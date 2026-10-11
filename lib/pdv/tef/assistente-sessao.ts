import "server-only";

import { resolverContextoAutorizadoEmpresa } from "@/lib/auth/contexto-autorizado";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import { planoPermiteRecursoEmpresa } from "@/lib/plataforma/entitlements/exigir-recurso";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  avaliarInstalacao,
  ambienteInformado,
  decidirAtivacao,
  digitosCnpj,
  etapaPersistida,
  montarGravacaoAtivacao,
  validarCredenciamento,
  type AmbienteTefAssistente,
  type CredenciamentoInformado,
  type EtapaAssistente,
  type LeituraConnector,
  type LeituraPinpad,
} from "@/lib/pdv/tef/assistente-instalacao";
import {
  classificacaoSemEvidencia,
  consultarEvidenciaArmazenada,
  prepararRegistroEvidencia,
  type AmbienteEvidenciaInstalacao,
  type CamposEvidenciaInstalacao,
  type ClassificacaoAmbienteInstalacao,
} from "@/lib/pdv/tef/evidencia-instalacao";
import { ErroTef, gravarServidoresPayGoEmpresa, lerHabilitacaoTef, salvarConfigTefEmpresa } from "@/lib/pdv/tef/persistencia";
import { STATUS_TEF_ABERTOS } from "@/lib/pdv/tef/regras";
import { decidirGravacaoServidor } from "@/lib/pdv/tef/servidor-paygo";

export type RascunhoAssistente = {
  etapa: EtapaAssistente;
  credenciamentoConfirmado: boolean;
  ambienteAutorizado: AmbienteTefAssistente;
  pontoCaptura: string;
  estabelecimento: string;
  parametrosOficiais: string;
  adquirentes: string[];
  pinpadExigido: boolean;
  servidorHomologacao: string;
  servidorProducao: string;
  servidorConfirmado: boolean;
};

export type ObservacaoAssistente = {
  dispositivoId?: string;
  connector?: Partial<LeituraConnector>;
  pinpad?: Partial<LeituraPinpad>;
  pinpadExigido?: boolean;
  empresaId?: string;
  credenciamento?: Partial<CredenciamentoInformado>;
};

function colunaServidorAusente(error: { code?: string; message?: string } | null) {
  const texto = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /42703|PGRST204|servidor_homologacao|servidor_producao|servidor_confirmado/i.test(texto);
}

function migracaoAusente(error: { code?: string; message?: string } | null) {
  const texto = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /PGRST205|42P01|does not exist|schema cache/i.test(texto);
}

function ambiente(valor: unknown): AmbienteTefAssistente {
  return valor === "producao" ? "producao" : "homologacao";
}

function leituraConnector(valor: Partial<LeituraConnector> | undefined): LeituraConnector {
  return {
    respondeu: valor?.respondeu === true,
    versao: valor?.versao ? String(valor.versao).slice(0, 40) : null,
    disponivel: valor?.disponivel === true,
    executavelEncontrado: valor?.executavelEncontrado === true,
    processo: valor?.processo ? String(valor.processo).slice(0, 40) : null,
    paygoInicializado: valor?.paygoInicializado === true,
    // A PGWebLib exporta PW_iSetEnvironment e não exporta leitura do ambiente.
    ambienteEfetivo: null,
    situacaoAmbiente: "desconhecido",
    pendenciaLocal: valor?.pendenciaLocal === true,
  };
}

function leituraPinpad(valor: Partial<LeituraPinpad> | undefined): LeituraPinpad {
  return {
    consultado: valor?.consultado === true,
    comunicacao: valor?.comunicacao ? String(valor.comunicacao).slice(0, 40) : null,
    fabricante: valor?.fabricante ? String(valor.fabricante).slice(0, 40) : null,
    modelo: valor?.modelo ? String(valor.modelo).slice(0, 40) : null,
    firmware: valor?.firmware ? String(valor.firmware).slice(0, 40) : null,
    porta: valor?.porta ? String(valor.porta).slice(0, 40) : null,
    paygoInicializado: typeof valor?.paygoInicializado === "boolean" ? valor.paygoInicializado : null,
    ppinfoDisponivel: typeof valor?.ppinfoDisponivel === "boolean" ? valor.ppinfoDisponivel : null,
    limitacaoModelo: valor?.limitacaoModelo ? String(valor.limitacaoModelo).slice(0, 40) : null,
  };
}

