import path from "node:path";

import {
  avaliarEmissaoEvidencia,
  prepararRegistroEvidencia,
  type ObservacaoInstalacaoControlada,
} from "@/lib/pdv/tef/evidencia-instalacao";
import { ABI_COMPROVADO, LAYOUT_HOMOLOGADO } from "@/lib/pdv/tef/motor";

export const ESTADOS_INSTALACAO_HOMOLOGACAO = [
  "nao_instalado",
  "preparado",
  "em_andamento",
  "instalado_confirmado",
  "falha_recuperacao",
] as const;

export type EstadoInstalacaoHomologacao = (typeof ESTADOS_INSTALACAO_HOMOLOGACAO)[number];

export const ROTULOS_INSTALACAO_HOMOLOGACAO: Record<EstadoInstalacaoHomologacao, string> = {
  nao_instalado: "Não instalado",
  preparado: "Preparado para instalação",
  em_andamento: "Instalação em andamento",
  instalado_confirmado: "Instalado e confirmado",
  falha_recuperacao: "Falha ou recuperação necessária",
};

export const CONFIRMACAO_INSTALACAO_HOMOLOGACAO = "EXECUTAR_PWOPER_INSTALL_HOMOLOGACAO";
export const CONFIRMACAO_INSTALACAO_PRODUCAO = "EXECUTAR_PWOPER_INSTALL_PRODUCAO";

export const IMPEDIMENTO_INSTALACAO_HOMOLOGACAO =
  "A comunicação do PinPad não comprova o ABI de PW_GetData. O record Pascal foi medido no Windows x64 junto do header público Linux, e ABI_COMPROVADO e LAYOUT_HOMOLOGADO continuam falsos. PW_iExecTransac só começa depois da confirmação explícita e pode produzir efeitos reais na homologação.";

export function mascararCnpjInstalacao(cnpj: string) {
  const digitos = cnpj.replace(/\D/g, "");
  if (digitos.length !== 14) return "";
  return `${digitos.slice(0, 2)}.***.***/****-${digitos.slice(12)}`;
}

export const ETAPAS_INSTALACAO_HOMOLOGACAO = [
  "Criar o diretório exclusivo do ambiente antes de PW_iInit.",
  "Enquanto o ponto não está instalado, PW_iSetEnvironment do ambiente configurado e, em seguida, PW_iInit até PWRET_OK.",
  "PW_iNewTransac(PWOPER_INSTALL).",
  "PW_iExecTransac com PW_GetData. Em PWRET_MOREDATA, responder só o dado pedido, por PW_iAddParam. A senha técnica só entra se a biblioteca pedir PWINFO_AUTHTECHUSER.",
  "Confirmar ou desfazer o resultado antes de outra transação. Com o ponto instalado, PW_iSetEnvironment não é chamado de novo.",
] as const;

export type EntradaInstalacaoHomologacao = {
  ambiente: "homologacao" | "producao" | "";
  empresaAutorizada: boolean;
  terminalAutorizado: boolean;
  configuracaoCompleta: boolean;
  comunicacaoPinpad: boolean;
  evidenciaBiblioteca: boolean;
  emAndamento: boolean;
  pendenciaFinanceira: boolean;
  diretorio: string;
};

function diretorioDoAmbiente(ambiente: EntradaInstalacaoHomologacao["ambiente"], diretorio: string) {
  const normal = diretorio.trim().toLowerCase();
  if (ambiente === "homologacao") {
    return normal.includes("homologacao") && !normal.includes("producao") && !normal.includes("\\paygo\\");
  }
  if (ambiente === "producao") {
    return normal.includes("producao") && normal.includes("pgweb") && !normal.includes("homologacao");
  }
  return false;
}

