import { validarServidorPayGo } from "@/lib/pdv/tef/servidor-paygo";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODIGO = /^[A-Za-z0-9._-]{1,40}$/;
const PONTO = /^[A-Za-z0-9._-]{1,40}$/;

export type AmbienteVinculo = "homologacao" | "producao";

export type TerminalSincronizacao = {
  id: string;
  empresaId: string;
  codigo: string;
  dispositivoId: string;
  chavePublica: string;
  chaveId: string;
  estabelecimento: string;
  pontoCaptura: string;
  ativo: boolean;
  revogada: boolean;
  ambiente: AmbienteVinculo | "";
  servidor: string;
  cnpj: string;
};

export type ConfiguracaoSincronizacao = {
  ambiente: AmbienteVinculo | "";
  estabelecimento: string;
  pontoCaptura: string;
  servidor: string;
};

export type VinculoAutorizado = {
  empresaId: string;
  terminalId: string;
  terminalCodigo: string;
  dispositivoId: string;
  estabelecimento: string;
  pontoCaptura: string;
  ambiente: AmbienteVinculo;
  cnpj: string;
  servidor: string;
};

export type EfeitoSincronizacao = "sincronizar" | "recusar";

export type DecisaoSincronizacao = {
  efeito: EfeitoSincronizacao;
  motivo: string;
  vinculo: VinculoAutorizado | null;
  ativaEmpresa: false;
  executaInstalacao: false;
  revogaChave: false;
  gravaBanco: false;
};

export type PedidoSincronizacaoVinculo = {
  empresaSessaoId: string;
  permissaoEditar: boolean;
  dispositivoInformado: string;
  chavePublicaInformada: string;
  dispositivoOutraEmpresa: boolean;
  pendenciaFinanceira: boolean;
  terminal: TerminalSincronizacao | null;
  config: ConfiguracaoSincronizacao;
  cnpjEmpresa: string;
};

function recusar(motivo: string): DecisaoSincronizacao {
  return {
    efeito: "recusar",
    motivo,
    vinculo: null,
    ativaEmpresa: false,
    executaInstalacao: false,
    revogaChave: false,
    gravaBanco: false,
  };
}

function identificador(valor: string) {
  return valor.trim().toLowerCase();
}

function servidorInformado(valor: string) {
  const texto = valor.trim();
  if (!texto) {
    return { ok: true as const, servidor: "" };
  }
  const validado = validarServidorPayGo(texto);
  if (!validado.ok) {
    return { ok: false as const, motivo: validado.motivo };
  }
  return { ok: true as const, servidor: validado.servidor };
}