async function contextoEdicao() {
  const ctx = await resolverContextoAutorizadoEmpresa();
  let permissaoEditar = true;
  try {
    await exigirPermissao({ modulo: "financeiro", acao: "editar" });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      permissaoEditar = false;
    } else {
      throw error;
    }
  }
  return { ...ctx, permissaoEditar };
}

const COLUNAS_RASCUNHO =
  "etapa, credenciamento_confirmado, ambiente_autorizado, ponto_captura, estabelecimento, parametros_oficiais, adquirentes, pinpad_exigido";

function rascunhoDe(data: {
  etapa?: unknown;
  credenciamento_confirmado?: unknown;
  ambiente_autorizado?: unknown;
  ponto_captura?: unknown;
  estabelecimento?: unknown;
  parametros_oficiais?: unknown;
  adquirentes?: unknown;
  pinpad_exigido?: unknown;
  servidor_homologacao?: unknown;
  servidor_producao?: unknown;
  servidor_confirmado?: unknown;
}): RascunhoAssistente {
  const etapa = String(data.etapa ?? "credenciamento");
  return {
    etapa: etapaPersistida(etapa, data.credenciamento_confirmado === true),
    credenciamentoConfirmado: data.credenciamento_confirmado === true,
    ambienteAutorizado: ambiente(data.ambiente_autorizado),
    pontoCaptura: String(data.ponto_captura ?? ""),
    estabelecimento: String(data.estabelecimento ?? ""),
    parametrosOficiais: String(data.parametros_oficiais ?? ""),
    adquirentes: Array.isArray(data.adquirentes) ? data.adquirentes.map((item) => String(item)) : [],
    pinpadExigido: data.pinpad_exigido !== false,
    servidorHomologacao: String(data.servidor_homologacao ?? ""),
    servidorProducao: String(data.servidor_producao ?? ""),
    servidorConfirmado: data.servidor_confirmado === true,
  };
}

export async function lerRascunhoAssistente(empresaId: string) {
  const cliente = createAdminClient();
  const completo = await cliente
    .from("tef_instalacoes")
    .select(`${COLUNAS_RASCUNHO}, servidor_homologacao, servidor_producao, servidor_confirmado`)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (completo.error && colunaServidorAusente(completo.error)) {
    const anterior = await cliente
      .from("tef_instalacoes")
      .select(COLUNAS_RASCUNHO)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (anterior.error) {
      if (migracaoAusente(anterior.error)) {
        return { migracaoPendente: true as const, rascunho: null };
      }
      throw new ErroTef("Não foi possível consultar o andamento do TEF.", 500);
    }
    if (!anterior.data) {
      return { migracaoPendente: false as const, rascunho: null };
    }
    return { migracaoPendente: false as const, rascunho: rascunhoDe(anterior.data) };
  }
  if (completo.error) {
    if (migracaoAusente(completo.error)) {
      return { migracaoPendente: true as const, rascunho: null };
    }
    throw new ErroTef("Não foi possível consultar o andamento do TEF.", 500);
  }
  if (!completo.data) {
    return { migracaoPendente: false as const, rascunho: null };
  }
  return { migracaoPendente: false as const, rascunho: rascunhoDe(completo.data) };
}

export async function lerPaginaAssistenteTef() {
  const ctx = await contextoEdicao();
  const [{ data: empresa }, { data: fiscal }, config, instalacao, plano] = await Promise.all([
    ctx.supabase.from("empresas").select("cnpj").eq("id", ctx.empresaId).maybeSingle(),
    ctx.supabase.from("empresas_fiscal").select("ambiente").eq("empresa_id", ctx.empresaId).maybeSingle(),
    lerHabilitacaoTef(ctx.supabase, ctx.empresaId),
    lerRascunhoAssistente(ctx.empresaId),
    planoPermiteRecursoEmpresa(ctx.empresaId, "pdv"),
  ]);
  return {
    empresaId: ctx.empresaId,
    cnpj: digitosCnpj(empresa?.cnpj),
    ambienteFiscal: fiscal?.ambiente == null ? null : Number(fiscal.ambiente),
    permissaoEditar: ctx.permissaoEditar,
    perfil: ctx.perfil,
    administrador: ctx.perfil === "administrador",
    planoPdv: plano.permitido === true,
    plataformaHabilitada: config.plataformaHabilitada === true,
    empresaJaHabilitada: config.empresaHabilitada === true,
    ambienteAtual: config.ambiente === "producao" ? "producao" : "homologacao",
    pontoAtual: config.pontoCaptura,
    estabelecimentoAtual: config.estabelecimento,
    migracaoInstalacaoPendente: instalacao.migracaoPendente,
    rascunho: instalacao.rascunho,
  };
}

