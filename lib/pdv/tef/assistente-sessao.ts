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
  sanitizarObservacaoBiblioteca,
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
import { decidirInstalacaoControlada, decidirInstalacaoProducaoIsolada } from "@/lib/pdv/tef/instalacao-controlada";
import { diretoriosRelativosBiblioteca } from "@/lib/pdv/tef/diretorio-biblioteca";
import { ErroTef, gravarServidoresPayGoEmpresa, lerHabilitacaoTef, salvarConfigTefEmpresa } from "@/lib/pdv/tef/persistencia";
import { STATUS_TEF_ABERTOS } from "@/lib/pdv/tef/regras";
import { confirmarServidorPersistido, decidirGravacaoServidor } from "@/lib/pdv/tef/servidor-paygo";

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
  biblioteca?: unknown;
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
    pgwebLibPronta: valor?.pgwebLibPronta === true,
    pgwebVersao: valor?.pgwebVersao ? String(valor.pgwebVersao).slice(0, 40) : null,
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

export async function lerRascunhoAssistente(empresaId: string): Promise<any>  {
  throw new ErroTef("A operação TEF foi desativada. Nenhuma instalação, pareamento, comunicação com PinPad ou cobrança foi executada. O histórico financeiro permanece.", 410);
}


export async function lerPaginaAssistenteTef(): Promise<any> {
  throw new ErroTef("A operação TEF foi desativada. Nenhuma instalação, pareamento, comunicação com PinPad ou cobrança foi executada. O histórico financeiro permanece.", 410);
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

export async function avaliarAssistenteTefSessao(observacao: ObservacaoAssistente): Promise<any>  {
  throw new ErroTef("A operação TEF foi desativada. Nenhuma instalação, pareamento, comunicação com PinPad ou cobrança foi executada. O histórico financeiro permanece.", 410);
}


async function consultarProvaTecnicaDaEmpresa(empresaId: string, dispositivoId: string) {
  void empresaId;
  void dispositivoId;
  return null;
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
}): Promise<any>  {
  throw new ErroTef("A operação TEF foi desativada. Nenhuma instalação, pareamento, comunicação com PinPad ou cobrança foi executada. O histórico financeiro permanece.", 410);
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

export async function ativarAssistenteTefSessao(observacao: ObservacaoAssistente): Promise<any>  {
  throw new ErroTef("A operação TEF foi desativada. Nenhuma instalação, pareamento, comunicação com PinPad ou cobrança foi executada. O histórico financeiro permanece.", 410);
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
  throw new ErroTef("A operação TEF foi desativada. Nenhuma instalação, pareamento, comunicação com PinPad ou cobrança foi executada. O histórico financeiro permanece.", 410);
}


export async function registrarEvidenciaInstalacaoSessao(input: {
  campos: CamposEvidenciaInstalacao;
  assinatura: string;
}): Promise<any>  {
  throw new ErroTef("A operação TEF foi desativada. Nenhuma instalação, pareamento, comunicação com PinPad ou cobrança foi executada. O histórico financeiro permanece.", 410);
}


async function lerServidoresOficiais(empresaId: string) {
  const cliente = createAdminClient();
  const consulta = await cliente
    .from("tef_configuracoes")
    .select("servidor_homologacao, servidor_producao")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (consulta.error) {
    if (colunaServidorAusente(consulta.error) || migracaoAusente(consulta.error)) {
      return { servidorHomologacao: "", servidorProducao: "" };
    }
    throw new ErroTef("Não foi possível consultar o servidor PayGoWeb.", 500);
  }
  return {
    servidorHomologacao: String(consulta.data?.servidor_homologacao ?? ""),
    servidorProducao: String(consulta.data?.servidor_producao ?? ""),
  };
}

export async function prepararInstalacaoAssistenteSessao(input: {
  confirmacaoExplicita: boolean;
  dispositivoId: string;
  credencialInformada: boolean;
  autorizacaoExplicitaReset: boolean;
  proposta: { pontoCaptura: string; ambiente: string; servidor: string } | null;
}): Promise<any>  {
  throw new ErroTef("A operação TEF foi desativada. Nenhuma instalação, pareamento, comunicação com PinPad ou cobrança foi executada. O histórico financeiro permanece.", 410);
}


export async function prepararBibliotecaProducaoSessao(input: {
  confirmacaoExplicita: boolean;
  dispositivoId: string;
  credencialInformada: boolean;
}): Promise<any>  {
  throw new ErroTef("A operação TEF foi desativada. Nenhuma instalação, pareamento, comunicação com PinPad ou cobrança foi executada. O histórico financeiro permanece.", 410);
}