export function classificarInstalacaoHomologacao(input: EntradaInstalacaoHomologacao) {
  const bloqueio = {
    executar: false as const,
    abiComprovado: ABI_COMPROVADO,
    layoutHomologado: LAYOUT_HOMOLOGADO,
    operacao: 0x01,
    operacaoNome: "PWOPER_INSTALL" as const,
    impedimento: IMPEDIMENTO_INSTALACAO_HOMOLOGACAO,
    etapas: ETAPAS_INSTALACAO_HOMOLOGACAO,
  };
  if (!diretorioDoAmbiente(input.ambiente, input.diretorio)) {
    return {
      ...bloqueio,
      estado: "nao_instalado" as const,
      rotulo: ROTULOS_INSTALACAO_HOMOLOGACAO.nao_instalado,
      motivo: "A instalação usa somente o diretório exclusivo do ambiente configurado nesta empresa.",
    };
  }
  if (input.pendenciaFinanceira) {
    return {
      ...bloqueio,
      estado: "falha_recuperacao" as const,
      rotulo: ROTULOS_INSTALACAO_HOMOLOGACAO.falha_recuperacao,
      motivo: "Há transação pendente. A instalação fica parada até a recuperação.",
    };
  }
  if (input.emAndamento) {
    return {
      ...bloqueio,
      estado: "em_andamento" as const,
      rotulo: ROTULOS_INSTALACAO_HOMOLOGACAO.em_andamento,
      motivo: IMPEDIMENTO_INSTALACAO_HOMOLOGACAO,
    };
  }
  if (input.evidenciaBiblioteca) {
    return {
      ...bloqueio,
      estado: "instalado_confirmado" as const,
      rotulo: ROTULOS_INSTALACAO_HOMOLOGACAO.instalado_confirmado,
      motivo: "A evidência assinada e validada confirma a instalação deste ponto.",
    };
  }
  if (
    input.empresaAutorizada &&
    input.terminalAutorizado &&
    input.configuracaoCompleta &&
    input.comunicacaoPinpad
  ) {
    return {
      ...bloqueio,
      estado: "preparado" as const,
      rotulo: ROTULOS_INSTALACAO_HOMOLOGACAO.preparado,
      motivo: IMPEDIMENTO_INSTALACAO_HOMOLOGACAO,
    };
  }
  return {
    ...bloqueio,
    estado: "nao_instalado" as const,
    rotulo: ROTULOS_INSTALACAO_HOMOLOGACAO.nao_instalado,
    motivo: "Falta configuração deste ambiente, terminal autorizado ou comunicação do PinPad.",
  };
}

export function montarConfirmacaoInstalacaoHomologacao(input: {
  ambiente: "homologacao" | "producao" | "";
  ponto: string;
  servidor: string;
  cnpjMascarado: string;
  dllIntegra: boolean;
  pinpadOcupado: boolean;
  portaPinpad: string;
}) {
  const producao = input.ambiente === "producao";
  const pronta =
    (input.ambiente === "homologacao" || producao) &&
    input.ponto.trim().length > 0 &&
    input.servidor.trim().length > 0 &&
    input.cnpjMascarado.length > 0 &&
    input.dllIntegra === true &&
    input.pinpadOcupado === false &&
    (producao || !input.servidor.toLowerCase().includes("producao"));
  return {
    pronta,
    executar: false as const,
    abiComprovado: ABI_COMPROVADO,
    layoutHomologado: LAYOUT_HOMOLOGADO,
    ambiente: producao ? "Produção" : "Homologação",
    ambienteBiblioteca: producao ? "ENVRMNT_PROD" : "ENVRMNT_TEST",
    perfil: producao ? "TEF\\Producao\\PGWeb" : "TEF\\Homologacao\\PGWeb",
    servidor: input.servidor.trim(),
    ponto: input.ponto.trim(),
    cnpj: input.cnpjMascarado,
    dll: input.dllIntegra ? "PGWebLib.dll x64 4.1.50.924, hash conferido" : "DLL oficial ainda não conferida",
    pinpad: input.pinpadOcupado
      ? "Ocupado por operação financeira"
      : input.portaPinpad
        ? `Comunicação anterior em ${input.portaPinpad}. Isso não comprova o ABI.`
        : "Sem comunicação confirmada nesta sessão",
    confirmacao: producao ? CONFIRMACAO_INSTALACAO_PRODUCAO : CONFIRMACAO_INSTALACAO_HOMOLOGACAO,
    efeito: producao
      ? "A confirmação autoriza PW_iExecTransac de PWOPER_INSTALL no diretório de produção. A senha técnica só é digitada se a biblioteca pedir."
      : "A confirmação autoriza PW_iExecTransac de PWOPER_INSTALL no Connector isolado.",
  };
}

