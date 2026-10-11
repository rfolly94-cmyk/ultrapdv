import {
  MENSAGEM_TEF_AMBIENTE_INCONCLUSIVO,
  MENSAGEM_TEF_HOMOLOGACAO_NFCE_PRODUCAO,
} from "@/lib/fiscal/tef/ambiente-tef-nfce";
import type { ClassificacaoAmbienteInstalacao } from "@/lib/pdv/tef/evidencia-instalacao";
import { validarServidorPayGo } from "@/lib/pdv/tef/servidor-paygo";

export const ETAPAS_ASSISTENTE = [
  "credenciamento",
  "connector",
  "pinpad",
  "vinculacao",
  "validacao",
  "ativacao",
] as const;

export type EtapaAssistente = (typeof ETAPAS_ASSISTENTE)[number];

export type EstadoRequisito = "aprovado" | "pendente" | "incompativel" | "nao_verificavel";

export type AmbienteTefAssistente = "homologacao" | "producao";

export type RequisitoInstalacao = {
  id: string;
  rotulo: string;
  estado: EstadoRequisito;
  mensagem: string;
};

export type CredenciamentoInformado = {
  cnpjEmpresa: string;
  cnpjConfirmado: string;
  credenciamentoConfirmado: boolean;
  ambienteAutorizado: AmbienteTefAssistente | "";
  pontoCaptura: string;
  estabelecimento: string;
  parametrosOficiais: string;
  adquirentes: string[];
  servidorHomologacao: string;
  servidorProducao: string;
  servidorConfirmado: boolean;
  exigirServidor?: boolean;
};

export type SituacaoAmbientePayGo = "comprovado" | "declarado" | "desconhecido";

export type LeituraConnector = {
  respondeu: boolean;
  versao: string | null;
  disponivel: boolean;
  executavelEncontrado: boolean;
  processo: string | null;
  paygoInicializado: boolean;
  ambienteEfetivo: AmbienteTefAssistente | null;
  situacaoAmbiente: SituacaoAmbientePayGo;
  pendenciaLocal: boolean;
};

export type LeituraPinpad = {
  consultado: boolean;
  comunicacao: string | null;
  fabricante: string | null;
  modelo: string | null;
  firmware: string | null;
  porta: string | null;
  paygoInicializado: boolean | null;
  ppinfoDisponivel: boolean | null;
  limitacaoModelo: string | null;
};

export type TerminalInstalacao = {
  empresaId: string;
  dispositivoId: string;
  ativo: boolean;
  pontoCaptura: string;
};

const TEXTO_SEGREDO =
  /senha|password|token|secret|chave.?privada|private.?key|certificado|csc|bearer|authorization/i;

const PONTO = /^[A-Za-z0-9._-]{1,40}$/;

export function ambienteInformado(valor: unknown): AmbienteTefAssistente | "" {
  return valor === "producao" || valor === "homologacao" ? valor : "";
}

export function digitosCnpj(valor: unknown) {
  return String(valor ?? "").replace(/\D/g, "").slice(0, 14);
}

export function formatarCnpj(valor: unknown) {
  const digitos = digitosCnpj(valor);
  if (digitos.length !== 14) {
    return digitos;
  }
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
}

export function textoTemSegredo(valor: unknown) {
  return TEXTO_SEGREDO.test(String(valor ?? ""));
}

export function adquirentesInformadas(valor: string | string[]) {
  const bruto = Array.isArray(valor) ? valor : String(valor ?? "").split(/[\n,;]/);
  const saida: string[] = [];
  for (const item of bruto) {
    const nome = item.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!nome || textoTemSegredo(nome) || saida.includes(nome)) {
      continue;
    }
    saida.push(nome);
    if (saida.length >= 20) {
      break;
    }
  }
  return saida;
}

