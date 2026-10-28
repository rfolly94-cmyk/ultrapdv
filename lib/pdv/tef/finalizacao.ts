import "server-only";

import {
  avaliarParcelasCartao,
  cartaoVinculadoSemHabilitacao,
  MENSAGEM_HABILITAR_TEF,
  operacaoManualAceita,
  type PoliticaCartaoTef,
} from "@/lib/pdv/tef/cartao-checkout";
import {
  formaDaModalidadeEfetiva,
  mensagemFormaAusente,
} from "@/lib/pdv/tef/modalidade-efetiva";
import { classificarFormaTef, validarPagamentoMisto, type ModalidadeTef } from "@/lib/pdv/tef/regras";
import { hashSegredoVinculo } from "@/lib/pdv/tef/prova";
import { dadosFiscaisDoMotor, type DadosFiscaisMotor } from "@/lib/pdv/tef/fiscal-motor";
import { decidirComprovanteMotor, decidirRegistroVendaMotor, decidirTratamentoComprovante, escolherConsultaJournal } from "@/lib/pdv/tef/motor-csharp";
import { carregarConfiguracaoMotor } from "@/lib/pdv/tef/politica-empresa-servidor";
import {
  ErroTef,
  lerHabilitacaoTef,
  marcarPendenciaFormaTefPersistida,
  vincularOperacoesTefNaVenda,
} from "@/lib/pdv/tef/persistencia";

type PagamentoTef = {
  formaPagamentoId: string;
  valorCentavos: number;
  tefOperacaoId?: string | null;
  tefVinculoSegredo?: string | null;
  cartaoManual?: boolean | null;
  motorChave?: string | null;
};

const MENSAGEM_HOMOLOGACAO_SEM_CONFIRMACAO =
  "Débito e crédito usam o TEF de homologação. A venda não foi registrada porque a biblioteca ainda não confirmou o pagamento.";

const MENSAGEM_CHAVE_NAO_COMPROVADA =
  "A venda não foi registrada porque o Connector não comprovou esta operação e este valor. Nenhuma nova cobrança foi iniciada.";

const MENSAGEM_PRODUCAO_BLOQUEADA =
  "A produção TEF continua bloqueada. Nenhuma cobrança foi iniciada.";

const MENSAGEM_CONSULTA_TEF =
  "Não foi possível validar o TEF. O cartão não foi registrado.";