function credenciamentoEfetivo(
  pagina: Awaited<ReturnType<typeof lerPaginaAssistenteTef>>,
  informado: Partial<CredenciamentoInformado> | undefined
): {
  credenciamento: CredenciamentoInformado;
  pontoAutorizado: string;
  ambienteAutorizado: AmbienteTefAssistente | "";
  estabelecimento: string;
} {
  if (pagina.empresaJaHabilitada) {
    return {
      credenciamento: credenciamentoDoRascunho(pagina.cnpj, pagina.rascunho, pagina.cnpj, pagina),
      pontoAutorizado: pagina.pontoAtual,
      ambienteAutorizado: ambienteInformado(pagina.ambienteAtual),
      estabelecimento: pagina.estabelecimentoAtual,
    };
  }
  if (pagina.rascunho?.credenciamentoConfirmado) {
    const credenciamento = credenciamentoDoRascunho(pagina.cnpj, pagina.rascunho, pagina.cnpj, pagina);
    return {
      credenciamento,
      pontoAutorizado: pagina.rascunho.pontoCaptura,
      ambienteAutorizado: ambienteInformado(pagina.rascunho.ambienteAutorizado),
      estabelecimento: pagina.rascunho.estabelecimento,
    };
  }
  const credenciamento = validarCredenciamento({
    cnpjEmpresa: pagina.cnpj,
    cnpjConfirmado: String(informado?.cnpjConfirmado ?? ""),
    credenciamentoConfirmado: informado?.credenciamentoConfirmado === true,
    ambienteAutorizado: ambienteInformado(informado?.ambienteAutorizado),
    pontoCaptura: String(informado?.pontoCaptura ?? ""),
    estabelecimento: String(informado?.estabelecimento ?? ""),
    parametrosOficiais: String(informado?.parametrosOficiais ?? ""),
    adquirentes: Array.isArray(informado?.adquirentes) ? informado.adquirentes : [],
    servidorHomologacao: String(informado?.servidorHomologacao ?? ""),
    servidorProducao: String(informado?.servidorProducao ?? ""),
    servidorConfirmado: informado?.servidorConfirmado === true,
  });
  return {
    credenciamento: {
      cnpjEmpresa: pagina.cnpj,
      cnpjConfirmado: String(informado?.cnpjConfirmado ?? ""),
      credenciamentoConfirmado: informado?.credenciamentoConfirmado === true,
      ambienteAutorizado: credenciamento.ambienteAutorizado,
      pontoCaptura: credenciamento.pontoCaptura,
      estabelecimento: credenciamento.estabelecimento,
      parametrosOficiais: String(informado?.parametrosOficiais ?? ""),
      adquirentes: credenciamento.adquirentes,
      servidorHomologacao: credenciamento.servidorHomologacao,
      servidorProducao: credenciamento.servidorProducao,
      servidorConfirmado: informado?.servidorConfirmado === true,
    } satisfies CredenciamentoInformado,
    pontoAutorizado: credenciamento.pontoCaptura,
    ambienteAutorizado: credenciamento.ambienteAutorizado,
    estabelecimento: credenciamento.estabelecimento,
  };
}
function credenciamentoDoRascunho(
  cnpj: string,
  rascunho: RascunhoAssistente | null,
  confirmado: string,
  pagina: Awaited<ReturnType<typeof lerPaginaAssistenteTef>>
): CredenciamentoInformado {
  if (pagina.empresaJaHabilitada) {
    return {
      cnpjEmpresa: cnpj,
      cnpjConfirmado: cnpj,
      credenciamentoConfirmado: true,
      ambienteAutorizado: pagina.ambienteAtual === "producao" ? "producao" : "homologacao",
      pontoCaptura: pagina.pontoAtual,
      estabelecimento: pagina.estabelecimentoAtual,
      parametrosOficiais: rascunho?.parametrosOficiais ?? "",
      adquirentes: rascunho?.adquirentes ?? [],
      servidorHomologacao: rascunho?.servidorHomologacao ?? "",
      servidorProducao: rascunho?.servidorProducao ?? "",
      servidorConfirmado: true,
      exigirServidor: false,
    };
  }
  return {
    cnpjEmpresa: cnpj,
    cnpjConfirmado: confirmado,
    credenciamentoConfirmado: rascunho?.credenciamentoConfirmado === true,
    ambienteAutorizado: rascunho?.ambienteAutorizado ?? "",
    pontoCaptura: rascunho?.pontoCaptura ?? "",
    estabelecimento: rascunho?.estabelecimento ?? "",
    parametrosOficiais: rascunho?.parametrosOficiais ?? "",
    adquirentes: rascunho?.adquirentes ?? [],
    servidorHomologacao: rascunho?.servidorHomologacao ?? "",
    servidorProducao: rascunho?.servidorProducao ?? "",
    servidorConfirmado: rascunho?.servidorConfirmado === true,
  };
}