export type ResultadoInstalacaoHomologacao = {
  instalado?: boolean;
  codigo?: string;
  execucaoId?: string;
  cnfreq?: string;
  retornoSetEnvironment?: number | null;
  sessaoAberta?: boolean;
  interrompida?: boolean;
  ponto?: string;
};

export function planejarEvidenciaInstalacaoHomologacao(input: {
  resultado: ResultadoInstalacaoHomologacao;
  empresaId: string;
  dispositivoId: string;
  terminalId: string;
  estabelecimento: string;
  ponto: string;
}): { persistir: false; motivo: string } | { persistir: true; observacao: ObservacaoInstalacaoControlada } {
  const resultado = input.resultado;
  const codigo = String(resultado.codigo ?? "");
  const conclusao = codigo === "PWRET_OK" || codigo === "INSTALADO_CONFIRMADO";
  if (
    resultado.interrompida === true ||
    resultado.sessaoAberta === true ||
    resultado.instalado !== true ||
    !conclusao ||
    (codigo === "PWRET_OK" && resultado.cnfreq === "1")
  ) {
    return {
      persistir: false,
      motivo: "Retorno parcial, falha, espera ou processo encerrado não grava evidência de instalação.",
    };
  }
  if (resultado.retornoSetEnvironment !== 0) {
    return { persistir: false, motivo: "PW_iSetEnvironment não retornou PWRET_OK." };
  }
  if (String(resultado.ponto ?? "") !== input.ponto.trim()) {
    return { persistir: false, motivo: "O ponto devolvido pela biblioteca diverge do ponto de homologação." };
  }
  const observacao: ObservacaoInstalacaoControlada = {
    empresaId: input.empresaId,
    dispositivoId: input.dispositivoId,
    terminalId: input.terminalId,
    pontoCaptura: input.ponto.trim(),
    pontoInstalado: input.ponto.trim(),
    estabelecimento: input.estabelecimento,
    ambienteSolicitado: "homologacao",
    instalacaoId: String(resultado.execucaoId ?? ""),
    pontoNaoExistia: true,
    retornoSetEnvironment: 0,
    instalacaoConcluida: true,
    vinculoAutorizado: true,
  };
  const emissao = avaliarEmissaoEvidencia(observacao);
  if (!emissao.ok) return { persistir: false, motivo: emissao.motivo };
  return { persistir: true, observacao };
}

