import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  iniciarOperacao,
  liberarConfirmacao,
  listarPendencias,
  marcarPendenciaAdministrativa,
  marcarConfirmada,
  marcarDesfeita,
  memoriaTefVazia,
  operacoesParaGravar,
  pedirDesfazimento,
  registrarResultado,
  reservarOperacoesParaVenda,
  salvarConfigEmpresa,
  vincularVenda,
  type MemoriaTef,
  type OperacaoTef,
  type TerminalTef,
} from "@/lib/pdv/tef/orquestracao";
import {
  decidirPorEvidencia,
  hashComprovante,
  juntarComprovante,
} from "@/lib/pdv/tef/ambiente-transacao";
import {
  formaDaModalidadeEfetiva,
  mensagemFormaAusente,
  tipoCartaoOficial,
} from "@/lib/pdv/tef/modalidade-efetiva";
import {
  dadosFiscaisProvaTef,
  hashSegredoVinculo,
  verificarAmbienteTef,
  verificarIdentidadeTef,
  verificarModalidadeTef,
  verificarProvaTef,
  type CamposProvaTef,
} from "@/lib/pdv/tef/prova";
import {
  STATUS_TEF_ABERTOS,
  type ModalidadeTef,
  type ResultadoConectorTef,
} from "@/lib/pdv/tef/regras";
import type { TerminalTefAtivo } from "@/lib/pdv/tef/estado-terminal";
import type {
  ConfiguracaoSincronizacao,
  TerminalSincronizacao,
} from "@/lib/pdv/tef/sincronizar-vinculo";
import { validarServidorPayGo } from "@/lib/pdv/tef/servidor-paygo";

export class ErroTef extends Error {
  status: number;

  constructor(mensagem: string, status = 400) {
    super(mensagem);
    this.name = "ErroTef";
    this.status = status;
  }
}

type Linha = Record<string, unknown>;

function admin() {
  return createAdminClient();
}

function migracaoAusente(error: { code?: string; message?: string } | null) {
  const texto = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /PGRST205|42P01|does not exist|schema cache/i.test(texto);
}

function colunaServidorAusente(error: { code?: string; message?: string } | null) {
  const texto = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /42703|PGRST204|servidor_homologacao|servidor_producao|servidor_confirmado/i.test(texto);
}

function colunaOperacaoManualAusente(error: { code?: string; message?: string } | null) {
  const texto = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /42703|PGRST204|permitir_operacao_manual/i.test(texto);
}

function colunaAmbienteAusente(error: { code?: string; message?: string } | null) {
  const texto = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /42703|PGRST204|ambiente_efetivo|ponto_efetivo|host_efetivo|comprovante_sha256|motivo_ambiente/i.test(
    texto
  );
}

function colunaModalidadeAusente(error: { code?: string; message?: string } | null) {
  const texto = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /modalidade_solicitada|modalidade_efetiva|tipo_cartao_paygo/i.test(texto);
}

function colunaFiscalCartaoAusente(error: { code?: string; message?: string } | null) {
  const texto = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /42703|PGRST204|bandeira_nome|cnpj_credenciadora|cnpj_recebedor|instituicao/i.test(texto);
}

function habilitacaoTefVazia(migracaoPendente: boolean) {
  return {
    habilitado: false,
    plataformaHabilitada: false,
    empresaHabilitada: false,
    permitirOperacaoManual: false,
    operacaoManualDisponivel: false,
    migracaoPendente,
    ambiente: "homologacao",
    estabelecimento: "",
    pontoCaptura: "",
  };
}

function linhaOperacao(linha: Linha): OperacaoTef {
  return {
    id: String(linha.id),
    empresaId: String(linha.empresa_id),
    terminalId: String(linha.terminal_id),
    identificador: String(linha.identificador),
    idempotencyKey: String(linha.idempotency_key),
    modalidade: linha.modalidade === "credito" ? "credito" : "debito",
    modalidadeSolicitada:
      linha.modalidade_solicitada === "credito" || linha.modalidade_solicitada === "debito"
        ? linha.modalidade_solicitada
        : linha.modalidade === "credito"
          ? "credito"
          : "debito",
    modalidadeEfetiva:
      linha.modalidade_efetiva === "credito" || linha.modalidade_efetiva === "debito"
        ? linha.modalidade_efetiva
        : null,
    tipoCartaoPayGo:
      typeof linha.tipo_cartao_paygo === "number" &&
      Number.isInteger(linha.tipo_cartao_paygo)
        ? linha.tipo_cartao_paygo
        : null,
    valorCentavos: Number(linha.valor_centavos),
    status: linha.status as OperacaoTef["status"],
    nsu: linha.nsu ? String(linha.nsu) : null,
    autorizacao: linha.autorizacao ? String(linha.autorizacao) : null,
    rede: linha.rede ? String(linha.rede) : null,
    finalizacao: linha.finalizacao ? String(linha.finalizacao) : null,
    vendaId: linha.venda_id ? String(linha.venda_id) : null,
    teste: linha.teste === true,
    desafio: linha.desafio ? String(linha.desafio) : "",
    usuarioId: linha.usuario_id ? String(linha.usuario_id) : "",
    segredoVinculoHash: linha.segredo_vinculo_hash
      ? String(linha.segredo_vinculo_hash)
      : "",
    vendaIdempotencyKey: linha.venda_idempotency_key
      ? String(linha.venda_idempotency_key)
      : "",
    ambienteEfetivo:
      linha.ambiente_efetivo === "producao" ||
      linha.ambiente_efetivo === "homologacao" ||
      linha.ambiente_efetivo === "desconhecido"
        ? linha.ambiente_efetivo
        : "",
    pontoEfetivo: linha.ponto_efetivo ? String(linha.ponto_efetivo) : "",
    hostEfetivo: linha.host_efetivo ? String(linha.host_efetivo) : "",
    comprovanteSha256: linha.comprovante_sha256 ? String(linha.comprovante_sha256) : "",
    motivoAmbiente: linha.motivo_ambiente ? String(linha.motivo_ambiente) : "",
  };
}

function payloadOperacao(operacao: OperacaoTef) {
  return {
    id: operacao.id,
    empresa_id: operacao.empresaId,
    terminal_id: operacao.terminalId,
    identificador: operacao.identificador,
    idempotency_key: operacao.idempotencyKey,
    modalidade: operacao.modalidade,
    modalidade_solicitada: operacao.modalidadeSolicitada ?? operacao.modalidade,
    modalidade_efetiva: operacao.modalidadeEfetiva ?? null,
    tipo_cartao_paygo: operacao.tipoCartaoPayGo ?? null,
    valor_centavos: operacao.valorCentavos,
    status: operacao.status,
    nsu: operacao.nsu,
    autorizacao: operacao.autorizacao,
    rede: operacao.rede,
    finalizacao: operacao.finalizacao,
    venda_id: operacao.vendaId,
    teste: operacao.teste,
    desafio: operacao.desafio,
    usuario_id: operacao.usuarioId,
    segredo_vinculo_hash: operacao.segredoVinculoHash,
    venda_idempotency_key: operacao.vendaIdempotencyKey || null,
    ambiente_efetivo: operacao.ambienteEfetivo || "",
    ponto_efetivo: (operacao.pontoEfetivo || "").slice(0, 32),
    host_efetivo: (operacao.hostEfetivo || "").slice(0, 120),
    comprovante_sha256: (operacao.comprovanteSha256 || "").slice(0, 64),
    motivo_ambiente: (operacao.motivoAmbiente || "").slice(0, 400),
    updated_at: new Date().toISOString(),
  };
}

async function gravarDadosFiscaisOperacao(
  cliente: ReturnType<typeof admin>,
  operacao: OperacaoTef
) {
  const { error } = await cliente
    .from("tef_operacoes")
    .update({
      bandeira_nome: operacao.bandeiraNome ?? null,
      cnpj_credenciadora: operacao.cnpjCredenciadora ?? null,
      cnpj_recebedor: operacao.cnpjRecebedor ?? null,
      instituicao: operacao.instituicao ?? null,
    } as never)
    .eq("id", operacao.id)
    .eq("empresa_id", operacao.empresaId);
  if (error && !colunaFiscalCartaoAusente(error)) {
    throw new ErroTef("Não foi possível gravar os dados fiscais do TEF.", 500);
  }
}

const COLUNAS_FISCAIS_TEF =
  "id, modalidade, valor_centavos, status, autorizacao, nsu, rede, bandeira_nome, cnpj_credenciadora, cnpj_recebedor, instituicao";
const COLUNAS_FISCAIS_TEF_BASE =
  "id, modalidade, valor_centavos, status, autorizacao, nsu, rede";

function mapearOperacaoFiscal(linha: Linha) {
  return {
    id: String(linha.id),
    modalidade: linha.modalidade === "credito" ? ("credito" as const) : ("debito" as const),
    valorCentavos: Number(linha.valor_centavos),
    status: String(linha.status),
    autorizacao: linha.autorizacao ? String(linha.autorizacao) : null,
    nsu: linha.nsu ? String(linha.nsu) : null,
    rede: linha.rede ? String(linha.rede) : null,
    bandeiraNome: linha.bandeira_nome ? String(linha.bandeira_nome) : null,
    cnpjCredenciadora: linha.cnpj_credenciadora ? String(linha.cnpj_credenciadora) : null,
    cnpjRecebedor: linha.cnpj_recebedor ? String(linha.cnpj_recebedor) : null,
    instituicao: linha.instituicao ? String(linha.instituicao) : null,
  };
}