async function pendenciasDaEmpresa(empresaId: string) {
  const cliente = createAdminClient();
  const { count, error } = await cliente
    .from("tef_operacoes")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .in("status", [...STATUS_TEF_ABERTOS]);
  if (error) {
    if (migracaoAusente(error)) {
      return 0;
    }
    throw new ErroTef("Não foi possível consultar as pendências TEF.", 500);
  }
  return count ?? 0;
}

async function terminaisDaObservacao(empresaId: string, dispositivoId: string) {
  const cliente = createAdminClient();
  const { data, error } = await cliente
    .from("tef_terminais")
    .select("empresa_id, dispositivo_id, ativo, ponto_captura")
    .eq("dispositivo_id", dispositivoId)
    .eq("ativo", true);
  if (error) {
    if (migracaoAusente(error)) {
      return [];
    }
    throw new ErroTef("Não foi possível consultar o terminal TEF.", 500);
  }
  return (data ?? []).map((linha) => ({
    empresaId: String(linha.empresa_id),
    dispositivoId: String(linha.dispositivo_id),
    ativo: linha.ativo !== false,
    pontoCaptura: String(linha.ponto_captura ?? ""),
  }));
}

export async function avaliarAssistenteTefSessao(observacao: ObservacaoAssistente) {
  const pagina = await lerPaginaAssistenteTef();
  const dispositivoId = String(observacao.dispositivoId ?? "").trim();
  const terminais = dispositivoId
    ? await terminaisDaObservacao(pagina.empresaId, dispositivoId)
    : [];
  const pendencias = await pendenciasDaEmpresa(pagina.empresaId);
  const efetivo = credenciamentoEfetivo(pagina, observacao.credenciamento);
  const evidencia = await consultarEvidenciaDaEmpresa({
    empresaId: pagina.empresaId,
    dispositivoId,
    ambienteDeclarado: efetivo.ambienteAutorizado,
  });
  return avaliarInstalacao({
    credenciamento: efetivo.credenciamento,
    connector: leituraConnector(observacao.connector),
    pinpad: leituraPinpad(observacao.pinpad),
    pinpadExigido:
      pagina.rascunho?.credenciamentoConfirmado
        ? pagina.rascunho.pinpadExigido !== false
        : observacao.pinpadExigido !== false,
    empresaId: pagina.empresaId,
    terminais,
    dispositivoId,
    pontoAutorizado: efetivo.pontoAutorizado,
    ambienteAutorizado: efetivo.ambienteAutorizado,
    pendenciasFinanceiras: pendencias,
    planoPdv: pagina.planoPdv,
    permissaoEditar: pagina.permissaoEditar,
    plataformaHabilitada: pagina.plataformaHabilitada,
    ambienteFiscal: pagina.ambienteFiscal,
    evidencia,
  });
}