export function planejarSincronizacaoVinculo(
  input: PedidoSincronizacaoVinculo
): DecisaoSincronizacao {
  if (!input.permissaoEditar) {
    return recusar("A sincronização exige permissão de edição do financeiro.");
  }
  if (!UUID.test(input.empresaSessaoId.trim()) || !UUID.test(input.dispositivoInformado.trim())) {
    return recusar("A identificação do computador é inválida.");
  }
  if (input.dispositivoOutraEmpresa) {
    return recusar("Este computador está vinculado a outra empresa.");
  }
  const terminal = input.terminal;
  if (
    !terminal ||
    !terminal.ativo ||
    terminal.revogada ||
    identificador(terminal.empresaId) !== identificador(input.empresaSessaoId) ||
    identificador(terminal.dispositivoId) !== identificador(input.dispositivoInformado)
  ) {
    return recusar("Este computador não está vinculado a esta empresa.");
  }
  if (!UUID.test(terminal.id.trim())) {
    return recusar("A identificação do terminal é inválida.");
  }
  if (!terminal.chavePublica.trim() || terminal.chavePublica.trim() !== input.chavePublicaInformada.trim()) {
    return recusar(
      "A chave deste Connector não é a chave autorizada do terminal. A sincronização não revoga nem gera outra chave."
    );
  }
  if (input.pendenciaFinanceira) {
    return recusar(
      "Há transação ou reconciliação pendente neste terminal. Resolva antes de sincronizar o Connector."
    );
  }
  if (!CODIGO.test(terminal.codigo.trim())) {
    return recusar("O código lógico do terminal é inválido.");
  }
  const pontoTerminal = terminal.pontoCaptura.trim();
  const pontoOficial = input.config.pontoCaptura.trim();
  if (!PONTO.test(pontoOficial) || !PONTO.test(pontoTerminal)) {
    return recusar("O ponto de captura oficial da empresa não está definido.");
  }
  if (pontoOficial !== pontoTerminal) {
    return recusar(
      "A configuração oficial da empresa não confere com o ponto deste terminal. A sincronização não altera o banco."
    );
  }
  if (input.config.ambiente !== "homologacao" && input.config.ambiente !== "producao") {
    return recusar("O ambiente oficial da empresa não está definido.");
  }
  if (terminal.ambiente && terminal.ambiente !== input.config.ambiente) {
    return recusar("O ambiente do terminal não confere com o ambiente oficial da empresa.");
  }
  const estabelecimentoOficial = input.config.estabelecimento.trim();
  const estabelecimentoTerminal = terminal.estabelecimento.trim();
  if (
    !estabelecimentoOficial ||
    estabelecimentoOficial.length > 40 ||
    /[\r\n]/.test(estabelecimentoOficial) ||
    estabelecimentoOficial !== estabelecimentoTerminal
  ) {
    return recusar("O estabelecimento oficial não confere com o terminal.");
  }
  const cnpjEmpresa = input.cnpjEmpresa.replace(/\D/g, "");
  const cnpjTerminal = terminal.cnpj.replace(/\D/g, "");
  if (cnpjEmpresa.length !== 14) {
    return recusar("O cadastro da empresa não possui CNPJ.");
  }
  if (cnpjTerminal && cnpjTerminal !== cnpjEmpresa) {
    return recusar("O CNPJ do terminal não confere com o cadastro da empresa.");
  }
  const servidorTerminal = servidorInformado(terminal.servidor);
  const servidorOficial = servidorInformado(input.config.servidor);
  if (!servidorTerminal.ok) {
    return recusar("O servidor gravado no terminal é inválido.");
  }
  if (!servidorOficial.ok) {
    return recusar("O servidor oficial da empresa é inválido.");
  }
  if (!servidorOficial.servidor) {
    return recusar("O servidor oficial da empresa não está definido.");
  }
  if (servidorTerminal.servidor && servidorTerminal.servidor !== servidorOficial.servidor) {
    return recusar("O servidor do terminal não confere com o servidor oficial.");
  }
  return {
    efeito: "sincronizar",
    motivo: "",
    vinculo: {
      empresaId: input.empresaSessaoId.trim(),
      terminalId: terminal.id.trim().toLowerCase(),
      terminalCodigo: terminal.codigo.trim(),
      dispositivoId: input.dispositivoInformado.trim(),
      estabelecimento: estabelecimentoOficial,
      pontoCaptura: pontoOficial,
      ambiente: input.config.ambiente,
      cnpj: cnpjEmpresa,
      servidor: servidorOficial.servidor,
    },
    ativaEmpresa: false,
    executaInstalacao: false,
    revogaChave: false,
    gravaBanco: false,
  };
}

export type LeituraProcessoTef = {
  processo: string;
  inicializado: boolean;
  transacaoPendenteConfirmacao: boolean;
  reconciliacaoNecessaria: boolean;
};

export type CampoVinculo =
  | "terminalCodigo"
  | "pontoCaptura"
  | "estabelecimento"
  | "ambiente"
  | "servidor"
  | "cnpj";

export type LeituraVinculoLocal = {
  vinculado: boolean;
  empresaId: string;
  terminalCodigo: string;
  pontoCaptura: string;
  estabelecimento: string;
  informaIdentidadeFiscal: boolean;
  ambiente: string;
  servidor: string;
  cnpjInformado: boolean;
};

const ROTULOS_VINCULO: Record<CampoVinculo, string> = {
  terminalCodigo: "código lógico",
  pontoCaptura: "ponto de captura",
  estabelecimento: "estabelecimento",
  ambiente: "ambiente",
  servidor: "servidor",
  cnpj: "CNPJ",
};

export function rotuloCampoVinculo(campo: CampoVinculo) {
  return ROTULOS_VINCULO[campo];
}