async function consultarOperacoesFiscais(
  filtro: (consulta: any) => any
) {
  const cliente = admin();
  const completa = await filtro(cliente.from("tef_operacoes").select(COLUNAS_FISCAIS_TEF));
  if (!completa.error) {
    return ((completa.data ?? []) as Linha[]).map(mapearOperacaoFiscal);
  }
  if (!colunaFiscalCartaoAusente(completa.error)) {
    if (migracaoAusente(completa.error)) {
      return [];
    }
    throw new ErroTef("Não foi possível consultar os dados fiscais do TEF.", 500);
  }
  const base = await filtro(cliente.from("tef_operacoes").select(COLUNAS_FISCAIS_TEF_BASE));
  if (base.error) {
    if (migracaoAusente(base.error)) {
      return [];
    }
    throw new ErroTef("Não foi possível consultar os dados fiscais do TEF.", 500);
  }
  return ((base.data ?? []) as Linha[]).map(mapearOperacaoFiscal);
}

export async function listarDadosFiscaisTefDaVenda(empresaId: string, vendaId: string) {
  return consultarOperacoesFiscais((consulta) =>
    consulta.eq("empresa_id", empresaId).eq("venda_id", vendaId)
  );
}

export async function listarDadosFiscaisTefPorIds(empresaId: string, ids: string[]) {
  if (ids.length === 0) {
    return [];
  }
  return consultarOperacoesFiscais((consulta) =>
    consulta.eq("empresa_id", empresaId).in("id", ids)
  );
}

const COLUNAS_OPERACAO_TEF_BASE =
  "id, empresa_id, terminal_id, identificador, idempotency_key, modalidade, valor_centavos, status, nsu, autorizacao, rede, finalizacao, venda_id, teste, desafio, usuario_id, segredo_vinculo_hash, venda_idempotency_key, ambiente_efetivo, ponto_efetivo, host_efetivo, comprovante_sha256, motivo_ambiente";

const COLUNAS_OPERACAO_TEF = `${COLUNAS_OPERACAO_TEF_BASE}, modalidade_solicitada, modalidade_efetiva, tipo_cartao_paygo`;

async function lerLinhasOperacao(
  consulta: (
    colunas: string
  ) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
) {
  const completa = await consulta(COLUNAS_OPERACAO_TEF);
  if (!completa.error) {
    return completa.data;
  }
  if (!colunaModalidadeAusente(completa.error)) {
    return exigirTabela(Promise.resolve(completa));
  }
  const base = await consulta(COLUNAS_OPERACAO_TEF_BASE);
  return exigirTabela(Promise.resolve(base));
}

async function exigirTabela<T>(consulta: PromiseLike<{ data: T; error: { code?: string; message?: string } | null }>) {
  const { data, error } = await consulta;
  if (error) {
    if (migracaoAusente(error)) {
      const detalhe = colunaAmbienteAusente(error)
        ? " Aplique supabase/migrations/20261013020000_tef_ambiente_efetivo.sql. A aplicação não altera NFC-e, vendas nem operações já gravadas."
        : "";
      throw new ErroTef(
        `A estrutura de TEF ainda não foi aplicada neste ambiente.${detalhe}`,
        503
      );
    }
    throw new ErroTef("Não foi possível consultar o TEF.", 500);
  }
  return data;
}

type ClienteLeitura = {
  from: (tabela: string) => {
    select: (colunas: string) => any;
  };
};

export async function lerHabilitacaoTef(
  supabase: ClienteLeitura,
  empresaId: string
) {
  const plataforma = await supabase
    .from("tef_plataforma")
    .select("habilitada")
    .eq("id", true)
    .maybeSingle();
  if (plataforma.error) {
    if (migracaoAusente(plataforma.error)) {
      return habilitacaoTefVazia(true);
    }
    throw new ErroTef("Não foi possível consultar o TEF.", 500);
  }
  const config = await supabase
    .from("tef_configuracoes")
    .select("habilitado, ambiente, estabelecimento, ponto_captura")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (config.error) {
    if (migracaoAusente(config.error)) {
      return habilitacaoTefVazia(true);
    }
    throw new ErroTef("Não foi possível consultar o TEF.", 500);
  }
  const manual = await supabase
    .from("tef_configuracoes")
    .select("permitir_operacao_manual")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  let permitirOperacaoManual = false;
  let operacaoManualDisponivel = false;
  if (manual.error) {
    if (!colunaOperacaoManualAusente(manual.error)) {
      if (migracaoAusente(manual.error)) {
        return habilitacaoTefVazia(true);
      }
      throw new ErroTef("Não foi possível consultar o TEF.", 500);
    }
  } else {
    operacaoManualDisponivel = true;
    permitirOperacaoManual = manual.data?.permitir_operacao_manual === true;
  }
  const empresaHabilitada = config.data?.habilitado === true;
  const plataformaHabilitada = plataforma.data?.habilitada === true;
  return {
    habilitado: plataformaHabilitada && empresaHabilitada,
    plataformaHabilitada,
    empresaHabilitada,
    permitirOperacaoManual,
    operacaoManualDisponivel,
    migracaoPendente: false,
    ambiente: config.data?.ambiente ? String(config.data.ambiente) : "homologacao",
    estabelecimento: config.data?.estabelecimento
      ? String(config.data.estabelecimento)
      : "",
    pontoCaptura: config.data?.ponto_captura ? String(config.data.ponto_captura) : "",
  };
}