export async function salvarRascunhoAssistenteSessao(input: {
  cnpjConfirmado: string;
  credenciamentoConfirmado: boolean;
  ambienteAutorizado: string;
  pontoCaptura: string;
  estabelecimento: string;
  parametrosOficiais: string;
  adquirentes: string[];
  pinpadExigido: boolean;
  etapa: string;
  servidorHomologacao: string;
  servidorProducao: string;
  servidorConfirmado: boolean;
}) {
  const pagina = await lerPaginaAssistenteTef();
  if (!pagina.permissaoEditar) {
    throw new ErroTef("A ativação exige permissão de edição do financeiro.", 403);
  }
  if (pagina.empresaJaHabilitada) {
    return { ok: true as const, preservado: true as const, etapa: "validacao" as const };
  }
  const credenciamento = validarCredenciamento({
    cnpjEmpresa: pagina.cnpj,
    cnpjConfirmado: input.cnpjConfirmado,
    credenciamentoConfirmado: input.credenciamentoConfirmado,
    ambienteAutorizado: ambienteInformado(
      input.ambienteAutorizado === "producao" || input.ambienteAutorizado === "homologacao"
        ? input.ambienteAutorizado
        : ""
    ),
    pontoCaptura: input.pontoCaptura,
    estabelecimento: input.estabelecimento,
    parametrosOficiais: input.parametrosOficiais,
    adquirentes: input.adquirentes,
    servidorHomologacao: input.servidorHomologacao,
    servidorProducao: input.servidorProducao,
    servidorConfirmado: input.servidorConfirmado,
  });
  if (!credenciamento.ok) {
    return {
      ok: false as const,
      pendencias: credenciamento.pendencias,
      etapa: "credenciamento" as const,
    };
  }
  const ambienteNovo = credenciamento.ambienteAutorizado;
  if (ambienteNovo !== "homologacao" && ambienteNovo !== "producao") {
    return {
      ok: false as const,
      pendencias: ["Informe o ambiente autorizado: homologação ou produção."],
      etapa: "credenciamento" as const,
    };
  }
  const servidorNovo =
    ambienteNovo === "producao" ? credenciamento.servidorProducao : credenciamento.servidorHomologacao;
  const pareados = await servidoresPareados(pagina.empresaId);
  const pendenciasFinanceiras = await pendenciasDaEmpresa(pagina.empresaId);
  const bases =
    pareados.length > 0 ? pareados : [{ servidor: "", ambiente: "" as const }];
  for (const pareado of bases) {
    const decisao = decidirGravacaoServidor({
      perfil: pagina.perfil ?? "",
      confirmacaoExplicita: input.servidorConfirmado === true,
      empresaJaHabilitada: false,
      pendenciaFinanceira: pendenciasFinanceiras > 0,
      terminalPareado: pareados.length > 0,
      servidorAtual: pareado.servidor,
      servidorNovo,
      ambienteAtual: pareado.ambiente,
      ambienteNovo,
    });
    if (decisao.efeito === "recusar") {
      return {
        ok: false as const,
        pendencias: [decisao.motivo],
        etapa: "credenciamento" as const,
      };
    }
  }
  const etapa = etapaPersistida(input.etapa, true);
  const cliente = createAdminClient();
  const { error } = await cliente.from("tef_instalacoes").upsert({
    empresa_id: pagina.empresaId,
    etapa,
    credenciamento_confirmado: true,
    ambiente_autorizado: credenciamento.ambienteAutorizado || "homologacao",
    ponto_captura: credenciamento.pontoCaptura,
    estabelecimento: credenciamento.estabelecimento,
    parametros_oficiais: input.parametrosOficiais.trim().slice(0, 500),
    adquirentes: credenciamento.adquirentes,
    pinpad_exigido: input.pinpadExigido !== false,
    servidor_homologacao: credenciamento.servidorHomologacao,
    servidor_producao: credenciamento.servidorProducao,
    servidor_confirmado: input.servidorConfirmado === true,
    atualizado_em: new Date().toISOString(),
  });
  if (error) {
    if (colunaServidorAusente(error)) {
      throw new ErroTef(
        "O servidor PayGoWeb ainda não foi aplicado no banco. A migration 20261011190000_tef_servidor_paygo.sql precisa ser aplicada antes de confirmar o servidor.",
        503
      );
    }
    if (migracaoAusente(error)) {
      throw new ErroTef(
        "O andamento do assistente ainda não foi aplicado no banco. A migration 20261011140000_tef_assistente_instalacao.sql precisa ser aplicada antes de retomar a instalação.",
        503
      );
    }
    throw new ErroTef("Não foi possível salvar o andamento do TEF.", 500);
  }
  await gravarServidoresPayGoEmpresa(pagina.empresaId, {
    ambiente: ambienteNovo,
    estabelecimento: credenciamento.estabelecimento,
    pontoCaptura: credenciamento.pontoCaptura,
    servidorHomologacao: credenciamento.servidorHomologacao,
    servidorProducao: credenciamento.servidorProducao,
  });
  return { ok: true as const, preservado: false as const, etapa, pendencias: credenciamento.pendencias };
}