export function concluirEvidenciaInstalacaoHomologacao(input: {
  resultado: ResultadoInstalacaoHomologacao;
  empresaId: string;
  dispositivoId: string;
  terminalId: string;
  estabelecimento: string;
  pontoHomologacao: string;
  chavePublicaVinculada: string;
  chavePublicaAssinante: string;
  assinatura: string;
}) {
  if (!input.chavePublicaVinculada.trim()) {
    return {
      persistir: false as const,
      motivo: "A chave de homologação não está vinculada a esta empresa.",
    };
  }
  const plano = planejarEvidenciaInstalacaoHomologacao({
    resultado: input.resultado,
    empresaId: input.empresaId,
    dispositivoId: input.dispositivoId,
    terminalId: input.terminalId,
    estabelecimento: input.estabelecimento,
    ponto: input.pontoHomologacao,
  });
  if (!plano.persistir) return { persistir: false as const, motivo: plano.motivo };
  if (input.chavePublicaAssinante.trim() !== input.chavePublicaVinculada.trim()) {
    return {
      persistir: false as const,
      motivo: "A assinatura não pertence à chave de homologação vinculada.",
    };
  }
  const registro = prepararRegistroEvidencia({
    campos: {
      empresaId: plano.observacao.empresaId,
      dispositivoId: plano.observacao.dispositivoId,
      terminalId: plano.observacao.terminalId,
      pontoCaptura: plano.observacao.pontoCaptura,
      estabelecimento: plano.observacao.estabelecimento,
      ambiente: "homologacao",
      instalacaoId: plano.observacao.instalacaoId,
    },
    assinatura: input.assinatura,
    chavePublicaPem: input.chavePublicaVinculada,
    empresaSessaoId: input.empresaId,
    dispositivoAutorizado: input.dispositivoId,
    terminalAutorizadoId: input.terminalId,
    pontoAutorizado: input.pontoHomologacao.trim(),
    estabelecimentoAutorizado: input.estabelecimento,
    instalacaoJaRegistrada: false,
    evidenciaAtivaNoDispositivo: false,
  });
  if (!registro.ok) return { persistir: false as const, motivo: registro.motivo };
  return { persistir: true as const, registro: registro.registro };
}

export async function gravarEvidenciaInstalacaoHomologacao(input: {
  plano: ReturnType<typeof planejarEvidenciaInstalacaoHomologacao>;
  assinar: (
    observacao: ObservacaoInstalacaoControlada
  ) => { campos: ObservacaoInstalacaoControlada; assinatura: string } | null;
  inserir: (registro: {
    empresa_id: string;
    dispositivo_id: string;
    terminal_id: string;
    instalacao_id: string;
    ponto_captura: string;
    estabelecimento: string;
    ambiente: "homologacao";
    origem: "instalacao_controlada";
    assinatura: string;
  }) => Promise<void>;
}) {
  if (!input.plano.persistir) {
    return { persistida: false as const, motivo: input.plano.motivo };
  }
  const assinada = input.assinar(input.plano.observacao);
  if (!assinada?.assinatura) {
    return {
      persistida: false as const,
      motivo:
        "A conclusão foi comprovada, mas a assinatura do terminal não está no Connector de homologação. A evidência não foi gravada.",
    };
  }
  const emissao = avaliarEmissaoEvidencia(assinada.campos);
  if (!emissao.ok) return { persistida: false as const, motivo: emissao.motivo };
  await input.inserir({
    empresa_id: emissao.campos.empresaId,
    dispositivo_id: emissao.campos.dispositivoId,
    terminal_id: emissao.campos.terminalId,
    instalacao_id: emissao.campos.instalacaoId,
    ponto_captura: emissao.campos.pontoCaptura,
    estabelecimento: emissao.campos.estabelecimento,
    ambiente: "homologacao",
    origem: "instalacao_controlada",
    assinatura: assinada.assinatura,
  });
  return { persistida: true as const, instalacaoId: emissao.campos.instalacaoId };
}

export type CapturaInstalacaoHomologacao = {
  identificador: number;
  prompt: string;
  valorSugerido: string;
  sensivel: boolean;
};

export type RespostaCapturaInstalacao = {
  identificador: number;
  valor: string;
};

const MENSAGEM_NAO_ENCAMINHADO = "Nada foi encaminhado ao Connector.";