async function carregarMemoria(
  empresaId: string,
  dispositivoId: string,
  idempotencyKey?: string
) {
  const cliente = admin();
  const memoria = memoriaTefVazia();
  memoria.criarId = () => randomUUID();
  const plataforma = await exigirTabela(
    cliente.from("tef_plataforma").select("habilitada").eq("id", true).maybeSingle()
  );
  memoria.plataformaHabilitada = plataforma?.habilitada === true;
  const config = await exigirTabela(
    cliente
      .from("tef_configuracoes")
      .select("habilitado, ambiente, estabelecimento, ponto_captura")
      .eq("empresa_id", empresaId)
      .maybeSingle()
  );
  if (config) {
    salvarConfigEmpresa(memoria, empresaId, {
      habilitado: config.habilitado === true,
      ambiente: config.ambiente === "producao" ? "producao" : "homologacao",
      estabelecimento: String(config.estabelecimento ?? ""),
      pontoCaptura: String(config.ponto_captura ?? ""),
    });
  }
  const terminais = await exigirTabela(
    cliente
      .from("tef_terminais")
      .select(
        "id, empresa_id, codigo, dispositivo_id, ativo, chave_publica, estabelecimento, ponto_captura, revogada_em"
      )
      .eq("dispositivo_id", dispositivoId)
  );
  memoria.terminais = ((terminais ?? []) as Linha[]).map(
    (linha): TerminalTef => ({
      id: String(linha.id),
      empresaId: String(linha.empresa_id),
      codigo: String(linha.codigo),
      dispositivoId: String(linha.dispositivo_id),
      ativo: linha.ativo !== false,
      chavePublica: linha.chave_publica ? String(linha.chave_publica) : "",
      estabelecimento: linha.estabelecimento ? String(linha.estabelecimento) : "",
      pontoCaptura: linha.ponto_captura ? String(linha.ponto_captura) : "",
      revogadaEm: linha.revogada_em ? String(linha.revogada_em) : null,
    })
  );
  const nosso = memoria.terminais.find(
    (item) => item.empresaId === empresaId && item.ativo
  );
  if (nosso) {
    const abertas = await lerLinhasOperacao((colunas) =>
      cliente
        .from("tef_operacoes")
        .select(colunas)
        .eq("empresa_id", empresaId)
        .eq("terminal_id", nosso.id)
        .in("status", [...STATUS_TEF_ABERTOS])
    );
    memoria.operacoes = ((abertas ?? []) as Linha[]).map(linhaOperacao);
  }
  if (idempotencyKey) {
    const existente = (await lerLinhasOperacao((colunas) =>
      cliente
        .from("tef_operacoes")
        .select(colunas)
        .eq("empresa_id", empresaId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle()
    )) as Linha | null;
    if (existente && !memoria.operacoes.some((item) => item.id === String(existente.id))) {
      memoria.operacoes.push(linhaOperacao(existente));
    }
  }
  return { cliente, memoria, antes: memoria.operacoes.map((item) => ({ ...item })) };
}

async function gravarMemoria(
  cliente: ReturnType<typeof admin>,
  antes: OperacaoTef[],
  memoria: MemoriaTef,
  empresaId: string,
  terminaisAntes: TerminalTef[]
) {
  for (const terminal of memoria.terminais) {
    if (terminal.empresaId !== empresaId) {
      continue;
    }
    if (terminaisAntes.some((item) => item.id === terminal.id)) {
      const anterior = terminaisAntes.find((item) => item.id === terminal.id);
      if (
        terminal.chavePublica &&
        anterior &&
        terminal.chavePublica !== anterior.chavePublica
      ) {
        const atualizacao = await cliente
          .from("tef_terminais")
          .update({ chave_publica: terminal.chavePublica })
          .eq("id", terminal.id)
          .eq("empresa_id", empresaId);
        if (atualizacao.error) {
          throw new ErroTef("Não foi possível registrar a chave do terminal TEF.", 500);
        }
      }
      continue;
    }
    const { error } = await cliente.from("tef_terminais").insert({
      id: terminal.id,
      empresa_id: empresaId,
      codigo: terminal.codigo,
      dispositivo_id: terminal.dispositivoId,
      ativo: true,
      chave_publica: terminal.chavePublica,
    });
    if (error) {
      if (error.code === "23505") {
        throw new ErroTef("Este terminal já está vinculado a outra empresa.", 409);
      }
      throw new ErroTef("Não foi possível registrar o terminal TEF.", 500);
    }
  }
  for (const operacao of operacoesParaGravar(antes, memoria.operacoes, empresaId)) {
    const payload = payloadOperacao(operacao);
    const nova = !antes.some((item) => item.id === operacao.id);
    const gravacao = nova
      ? await cliente.from("tef_operacoes").insert(payload)
      : await cliente
          .from("tef_operacoes")
          .update(payload)
          .eq("id", operacao.id)
          .eq("empresa_id", empresaId);
    let error = gravacao.error;
    if (error && colunaModalidadeAusente(error)) {
      const resto: Record<string, unknown> = { ...payload };
      delete resto.modalidade_solicitada;
      delete resto.modalidade_efetiva;
      delete resto.tipo_cartao_paygo;
      const reservaModalidade = nova
        ? await cliente.from("tef_operacoes").insert(resto)
        : await cliente
            .from("tef_operacoes")
            .update(resto)
            .eq("id", operacao.id)
            .eq("empresa_id", empresaId);
      error = reservaModalidade.error;
    }
    if (error && colunaAmbienteAusente(error)) {
      const resto: Record<string, unknown> = { ...payload };
      delete resto.modalidade_solicitada;
      delete resto.modalidade_efetiva;
      delete resto.tipo_cartao_paygo;
      delete resto.ambiente_efetivo;
      delete resto.ponto_efetivo;
      delete resto.host_efetivo;
      delete resto.comprovante_sha256;
      delete resto.motivo_ambiente;
      const reserva = nova
        ? await cliente.from("tef_operacoes").insert(resto)
        : await cliente
            .from("tef_operacoes")
            .update({
              status: payload.status,
              nsu: payload.nsu,
              autorizacao: payload.autorizacao,
              rede: payload.rede,
              finalizacao: payload.finalizacao,
              venda_id: payload.venda_id,
              teste: payload.teste,
              updated_at: payload.updated_at,
            })
            .eq("id", operacao.id)
            .eq("empresa_id", empresaId);
      error = reserva.error;
    }
    if (error) {
      if (error.code === "23505") {
        throw new ErroTef("Este terminal TEF já está em uma operação.", 409);
      }
      throw new ErroTef("Não foi possível gravar a operação TEF.", 500);
    }
  }
}

export async function iniciarTefPersistido(input: {
  empresaId: string;
  usuarioId: string;
  dispositivoId: string;
  modalidade: ModalidadeTef;
  valorCentavos: number;
  idempotencyKey: string;
  chavePublica: string;
  assinaturaIdentidade: string;
  grupoVenda?: string;
}) {
  if (
    !verificarIdentidadeTef(
      input.chavePublica,
      input.dispositivoId,
      input.assinaturaIdentidade
    )
  ) {
    throw new ErroTef("O Connector não comprovou a identidade do terminal.", 403);
  }
  const { cliente, memoria, antes } = await carregarMemoria(
    input.empresaId,
    input.dispositivoId,
    input.idempotencyKey
  );
  const terminaisAntes = memoria.terminais.map((item) => ({ ...item }));
  const proprio = memoria.terminais.find(
    (item) => item.empresaId === input.empresaId && item.ativo && !item.revogadaEm
  );
  if (!proprio?.chavePublica) {
    throw new ErroTef("Este computador ainda não foi autorizado pelo estabelecimento.", 403);
  }
  if (proprio.chavePublica !== input.chavePublica) {
    throw new ErroTef("A chave deste Connector não confere com o terminal autorizado.", 403);
  }
  const configEmpresa = memoria.configuracoes[input.empresaId];
  if (configEmpresa?.ambiente === "producao") {
    const referencia = await referenciasProducaoTef(cliente, input.empresaId, proprio.id);
    if (!referencia.pontoOficial || !referencia.hostOficial) {
      throw new ErroTef(
        "Defina o ponto e o servidor de produção do TEF antes de cobrar. A operação não foi iniciada. Abra Configurações, Financeiro, TEF.",
        409
      );
    }
  }
  const vinculoSegredo = randomBytes(32).toString("hex");
  const resultado = iniciarOperacao(memoria, {
    empresaId: input.empresaId,
    dispositivoId: input.dispositivoId,
    terminalCodigo: proprio.codigo,
    modalidade: input.modalidade,
    valorCentavos: input.valorCentavos,
    identificador: randomUUID(),
    idempotencyKey: input.idempotencyKey,
    usuarioId: input.usuarioId,
    desafio: randomBytes(32).toString("hex"),
    vinculoSegredo,
    segredoVinculoHash: hashSegredoVinculo(vinculoSegredo),
    chavePublica: input.chavePublica,
    estabelecimento: configEmpresa?.estabelecimento,
    pontoCaptura: configEmpresa?.pontoCaptura,
    exigirTerminalPareado: true,
    grupoVenda: input.grupoVenda,
  });
  if (!resultado.ok) {
    throw new ErroTef(resultado.erro, resultado.codigo === "TEF_DESABILITADO" ? 403 : 409);
  }
  await gravarMemoria(cliente, antes, memoria, input.empresaId, terminaisAntes);
  const terminal = memoria.terminais.find(
    (item) => item.id === resultado.terminalId && item.empresaId === input.empresaId
  );
  return {
    ok: true as const,
    operacaoId: resultado.operacaoId,
    identificador: resultado.identificador,
    valor: resultado.valor,
    modalidade: resultado.modalidade,
    status: resultado.status,
    terminalCodigo: terminal?.codigo ?? resultado.terminalCodigo,
    empresaId: input.empresaId,
    dispositivoId: input.dispositivoId,
    parear: false,
    jaAutorizada: resultado.jaAutorizada,
    emAndamento: resultado.emAndamento,
    repetida: resultado.repetida,
    recuperada: resultado.recuperada === true,
    cobrarDeNovo: resultado.cobrarDeNovo === true,
    diagnostico: resultado.diagnostico,
    modalidadeSolicitada: resultado.modalidadeSolicitada,
    modalidadeEfetiva: resultado.modalidadeEfetiva,
    avisoModalidade: resultado.avisoModalidade,
    desafio: resultado.repetida ? "" : resultado.desafio,
    vinculoSegredo: resultado.repetida ? "" : vinculoSegredo,
  };
}

async function memoriaDaOperacao(empresaId: string, operacaoId: string) {
  const cliente = admin();
  const memoria = memoriaTefVazia();
  const linha = (await lerLinhasOperacao((colunas) =>
    cliente
      .from("tef_operacoes")
      .select(colunas)
      .eq("empresa_id", empresaId)
      .eq("id", operacaoId)
      .maybeSingle()
  )) as Linha | null;
  if (!linha) {
    throw new ErroTef("Operação TEF não encontrada.", 404);
  }
  memoria.operacoes = [linhaOperacao(linha)];
  memoria.plataformaHabilitada = true;
  return { cliente, memoria, antes: memoria.operacoes.map((item) => ({ ...item })) };
}

async function chavePublicaDaOperacao(
  cliente: ReturnType<typeof admin>,
  operacao: OperacaoTef
) {
  const linha = await exigirTabela(
    cliente
      .from("tef_terminais")
      .select("chave_publica")
      .eq("empresa_id", operacao.empresaId)
      .eq("id", operacao.terminalId)
      .maybeSingle()
  );
  return linha?.chave_publica ? String(linha.chave_publica) : "";
}

function camposProvados(
  operacao: OperacaoTef,
  campos: Omit<CamposProvaTef, "desafio" | "identificador" | "valorCentavos">
): CamposProvaTef {
  return {
    ...campos,
    desafio: operacao.desafio,
    identificador: operacao.identificador,
    valorCentavos: operacao.valorCentavos,
  };
}

function textoLimitado(valor: unknown, maximo: number) {
  const texto = typeof valor === "string" ? valor : "";
  return texto.length > maximo ? "" : texto;
}

export async function registrarResultadoTefPersistido(input: {
  empresaId: string;
  operacaoId: string;
  resultado: ResultadoConectorTef;
  prova: string;
  provaAmbiente?: string;
  comprovante?: string;
  host?: string;
  pontoCaptura?: string;
  provaModalidade?: string;
}) {
  const { cliente, memoria, antes } = await memoriaDaOperacao(
    input.empresaId,
    input.operacaoId
  );
  const operacao = memoria.operacoes[0];
  if (!operacao) {
    throw new ErroTef("Operação TEF não encontrada.", 404);
  }
  const chave = await chavePublicaDaOperacao(cliente, operacao);
  const fiscal = dadosFiscaisProvaTef(input.resultado);
  const camposFinanceiros = {
    nsu: input.resultado.nsu ?? "",
    autorizacao: input.resultado.autorizacao || input.resultado.codigoAutorizacao || "",
    rede: input.resultado.rede ?? "",
    finalizacao: input.resultado.finalizacao || input.resultado.codigoFinalizacao || "",
  };
  const provaValida = verificarProvaTef(
    chave,
    camposProvados(operacao, {
      acao: "pagamento",
      ...camposFinanceiros,
      sucesso: input.resultado.sucessoTransacao === true,
      codigo: input.resultado.codigo ?? "",
      bandeira: fiscal.bandeira,
      cnpjCredenciadora: fiscal.cnpjCredenciadora,
      cnpjRecebedor: fiscal.cnpjRecebedor,
      instituicao: fiscal.instituicao,
    }),
    input.prova
  );
  const comprovante = textoLimitado(input.comprovante, 48000);
  const host = textoLimitado(input.host, 120).trim();
  const pontoCaptura = textoLimitado(input.pontoCaptura, 32).trim();
  const comprovanteSha256 = hashComprovante(comprovante);
  const assinaturaAmbiente = verificarAmbienteTef(
    chave,
    {
      desafio: operacao.desafio,
      identificador: operacao.identificador,
      valorCentavos: operacao.valorCentavos,
      ...camposFinanceiros,
      pontoCaptura,
      host,
      comprovanteSha256,
    },
    textoLimitado(input.provaAmbiente, 4096)
  );
  const referencia = await referenciasProducaoTef(cliente, input.empresaId, operacao.terminalId);
  const origem = decidirPorEvidencia({
    comprovante,
    host,
    pontoCaptura,
    pontoOficial: referencia.pontoOficial,
    hostOficial: referencia.hostOficial,
    assinaturaValida: assinaturaAmbiente,
    fluxoHomologacao: referencia.fluxoHomologacao,
  });
  const provaModalidade = textoLimitado(input.provaModalidade, 4096);
  const avaliarModalidade = provaModalidade.length > 0;
  const tipoCartao = tipoCartaoOficial(input.resultado.tipoCartao);
  const provaModalidadeValida =
    avaliarModalidade &&
    verificarModalidadeTef(
      chave,
      {
        desafio: operacao.desafio,
        identificador: operacao.identificador,
        valorCentavos: operacao.valorCentavos,
        nsu: camposFinanceiros.nsu,
        autorizacao: camposFinanceiros.autorizacao,
        tipoCartao,
      },
      provaModalidade
    );
  const registrado = registrarResultado(memoria, {
    ...input,
    provaValida,
    origem,
    modalidadeOficial: avaliarModalidade
      ? { provaValida: provaModalidadeValida, tipoCartao }
      : undefined,
  });
  if (!registrado.ok) {
    throw new ErroTef(registrado.erro, 404);
  }
  await gravarMemoria(cliente, antes, memoria, input.empresaId, memoria.terminais);
  if (!registrado.repetida) {
    await gravarDadosFiscaisOperacao(cliente, memoria.operacoes[0]);
  }
  return {
    ok: true as const,
    status: registrado.status,
    teste: registrado.teste,
    diagnostico: registrado.diagnostico,
    proibirDesfazimento: registrado.proibirDesfazimento,
    modalidade: registrado.modalidade,
    modalidadeSolicitada: registrado.modalidadeSolicitada,
    modalidadeEfetiva: registrado.modalidadeEfetiva,
    avisoModalidade: registrado.avisoModalidade,
    erro: registrado.status === "autorizada" && !registrado.teste ? undefined : registrado.diagnostico,
  };
}

async function referenciasProducaoTef(
  cliente: ReturnType<typeof admin>,
  empresaId: string,
  terminalId: string
) {
  const config = await cliente
    .from("tef_configuracoes")
    .select("ambiente, ponto_captura, servidor_producao")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  const terminal = await cliente
    .from("tef_terminais")
    .select("ponto_captura")
    .eq("empresa_id", empresaId)
    .eq("id", terminalId)
    .maybeSingle();
  const pontoTerminal = terminal.error ? "" : String(terminal.data?.ponto_captura ?? "").trim();
  const pontoConfig = config.error ? "" : String(config.data?.ponto_captura ?? "").trim();
  return {
    fluxoHomologacao: !config.error && config.data?.ambiente === "homologacao",
    pontoOficial: pontoTerminal || pontoConfig,
    hostOficial: config.error ? "" : String(config.data?.servidor_producao ?? "").trim(),
  };
}

export async function liberarConfirmacaoTefPersistida(input: {
  empresaId: string;
  operacaoId: string;
  vendaId: string;
}) {
  const { memoria } = await memoriaDaOperacao(input.empresaId, input.operacaoId);
  const cliente = admin();
  const venda = await exigirTabela(
    cliente
      .from("vendas")
      .select("id, empresa_id")
      .eq("empresa_id", input.empresaId)
      .eq("id", input.vendaId)
      .maybeSingle()
  );
  if (venda) {
    memoria.vendas.push({
      id: String(venda.id),
      empresaId: input.empresaId,
      idempotencyKey: "",
    });
  }
  const liberada = liberarConfirmacao(memoria, input);
  if (!liberada.ok) {
    throw new ErroTef(liberada.erro, 409);
  }
  return liberada;
}

export async function marcarConfirmacaoTefPersistida(input: {
  empresaId: string;
  operacaoId: string;
  prova: string;
}) {
  const { cliente, memoria, antes } = await memoriaDaOperacao(
    input.empresaId,
    input.operacaoId
  );
  const operacao = memoria.operacoes[0];
  if (!operacao || operacao.empresaId !== input.empresaId) {
    throw new ErroTef("Operação TEF não encontrada.", 404);
  }
  const chave = await chavePublicaDaOperacao(cliente, operacao);
  const base = {
    acao: "confirmar" as const,
    nsu: operacao.nsu ?? "",
    autorizacao: operacao.autorizacao ?? "",
    rede: operacao.rede ?? "",
    finalizacao: operacao.finalizacao ?? "",
    codigo: "",
  };
  const provaOk = verificarProvaTef(
    chave,
    camposProvados(operacao, { ...base, sucesso: true }),
    input.prova
  );
  const provaFalha = verificarProvaTef(
    chave,
    camposProvados(operacao, { ...base, sucesso: false }),
    input.prova
  );
  if (!provaOk) {
    if (provaFalha) {
      operacao.status = "reconciliacao";
      await gravarMemoria(cliente, antes, memoria, input.empresaId, []);
      return { ok: true as const, status: "reconciliacao" as const };
    }
    throw new ErroTef("A confirmação TEF não tem prova do terminal.", 409);
  }
  const marcada = marcarConfirmada(memoria, {
    empresaId: input.empresaId,
    operacaoId: input.operacaoId,
    rede: operacao.rede ?? "",
    nsu: operacao.nsu ?? "",
    finalizacao: operacao.finalizacao ?? "",
    provaValida: true,
  });
  if (!marcada.ok) {
    throw new ErroTef(marcada.erro, 409);
  }
  await gravarMemoria(cliente, antes, memoria, input.empresaId, []);
  return { ok: true as const, status: "confirmada" as const };
}

export async function desfazerTefPersistido(input: {
  empresaId: string;
  usuarioId: string;
  operacaoId: string;
  idempotencyKeyVenda?: string | null;
}) {
  const { cliente, memoria, antes } = await memoriaDaOperacao(
    input.empresaId,
    input.operacaoId
  );
  if (input.idempotencyKeyVenda) {
    const venda = await exigirTabela(
      cliente
        .from("vendas")
        .select("id, empresa_id")
        .eq("empresa_id", input.empresaId)
        .eq("idempotency_key", input.idempotencyKeyVenda)
        .maybeSingle()
    );
    if (venda) {
      memoria.vendas.push({
        id: String(venda.id),
        empresaId: input.empresaId,
        idempotencyKey: input.idempotencyKeyVenda,
      });
    }
  }
  const operacaoAtual = memoria.operacoes[0];
  let vendaIdEncontrada =
    memoria.vendas.find((item) => item.empresaId === input.empresaId)?.id ?? null;
  if (!vendaIdEncontrada && operacaoAtual?.vendaIdempotencyKey) {
    const vendaReservada = await exigirTabela(
      cliente
        .from("vendas")
        .select("id, empresa_id")
        .eq("empresa_id", input.empresaId)
        .eq("idempotency_key", operacaoAtual.vendaIdempotencyKey)
        .maybeSingle()
    );
    if (vendaReservada) {
      vendaIdEncontrada = String(vendaReservada.id);
      memoria.vendas.push({
        id: vendaIdEncontrada,
        empresaId: input.empresaId,
        idempotencyKey: operacaoAtual.vendaIdempotencyKey,
      });
    }
  }
  const pedido = pedirDesfazimento(memoria, {
    ...input,
    vendaIdEncontrada,
  });
  if (!pedido.ok) {
    throw new ErroTef(pedido.erro, 404);
  }
  await gravarMemoria(cliente, antes, memoria, input.empresaId, []);
  return pedido;
}

export async function registrarDesfazimentoTefPersistido(input: {
  empresaId: string;
  operacaoId: string;
  prova: string;
}) {
  const { cliente, memoria, antes } = await memoriaDaOperacao(
    input.empresaId,
    input.operacaoId
  );
  const operacao = memoria.operacoes[0];
  if (!operacao) {
    throw new ErroTef("Operação TEF não encontrada.", 404);
  }
  const chave = await chavePublicaDaOperacao(cliente, operacao);
  const base = {
    acao: "desfazer" as const,
    nsu: operacao.nsu ?? "",
    autorizacao: operacao.autorizacao ?? "",
    rede: operacao.rede ?? "",
    finalizacao: operacao.finalizacao ?? "",
    codigo: "",
  };
  const provaOk = verificarProvaTef(
    chave,
    camposProvados(operacao, { ...base, sucesso: true }),
    input.prova
  );
  const marcada = marcarDesfeita(memoria, {
    empresaId: input.empresaId,
    operacaoId: input.operacaoId,
    sucesso: provaOk,
    provaValida: provaOk,
  });
  await gravarMemoria(cliente, antes, memoria, input.empresaId, []);
  if (!marcada.ok) {
    throw new ErroTef(marcada.erro, 409);
  }
  return { ok: true as const, status: marcada.status };
}

export async function listarPendenciasTefPersistidas(empresaId: string) {
  const cliente = admin();
  const linhas = await lerLinhasOperacao((colunas) =>
    cliente
      .from("tef_operacoes")
      .select(colunas)
      .eq("empresa_id", empresaId)
      .in("status", [...STATUS_TEF_ABERTOS])
  );
  const memoria = memoriaTefVazia();
  memoria.operacoes = ((linhas ?? []) as Linha[]).map(linhaOperacao);
  const terminais = await exigirTabela(
    cliente
      .from("tef_terminais")
      .select("id, codigo")
      .eq("empresa_id", empresaId)
  );
  const codigos = new Map(
    ((terminais ?? []) as Linha[]).map((linha) => [String(linha.id), String(linha.codigo)])
  );
  return listarPendencias(memoria, empresaId).map((item) => ({
    ...item,
    terminalCodigo: codigos.get(item.terminalId) ?? "",
  }));
}

export async function marcarPendenciaFormaTefPersistida(input: {
  empresaId: string;
  operacaoId: string;
}) {
  const { cliente, memoria, antes } = await memoriaDaOperacao(
    input.empresaId,
    input.operacaoId
  );
  const operacao = memoria.operacoes[0];
  if (!operacao) {
    throw new ErroTef("Operação TEF não encontrada.", 404);
  }
  const modalidade = operacao.modalidadeEfetiva ?? operacao.modalidade;
  const formas = await exigirTabela(
    cliente
      .from("formas_pagamento")
      .select("id, codigo, nome, tipo, codigo_fiscal, permite_fiado")
      .eq("empresa_id", input.empresaId)
  );
  const lista = ((formas ?? []) as Linha[]).map((linha) => ({
    id: String(linha.id),
    codigo: linha.codigo ? String(linha.codigo) : null,
    nome: linha.nome ? String(linha.nome) : null,
    tipo: linha.tipo ? String(linha.tipo) : null,
    codigo_fiscal: linha.codigo_fiscal ? String(linha.codigo_fiscal) : null,
    permite_fiado: linha.permite_fiado === true,
  }));
  if (formaDaModalidadeEfetiva(lista, modalidade)) {
    return {
      ok: true as const,
      pendente: false,
      status: operacao.status,
      diagnostico: operacao.motivoAmbiente || "",
    };
  }
  const marcada = marcarPendenciaAdministrativa(memoria, {
    empresaId: input.empresaId,
    operacaoId: input.operacaoId,
    motivo: mensagemFormaAusente(modalidade),
  });
  if (!marcada.ok) {
    throw new ErroTef(marcada.erro, 409);
  }
  await gravarMemoria(cliente, antes, memoria, input.empresaId, []);
  return {
    ok: true as const,
    pendente: true,
    status: marcada.status,
    diagnostico: marcada.diagnostico,
    modalidadeEfetiva: marcada.modalidadeEfetiva,
  };
}

export async function vincularOperacoesTefNaVenda(input: {
  empresaId: string;
  vendaId: string;
  usuarioId: string;
  operacaoIds: string[];
  segredos: Record<string, string>;
}) {
  if (input.operacaoIds.length === 0) {
    return { confirmacaoLiberada: false };
  }
  let liberada = true;
  for (const operacaoId of input.operacaoIds) {
    const { cliente, memoria, antes } = await memoriaDaOperacao(
      input.empresaId,
      operacaoId
    );
    memoria.vendas.push({
      id: input.vendaId,
      empresaId: input.empresaId,
      idempotencyKey: "",
    });
    const venda = await cliente
      .from("vendas")
      .select("id")
      .eq("empresa_id", input.empresaId)
      .eq("id", input.vendaId)
      .maybeSingle();
    if (venda.error || !venda.data) {
      liberada = false;
      continue;
    }
    const vinculada = vincularVenda(memoria, {
      empresaId: input.empresaId,
      operacaoId,
      vendaId: input.vendaId,
      usuarioId: input.usuarioId,
      segredoVinculoHash: input.segredos[operacaoId] ?? "",
    });
    if (!vinculada.ok) {
      liberada = false;
      continue;
    }
    await gravarMemoria(cliente, antes, memoria, input.empresaId, []);
  }
  return { confirmacaoLiberada: liberada };
}

export async function reservarOperacoesTefParaVenda(input: {
  empresaId: string;
  usuarioId: string;
  idempotencyKey: string;
  operacaoIds: string[];
}) {
  if (input.operacaoIds.length === 0) {
    return { ok: true as const };
  }
  const cliente = admin();
  const memoria = memoriaTefVazia();
  const linhas = await exigirTabela(
    cliente
      .from("tef_operacoes")
      .select(
        "id, empresa_id, terminal_id, identificador, idempotency_key, modalidade, valor_centavos, status, nsu, autorizacao, rede, finalizacao, venda_id, teste, desafio, usuario_id, segredo_vinculo_hash, venda_idempotency_key, ambiente_efetivo, ponto_efetivo, host_efetivo, comprovante_sha256, motivo_ambiente"
      )
      .eq("empresa_id", input.empresaId)
      .in("id", input.operacaoIds)
  );
  memoria.operacoes = ((linhas ?? []) as Linha[]).map(linhaOperacao);
  const antes = memoria.operacoes.map((item) => ({ ...item }));
  const reservada = reservarOperacoesParaVenda(memoria, input);
  if (!reservada.ok) {
    throw new ErroTef(reservada.erro, 409);
  }
  await gravarMemoria(cliente, antes, memoria, input.empresaId, []);
  return { ok: true as const };
}

export async function autorizarPareamentoTef(input: {
  empresaId: string;
  usuarioId: string;
  codigo: string;
}) {
  const cliente = admin();
  const config = await exigirTabela(
    cliente
      .from("tef_configuracoes")
      .select("habilitado, estabelecimento, ponto_captura")
      .eq("empresa_id", input.empresaId)
      .maybeSingle()
  );
  const estabelecimento = String(config?.estabelecimento ?? "").trim();
  const pontoCaptura = String(config?.ponto_captura ?? "").trim();
  if (!estabelecimento || !pontoCaptura) {
    throw new ErroTef("Salve o estabelecimento e o ponto de captura antes de autorizar o terminal.");
  }
  const habilitado = config?.habilitado === true;
  let ambientePareamento = "";
  let servidorPareamento = "";
  let cnpjPareamento = "";
  if (!habilitado) {
    const servidores = await cliente
      .from("tef_configuracoes")
      .select("ambiente, servidor_homologacao, servidor_producao")
      .eq("empresa_id", input.empresaId)
      .maybeSingle();
    if (servidores.error) {
      if (colunaServidorAusente(servidores.error)) {
        throw new ErroTef(
          "O servidor PayGoWeb ainda não foi aplicado no banco. A migration 20261011190000_tef_servidor_paygo.sql precisa ser aplicada antes de parear um ponto novo.",
          503
        );
      }
      throw new ErroTef("Não foi possível consultar o servidor PayGoWeb autorizado.", 500);
    }
    const ambiente =
      servidores.data?.ambiente === "producao" || servidores.data?.ambiente === "homologacao"
        ? servidores.data.ambiente
        : "";
    const servidorBruto =
      ambiente === "producao"
        ? servidores.data?.servidor_producao
        : ambiente === "homologacao"
          ? servidores.data?.servidor_homologacao
          : "";
    const servidor = validarServidorPayGo(servidorBruto);
    if (!servidor.ok) {
      throw new ErroTef("Confirme o servidor PayGoWeb deste ambiente antes de parear o terminal.");
    }
    const empresa = await cliente
      .from("empresas")
      .select("cnpj")
      .eq("id", input.empresaId)
      .maybeSingle();
    const cnpj = String(empresa.data?.cnpj ?? "").replace(/\D/g, "");
    if (!/^\d{14}$/.test(cnpj)) {
      throw new ErroTef("O cadastro da empresa não possui CNPJ para o pareamento.");
    }
    ambientePareamento = ambiente;
    servidorPareamento = servidor.servidor;
    cnpjPareamento = cnpj;
  }
  const expira = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error } = await cliente.from("tef_pareamentos").insert({
    empresa_id: input.empresaId,
    usuario_id: input.usuarioId,
    codigo_hash: hashSegredoVinculo(input.codigo.trim().toUpperCase()),
    estabelecimento,
    ponto_captura: pontoCaptura,
    expira_em: expira,
    ...(servidorPareamento
      ? { ambiente: ambientePareamento, servidor: servidorPareamento, cnpj: cnpjPareamento }
      : {}),
  });
  if (error) {
    if (colunaServidorAusente(error)) {
      throw new ErroTef(
        "O servidor PayGoWeb ainda não foi aplicado no banco. A migration 20261011190000_tef_servidor_paygo.sql precisa ser aplicada antes de parear um ponto novo.",
        503
      );
    }
    if (migracaoAusente(error)) {
      throw new ErroTef("A estrutura de TEF ainda não foi aplicada neste ambiente.", 503);
    }
    throw new ErroTef("Não foi possível autorizar o pareamento.", 500);
  }
  return { ok: true as const, expiraEm: expira, estabelecimento, pontoCaptura };
}