async function codigoJournalMotor(origem: string, empresaId: string, chave: string, valorCentavos: number, ambiente: 0 | 1) {
  const vazio = { codigo: "", vendaId: null as string | null, fiscal: null as DadosFiscaisMotor | null };
  let url: URL;
  try {
    url = new URL(origem);
  } catch {
    return vazio;
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    return vazio;
  }
  try {
    const resposta = await fetch(new URL("/tef/csharp", url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comando: "situacao",
        empresaId,
        ambiente,
        finalidade: ambiente === 0 ? "consulta_producao" : undefined,
        chave,
        valorCentavos,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const corpo = (await resposta.json().catch(() => null)) as { codigo?: unknown; vendaId?: unknown; fiscal?: unknown } | null;
    const vendaId = typeof corpo?.vendaId === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(corpo.vendaId)
      ? corpo.vendaId
      : null;
    return {
      codigo: typeof corpo?.codigo === "string" ? corpo.codigo : "",
      vendaId,
      fiscal: dadosFiscaisDoMotor(corpo?.fiscal),
    };
  } catch {
    return vazio;
  }
}

async function localizarJournalDaOperacao(
  origem: string,
  empresaId: string,
  chave: string,
  valorCentavos: number,
  preferido: "producao" | "homologacao",
): Promise<{
  ambiente: "producao" | "homologacao";
  consulta: { codigo: string; vendaId: string | null; fiscal: DadosFiscaisMotor | null };
}> {
  const vazio = { codigo: "", vendaId: null as string | null, fiscal: null as DadosFiscaisMotor | null };
  const preferida = await codigoJournalMotor(origem, empresaId, chave, valorCentavos, preferido === "producao" ? 0 : 1);
  const outroAmbiente = preferido === "producao" ? "homologacao" : "producao";
  const outra = await codigoJournalMotor(origem, empresaId, chave, valorCentavos, outroAmbiente === "producao" ? 0 : 1);
  const escolha = escolherConsultaJournal({
    preferido,
    codigoPreferido: preferida.codigo,
    codigoOutro: outra.codigo,
  });
  if (escolha === "outro") {
    return { ambiente: outroAmbiente, consulta: outra };
  }
  return { ambiente: preferido, consulta: preferida.codigo ? preferida : vazio };
}

export async function validarTefNaFinalizacao(input: {
  supabase: {
    from: (tabela: string) => {
      select: (colunas: string) => any;
    };
  };
  empresaId: string;
  usuarioId: string;
  pagamentos: PagamentoTef[];
  motorOrigem?: string | null;
  ambienteCobranca?: "producao" | "homologacao" | null;
}) {
  const comprovantes = input.pagamentos.filter((pagamento) => pagamento.motorChave);
  if (comprovantes.length > 0) {
    const oficial = await carregarConfiguracaoMotor(input.empresaId);
    const ambiente = oficial.existe && oficial.ambiente === "producao"
      ? "producao"
      : oficial.existe && oficial.ambiente === "homologacao"
        ? "homologacao"
        : "";
    if (!ambiente) {
      return {
        ok: false as const,
        erro: "A configuração TEF da empresa não foi resolvida. A venda não foi registrada e nenhuma nova cobrança foi iniciada.",
        operacaoIds: [] as string[],
      };
    }
    let suprimirNfceComercial = false;
    let vendaJaRegistradaId = "";
    let registraNova = false;
    let ambienteOperacao = ambiente;
    const fiscaisMotor: Array<{ chave: string; valorCentavos: number; fiscal: DadosFiscaisMotor }> = [];
    for (const pagamento of comprovantes) {
      const chave = pagamento.motorChave ?? "";
      const modalidade = chave.split(":").at(-2) ?? "";
      const localizado = input.motorOrigem
        ? await localizarJournalDaOperacao(
            input.motorOrigem,
            input.empresaId,
            chave,
            pagamento.valorCentavos,
            input.ambienteCobranca === "producao" || input.ambienteCobranca === "homologacao"
              ? input.ambienteCobranca
              : ambiente,
          )
        : {
            ambiente: ambiente === "producao" ? "producao" : "homologacao",
            consulta: { codigo: "", vendaId: null, fiscal: null },
          };
      const consulta = localizado.consulta;
      const ambienteDaOperacao = localizado.ambiente === "producao" ? "producao" : "homologacao";
      ambienteOperacao = ambienteDaOperacao;
      const decisao = decidirRegistroVendaMotor({
        ambiente: ambienteDaOperacao,
        codigo: consulta.codigo,
        chave,
        modalidade,
        valorCentavos: pagamento.valorCentavos,
        empresaSessao: input.empresaId,
        empresaJournal: input.empresaId,
        vendaId: consulta.vendaId,
      });
      if (decisao.acao === "recusar") {
        return { ok: false as const, erro: decisao.erro, operacaoIds: [] as string[] };
      }
      if (decisao.acao === "ja_registrada") {
        if (vendaJaRegistradaId && vendaJaRegistradaId !== decisao.vendaId) {
          return {
            ok: false as const,
            erro: "Os pagamentos confirmados já pertencem a vendas diferentes. Nenhuma nova venda foi criada e nenhuma nova cobrança foi iniciada.",
            operacaoIds: [] as string[],
          };
        }
        vendaJaRegistradaId = decisao.vendaId;
      } else {
        registraNova = true;
      }
      if (decisao.suprimirNfce) suprimirNfceComercial = true;
      if (
        consulta.fiscal &&
        (decisao.acao === "registrar_producao" || decisao.acao === "registrar_homologacao" || decisao.acao === "ja_registrada")
      ) {
        fiscaisMotor.push({
          chave,
          valorCentavos: pagamento.valorCentavos,
          fiscal: consulta.fiscal,
        });
      }
    }
    if (vendaJaRegistradaId && registraNova) {
      return {
        ok: false as const,
        erro: "Este pagamento confirmado já está vinculado a uma venda. Ele não pode ser usado em outra venda. Nenhuma nova cobrança foi iniciada.",
        operacaoIds: [] as string[],
      };
    }
    return {
      ok: true as const,
      operacaoIds: [] as string[],
      segredos: {},
      ajustes: [] as Array<{ indice: number; formaPagamentoId: string; aviso: string | null }>,
      suprimirNfceComercial,
      motorComprovado: true as const,
      ambienteMotor: ambienteOperacao,
      vendaJaRegistradaId,
      fiscaisMotor,
    };
  }

  let habilitacao: Awaited<ReturnType<typeof lerHabilitacaoTef>> | null;
  try {
    habilitacao = await lerHabilitacaoTef(input.supabase, input.empresaId);
  } catch (error) {
    if (error instanceof ErroTef && error.status === 503) {
      habilitacao = {
        habilitado: false,
        plataformaHabilitada: false,
        empresaHabilitada: false,
        permitirOperacaoManual: false,
        operacaoManualDisponivel: false,
        migracaoPendente: true,
        ambiente: "homologacao",
        ambienteGravado: "",
        estabelecimento: "",
        pontoCaptura: "",
      };
    } else {
      habilitacao = null;
    }
  }

  if (!habilitacao) {
    const bloqueio = await bloquearCartaoSeConsultaFalhou(input);
    if (bloqueio) {
      return bloqueio;
    }
    return { ok: true as const, operacaoIds: [] as string[], segredos: {}, ajustes: [] };
  }

  const informouTef = input.pagamentos.some((pagamento) => pagamento.tefOperacaoId);
  let suprimirNfceComercial = false;
  if (
    (habilitacao.ambienteGravado === "homologacao" || habilitacao.ambienteGravado === "producao") &&
    !informouTef
  ) {
    const idsForma = [...new Set(input.pagamentos.map((item) => item.formaPagamentoId))];
    const consultaFormas = idsForma.length
      ? await input.supabase
          .from("formas_pagamento")
          .select("id, codigo, nome, tipo, codigo_fiscal, permite_fiado")
          .eq("empresa_id", input.empresaId)
          .in("id", idsForma)
      : { data: [], error: null };
    const { data: formas, error } = consultaFormas;
    if (error) {
      return {
        ok: false as const,
        erro: "Não foi possível validar as formas de pagamento.",
        operacaoIds: [] as string[],
      };
    }
    if (
      cartaoVinculadoSemHabilitacao({
        ambiente: habilitacao.ambienteGravado,
        empresaHabilitada: habilitacao.empresaHabilitada,
        formas: (formas ?? []).map((forma: Record<string, unknown>) => ({
          codigo: forma.codigo ? String(forma.codigo) : null,
          nome: forma.nome ? String(forma.nome) : null,
          tipo: forma.tipo ? String(forma.tipo) : null,
          codigo_fiscal: forma.codigo_fiscal ? String(forma.codigo_fiscal) : null,
          permite_fiado: forma.permite_fiado === true,
        })),
      })
    ) {
      const comprovante = input.pagamentos.find((pagamento) => pagamento.motorChave);
      const oficial = await carregarConfiguracaoMotor(input.empresaId);
      const ambienteReal = oficial.existe && oficial.ambiente === "producao" ? "producao" : "homologacao";
      const consulta = comprovante?.motorChave && input.motorOrigem
        ? await codigoJournalMotor(
            input.motorOrigem,
            input.empresaId,
            comprovante.motorChave,
            comprovante.valorCentavos,
            ambienteReal === "producao" ? 0 : 1,
          )
        : { codigo: "", vendaId: null };
      const tratamento = decidirTratamentoComprovante({
        ambiente: ambienteReal,
        codigo: consulta.codigo,
        temChave: Boolean(comprovante?.motorChave),
      });
      if (tratamento.acao === "registrar_producao") {
        return {
          ok: true as const,
          operacaoIds: [] as string[],
          segredos: {},
          ajustes: [] as Array<{ indice: number; formaPagamentoId: string; aviso: string | null }>,
          suprimirNfceComercial: false,
          motorComprovado: true as const,
          ambienteMotor: "producao" as const,
        };
      }
      if (tratamento.acao === "recusar") {
        return { ok: false as const, erro: tratamento.erro, operacaoIds: [] as string[] };
      }
      if (tratamento.acao === "aceitar_homologacao") {
        suprimirNfceComercial = true;
      }
      const decisao = tratamento.acao === "aceitar_homologacao"
        ? "aceitar"
        : decidirComprovanteMotor({ ambienteGravado: habilitacao.ambienteGravado, codigo: consulta.codigo });
      if (decisao === "aceitar") {
        suprimirNfceComercial = true;
      } else {
        const erro = comprovante?.motorChave
          ? MENSAGEM_CHAVE_NAO_COMPROVADA
          : decisao === "producao_bloqueada"
            ? MENSAGEM_PRODUCAO_BLOQUEADA
            : habilitacao.ambienteGravado === "homologacao"
              ? MENSAGEM_HOMOLOGACAO_SEM_CONFIRMACAO
              : MENSAGEM_HABILITAR_TEF;
        return { ok: false as const, erro, operacaoIds: [] as string[] };
      }
    }
  }
  if (!habilitacao.empresaHabilitada && !informouTef) {
    return { ok: true as const, operacaoIds: [] as string[], segredos: {}, ajustes: [], suprimirNfceComercial };
  }

  if (habilitacao.migracaoPendente && informouTef) {
    return {
      ok: false as const,
      erro: "A estrutura de TEF ainda não foi aplicada neste ambiente.",
      operacaoIds: [] as string[],
    };
  }

  const idsForma = [...new Set(input.pagamentos.map((item) => item.formaPagamentoId))];
  const { data: formas, error } = await input.supabase
    .from("formas_pagamento")
    .select("id, codigo, nome, tipo, codigo_fiscal, permite_fiado, permite_troco")
    .eq("empresa_id", input.empresaId)
    .in("id", idsForma);
  if (error) {
    return {
      ok: false as const,
      erro: "Não foi possível validar as formas de pagamento.",
      operacaoIds: [] as string[],
    };
  }

  const parcelas = input.pagamentos.map((pagamento) => {
    const forma =
      (formas ?? []).find((item: Record<string, unknown>) => String(item.id) === pagamento.formaPagamentoId) ??
      null;
    return {
      modalidade: classificarFormaTef(
        forma
          ? {
              codigo: forma.codigo ? String(forma.codigo) : null,
              nome: forma.nome ? String(forma.nome) : null,
              tipo: forma.tipo ? String(forma.tipo) : null,
              codigo_fiscal: forma.codigo_fiscal ? String(forma.codigo_fiscal) : null,
              permite_fiado: forma.permite_fiado === true,
            }
          : null
      ),
      valorCentavos: pagamento.valorCentavos,
      tefOperacaoId: pagamento.tefOperacaoId,
      operacaoManual: pagamento.cartaoManual === true,
      permiteTroco: forma?.permite_troco === true,
      usuarioId: input.usuarioId,
      segredoVinculoHash: pagamento.tefVinculoSegredo
        ? hashSegredoVinculo(pagamento.tefVinculoSegredo)
        : "",
    };
  });

  const politica: PoliticaCartaoTef = {
    plataformaHabilitada: habilitacao.plataformaHabilitada,
    empresaHabilitada: habilitacao.empresaHabilitada,
    permitirOperacaoManual: habilitacao.permitirOperacaoManual,
  };
  const decisao = avaliarParcelasCartao(politica, parcelas);
  if (!decisao.ok) {
    return { ok: false as const, erro: decisao.erro, operacaoIds: [] as string[] };
  }
  const parcelasProva = parcelas.map((parcela) =>
    operacaoManualAceita(politica, parcela)
      ? { ...parcela, modalidade: null, tefOperacaoId: null }
      : parcela
  );

  const ids = parcelasProva
    .map((parcela) => parcela.tefOperacaoId)
    .filter((id): id is string => Boolean(id));
  const { data: operacoes, error: erroOps } = ids.length
    ? await input.supabase
        .from("tef_operacoes")
        .select(
          "id, empresa_id, modalidade, valor_centavos, status, venda_id, teste, nsu, autorizacao, rede, instituicao, bandeira_nome, usuario_id, segredo_vinculo_hash, ambiente_efetivo"
        )
        .eq("empresa_id", input.empresaId)
        .in("id", ids)
    : { data: [], error: null };

  if (erroOps) {
    const detalhe = `${erroOps.code ?? ""} ${erroOps.message ?? ""}`;
    return {
      ok: false as const,
      erro: /42703|PGRST204|ambiente_efetivo/i.test(detalhe)
        ? "A comprovação de ambiente do TEF ainda não está disponível. A venda não foi finalizada."
        : "Não foi possível validar o TEF.",
      operacaoIds: [] as string[],
    };
  }

  const formasTef = (formas ?? []).map((item: Record<string, unknown>) => ({
    id: String(item.id),
    codigo: item.codigo ? String(item.codigo) : null,
    nome: item.nome ? String(item.nome) : null,
    tipo: item.tipo ? String(item.tipo) : null,
    codigo_fiscal: item.codigo_fiscal ? String(item.codigo_fiscal) : null,
    permite_fiado: item.permite_fiado === true,
  }));
  const ajustes: Array<{
    indice: number;
    formaPagamentoId: string;
    aviso: string | null;
  }> = [];
  const parcelasAlinhadas = parcelasProva.map((parcela, indice) => {
    if (!parcela.modalidade || !parcela.tefOperacaoId) {
      return parcela;
    }
    const operacao = (operacoes ?? []).find(
      (item: Record<string, unknown>) => String(item.id) === parcela.tefOperacaoId
    );
    const efetiva: ModalidadeTef | null =
      operacao?.modalidade === "credito" || operacao?.modalidade === "debito"
        ? operacao.modalidade
        : null;
    if (!efetiva || efetiva === parcela.modalidade) {
      return parcela;
    }
    const forma = formaDaModalidadeEfetiva(
      formasTef,
      efetiva,
      input.pagamentos[indice]?.formaPagamentoId
    );
    if (!forma) {
      return parcela;
    }
    ajustes.push({
      indice,
      formaPagamentoId: forma.id,
      aviso:
        efetiva === "credito"
          ? "Pagamento aprovado no crédito"
          : "Pagamento aprovado no débito",
    });
    return { ...parcela, modalidade: efetiva };
  });
  const semForma = parcelasProva.find((parcela, indice) => {
    if (!parcela.modalidade || !parcela.tefOperacaoId) {
      return false;
    }
    const operacao = (operacoes ?? []).find(
      (item: Record<string, unknown>) => String(item.id) === parcela.tefOperacaoId
    );
    const efetiva = operacao?.modalidade === "credito" || operacao?.modalidade === "debito"
      ? operacao.modalidade
      : null;
    return Boolean(efetiva && efetiva !== parcela.modalidade && !ajustes.some((item) => item.indice === indice));
  });
  if (semForma) {
    const operacao = (operacoes ?? []).find(
      (item: Record<string, unknown>) => String(item.id) === semForma.tefOperacaoId
    );
    const efetiva = operacao?.modalidade === "credito" ? "credito" : "debito";
    if (semForma.tefOperacaoId) {
      await marcarPendenciaFormaTefPersistida({
        empresaId: input.empresaId,
        operacaoId: semForma.tefOperacaoId,
      }).catch(() => undefined);
    }
    return {
      ok: false as const,
      erro: mensagemFormaAusente(efetiva),
      operacaoIds: [] as string[],
    };
  }

  const avaliacao = validarPagamentoMisto(
    parcelasAlinhadas,
    (operacoes ?? []).map((linha: Record<string, unknown>) => ({
      id: String(linha.id),
      empresaId: String(linha.empresa_id),
      modalidade: linha.modalidade === "credito" ? "credito" : "debito",
      valorCentavos: Number(linha.valor_centavos),
      status: linha.status as "autorizada",
      vendaId: linha.venda_id ? String(linha.venda_id) : null,
      teste: linha.teste === true,
      nsu: linha.nsu ? String(linha.nsu) : null,
      autorizacao: linha.autorizacao ? String(linha.autorizacao) : null,
      rede: linha.rede ? String(linha.rede) : null,
      instituicao: linha.instituicao ? String(linha.instituicao) : null,
      nomeBandeiraPadrao: linha.bandeira_nome ? String(linha.bandeira_nome) : null,
      usuarioId: linha.usuario_id ? String(linha.usuario_id) : "",
      segredoVinculoHash: linha.segredo_vinculo_hash
        ? String(linha.segredo_vinculo_hash)
        : "",
      ambienteEfetivo: linha.ambiente_efetivo ? String(linha.ambiente_efetivo) : "",
    })),
    input.empresaId
  );
  if (!avaliacao.ok) {
    return { ok: false as const, erro: avaliacao.erro, operacaoIds: [] as string[] };
  }
  const segredos: Record<string, string> = {};
  for (const parcela of parcelas) {
    if (parcela.tefOperacaoId && parcela.segredoVinculoHash) {
      segredos[parcela.tefOperacaoId] = parcela.segredoVinculoHash;
    }
  }
  return { ok: true as const, operacaoIds: avaliacao.operacaoIds, segredos, ajustes };
}

async function bloquearCartaoSeConsultaFalhou(input: {
  supabase: {
    from: (tabela: string) => {
      select: (colunas: string) => any;
    };
  };
  empresaId: string;
  pagamentos: PagamentoTef[];
}) {
  if (input.pagamentos.some((pagamento) => pagamento.tefOperacaoId || pagamento.cartaoManual)) {
    return {
      ok: false as const,
      erro: MENSAGEM_CONSULTA_TEF,
      operacaoIds: [] as string[],
    };
  }
  const idsForma = [...new Set(input.pagamentos.map((item) => item.formaPagamentoId))];
  if (idsForma.length === 0) {
    return null;
  }
  const { data: formas, error } = await input.supabase
    .from("formas_pagamento")
    .select("id, codigo, nome, tipo, codigo_fiscal, permite_fiado")
    .eq("empresa_id", input.empresaId)
    .in("id", idsForma);
  if (error) {
    return {
      ok: false as const,
      erro: MENSAGEM_CONSULTA_TEF,
      operacaoIds: [] as string[],
    };
  }
  const temCartao = input.pagamentos.some((pagamento) => {
    const forma =
      (formas ?? []).find(
        (item: Record<string, unknown>) => String(item.id) === pagamento.formaPagamentoId
      ) ?? null;
    return (
      classificarFormaTef(
        forma
          ? {
              codigo: forma.codigo ? String(forma.codigo) : null,
              nome: forma.nome ? String(forma.nome) : null,
              tipo: forma.tipo ? String(forma.tipo) : null,
              codigo_fiscal: forma.codigo_fiscal ? String(forma.codigo_fiscal) : null,
              permite_fiado: forma.permite_fiado === true,
            }
          : null
      ) != null
    );
  });
  if (!temCartao) {
    return null;
  }
  return {
    ok: false as const,
    erro: MENSAGEM_CONSULTA_TEF,
    operacaoIds: [] as string[],
  };
}

export async function vincularJournalNaVenda(input: {
  origem: string;
  empresaId: string;
  chave: string;
  vendaId: string;
  valorCentavos: number;
  ambiente: 0 | 1;
}) {
  let url: URL;
  try {
    url = new URL(input.origem);
  } catch {
    return false;
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return false;
  try {
    const resposta = await fetch(new URL("/tef/csharp", url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comando: "vincular",
        empresaId: input.empresaId,
        ambiente: input.ambiente,
        finalidade: input.ambiente === 0 ? "vinculo_producao" : undefined,
        chave: input.chave,
        vendaId: input.vendaId,
        valorCentavos: input.valorCentavos,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const corpo = (await resposta.json().catch(() => null)) as { codigo?: unknown } | null;
    return corpo?.codigo === "vinculada";
  } catch {
    return false;
  }
}

export async function vincularTefNaVenda(input: {
  empresaId: string;
  vendaId: string;
  usuarioId: string;
  operacaoIds: string[];
  segredos: Record<string, string>;
}) {
  try {
    return await vincularOperacoesTefNaVenda(input);
  } catch {
    return { confirmacaoLiberada: false };
  }
}
