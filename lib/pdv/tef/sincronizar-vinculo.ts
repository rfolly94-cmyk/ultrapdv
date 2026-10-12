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
  if (
    servidorTerminal.servidor &&
    servidorOficial.servidor &&
    servidorTerminal.servidor !== servidorOficial.servidor
  ) {
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
      servidor: servidorTerminal.servidor || servidorOficial.servidor,
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

export type LeituraVinculoLocal = {
  vinculado: boolean;
  empresaId: string;
  terminalCodigo: string;
  pontoCaptura: string;
  estabelecimento: string;
};

export function processoTefAtivo(leitura: LeituraProcessoTef) {
  return (
    leitura.inicializado === true ||
    leitura.processo === "executando" ||
    leitura.processo === "iniciando"
  );
}

export function avaliarProcessoAntesDeGravar(input: {
  processo: LeituraProcessoTef;
  vinculoLocal: LeituraVinculoLocal | null;
  vinculoAutorizado: VinculoAutorizado;
}): { efeito: "gravar" | "ja_sincronizado" | "recusar"; motivo: string } {
  if (input.processo.transacaoPendenteConfirmacao) {
    return {
      efeito: "recusar",
      motivo: "O Connector informa transação pendente. Resolva antes de sincronizar.",
    };
  }
  if (input.processo.reconciliacaoNecessaria) {
    return {
      efeito: "recusar",
      motivo: "O Connector informa reconciliação pendente. Resolva antes de sincronizar.",
    };
  }
  const local = input.vinculoLocal;
  if (local?.vinculado && local.empresaId.trim().toLowerCase() !== input.vinculoAutorizado.empresaId.trim().toLowerCase()) {
    return {
      efeito: "recusar",
      motivo: "O Connector está vinculado a outra empresa. A sincronização não transfere o terminal.",
    };
  }
  const alinhado =
    local?.vinculado === true &&
    local.terminalCodigo.trim() === input.vinculoAutorizado.terminalCodigo &&
    local.pontoCaptura.trim() === input.vinculoAutorizado.pontoCaptura &&
    local.estabelecimento.trim() === input.vinculoAutorizado.estabelecimento;
  if (processoTefAtivo(input.processo) && !alinhado) {
    return {
      efeito: "recusar",
      motivo:
        "O processo TEF está ativo com identidade diferente do ponto oficial. Encerre o processo antes de sincronizar. A instalação não será chamada.",
    };
  }
  if (alinhado) {
    return { efeito: "ja_sincronizado", motivo: "" };
  }
  return { efeito: "gravar", motivo: "" };
}

export function montarCorpoVincular(codigoPareamento: string, vinculo: VinculoAutorizado) {
  return {
    codigo: codigoPareamento.trim().toUpperCase(),
    empresaId: vinculo.empresaId,
    terminalCodigo: vinculo.terminalCodigo,
    dispositivoId: vinculo.dispositivoId,
    estabelecimento: vinculo.estabelecimento,
    pontoCaptura: vinculo.pontoCaptura,
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
};

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
    };
    tef?: { processo?: string };
  } | null;
  esperado: VinculoAutorizado;
}):
  | { efeito: "sincronizado" | "recuperado"; gravado: VinculoConfirmado }
  | { efeito: "falhou"; motivo: string; podeRepetir: boolean } {
  const vinculo = input.status?.vinculo;
  const confere =
    vinculo?.vinculado === true &&
    String(vinculo.empresaId ?? "").trim().toLowerCase() === input.esperado.empresaId.trim().toLowerCase() &&
    String(vinculo.terminalCodigo ?? "").trim() === input.esperado.terminalCodigo &&
    String(vinculo.pontoCaptura ?? "").trim() === input.esperado.pontoCaptura &&
    String(vinculo.estabelecimento ?? "").trim() === input.esperado.estabelecimento;
  if (confere && vinculo) {
    return {
      efeito: input.gravacaoOk ? "sincronizado" : "recuperado",
      gravado: {
        empresaId: String(vinculo.empresaId).trim(),
        terminalCodigo: String(vinculo.terminalCodigo).trim(),
        pontoCaptura: String(vinculo.pontoCaptura).trim(),
        estabelecimento: String(vinculo.estabelecimento ?? "").trim(),
        processo: String(input.status?.tef?.processo ?? ""),
      },
    };
  }
  const pontoLido = String(vinculo?.pontoCaptura ?? "").trim();
  const detalhePonto =
    pontoLido && pontoLido !== input.esperado.pontoCaptura
      ? ` O status continua com o ponto ${pontoLido}.`
      : "";
  return {
    efeito: "falhou",
    motivo: input.gravacaoOk
      ? `O Connector respondeu, mas o status não confirma o ponto oficial.${detalhePonto}`
      : `${descreverRecusaVincular({
          httpStatus: input.recusa?.httpStatus ?? null,
          erro: input.recusa?.erro ?? "",
        })}${detalhePonto}`,
    podeRepetir: true,
  };
}