export function validarCredenciamento(input: CredenciamentoInformado) {
  const pendencias: string[] = [];
  const cnpjEmpresa = digitosCnpj(input.cnpjEmpresa);
  const cnpjConfirmado = digitosCnpj(input.cnpjConfirmado);
  if (cnpjEmpresa.length !== 14) {
    pendencias.push("O cadastro da empresa não possui CNPJ.");
  } else if (cnpjConfirmado !== cnpjEmpresa) {
    pendencias.push("Confirme o CNPJ da empresa autenticada.");
  }
  if (input.credenciamentoConfirmado !== true) {
    pendencias.push("Confirme o credenciamento PayGoWeb deste CNPJ.");
  }
  if (input.ambienteAutorizado !== "homologacao" && input.ambienteAutorizado !== "producao") {
    pendencias.push("Informe o ambiente autorizado: homologação ou produção.");
  }
  const ponto = input.pontoCaptura.trim();
  if (!PONTO.test(ponto)) {
    pendencias.push("Informe o ponto de captura atribuído pelo PayGoWeb.");
  }
  const estabelecimento = input.estabelecimento.trim();
  if (!estabelecimento || estabelecimento.length > 40) {
    pendencias.push("Informe o estabelecimento informado pelo PayGoWeb.");
  }
  if (textoTemSegredo(input.parametrosOficiais) || input.parametrosOficiais.length > 500) {
    pendencias.push("Os parâmetros oficiais não podem conter senha ou segredo.");
  }
  if (input.adquirentes.some((item) => textoTemSegredo(item))) {
    pendencias.push("A lista de adquirentes não pode conter senha ou segredo.");
  }
  const homologacao = validarServidorPayGo(input.servidorHomologacao);
  const producao = validarServidorPayGo(input.servidorProducao);
  const ambienteAutorizado = ambienteInformado(input.ambienteAutorizado);
  const exigirCampo = (
    rotulo: string,
    bruto: string,
    validado: ReturnType<typeof validarServidorPayGo>
  ) => {
    if (!bruto.trim()) {
      pendencias.push(`Informe o servidor de ${rotulo} no formato host:porta.`);
    } else if (!validado.ok) {
      pendencias.push(validado.motivo);
    }
  };
  if (input.exigirServidor !== false) {
    if (input.servidorConfirmado !== true) {
      pendencias.push("Confirme o servidor PayGoWeb atribuído a este estabelecimento.");
    }
    if (ambienteAutorizado === "homologacao") {
      exigirCampo("homologação", input.servidorHomologacao, homologacao);
    }
    if (ambienteAutorizado === "producao") {
      exigirCampo("produção", input.servidorProducao, producao);
    }
  }
  if (ambienteAutorizado !== "homologacao" && input.servidorHomologacao.trim() && !homologacao.ok) {
    pendencias.push(homologacao.motivo);
  }
  if (ambienteAutorizado !== "producao" && input.servidorProducao.trim() && !producao.ok) {
    pendencias.push(producao.motivo);
  }
  return {
    ok: pendencias.length === 0,
    pendencias,
    adquirentes: adquirentesInformadas(input.adquirentes),
    pontoCaptura: PONTO.test(ponto) ? ponto : "",
    estabelecimento: estabelecimento.slice(0, 40),
    ambienteAutorizado,
    servidorHomologacao: homologacao.ok ? homologacao.servidor : "",
    servidorProducao: producao.ok ? producao.servidor : "",
  };
}

export function sanitizarAmbienteDoStatus(): {
  ambienteEfetivo: null;
  situacaoAmbiente: "desconhecido";
} {
  return { ambienteEfetivo: null, situacaoAmbiente: "desconhecido" };
}

export function ambienteEfetivoComprovado(_leitura?: {
  situacaoAmbiente?: SituacaoAmbientePayGo | null;
  ambienteEfetivo?: AmbienteTefAssistente | null;
}) {
  return null;
}

export function ambienteComprovadoDaEvidencia(evidencia: ClassificacaoAmbienteInstalacao) {
  if (evidencia.deveRevogar || evidencia.situacao !== "comprovado") {
    return null;
  }
  return evidencia.ambienteEfetivo === "homologacao" || evidencia.ambienteEfetivo === "producao"
    ? evidencia.ambienteEfetivo
    : null;
}