async function servidoresPareados(empresaId: string) {
  const cliente = createAdminClient();
  const { data, error } = await cliente
    .from("tef_terminais")
    .select("servidor, ambiente")
    .eq("empresa_id", empresaId)
    .eq("ativo", true)
    .is("revogada_em", null);
  if (error) {
    if (colunaServidorAusente(error) || migracaoAusente(error)) {
      return [];
    }
    throw new ErroTef("Não foi possível consultar o servidor do terminal.", 500);
  }
  return (data ?? []).map((linha) => ({
    servidor: String(linha.servidor ?? ""),
    ambiente:
      linha.ambiente === "producao" || linha.ambiente === "homologacao" ? linha.ambiente : ("" as const),
  }));
}

export async function ativarAssistenteTefSessao(observacao: ObservacaoAssistente) {
  const pagina = await lerPaginaAssistenteTef();
  const avaliacao = await avaliarAssistenteTefSessao(observacao);
  const efetivo = credenciamentoEfetivo(pagina, observacao.credenciamento);
  const decisao = decidirAtivacao({
    permissaoEditar: pagina.permissaoEditar,
    empresaJaHabilitada: pagina.empresaJaHabilitada,
    podeAtivar: avaliacao.podeAtivar,
    pontoAtual: pagina.pontoAtual,
    ambienteAtual: pagina.ambienteAtual === "producao" ? "producao" : "homologacao",
    pontoInformado: efetivo.pontoAutorizado,
    ambienteInformado: efetivo.ambienteAutorizado === "producao" ? "producao" : efetivo.ambienteAutorizado === "homologacao" ? "homologacao" : "",
  });
  if (decisao.efeito === "recusar") {
    return {
      ok: false as const,
      efeito: decisao.efeito,
      motivo: decisao.motivo,
      mensagens: avaliacao.mensagens,
    };
  }
  if (decisao.efeito === "preservar") {
    return { ok: true as const, efeito: decisao.efeito, mensagens: avaliacao.mensagens };
  }
  if (decisao.ambiente !== "producao" && decisao.ambiente !== "homologacao") {
    return {
      ok: false as const,
      efeito: "recusar" as const,
      motivo: "requisitos",
      mensagens: avaliacao.mensagens,
    };
  }
  const evidencia = await consultarEvidenciaDaEmpresa({
    empresaId: pagina.empresaId,
    dispositivoId: String(observacao.dispositivoId ?? "").trim(),
    ambienteDeclarado: efetivo.ambienteAutorizado,
  });
  const ambienteEvidencia = evidencia.ambienteEfetivo;
  if (
    evidencia.situacao !== "comprovado" ||
    evidencia.deveRevogar ||
    (ambienteEvidencia !== "homologacao" && ambienteEvidencia !== "producao") ||
    ambienteEvidencia !== decisao.ambiente
  ) {
    return {
      ok: false as const,
      efeito: "recusar" as const,
      motivo: "requisitos",
      mensagens: [evidencia.motivo],
    };
  }
  const gravacao = montarGravacaoAtivacao({
    empresaSessaoId: pagina.empresaId,
    empresaInformada: observacao.empresaId ?? null,
    ambiente: ambienteEvidencia,
    pontoCaptura: decisao.ponto || "",
    estabelecimento: efetivo.estabelecimento,
  });
  await salvarConfigTefEmpresa(gravacao.empresaId, {
    habilitado: true,
    ambiente: gravacao.ambiente,
    estabelecimento: gravacao.estabelecimento,
    pontoCaptura: gravacao.pontoCaptura,
  });
  return { ok: true as const, efeito: decisao.efeito, mensagens: [] as string[] };
}