export function descreverDivergencias(campos: CampoVinculo[]) {
  if (campos.length === 0) {
    return "";
  }
  return `Ainda divergem: ${campos.map((campo) => ROTULOS_VINCULO[campo]).join(", ")}.`;
}

export function versaoInformaIdentidadeFiscal(versao: string | null | undefined) {
  const partes = String(versao ?? "")
    .trim()
    .split(".");
  if (partes.length < 3) {
    return false;
  }
  const numeros = partes.slice(0, 3).map((parte) => Number(parte));
  if (numeros.some((numero) => !Number.isInteger(numero) || numero < 0)) {
    return false;
  }
  const [maior, menor, correcao] = numeros;
  if (maior !== 1) {
    return maior > 1;
  }
  if (menor !== 3) {
    return menor > 3;
  }
  return correcao >= 5;
}

export function lerVinculoDoStatus(vinculo: {
  vinculado?: boolean;
  empresaId?: string;
  terminalCodigo?: string;
  pontoCaptura?: string;
  estabelecimento?: string;
  ambiente?: string;
  servidor?: string;
  cnpjInformado?: boolean;
} | null | undefined): LeituraVinculoLocal | null {
  if (!vinculo?.vinculado) {
    return null;
  }
  const informaIdentidadeFiscal =
    Object.prototype.hasOwnProperty.call(vinculo, "ambiente") ||
    Object.prototype.hasOwnProperty.call(vinculo, "servidor") ||
    Object.prototype.hasOwnProperty.call(vinculo, "cnpjInformado");
  return {
    vinculado: true,
    empresaId: String(vinculo.empresaId ?? ""),
    terminalCodigo: String(vinculo.terminalCodigo ?? ""),
    pontoCaptura: String(vinculo.pontoCaptura ?? ""),
    estabelecimento: String(vinculo.estabelecimento ?? ""),
    informaIdentidadeFiscal,
    ambiente: informaIdentidadeFiscal ? String(vinculo.ambiente ?? "") : "",
    servidor: informaIdentidadeFiscal ? String(vinculo.servidor ?? "") : "",
    cnpjInformado: informaIdentidadeFiscal ? vinculo.cnpjInformado === true : false,
  };
}

export function exigirIdentidadeFiscalDoStatus(status: {
  tef?: { agente?: { versao?: string } };
  vinculo?: {
    ambiente?: string;
    servidor?: string;
    cnpjInformado?: boolean;
  };
} | null | undefined) {
  if (!status) {
    return false;
  }
  if (versaoInformaIdentidadeFiscal(status.tef?.agente?.versao)) {
    return true;
  }
  const vinculo = status.vinculo;
  if (!vinculo || typeof vinculo !== "object") {
    return false;
  }
  return (
    Object.prototype.hasOwnProperty.call(vinculo, "ambiente") ||
    Object.prototype.hasOwnProperty.call(vinculo, "servidor") ||
    Object.prototype.hasOwnProperty.call(vinculo, "cnpjInformado")
  );
}

export function processoTefAtivo(leitura: LeituraProcessoTef) {
  return (
    leitura.inicializado === true ||
    leitura.processo === "executando" ||
    leitura.processo === "iniciando"
  );
}

function servidoresConferem(local: string, esperado: string) {
  const gravado = servidorInformado(local);
  const oficial = servidorInformado(esperado);
  return gravado.ok && oficial.ok && gravado.servidor !== "" && gravado.servidor === oficial.servidor;
}

export function divergenciasVinculo(
  local: LeituraVinculoLocal | null,
  esperado: VinculoAutorizado
): CampoVinculo[] {
  const campos: CampoVinculo[] = [];
  if (!local?.vinculado || local.terminalCodigo.trim() !== esperado.terminalCodigo) {
    campos.push("terminalCodigo");
  }
  if (!local?.vinculado || local.pontoCaptura.trim() !== esperado.pontoCaptura) {
    campos.push("pontoCaptura");
  }
  if (!local?.vinculado || local.estabelecimento.trim() !== esperado.estabelecimento) {
    campos.push("estabelecimento");
  }
  if (local?.informaIdentidadeFiscal) {
    if (local.ambiente !== esperado.ambiente) {
      campos.push("ambiente");
    }
    if (!servidoresConferem(local.servidor, esperado.servidor)) {
      campos.push("servidor");
    }
    if (local.cnpjInformado !== true) {
      campos.push("cnpj");
    }
  }
  return campos;
}