export function interpretarStatusConnector(input: {
  descobertaOk: boolean;
  versao?: string | null;
  status?: unknown;
}): LeituraConnector {
  const raiz =
    input.status && typeof input.status === "object"
      ? (input.status as { tef?: unknown }).tef
      : null;
  const tef = raiz && typeof raiz === "object" ? (raiz as Record<string, unknown>) : null;
  const ambiente = sanitizarAmbienteDoStatus();
  return {
    respondeu: input.descobertaOk === true,
    versao: input.descobertaOk && input.versao ? String(input.versao).slice(0, 40) : null,
    disponivel: input.descobertaOk === true && tef?.disponivel === true,
    executavelEncontrado: input.descobertaOk === true && tef?.executavelEncontrado === true,
    processo: tef?.processo ? String(tef.processo).slice(0, 40) : null,
    paygoInicializado: input.descobertaOk === true && tef?.inicializado === true,
    ambienteEfetivo: ambiente.ambienteEfetivo,
    situacaoAmbiente: ambiente.situacaoAmbiente,
    pendenciaLocal:
      tef?.transacaoPendenteConfirmacao === true || tef?.reconciliacaoNecessaria === true,
  };
}

export function camposPinpadDisponiveis(leitura: LeituraPinpad) {
  return {
    fabricante: textoUtil(leitura.fabricante),
    modelo: textoUtil(leitura.modelo),
    firmware: textoUtil(leitura.firmware),
    porta: textoUtil(leitura.porta),
    comunicacao: textoUtil(leitura.comunicacao),
  };
}

function textoUtil(valor: string | null | undefined) {
  const texto = String(valor ?? "").trim();
  return texto || null;
}

export function terminalDaSessao(
  terminais: TerminalInstalacao[],
  empresaId: string,
  dispositivoId: string
) {
  const id = dispositivoId.trim();
  const desta =
    terminais.find(
      (item) => item.ativo && item.empresaId === empresaId && item.dispositivoId === id
    ) ?? null;
  const outraEmpresa = terminais.some(
    (item) => item.ativo && item.empresaId !== empresaId && item.dispositivoId === id
  );
  return { terminal: desta, outraEmpresa: Boolean(id) && outraEmpresa };
}

export function etapaPersistida(pedida: string | null, credenciamentoCompleto: boolean): EtapaAssistente {
  if (!credenciamentoCompleto) {
    return "credenciamento";
  }
  return ETAPAS_ASSISTENTE.includes(pedida as EtapaAssistente)
    ? (pedida as EtapaAssistente)
    : "connector";
}

export function etapaInicial(input: {
  etapaSalva: string | null;
  credenciamentoCompleto: boolean;
  empresaJaHabilitada: boolean;
}): EtapaAssistente {
  if (!input.credenciamentoCompleto && !input.empresaJaHabilitada) {
    return "credenciamento";
  }
  if (input.etapaSalva && ETAPAS_ASSISTENTE.includes(input.etapaSalva as EtapaAssistente)) {
    return etapaPersistida(input.etapaSalva, input.credenciamentoCompleto || input.empresaJaHabilitada);
  }
  if (input.empresaJaHabilitada) {
    return "validacao";
  }
  return input.credenciamentoCompleto ? "connector" : "credenciamento";
}

export function avancarEtapa(atual: EtapaAssistente): EtapaAssistente {
  const indice = ETAPAS_ASSISTENTE.indexOf(atual);
  return ETAPAS_ASSISTENTE[Math.min(indice + 1, ETAPAS_ASSISTENTE.length - 1)];
}

export function voltarEtapa(atual: EtapaAssistente): EtapaAssistente {
  const indice = ETAPAS_ASSISTENTE.indexOf(atual);
  return ETAPAS_ASSISTENTE[Math.max(indice - 1, 0)];
}

export type FatosInstalacao = {
  credenciamento: CredenciamentoInformado;
  connector: LeituraConnector;
  pinpad: LeituraPinpad;
  pinpadExigido: boolean;
  empresaId: string;
  terminais: TerminalInstalacao[];
  dispositivoId: string;
  pontoAutorizado: string;
  ambienteAutorizado: AmbienteTefAssistente | "";
  pendenciasFinanceiras: number;
  planoPdv: boolean;
  permissaoEditar: boolean;
  plataformaHabilitada: boolean;
  ambienteFiscal: number | null;
  evidencia: ClassificacaoAmbienteInstalacao;
};