export function validarEncaminhamentoCapturas(input: {
  execucaoId: unknown;
  respostas: unknown;
}):
  | { ok: true; execucaoId: string; respostas: RespostaCapturaInstalacao[] }
  | { ok: false; mensagem: string } {
  const execucaoId = typeof input.execucaoId === "string" ? input.execucaoId.trim() : "";
  if (!execucaoId) {
    return { ok: false, mensagem: `A execução em andamento não foi informada. ${MENSAGEM_NAO_ENCAMINHADO}` };
  }
  if (!Array.isArray(input.respostas) || input.respostas.length === 0) {
    return { ok: false, mensagem: `Nenhum dado pedido foi informado. ${MENSAGEM_NAO_ENCAMINHADO}` };
  }
  const respostas: RespostaCapturaInstalacao[] = [];
  for (const item of input.respostas) {
    if (!item || typeof item !== "object") {
      return { ok: false, mensagem: `A captura informada é inválida. ${MENSAGEM_NAO_ENCAMINHADO}` };
    }
    const identificador = Number((item as { identificador?: unknown }).identificador);
    const valor = String((item as { valor?: unknown }).valor ?? "").trim();
    if (!Number.isInteger(identificador) || identificador < 0) {
      return { ok: false, mensagem: `O identificador pedido é inválido. ${MENSAGEM_NAO_ENCAMINHADO}` };
    }
    if (!valor) {
      return { ok: false, mensagem: `Um dos dados pedidos está vazio. ${MENSAGEM_NAO_ENCAMINHADO}` };
    }
    respostas.push({ identificador, valor });
  }
  return { ok: true, execucaoId, respostas };
}

export function montarPedidoResponderInstalacao(input: {
  dispositivoId: string;
  execucaoId: string;
  capturas: CapturaInstalacaoHomologacao[];
  digitado: Record<number, string>;
}):
  | { ok: true; pedido: { dispositivoId: string; acao: "responder"; execucaoId: string; respostas: RespostaCapturaInstalacao[] } }
  | { ok: false; mensagem: string } {
  const dispositivoId = input.dispositivoId.trim();
  if (!dispositivoId) {
    return { ok: false, mensagem: `O computador desta instalação não está identificado. ${MENSAGEM_NAO_ENCAMINHADO}` };
  }
  const respostas = input.capturas.map((item) => ({
    identificador: Number(item.identificador),
    valor: String(input.digitado[item.identificador] ?? item.valorSugerido ?? ""),
  }));
  const validado = validarEncaminhamentoCapturas({ execucaoId: input.execucaoId, respostas });
  if (!validado.ok) return validado;
  return {
    ok: true,
    pedido: {
      dispositivoId,
      acao: "responder",
      execucaoId: validado.execucaoId,
      respostas: validado.respostas,
    },
  };
}

export function atualizarCapturasInstalacao<T>(
  atuais: T[],
  corpo: { capturas?: unknown; codigo?: unknown }
) {
  if (Array.isArray(corpo.capturas)) return corpo.capturas as T[];
  if (corpo.codigo === "PWRET_OK" || corpo.codigo === "AGUARDANDO_CONFIRMACAO") return [];
  return atuais;
}

const ROTULO_CAPTURA_PUBLICA = new Map<number, string>([
  [0x11, "Ponto de captura"],
  [0x1b, "Servidor"],
  [0x1c, "CNPJ"],
]);

export type CapturaConsultaInstalacao = {
  identificador: number;
  tipo: number;
  prompt: string;
  sensivel: boolean;
  valorSugerido: "";
};

function capturaSensivel(identificador: number, tipo: number) {
  return tipo === 6 || tipo === 17 || identificador === 0xf5 || identificador === 0xf6;
}

export function apresentarCapturaPendente(identificador: number, tipo = 2): CapturaConsultaInstalacao {
  const sensivel = capturaSensivel(identificador, tipo);
  return {
    identificador,
    tipo,
    prompt: sensivel ? "Dado sensível solicitado pelo PayGo." : ROTULO_CAPTURA_PUBLICA.get(identificador) ?? `Dado ${identificador}`,
    sensivel,
    valorSugerido: "",
  };
}