export function avaliarProcessoAntesDeGravar(input: {
  processo: LeituraProcessoTef;
  vinculoLocal: LeituraVinculoLocal | null;
  vinculoAutorizado: VinculoAutorizado;
}): { efeito: "gravar" | "ja_sincronizado" | "recusar"; motivo: string; divergencias: CampoVinculo[] } {
  if (input.processo.transacaoPendenteConfirmacao) {
    return {
      efeito: "recusar",
      motivo: "O Connector informa transação pendente. Resolva antes de sincronizar.",
      divergencias: [],
    };
  }
  if (input.processo.reconciliacaoNecessaria) {
    return {
      efeito: "recusar",
      motivo: "O Connector informa reconciliação pendente. Resolva antes de sincronizar.",
      divergencias: [],
    };
  }
  const local = input.vinculoLocal;
  if (local?.vinculado && local.empresaId.trim().toLowerCase() !== input.vinculoAutorizado.empresaId.trim().toLowerCase()) {
    return {
      efeito: "recusar",
      motivo: "O Connector está vinculado a outra empresa. A sincronização não transfere o terminal.",
      divergencias: [],
    };
  }
  const divergencias = divergenciasVinculo(local, input.vinculoAutorizado);
  if (processoTefAtivo(input.processo) && divergencias.length > 0) {
    return {
      efeito: "recusar",
      motivo:
        "O processo TEF está ativo com identidade diferente do ponto oficial. Encerre o processo antes de sincronizar. A instalação não será chamada.",
      divergencias,
    };
  }
  if (divergencias.length === 0) {
    return { efeito: "ja_sincronizado", motivo: "", divergencias: [] };
  }
  return { efeito: "gravar", motivo: descreverDivergencias(divergencias), divergencias };
}

export function montarCorpoVincular(
  codigoPareamento: string,
  vinculo: VinculoAutorizado,
  opcoes: { identidadeFiscal?: boolean } = {}
) {
  return {
    codigo: codigoPareamento.trim().toUpperCase(),
    empresaId: vinculo.empresaId,
    terminalCodigo: vinculo.terminalCodigo,
    dispositivoId: vinculo.dispositivoId,
    estabelecimento: vinculo.estabelecimento,
    pontoCaptura: vinculo.pontoCaptura,
    ...(opcoes.identidadeFiscal
      ? {
          ambiente: vinculo.ambiente,
          cnpj: vinculo.cnpj,
          servidor: vinculo.servidor,
          terminalId: vinculo.terminalId,
        }
      : {}),
  };
}

export function lerRecusaVincular(httpStatus: number, corpo: unknown) {
  const registro =
    corpo && typeof corpo === "object" && !Array.isArray(corpo)
      ? (corpo as { ok?: unknown; erro?: unknown })
      : {};
  const erroBruto = typeof registro.erro === "string" ? registro.erro.replace(/\s+/g, " ").trim() : "";
  const erro = /^[A-Z2-9]{10}$/.test(erroBruto) ? "" : erroBruto.slice(0, 200);
  return {
    ok: httpStatus >= 200 && httpStatus < 300 && registro.ok === true,
    httpStatus,
    erro,
  };
}

export function descreverRecusaVincular(input: { httpStatus: number | null; erro: string }) {
  const erro = input.erro.trim();
  if (erro && input.httpStatus) {
    return `O Connector não gravou o vínculo (HTTP ${input.httpStatus}): ${erro}`;
  }
  if (erro) {
    return `O Connector não gravou o vínculo: ${erro}`;
  }
  if (input.httpStatus) {
    return `O Connector não gravou o vínculo (HTTP ${input.httpStatus}). O ponto oficial permanece no servidor.`;
  }
  return "O Connector não gravou o vínculo. O ponto oficial permanece no servidor.";
}

export type VinculoConfirmado = {
  empresaId: string;
  terminalCodigo: string;
  pontoCaptura: string;
  estabelecimento: string;
  processo: string;
  ambiente: string;
  servidor: string;
  cnpjInformado: boolean;
  identidadeFiscal: boolean;
};