export function avaliarInstalacao(fatos: FatosInstalacao) {
  const credenciamento = validarCredenciamento(fatos.credenciamento);
  const vinculo = terminalDaSessao(fatos.terminais, fatos.empresaId, fatos.dispositivoId);
  const ambienteComprovado = ambienteComprovadoDaEvidencia(fatos.evidencia);
  const requisitos: RequisitoInstalacao[] = [
    requisitoCredenciamento(credenciamento.ok, credenciamento.pendencias),
    requisitoConnector(fatos.connector),
    requisitoExecutavel(fatos.connector),
    requisitoPaygo(fatos.connector),
    requisitoPinpad(fatos.pinpad, fatos.pinpadExigido),
    requisitoTerminal(vinculo, fatos.dispositivoId),
    requisitoPonto(vinculo.terminal, fatos.pontoAutorizado),
    requisitoAmbiente(fatos.ambienteAutorizado, fatos.evidencia, ambienteComprovado),
    requisitoPendencias(fatos.pendenciasFinanceiras + (fatos.connector.pendenciaLocal ? 1 : 0)),
    requisitoPlano(fatos.planoPdv),
    requisitoPermissao(fatos.permissaoEditar),
    requisitoPlataforma(fatos.plataformaHabilitada),
    requisitoFinanciamento(fatos.ambienteFiscal, fatos.ambienteAutorizado, ambienteComprovado),
  ];
  const mensagens = requisitos
    .filter((item) => item.estado !== "aprovado")
    .map((item) => item.mensagem);
  return {
    requisitos,
    mensagens,
    podeAtivar: requisitos.every((item) => item.estado === "aprovado"),
    adquirentes: credenciamento.adquirentes,
  };
}

function requisito(
  id: string,
  rotulo: string,
  estado: EstadoRequisito,
  mensagem: string
): RequisitoInstalacao {
  return { id, rotulo, estado, mensagem };
}

function requisitoCredenciamento(ok: boolean, pendencias: string[]): RequisitoInstalacao {
  return requisito(
    "credenciamento",
    "Credenciamento",
    ok ? "aprovado" : "pendente",
    ok ? "Credenciamento PayGoWeb informado." : pendencias[0] || "Credenciamento incompleto."
  );
}

function requisitoConnector(leitura: LeituraConnector): RequisitoInstalacao {
  if (!leitura.respondeu) {
    return requisito(
      "connector",
      "Connector",
      "pendente",
      "O UltraPDV Connector não respondeu neste computador. Instale-o e abra-o. Este assistente não instala nem reinicia o Connector."
    );
  }
  if (!leitura.disponivel) {
    return requisito(
      "connector",
      "Connector",
      "pendente",
      "O Connector respondeu, mas o serviço TEF não está disponível."
    );
  }
  return requisito(
    "connector",
    "Connector",
    "aprovado",
    leitura.versao ? `Connector disponível, versão ${leitura.versao}.` : "Connector disponível."
  );
}

function requisitoExecutavel(leitura: LeituraConnector): RequisitoInstalacao {
  if (!leitura.respondeu) {
    return requisito("executavel", "Executável TEF", "nao_verificavel", "O executável TEF não pôde ser verificado.");
  }
  if (!leitura.executavelEncontrado) {
    return requisito(
      "executavel",
      "Executável TEF",
      "pendente",
      "O executável TEF não foi encontrado pelo Connector."
    );
  }
  return requisito(
    "executavel",
    "Executável TEF",
    "aprovado",
    leitura.processo ? `Executável TEF encontrado. Estado: ${leitura.processo}.` : "Executável TEF encontrado."
  );
}

function requisitoPaygo(leitura: LeituraConnector): RequisitoInstalacao {
  if (!leitura.respondeu) {
    return requisito("paygo", "PayGoWeb", "nao_verificavel", "Não foi possível verificar se o PayGoWeb está inicializado.");
  }
  if (!leitura.paygoInicializado) {
    return requisito(
      "paygo",
      "PayGoWeb",
      "pendente",
      "O PayGoWeb não está inicializado. Este assistente não chama instalação, manutenção ou reinício."
    );
  }
  return requisito("paygo", "PayGoWeb", "aprovado", "PayGoWeb inicializado.");
}