const ID_EVIDENCIA =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ambienteDeclaradoDaEvidencia(
  valor: AmbienteTefAssistente | ""
): AmbienteEvidenciaInstalacao | "" {
  return valor === "homologacao" || valor === "producao" ? valor : "";
}

export async function consultarEvidenciaDaEmpresa(input: {
  empresaId: string;
  dispositivoId: string;
  ambienteDeclarado: AmbienteTefAssistente | "";
}): Promise<ClassificacaoAmbienteInstalacao> {
  const declarado = ambienteDeclaradoDaEvidencia(input.ambienteDeclarado);
  const dispositivoId = input.dispositivoId.trim().toLowerCase();
  if (!ID_EVIDENCIA.test(dispositivoId)) {
    return classificacaoSemEvidencia(declarado);
  }
  const cliente = createAdminClient();
  const terminal = await cliente
    .from("tef_terminais")
    .select("id, dispositivo_id, chave_publica, estabelecimento, ponto_captura")
    .eq("empresa_id", input.empresaId)
    .eq("dispositivo_id", dispositivoId)
    .eq("ativo", true)
    .is("revogada_em", null)
    .maybeSingle();
  if (terminal.error) {
    if (migracaoAusente(terminal.error)) {
      return classificacaoSemEvidencia(declarado);
    }
    throw new ErroTef("Não foi possível consultar o terminal da evidência.", 500);
  }
  const armazenada = await cliente
    .from("tef_evidencias_instalacao")
    .select(
      "id, dispositivo_id, terminal_id, ponto_captura, estabelecimento, ambiente, instalacao_id, assinatura"
    )
    .eq("empresa_id", input.empresaId)
    .eq("dispositivo_id", dispositivoId)
    .is("revogada_em", null)
    .maybeSingle();
  if (armazenada.error) {
    if (migracaoAusente(armazenada.error)) {
      return classificacaoSemEvidencia(declarado);
    }
    throw new ErroTef("Não foi possível consultar a evidência de instalação.", 500);
  }
  const linha = armazenada.data;
  const terminalLinha = terminal.data;
  const ambienteLinha =
    linha?.ambiente === "producao" || linha?.ambiente === "homologacao" ? linha.ambiente : null;
  const classificacao = consultarEvidenciaArmazenada({
    evidencia:
      linha && ambienteLinha
        ? {
            campos: {
              empresaId: input.empresaId,
              dispositivoId: String(linha.dispositivo_id),
              terminalId: String(linha.terminal_id),
              pontoCaptura: String(linha.ponto_captura ?? ""),
              estabelecimento: String(linha.estabelecimento ?? ""),
              ambiente: ambienteLinha,
              instalacaoId: String(linha.instalacao_id),
            },
            assinatura: String(linha.assinatura ?? ""),
            revogada: false,
          }
        : null,
    chavePublicaPem: terminalLinha?.chave_publica ? String(terminalLinha.chave_publica) : "",
    empresaSessaoId: input.empresaId,
    dispositivoAutorizado: terminalLinha ? String(terminalLinha.dispositivo_id) : "",
    terminalAutorizadoId: terminalLinha ? String(terminalLinha.id) : "",
    pontoTerminal: terminalLinha ? String(terminalLinha.ponto_captura ?? "") : "",
    estabelecimentoTerminal: terminalLinha ? String(terminalLinha.estabelecimento ?? "") : "",
    ambienteDeclarado: declarado,
    evento: "nenhum",
  });
  if (classificacao.deveRevogar && linha?.id) {
    const { error } = await cliente
      .from("tef_evidencias_instalacao")
      .update({
        revogada_em: new Date().toISOString(),
        motivo_revogacao: classificacao.motivo.slice(0, 200),
      })
      .eq("id", linha.id)
      .eq("empresa_id", input.empresaId)
      .is("revogada_em", null);
    if (error && !migracaoAusente(error)) {
      throw new ErroTef("Não foi possível revogar a evidência de instalação.", 500);
    }
  }
  return classificacao;
}