export function mensagemVinculoConfirmado(
  efeito: "ja_sincronizado" | "sincronizado" | "recuperado",
  identidadeFiscal: boolean
) {
  if (identidadeFiscal) {
    if (efeito === "recuperado") {
      return "A resposta da gravação falhou, mas o status do Connector confirma o vínculo oficial. Nenhuma venda foi ativada.";
    }
    return "Vínculo oficial sincronizado. Nenhuma venda foi ativada.";
  }
  if (efeito === "recuperado") {
    return "A resposta da gravação falhou, mas o status do Connector já confirma o ponto e o terminal. Esta versão não confirma ambiente, servidor e CNPJ. Nenhuma venda foi ativada.";
  }
  if (efeito === "ja_sincronizado") {
    return "Este Connector já guarda o ponto e o terminal, mas não confirma ambiente, servidor e CNPJ. Nenhuma venda foi ativada.";
  }
  return "Vínculo do Connector atualizado. Esta versão não confirma ambiente, servidor e CNPJ. Nenhuma venda foi ativada e nenhuma transação foi enviada.";
}

export function concluirSincronizacaoLocal(input: {
  gravacaoOk: boolean;
  recusa?: { httpStatus: number | null; erro: string };
  status: {
    vinculo?: {
      vinculado?: boolean;
      empresaId?: string;
      terminalCodigo?: string;
      pontoCaptura?: string;
      estabelecimento?: string;
      ambiente?: string;
      servidor?: string;
      cnpjInformado?: boolean;
    };
    tef?: { processo?: string; agente?: { versao?: string } };
  } | null;
  esperado: VinculoAutorizado;
  exigirIdentidadeFiscal?: boolean;
}):
  | { efeito: "sincronizado" | "recuperado"; gravado: VinculoConfirmado; divergencias: CampoVinculo[] }
  | { efeito: "falhou"; motivo: string; podeRepetir: boolean; divergencias: CampoVinculo[] } {
  const lido = lerVinculoDoStatus(input.status?.vinculo);
  const exigir =
    input.exigirIdentidadeFiscal === true || lido?.informaIdentidadeFiscal === true;
  const comparado = lido
    ? { ...lido, informaIdentidadeFiscal: exigir }
    : null;
  const divergencias = divergenciasVinculo(comparado, input.esperado);
  const identidadeFiscal =
    exigir &&
    divergencias.length === 0 &&
    lido?.informaIdentidadeFiscal === true;
  if (divergencias.length === 0 && lido && (!exigir || identidadeFiscal)) {
    return {
      efeito: input.gravacaoOk ? "sincronizado" : "recuperado",
      divergencias: [],
      gravado: {
        empresaId: lido.empresaId.trim(),
        terminalCodigo: lido.terminalCodigo.trim(),
        pontoCaptura: lido.pontoCaptura.trim(),
        estabelecimento: lido.estabelecimento.trim(),
        processo: String(input.status?.tef?.processo ?? ""),
        ambiente: lido.informaIdentidadeFiscal ? lido.ambiente : "",
        servidor: lido.informaIdentidadeFiscal ? lido.servidor : "",
        cnpjInformado: lido.informaIdentidadeFiscal ? lido.cnpjInformado : false,
        identidadeFiscal,
      },
    };
  }
  const pontoLido = lido?.pontoCaptura.trim() ?? "";
  const detalhePonto =
    pontoLido && pontoLido !== input.esperado.pontoCaptura
      ? ` O status continua com o ponto ${pontoLido}.`
      : "";
  const detalheCampos = descreverDivergencias(divergencias);
  const sufixo = `${detalhePonto}${detalheCampos ? ` ${detalheCampos}` : ""}`;
  return {
    efeito: "falhou",
    divergencias,
    motivo: input.gravacaoOk
      ? `O Connector respondeu, mas o status não confirma o vínculo oficial.${sufixo}`
      : `${descreverRecusaVincular({
          httpStatus: input.recusa?.httpStatus ?? null,
          erro: input.recusa?.erro ?? "",
        })}${sufixo}`,
    podeRepetir: true,
  };
}