function requisitoPinpad(leitura: LeituraPinpad, exigido: boolean): RequisitoInstalacao {
  if (!exigido) {
    return requisito("pinpad", "Pinpad", "aprovado", "Esta instalação não exige pinpad.");
  }
  if (!leitura.consultado) {
    return requisito("pinpad", "Pinpad", "pendente", "O pinpad ainda não foi consultado.");
  }
  if (
    leitura.limitacaoModelo === "nao_reconhecido" ||
    leitura.comunicacao === "modelo_nao_reconhecido"
  ) {
    return requisito(
      "pinpad",
      "Pinpad",
      "incompativel",
      "O modelo informado pela biblioteca não foi reconhecido. Isso não é uma homologação."
    );
  }
  if (leitura.comunicacao === "confirmada") {
    return requisito("pinpad", "Pinpad", "aprovado", "Pinpad com comunicação confirmada.");
  }
  if (leitura.ppinfoDisponivel === false || leitura.comunicacao === "nao_executada") {
    return requisito(
      "pinpad",
      "Pinpad",
      "nao_verificavel",
      "A identificação do pinpad não está disponível fora de transação nesta biblioteca. O teste de comunicação ainda não confirmou o equipamento."
    );
  }
  if (
    leitura.comunicacao === "indisponivel" ||
    leitura.comunicacao === "nao_encontrado" ||
    leitura.comunicacao === "aplicacao_indisponivel"
  ) {
    return requisito("pinpad", "Pinpad", "pendente", "Pinpad indisponível nesta consulta.");
  }
  return requisito("pinpad", "Pinpad", "pendente", "A comunicação do pinpad ainda não foi confirmada.");
}

function requisitoTerminal(
  vinculo: ReturnType<typeof terminalDaSessao>,
  dispositivoId: string
): RequisitoInstalacao {
  if (!dispositivoId.trim()) {
    return requisito("terminal", "Terminal", "pendente", "Este computador ainda não foi identificado.");
  }
  if (vinculo.outraEmpresa) {
    return requisito(
      "terminal",
      "Terminal",
      "incompativel",
      "Este computador está vinculado a outra empresa. A vinculação não será trocada."
    );
  }
  if (!vinculo.terminal) {
    return requisito("terminal", "Terminal", "pendente", "O terminal ainda não está vinculado a esta empresa.");
  }
  return requisito("terminal", "Terminal", "aprovado", "Terminal vinculado a esta empresa.");
}

function requisitoPonto(
  terminal: TerminalInstalacao | null,
  pontoAutorizado: string
): RequisitoInstalacao {
  if (!terminal) {
    return requisito("ponto", "Ponto de captura", "pendente", "O ponto de captura será conferido depois da vinculação.");
  }
  if (!pontoAutorizado || terminal.pontoCaptura !== pontoAutorizado) {
    return requisito(
      "ponto",
      "Ponto de captura",
      "incompativel",
      "O ponto de captura do terminal não confere com o ponto autorizado."
    );
  }
  return requisito("ponto", "Ponto de captura", "aprovado", "Ponto de captura conferido.");
}

function requisitoAmbiente(
  autorizado: AmbienteTefAssistente | "",
  evidencia: ClassificacaoAmbienteInstalacao,
  efetivo: AmbienteTefAssistente | null
): RequisitoInstalacao {
  if (efetivo !== "homologacao" && efetivo !== "producao") {
    return requisito("ambiente", "Ambiente", "nao_verificavel", evidencia.motivo);
  }
  if (autorizado !== efetivo) {
    return requisito(
      "ambiente",
      "Ambiente",
      "incompativel",
      "O ambiente comprovado pela instalação controlada diverge do ambiente autorizado."
    );
  }
  return requisito("ambiente", "Ambiente", "aprovado", evidencia.motivo);
}

function requisitoPendencias(quantidade: number): RequisitoInstalacao {
  if (quantidade > 0) {
    return requisito(
      "pendencias",
      "Pendências",
      "pendente",
      "Existe operação financeira pendente. Resolva antes de ativar."
    );
  }
  return requisito("pendencias", "Pendências", "aprovado", "Não há operação financeira pendente.");
}

function requisitoPlano(permitido: boolean): RequisitoInstalacao {
  return requisito(
    "plano",
    "Plano",
    permitido ? "aprovado" : "pendente",
    permitido ? "O plano da empresa inclui o PDV." : "O plano da empresa não inclui o PDV."
  );
}