export async function registrarEvidenciaInstalacaoSessao(input: {
  campos: CamposEvidenciaInstalacao;
  assinatura: string;
}) {
  const ctx = await contextoEdicao();
  if (!ctx.permissaoEditar) {
    throw new ErroTef("O registro da evidência exige permissão de edição do financeiro.", 403);
  }
  const dispositivoId = String(input.campos?.dispositivoId ?? "").trim().toLowerCase();
  if (!ID_EVIDENCIA.test(dispositivoId)) {
    throw new ErroTef("Os identificadores da instalação estão incompletos.", 400);
  }
  const cliente = createAdminClient();
  const { data: terminal, error: erroTerminal } = await cliente
    .from("tef_terminais")
    .select("id, dispositivo_id, chave_publica, estabelecimento, ponto_captura")
    .eq("empresa_id", ctx.empresaId)
    .eq("dispositivo_id", dispositivoId)
    .eq("ativo", true)
    .is("revogada_em", null)
    .maybeSingle();
  if (erroTerminal) {
    throw new ErroTef("Não foi possível consultar o terminal da evidência.", 500);
  }
  if (!terminal?.chave_publica) {
    throw new ErroTef("O terminal ainda não está autorizado nesta empresa.", 403);
  }
  const instalacaoId = String(input.campos.instalacaoId ?? "").trim().toLowerCase();
  const { data: conhecida, error: erroConhecida } = await cliente
    .from("tef_evidencias_instalacao")
    .select("id")
    .eq("instalacao_id", instalacaoId)
    .maybeSingle();
  if (erroConhecida) {
    if (migracaoAusente(erroConhecida)) {
      throw new ErroTef(
        "A evidência de instalação ainda não foi aplicada no banco. A migration 20261011180000_tef_evidencia_instalacao.sql precisa ser aplicada antes do registro.",
        503
      );
    }
    throw new ErroTef("Não foi possível conferir a evidência de instalação.", 500);
  }
  const { data: ativa, error: erroAtiva } = await cliente
    .from("tef_evidencias_instalacao")
    .select("id")
    .eq("empresa_id", ctx.empresaId)
    .eq("dispositivo_id", dispositivoId)
    .is("revogada_em", null)
    .maybeSingle();
  if (erroAtiva) {
    throw new ErroTef("Não foi possível conferir a evidência ativa.", 500);
  }
  const plano = prepararRegistroEvidencia({
    campos: input.campos,
    assinatura: input.assinatura,
    chavePublicaPem: String(terminal.chave_publica),
    empresaSessaoId: ctx.empresaId,
    dispositivoAutorizado: String(terminal.dispositivo_id),
    terminalAutorizadoId: String(terminal.id),
    pontoAutorizado: String(terminal.ponto_captura ?? ""),
    estabelecimentoAutorizado: String(terminal.estabelecimento ?? ""),
    instalacaoJaRegistrada: Boolean(conhecida?.id),
    evidenciaAtivaNoDispositivo: Boolean(ativa?.id),
  });
  if (!plano.ok) {
    throw new ErroTef(plano.motivo, 403);
  }
  if (plano.registro.empresa_id !== ctx.empresaId.trim().toLowerCase()) {
    throw new ErroTef("A evidência de instalação pertence a outra empresa.", 403);
  }
  if (plano.revogarAtiva && ativa?.id) {
    const { error } = await cliente
      .from("tef_evidencias_instalacao")
      .update({
        revogada_em: new Date().toISOString(),
        motivo_revogacao: "Substituída por nova instalação controlada.",
      })
      .eq("id", ativa.id)
      .eq("empresa_id", ctx.empresaId)
      .is("revogada_em", null);
    if (error) {
      throw new ErroTef("Não foi possível revogar a evidência anterior.", 500);
    }
  }
  const { error } = await cliente.from("tef_evidencias_instalacao").insert({
    empresa_id: ctx.empresaId,
    dispositivo_id: plano.registro.dispositivo_id,
    terminal_id: plano.registro.terminal_id,
    instalacao_id: plano.registro.instalacao_id,
    ponto_captura: plano.registro.ponto_captura,
    estabelecimento: plano.registro.estabelecimento,
    ambiente: plano.registro.ambiente,
    origem: "instalacao_controlada",
    assinatura: plano.registro.assinatura,
  });
  if (error) {
    throw new ErroTef("Não foi possível registrar a evidência de instalação.", 500);
  }
  return {
    ok: true as const,
    ambiente: plano.registro.ambiente,
    origem: "instalacao_controlada" as const,
  };
}