export async function concluirPareamentoTef(input: {
  empresaId: string;
  codigo: string;
  dispositivoId: string;
  chavePublica: string;
  chaveId: string;
  assinatura: string;
}) {
  const cliente = admin();
  const codigoHash = hashSegredoVinculo(input.codigo.trim().toUpperCase());
  const pendente = await exigirTabela(
    cliente
      .from("tef_pareamentos")
      .select("id, estabelecimento, ponto_captura, expira_em, consumido_em")
      .eq("empresa_id", input.empresaId)
      .eq("codigo_hash", codigoHash)
      .is("consumido_em", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  );
  if (!pendente || new Date(String(pendente.expira_em)).getTime() <= Date.now()) {
    throw new ErroTef("Não há autorização vigente para este código.", 403);
  }
  const assinaturaValida = verificarProvaTef(
    input.chavePublica,
    {
      acao: "pareamento",
      desafio: codigoHash,
      identificador: input.dispositivoId,
      valorCentavos: 0,
      nsu: "",
      autorizacao: "",
      rede: "",
      finalizacao: "",
      sucesso: true,
      codigo: "",
    },
    input.assinatura
  );
  if (!assinaturaValida) {
    throw new ErroTef("O Connector não comprovou o código de pareamento.", 403);
  }
  const revogada = await exigirTabela(
    cliente
      .from("tef_chaves_revogadas")
      .select("id")
      .eq("chave_publica", input.chavePublica)
      .limit(1)
      .maybeSingle()
  );
  if (revogada) {
    throw new ErroTef("Esta chave do Connector foi revogada. Gere outra neste computador.", 409);
  }
  const terminais = await exigirTabela(
    cliente
      .from("tef_terminais")
      .select("id, empresa_id, ativo, chave_publica, revogada_em")
      .eq("dispositivo_id", input.dispositivoId)
  );
  const linhas = (terminais ?? []) as Linha[];
  if (
    linhas.some(
      (linha) => linha.ativo !== false && String(linha.empresa_id) !== input.empresaId
    )
  ) {
    throw new ErroTef("Este terminal já está vinculado a outra empresa.", 409);
  }
  const abertas = await exigirTabela(
    cliente
      .from("tef_operacoes")
      .select("id, terminal_id, status")
      .eq("empresa_id", input.empresaId)
      .in("status", [...STATUS_TEF_ABERTOS])
  );
  const idsTerminais = new Set(linhas.map((linha) => String(linha.id)));
  if (((abertas ?? []) as Linha[]).some((linha) => idsTerminais.has(String(linha.terminal_id)))) {
    throw new ErroTef("Há transação TEF pendente neste terminal. Resolva antes de parear de novo.", 409);
  }
  const estabelecimento = String(pendente.estabelecimento);
  const pontoCaptura = String(pendente.ponto_captura);
  const vinculoPareamento = await cliente
    .from("tef_pareamentos")
    .select("ambiente, servidor, cnpj")
    .eq("id", pendente.id)
    .eq("empresa_id", input.empresaId)
    .maybeSingle();
  let ambientePareamento = "";
  let servidorPareamento = "";
  let cnpjPareamento = "";
  if (!vinculoPareamento.error) {
    const servidor = validarServidorPayGo(vinculoPareamento.data?.servidor);
    ambientePareamento =
      vinculoPareamento.data?.ambiente === "producao" ||
      vinculoPareamento.data?.ambiente === "homologacao"
        ? vinculoPareamento.data.ambiente
        : "";
    servidorPareamento = servidor.ok ? servidor.servidor : "";
    cnpjPareamento = /^\d{14}$/.test(String(vinculoPareamento.data?.cnpj ?? ""))
      ? String(vinculoPareamento.data?.cnpj)
      : "";
  } else if (!colunaServidorAusente(vinculoPareamento.error)) {
    throw new ErroTef("Não foi possível consultar o servidor autorizado do pareamento.", 500);
  }
  const daEmpresa = linhas.filter((linha) => String(linha.empresa_id) === input.empresaId);
  const ativo = daEmpresa.find((linha) => linha.ativo !== false && !linha.revogada_em);
  if (ativo && String(ativo.chave_publica ?? "") !== input.chavePublica) {
    throw new ErroTef("Revogue a chave anterior antes de substituir o Connector.", 409);
  }
  const alvo = ativo ?? daEmpresa[0];
  let terminalId = alvo ? String(alvo.id) : randomUUID();
  if (servidorPareamento && alvo) {
    const servidorAtual = await cliente
      .from("tef_terminais")
      .select("servidor, ambiente")
      .eq("id", terminalId)
      .eq("empresa_id", input.empresaId)
      .maybeSingle();
    if (servidorAtual.error) {
      if (!colunaServidorAusente(servidorAtual.error)) {
        throw new ErroTef("Não foi possível consultar o servidor do terminal.", 500);
      }
    } else {
      const gravado = validarServidorPayGo(servidorAtual.data?.servidor);
      if (gravado.ok && gravado.servidor !== servidorPareamento) {
        throw new ErroTef("O servidor deste terminal já foi pareado e não pode ser trocado.", 409);
      }
      const ambienteGravado = servidorAtual.data?.ambiente;
      if (
        (ambienteGravado === "homologacao" || ambienteGravado === "producao") &&
        ambientePareamento &&
        ambienteGravado !== ambientePareamento
      ) {
        throw new ErroTef("O ambiente do terminal pareado diverge do ambiente informado.", 409);
      }
    }
  }
  const camposPareamento = servidorPareamento
    ? { ambiente: ambientePareamento, servidor: servidorPareamento, cnpj: cnpjPareamento }
    : {};
  if (alvo) {
    const atualizacao = await cliente
      .from("tef_terminais")
      .update({
        ativo: true,
        revogada_em: null,
        chave_publica: input.chavePublica,
        chave_id: input.chaveId || null,
        estabelecimento,
        ponto_captura: pontoCaptura,
        ...camposPareamento,
      })
      .eq("id", terminalId)
      .eq("empresa_id", input.empresaId);
    if (atualizacao.error) {
      if (atualizacao.error.code === "23505") {
        throw new ErroTef("Este terminal já está vinculado a outra empresa.", 409);
      }
      if (colunaServidorAusente(atualizacao.error)) {
        throw new ErroTef(
          "O servidor PayGoWeb ainda não foi aplicado no banco. A migration 20261011190000_tef_servidor_paygo.sql precisa ser aplicada antes de parear um ponto novo.",
          503
        );
      }
      throw new ErroTef("Não foi possível registrar o terminal.", 500);
    }
  } else {
    const codigo = /^[A-Za-z0-9._-]{1,40}$/.test(pontoCaptura)
      ? pontoCaptura
      : `CX${input.dispositivoId.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
    const inclusao = await cliente.from("tef_terminais").insert({
      id: terminalId,
      empresa_id: input.empresaId,
      codigo,
      dispositivo_id: input.dispositivoId,
      chave_publica: input.chavePublica,
      chave_id: input.chaveId || null,
      estabelecimento,
      ponto_captura: pontoCaptura,
      ativo: true,
      ...camposPareamento,
    });
    if (inclusao.error) {
      if (inclusao.error.code === "23505") {
        throw new ErroTef("Este terminal já está vinculado a outra empresa.", 409);
      }
      if (colunaServidorAusente(inclusao.error)) {
        throw new ErroTef(
          "O servidor PayGoWeb ainda não foi aplicado no banco. A migration 20261011190000_tef_servidor_paygo.sql precisa ser aplicada antes de parear um ponto novo.",
          503
        );
      }
      throw new ErroTef("Não foi possível registrar o terminal.", 500);
    }
  }
  await cliente
    .from("tef_pareamentos")
    .update({ consumido_em: new Date().toISOString(), dispositivo_id: input.dispositivoId })
    .eq("id", pendente.id)
    .eq("empresa_id", input.empresaId);
  const terminal = await exigirTabela(
    cliente
      .from("tef_terminais")
      .select("codigo")
      .eq("empresa_id", input.empresaId)
      .eq("id", terminalId)
      .maybeSingle()
  );
  const configuracao = await cliente
    .from("tef_configuracoes")
    .select("ambiente")
    .eq("empresa_id", input.empresaId)
    .maybeSingle();
  const ambienteConfiguracao = configuracao.data?.ambiente;
  const ambiente =
    ambienteConfiguracao === "producao" || ambienteConfiguracao === "homologacao"
      ? ambienteConfiguracao
      : "";
  const empresa = await cliente
    .from("empresas")
    .select("cnpj")
    .eq("id", input.empresaId)
    .maybeSingle();
  const cnpj = String(empresa.data?.cnpj ?? "").replace(/\D/g, "");
  return {
    ok: true as const,
    empresaId: input.empresaId,
    dispositivoId: input.dispositivoId,
    terminalId,
    terminalCodigo: String(terminal?.codigo ?? ""),
    estabelecimento,
    pontoCaptura,
    ambiente: ambientePareamento || ambiente,
    cnpj: cnpjPareamento || (/^\d{14}$/.test(cnpj) ? cnpj : ""),
    servidor: servidorPareamento,
  };
}

export async function gravarServidoresPayGoEmpresa(
  empresaId: string,
  input: {
    ambiente: "homologacao" | "producao";
    estabelecimento: string;
    pontoCaptura: string;
    servidorHomologacao: string;
    servidorProducao: string;
  }
) {
  const cliente = admin();
  const atual = await cliente
    .from("tef_configuracoes")
    .select("habilitado")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (atual.error) {
    if (migracaoAusente(atual.error)) {
      throw new ErroTef("A estrutura de TEF ainda não foi aplicada neste ambiente.", 503);
    }
    throw new ErroTef("Não foi possível consultar a configuração TEF.", 500);
  }
  if (atual.data?.habilitado === true) {
    const servidoresHabilitados: {
      servidor_homologacao?: string;
      servidor_producao?: string;
      updated_at: string;
    } = { updated_at: new Date().toISOString() };
    if (input.servidorHomologacao) {
      servidoresHabilitados.servidor_homologacao = input.servidorHomologacao;
    }
    if (input.servidorProducao) {
      servidoresHabilitados.servidor_producao = input.servidorProducao;
    }
    const preenchimento = await cliente
      .from("tef_configuracoes")
      .update(servidoresHabilitados)
      .eq("empresa_id", empresaId);
    if (preenchimento.error) {
      if (colunaServidorAusente(preenchimento.error)) {
        throw new ErroTef(
          "O servidor PayGoWeb ainda não foi aplicado no banco. A migration 20261011190000_tef_servidor_paygo.sql precisa ser aplicada antes de confirmar o servidor.",
          503
        );
      }
      throw new ErroTef("Não foi possível gravar o servidor PayGoWeb.", 500);
    }
    return { preservado: false as const };
  }
  const servidores = {
    servidor_homologacao: input.servidorHomologacao,
    servidor_producao: input.servidorProducao,
    updated_at: new Date().toISOString(),
  };
  if (!atual.data) {
    const inclusao = await cliente.from("tef_configuracoes").insert({
      empresa_id: empresaId,
      habilitado: false,
      ambiente: input.ambiente,
      estabelecimento: input.estabelecimento,
      ponto_captura: input.pontoCaptura,
      ...servidores,
    });
    if (inclusao.error) {
      if (colunaServidorAusente(inclusao.error)) {
        throw new ErroTef(
          "O servidor PayGoWeb ainda não foi aplicado no banco. A migration 20261011190000_tef_servidor_paygo.sql precisa ser aplicada antes de confirmar o servidor.",
          503
        );
      }
      throw new ErroTef("Não foi possível gravar o servidor PayGoWeb.", 500);
    }
    return { preservado: false as const };
  }
  const atualizacao = await cliente
    .from("tef_configuracoes")
    .update({
      ambiente: input.ambiente,
      estabelecimento: input.estabelecimento,
      ponto_captura: input.pontoCaptura,
      ...servidores,
    })
    .eq("empresa_id", empresaId)
    .eq("habilitado", false);
  if (atualizacao.error) {
    if (colunaServidorAusente(atualizacao.error)) {
      throw new ErroTef(
        "O servidor PayGoWeb ainda não foi aplicado no banco. A migration 20261011190000_tef_servidor_paygo.sql precisa ser aplicada antes de confirmar o servidor.",
        503
      );
    }
    throw new ErroTef("Não foi possível gravar o servidor PayGoWeb.", 500);
  }
  return { preservado: false as const };
}

export async function revogarTerminalTef(input: { empresaId: string; terminalId: string }) {
  const cliente = admin();
  const terminal = await exigirTabela(
    cliente
      .from("tef_terminais")
      .select("id, dispositivo_id, chave_publica, chave_id, ativo")
      .eq("empresa_id", input.empresaId)
      .eq("id", input.terminalId)
      .maybeSingle()
  );
  if (!terminal) {
    throw new ErroTef("Terminal TEF não encontrado.", 404);
  }
  const abertas = await exigirTabela(
    cliente
      .from("tef_operacoes")
      .select("id")
      .eq("empresa_id", input.empresaId)
      .eq("terminal_id", input.terminalId)
      .in("status", [...STATUS_TEF_ABERTOS])
      .limit(1)
  );
  if ((abertas ?? []).length > 0) {
    throw new ErroTef("Há transação pendente neste terminal. Resolva antes de revogar a chave.", 409);
  }
  if (terminal.chave_publica) {
    await cliente.from("tef_chaves_revogadas").insert({
      empresa_id: input.empresaId,
      dispositivo_id: terminal.dispositivo_id,
      chave_publica: terminal.chave_publica,
      chave_id: terminal.chave_id,
    });
  }
  const atualizacao = await cliente
    .from("tef_terminais")
    .update({ ativo: false, revogada_em: new Date().toISOString() })
    .eq("empresa_id", input.empresaId)
    .eq("id", input.terminalId);
  if (atualizacao.error) {
    throw new ErroTef("Não foi possível revogar o terminal.", 500);
  }
  return { ok: true as const };
}

export async function listarTerminaisAtivosEmpresa(
  supabase: ClienteLeitura,
  empresaId: string
): Promise<TerminalTefAtivo[]> {
  const consulta = await supabase
    .from("tef_terminais")
    .select("id, codigo, dispositivo_id, estabelecimento, ponto_captura, revogada_em")
    .eq("empresa_id", empresaId)
    .eq("ativo", true);
  if (consulta.error) {
    if (migracaoAusente(consulta.error)) {
      return [];
    }
    throw new ErroTef("Não foi possível consultar os terminais TEF.", 500);
  }
  const linhas = ((consulta.data ?? []) as Linha[]).filter((linha) => !linha.revogada_em);
  const ids = linhas.map((linha) => String(linha.id));
  const pendentes = new Set<string>();
  if (ids.length > 0) {
    const operacoes = await supabase
      .from("tef_operacoes")
      .select("terminal_id")
      .eq("empresa_id", empresaId)
      .in("terminal_id", ids)
      .in("status", [...STATUS_TEF_ABERTOS]);
    if (operacoes.error) {
      if (!migracaoAusente(operacoes.error)) {
        throw new ErroTef("Não foi possível consultar as pendências TEF.", 500);
      }
    } else {
      for (const linha of (operacoes.data ?? []) as Linha[]) {
        pendentes.add(String(linha.terminal_id));
      }
    }
  }
  return linhas.map((linha) => ({
    id: String(linha.id),
    codigo: String(linha.codigo),
    dispositivoId: String(linha.dispositivo_id),
    estabelecimento: String(linha.estabelecimento ?? ""),
    pontoCaptura: String(linha.ponto_captura ?? ""),
    temPendencia: pendentes.has(String(linha.id)),
  }));
}

export async function dispositivoAtivoDeOutraEmpresa(
  empresaId: string,
  dispositivoId: string
) {
  const cliente = admin();
  let linhas: Linha[] = [];
  try {
    const data = await exigirTabela(
      cliente
        .from("tef_terminais")
        .select("empresa_id")
        .eq("dispositivo_id", dispositivoId)
        .eq("ativo", true)
    );
    linhas = (data ?? []) as Linha[];
  } catch (error) {
    if (error instanceof ErroTef && error.status === 503) {
      return false;
    }
    throw error;
  }
  return linhas.some((linha) => String(linha.empresa_id) !== empresaId);
}

export async function salvarConfigTefEmpresa(
  empresaId: string,
  config: {
    habilitado: boolean;
    ambiente: "homologacao" | "producao";
    estabelecimento: string;
    pontoCaptura: string;
    permitirOperacaoManual?: boolean;
  }
) {
  const cliente = admin();
  const base = {
    empresa_id: empresaId,
    habilitado: config.habilitado,
    ambiente: config.ambiente,
    estabelecimento: config.estabelecimento,
    ponto_captura: config.pontoCaptura,
    updated_at: new Date().toISOString(),
  };
  const gravarManual = config.permitirOperacaoManual !== undefined;
  const { error } = await cliente.from("tef_configuracoes").upsert({
    ...base,
    ...(gravarManual
      ? { permitir_operacao_manual: config.permitirOperacaoManual === true }
      : {}),
  } as typeof base);
  if (error && gravarManual && colunaOperacaoManualAusente(error)) {
    if (config.permitirOperacaoManual) {
      throw new ErroTef(
        "A autorização de cartão manual ainda não está disponível neste ambiente.",
        503
      );
    }
    const reserva = await cliente.from("tef_configuracoes").upsert(base);
    if (reserva.error) {
      if (migracaoAusente(reserva.error)) {
        throw new ErroTef("A estrutura de TEF ainda não foi aplicada neste ambiente.", 503);
      }
      throw new ErroTef("Não foi possível salvar a configuração TEF.", 500);
    }
    return;
  }
  if (error) {
    if (migracaoAusente(error)) {
      throw new ErroTef("A estrutura de TEF ainda não foi aplicada neste ambiente.", 503);
    }
    throw new ErroTef("Não foi possível salvar a configuração TEF.", 500);
  }
}

function ambienteSincronizacao(valor: unknown): TerminalSincronizacao["ambiente"] {
  return valor === "producao" || valor === "homologacao" ? valor : "";
}

export async function carregarFatosSincronizacaoVinculo(input: {
  empresaId: string;
  dispositivoId: string;
}) {
  const cliente = admin();
  const completo = await cliente
    .from("tef_terminais")
    .select(
      "id, empresa_id, codigo, dispositivo_id, ativo, chave_publica, chave_id, estabelecimento, ponto_captura, revogada_em, ambiente, servidor, cnpj"
    )
    .eq("dispositivo_id", input.dispositivoId);
  let linhas: Linha[] = [];
  if (completo.error) {
    if (!colunaServidorAusente(completo.error)) {
      if (migracaoAusente(completo.error)) {
        throw new ErroTef("A estrutura de TEF ainda não foi aplicada neste ambiente.", 503);
      }
      throw new ErroTef("Não foi possível consultar o terminal.", 500);
    }
    const base = await exigirTabela(
      cliente
        .from("tef_terminais")
        .select(
          "id, empresa_id, codigo, dispositivo_id, ativo, chave_publica, chave_id, estabelecimento, ponto_captura, revogada_em"
        )
        .eq("dispositivo_id", input.dispositivoId)
    );
    linhas = ((base ?? []) as Linha[]).map((linha) => ({
      ...linha,
      ambiente: "",
      servidor: "",
      cnpj: "",
    }));
  } else {
    linhas = (completo.data ?? []) as Linha[];
  }
  const empresaId = input.empresaId.trim().toLowerCase();
  const destaEmpresa = linhas.find(
    (linha) =>
      String(linha.empresa_id).toLowerCase() === empresaId &&
      linha.ativo !== false &&
      !linha.revogada_em
  );
  const dispositivoOutraEmpresa = linhas.some(
    (linha) =>
      String(linha.empresa_id).toLowerCase() !== empresaId &&
      linha.ativo !== false &&
      !linha.revogada_em
  );
  const terminal: TerminalSincronizacao | null = destaEmpresa
    ? {
        id: String(destaEmpresa.id),
        empresaId: String(destaEmpresa.empresa_id),
        codigo: String(destaEmpresa.codigo ?? ""),
        dispositivoId: String(destaEmpresa.dispositivo_id),
        chavePublica: destaEmpresa.chave_publica ? String(destaEmpresa.chave_publica) : "",
        chaveId: destaEmpresa.chave_id ? String(destaEmpresa.chave_id) : "",
        estabelecimento: String(destaEmpresa.estabelecimento ?? ""),
        pontoCaptura: String(destaEmpresa.ponto_captura ?? ""),
        ativo: destaEmpresa.ativo !== false,
        revogada: Boolean(destaEmpresa.revogada_em),
        ambiente: ambienteSincronizacao(destaEmpresa.ambiente),
        servidor: String(destaEmpresa.servidor ?? ""),
        cnpj: String(destaEmpresa.cnpj ?? ""),
      }
    : null;
  const configConsulta = await cliente
    .from("tef_configuracoes")
    .select("ambiente, estabelecimento, ponto_captura, servidor_homologacao, servidor_producao")
    .eq("empresa_id", input.empresaId)
    .maybeSingle();
  let configLinha: Linha | null = null;
  if (configConsulta.error) {
    if (!colunaServidorAusente(configConsulta.error)) {
      if (migracaoAusente(configConsulta.error)) {
        throw new ErroTef("A estrutura de TEF ainda não foi aplicada neste ambiente.", 503);
      }
      throw new ErroTef("Não foi possível consultar a configuração TEF.", 500);
    }
    const base = await exigirTabela(
      cliente
        .from("tef_configuracoes")
        .select("ambiente, estabelecimento, ponto_captura")
        .eq("empresa_id", input.empresaId)
        .maybeSingle()
    );
    configLinha = base ? { ...base, servidor_homologacao: "", servidor_producao: "" } : null;
  } else {
    configLinha = configConsulta.data;
  }
  const ambiente = ambienteSincronizacao(configLinha?.ambiente);
  const config: ConfiguracaoSincronizacao = {
    ambiente,
    estabelecimento: String(configLinha?.estabelecimento ?? ""),
    pontoCaptura: String(configLinha?.ponto_captura ?? ""),
    servidor:
      ambiente === "producao"
        ? String(configLinha?.servidor_producao ?? "")
        : ambiente === "homologacao"
          ? String(configLinha?.servidor_homologacao ?? "")
          : "",
  };
  let pendenciaFinanceira = false;
  if (terminal) {
    const abertas = await exigirTabela(
      cliente
        .from("tef_operacoes")
        .select("id")
        .eq("empresa_id", input.empresaId)
        .eq("terminal_id", terminal.id)
        .in("status", [...STATUS_TEF_ABERTOS])
        .limit(1)
    );
    pendenciaFinanceira = ((abertas ?? []) as Linha[]).length > 0;
  }
  const empresa = await cliente
    .from("empresas")
    .select("cnpj")
    .eq("id", input.empresaId)
    .maybeSingle();
  if (empresa.error) {
    throw new ErroTef("Não foi possível consultar o cadastro da empresa.", 500);
  }
  return {
    dispositivoOutraEmpresa,
    pendenciaFinanceira,
    terminal,
    config,
    cnpjEmpresa: String(empresa.data?.cnpj ?? ""),
  };
}

function funcaoRecuperacaoAusente(error: { code?: string; message?: string } | null) {
  const texto = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /PGRST202|42883|tef_recuperar_autorizacao_terminal|schema cache/i.test(texto);
}

export async function consultarConflitoChaveTef(input: {
  terminalId: string;
  chavePublica: string;
}) {
  const cliente = admin();
  const revogada = await cliente
    .from("tef_chaves_revogadas")
    .select("id")
    .eq("chave_publica", input.chavePublica)
    .limit(1)
    .maybeSingle();
  if (revogada.error && !migracaoAusente(revogada.error)) {
    throw new ErroTef("Não foi possível consultar as chaves revogadas.", 500);
  }
  const outro = await cliente
    .from("tef_terminais")
    .select("id")
    .eq("chave_publica", input.chavePublica)
    .neq("id", input.terminalId)
    .limit(1)
    .maybeSingle();
  if (outro.error && !migracaoAusente(outro.error)) {
    throw new ErroTef("Não foi possível consultar os terminais TEF.", 500);
  }
  return {
    chaveJaRevogada: Boolean(revogada.data?.id),
    chaveEmOutroTerminal: Boolean(outro.data?.id),
  };
}

export async function substituirAutorizacaoTerminalTef(input: {
  empresaId: string;
  dispositivoId: string;
  usuarioId: string;
  chavePublica: string;
  chaveId: string | null;
  chaveAnterior: string;
  fingerprintAnterior: string;
  fingerprintAtual: string;
}) {
  const cliente = admin();
  const { data, error } = await cliente.rpc("tef_recuperar_autorizacao_terminal", {
    p_empresa_id: input.empresaId,
    p_dispositivo_id: input.dispositivoId,
    p_usuario_id: input.usuarioId,
    p_chave_publica: input.chavePublica,
    p_chave_id: input.chaveId,
    p_chave_anterior: input.chaveAnterior,
    p_fingerprint_anterior: input.fingerprintAnterior,
    p_fingerprint_atual: input.fingerprintAtual,
  });
  if (error) {
    if (funcaoRecuperacaoAusente(error)) {
      throw new ErroTef(
        "A recuperação de autorização ainda não foi aplicada no banco. A migration 20261012140000_tef_recuperar_autorizacao.sql precisa ser aplicada antes de usar o botão. Ela não revoga nenhuma chave ao ser aplicada.",
        503
      );
    }
    if (/concorrente/i.test(error.message ?? "")) {
      throw new ErroTef(
        "A autorização deste terminal mudou durante a recuperação. Confira as chaves antes de tentar de novo. Nenhuma chave nova foi gerada.",
        409
      );
    }
    throw new ErroTef("Não foi possível recuperar a autorização do terminal.", 500);
  }
  const resultado = (data ?? {}) as { efeito?: string; motivo?: string };
  return {
    efeito: String(resultado.efeito ?? "recusar"),
    motivo: String(resultado.motivo ?? ""),
  };
}

export async function definirTefPlataforma(habilitada: boolean) {
  const cliente = admin();
  const { error } = await cliente
    .from("tef_plataforma")
    .update({ habilitada, atualizado_em: new Date().toISOString() })
    .eq("id", true);
  if (error) {
    if (migracaoAusente(error)) {
      throw new ErroTef("A estrutura de TEF ainda não foi aplicada neste ambiente.", 503);
    }
    throw new ErroTef("Não foi possível atualizar a disponibilidade do TEF.", 500);
  }
}

export async function lerTefPlataforma() {
  const cliente = admin();
  const data = await exigirTabela(
    cliente.from("tef_plataforma").select("habilitada").eq("id", true).maybeSingle()
  );
  return { habilitada: data?.habilitada === true };
}