function requisitoPermissao(permitida: boolean): RequisitoInstalacao {
  return requisito(
    "permissao",
    "Permissão",
    permitida ? "aprovado" : "pendente",
    permitida
      ? "O usuário pode editar a configuração financeira."
      : "A ativação exige permissão de edição do financeiro."
  );
}

function requisitoPlataforma(habilitada: boolean): RequisitoInstalacao {
  return requisito(
    "plataforma",
    "Plataforma",
    habilitada ? "aprovado" : "pendente",
    habilitada
      ? "A plataforma TEF está habilitada."
      : "A plataforma TEF ainda não foi habilitada na administração master."
  );
}

function requisitoFinanciamento(
  ambienteFiscal: number | null,
  autorizado: AmbienteTefAssistente | "",
  efetivo: AmbienteTefAssistente | null
): RequisitoInstalacao {
  if (Number(ambienteFiscal) !== 1) {
    return requisito(
      "financiamento",
      "NFC-e",
      "aprovado",
      "A NFC-e desta empresa não está em produção."
    );
  }
  if (efetivo !== "homologacao" && efetivo !== "producao") {
    return requisito("financiamento", "NFC-e", "nao_verificavel", MENSAGEM_TEF_AMBIENTE_INCONCLUSIVO);
  }
  if (autorizado !== "producao" || efetivo !== "producao") {
    return requisito("financiamento", "NFC-e", "incompativel", MENSAGEM_TEF_HOMOLOGACAO_NFCE_PRODUCAO);
  }
  return requisito(
    "financiamento",
    "NFC-e",
    "aprovado",
    "O TEF de produção pode financiar a NFC-e de produção."
  );
}

export function decidirAtivacao(input: {
  permissaoEditar: boolean;
  empresaJaHabilitada: boolean;
  podeAtivar: boolean;
  pontoAtual: string;
  ambienteAtual: AmbienteTefAssistente | "";
  pontoInformado: string;
  ambienteInformado: AmbienteTefAssistente | "";
}) {
  if (!input.permissaoEditar) {
    return {
      efeito: "recusar" as const,
      motivo: "sem_permissao",
      alteraPonto: false,
      alteraAmbiente: false,
      alteraPlataforma: false,
      alteraChave: false,
    };
  }
  if (input.empresaJaHabilitada) {
    return {
      efeito: "preservar" as const,
      motivo: "ja_configurada",
      alteraPonto: false,
      alteraAmbiente: false,
      alteraPlataforma: false,
      alteraChave: false,
      ponto: input.pontoAtual,
      ambiente: input.ambienteAtual,
    };
  }
  if (!input.podeAtivar) {
    return {
      efeito: "recusar" as const,
      motivo: "requisitos",
      alteraPonto: false,
      alteraAmbiente: false,
      alteraPlataforma: false,
      alteraChave: false,
    };
  }
  return {
    efeito: "habilitar" as const,
    motivo: "comprovado",
    alteraPonto: false,
    alteraAmbiente: false,
    alteraPlataforma: false,
    alteraChave: false,
    ponto: input.pontoInformado,
    ambiente: input.ambienteInformado,
  };
}

export function montarGravacaoAtivacao(input: {
  empresaSessaoId: string;
  empresaInformada: string | null;
  ambiente: AmbienteTefAssistente;
  pontoCaptura: string;
  estabelecimento: string;
}) {
  return {
    empresaId: input.empresaSessaoId,
    empresaInformadaIgnorada: input.empresaInformada,
    habilitado: true,
    ambiente: input.ambiente,
    pontoCaptura: input.pontoCaptura,
    estabelecimento: input.estabelecimento,
    alteraPlataforma: false,
  };
}

export function rotuloEstado(estado: EstadoRequisito) {
  if (estado === "aprovado") return "Aprovado";
  if (estado === "pendente") return "Pendente";
  if (estado === "incompativel") return "Incompatível";
  return "Não verificável";
}

export function rotuloEtapa(etapa: EtapaAssistente) {
  const rotulos: Record<EtapaAssistente, string> = {
    credenciamento: "Credenciamento",
    connector: "Connector",
    pinpad: "Pinpad",
    vinculacao: "Vinculação do terminal",
    validacao: "Validação",
    ativacao: "Ativação",
  };
  return rotulos[etapa];
}