export function apresentarConsultaInstalacao(input: {
  empresaSessaoId: string;
  empresaAutorizadaId: string;
  dispositivoInformado: string;
  dispositivoAutorizado: string;
  terminalInformadoId: string;
  terminalAutorizadoId: string;
  consulta: {
    ativa?: boolean;
    execucaoId?: string;
    capturas?: Array<{ identificador?: unknown; tipo?: unknown; prompt?: unknown; sensivel?: unknown }>;
  };
}):
  | { ok: true; ativa: boolean; execucaoId: string; capturas: CapturaConsultaInstalacao[] }
  | { ok: false; motivo: string } {
  if (input.empresaSessaoId !== input.empresaAutorizadaId) {
    return { ok: false, motivo: "A consulta pertence a outra empresa." };
  }
  if (input.dispositivoInformado.trim() !== input.dispositivoAutorizado.trim()) {
    return { ok: false, motivo: "O computador informado não é o terminal autorizado." };
  }
  if (input.terminalInformadoId !== input.terminalAutorizadoId) {
    return { ok: false, motivo: "O terminal informado não pertence a esta empresa." };
  }
  if (input.consulta.ativa !== true) {
    return { ok: true, ativa: false, execucaoId: "", capturas: [] };
  }
  const capturas = (input.consulta.capturas ?? []).map((item) =>
    apresentarCapturaPendente(Number(item.identificador), Number(item.tipo) || 2)
  );
  return {
    ok: true,
    ativa: true,
    execucaoId: String(input.consulta.execucaoId ?? ""),
    capturas: capturas.filter((item) => Number.isInteger(item.identificador) && item.identificador >= 0),
  };
}

export function nomeLogCommsHomologacao(data: Date) {
  const yy = String(data.getFullYear()).slice(2);
  const mm = String(data.getMonth() + 1).padStart(2, "0");
  const dd = String(data.getDate()).padStart(2, "0");
  return `comms_${yy}${mm}${dd}.log`;
}

export function caminhoLogCommsHomologacao(env: NodeJS.ProcessEnv, data = new Date()) {
  const local = String(env.LOCALAPPDATA ?? "").trim();
  if (!local) return null;
  return path.win32.join(
    local,
    "UltraPDV",
    "conector-homologacao",
    "TEF",
    "Homologacao",
    "PGWeb",
    "Log",
    nomeLogCommsHomologacao(data)
  );
}

export function capturasPendentesNoTexto(texto: string) {
  let lote: { tipo: number; identificador: number }[] = [];
  let acumulando = false;
  for (const linha of texto.split(/\r?\n/)) {
    if (linha.includes("PW_End") || linha.includes("PW_iNewTransac")) {
      lote = [];
      acumulando = false;
      continue;
    }
    if (linha.includes("PW_iExecTransac")) {
      const pares = [...linha.matchAll(/\[(\d+):0x([0-9A-Fa-f]+)\]/g)].map((item) => ({
        tipo: Number(item[1]),
        identificador: Number.parseInt(item[2], 16),
      }));
      if (!acumulando) lote = [];
      lote.push(...pares);
      acumulando = true;
      continue;
    }
    if (/PW_iAddParam|PW_iConfirmation|PW_iPPAbort|PW_iInit/.test(linha)) {
      acumulando = false;
    }
  }
  return lote;
}

export function recuperarConsultaDoProcessoAnterior(input: {
  respostaConector: { codigo?: string; sessaoAberta?: boolean; execucaoId?: string };
  textoLog: string;
}) {
  if (input.respostaConector.codigo !== "SESSAO_DIVERGENTE" || input.respostaConector.sessaoAberta !== true) {
    return { ativa: false as const, execucaoId: "", capturas: [] as CapturaConsultaInstalacao[] };
  }
  return {
    ativa: true as const,
    execucaoId: String(input.respostaConector.execucaoId ?? ""),
    capturas: capturasPendentesNoTexto(input.textoLog).map((item) =>
      apresentarCapturaPendente(item.identificador, item.tipo)
    ),
  };
}

export function executarInstalacaoHomologacao(input: EntradaInstalacaoHomologacao) {
  const plano = classificarInstalacaoHomologacao(input);
  return {
    ok: false as const,
    executado: false as const,
    estado: plano.estado,
    motivo: plano.estado === "instalado_confirmado" ? plano.motivo : IMPEDIMENTO_INSTALACAO_HOMOLOGACAO,
  };
}
