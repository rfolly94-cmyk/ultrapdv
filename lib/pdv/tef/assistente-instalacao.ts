import {
  MENSAGEM_TEF_AMBIENTE_INCONCLUSIVO,
  MENSAGEM_TEF_HOMOLOGACAO_NFCE_PRODUCAO,
} from "@/lib/fiscal/tef/ambiente-tef-nfce";
import type { ClassificacaoAmbienteInstalacao } from "@/lib/pdv/tef/evidencia-instalacao";
import { validarServidorPayGo } from "@/lib/pdv/tef/servidor-paygo";

export const ETAPAS_ASSISTENTE = ["credenciamento", "connector", "ativacao"] as const;

const ETAPAS_LEGADAS: Record<string, EtapaAssistente> = {
  credenciamento: "credenciamento",
  connector: "connector",
  pinpad: "connector",
  vinculacao: "connector",
  validacao: "ativacao",
  ativacao: "ativacao",
};

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
  pgwebLibPronta: boolean;
  pgwebVersao: string | null;
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

function registro(valor: unknown) {
  return valor && typeof valor === "object" ? (valor as Record<string, unknown>) : null;
}

function textoStatus(valor: unknown) {
  const texto = typeof valor === "string" ? valor.trim() : "";
  return texto ? texto.slice(0, 40) : null;
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
    disponivel: input.descobertaOk === true && registro(tef?.pgwebLib)?.pronta === true,
    executavelEncontrado: false,
    processo: null,
    pgwebLibPronta: input.descobertaOk === true && registro(tef?.pgwebLib)?.pronta === true,
    pgwebVersao: textoStatus(registro(tef?.pgwebLib)?.versao),
    paygoInicializado: input.descobertaOk === true && registro(tef?.pgwebLib)?.pronta === true,
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

export function normalizarEtapa(valor: string | null | undefined): EtapaAssistente | null {
  if (!valor) {
    return null;
  }
  return ETAPAS_LEGADAS[valor] ?? null;
}

export function etapaPersistida(pedida: string | null, credenciamentoCompleto: boolean): EtapaAssistente {
  if (!credenciamentoCompleto) {
    return "credenciamento";
  }
  return normalizarEtapa(pedida) ?? "connector";
}

export function etapaInicial(input: {
  etapaSalva: string | null;
  credenciamentoCompleto: boolean;
  empresaJaHabilitada: boolean;
  servidorOficial?: string;
}): EtapaAssistente {
  const servidorInformado = String(input.servidorOficial ?? "").trim();
  if ((input.empresaJaHabilitada || input.credenciamentoCompleto) && !servidorInformado) {
    return "credenciamento";
  }
  if (!input.credenciamentoCompleto && !input.empresaJaHabilitada) {
    return "credenciamento";
  }
  const salva = normalizarEtapa(input.etapaSalva);
  if (salva) {
    return etapaPersistida(salva, input.credenciamentoCompleto || input.empresaJaHabilitada);
  }
  if (input.empresaJaHabilitada) {
    return "connector";
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
  biblioteca?: ObservacaoBibliotecaAssistente | null;
  provaTecnica?: ProvaTecnicaAssistente | null;
};

export type ProvaTecnicaAssistente = {
  instalacaoComprovada: boolean;
  ambienteConfigurado: boolean;
};

export function avaliarInstalacao(fatos: FatosInstalacao) {
  const credenciamento = validarCredenciamento(fatos.credenciamento);
  const vinculo = terminalDaSessao(fatos.terminais, fatos.empresaId, fatos.dispositivoId);
  const ambienteComprovado = ambienteComprovadoDaEvidencia(fatos.evidencia);
  const requisitos: RequisitoInstalacao[] = [
    requisitoCredenciamento(credenciamento.ok, credenciamento.pendencias),
    requisitoConnector(fatos.connector),
    requisitoProcesso(fatos.connector),
    requisitoExecutavel(fatos.connector),
    requisitoPaygo(fatos.connector, fatos.provaTecnica),
    requisitoPinpad(fatos.pinpad, fatos.pinpadExigido),
    requisitoTerminal(vinculo, fatos.dispositivoId),
    requisitoPonto(vinculo.terminal, fatos.pontoAutorizado),
    requisitoAmbiente(
      fatos.ambienteAutorizado,
      fatos.evidencia,
      ambienteComprovado,
      fatos.biblioteca,
      fatos.provaTecnica
    ),
    requisitoAdquirente(ambienteComprovado, fatos.provaTecnica),
    requisitoPendencias(fatos.pendenciasFinanceiras + (fatos.connector.pendenciaLocal ? 1 : 0)),
    requisitoPlano(fatos.planoPdv),
    requisitoPermissao(fatos.permissaoEditar),
    requisitoPlataforma(fatos.plataformaHabilitada),
    requisitoFinanciamento(fatos.ambienteFiscal, fatos.ambienteAutorizado, ambienteComprovado),
  ];
  const mensagens = requisitos
    .filter((item) => item.estado !== "aprovado")
    .map((item) => item.mensagem);
  const informativos = new Set(["adquirente", "processo"]);
  return {
    requisitos,
    mensagens,
    podeAtivar: requisitos
      .filter((item) => !informativos.has(item.id))
      .every((item) => item.estado === "aprovado"),
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
  return requisito(
    "connector",
    "Connector",
    "aprovado",
    leitura.versao
      ? `Serviço do Connector conectado, versão ${leitura.versao}. O estado do processo TEF é uma condição separada.`
      : "Serviço do Connector conectado. O estado do processo TEF é uma condição separada."
  );
}

function requisitoProcesso(leitura: LeituraConnector): RequisitoInstalacao {
  if (!leitura.respondeu) {
    return requisito(
      "processo",
      "PGWebLib",
      "nao_verificavel",
      "A PGWebLib não pôde ser consultada porque o Connector não respondeu."
    );
  }
  if (leitura.pgwebLibPronta) {
    return requisito(
      "processo",
      "PGWebLib",
      "aprovado",
      leitura.pgwebVersao ? `PGWebLib ${leitura.pgwebVersao} pronta.` : "PGWebLib pronta."
    );
  }
  return requisito(
    "processo",
    "PGWebLib",
    "pendente",
    "A PGWebLib consultada não está pronta. Nenhuma cobrança foi iniciada."
  );
}

function requisitoExecutavel(leitura: LeituraConnector): RequisitoInstalacao {
  if (!leitura.respondeu) {
    return requisito("executavel", "PGWebLib", "nao_verificavel", "A PGWebLib não pôde ser consultada.");
  }
  if (!leitura.pgwebLibPronta) {
    return requisito(
      "executavel",
      "PGWebLib",
      "pendente",
      "A PGWebLib.dll não está pronta nesta consulta."
    );
  }
  return requisito("executavel", "PGWebLib", "aprovado", "A PGWebLib.dll consultada está pronta.");
}

function requisitoPaygo(
  leitura: LeituraConnector,
  prova?: ProvaTecnicaAssistente | null
): RequisitoInstalacao {
  if (provaTecnicaValida(prova)) {
    return requisito(
      "paygo",
      "PayGoWeb",
      "aprovado",
      "Instalação técnica comprovada pela prova ultrapdv-tef-biblioteca-v2 e ambiente da biblioteca configurado. Isso não é a evidência v1 e não autoriza a adquirente."
    );
  }
  if (!leitura.respondeu) {
    return requisito("paygo", "PayGoWeb", "nao_verificavel", "Não foi possível verificar se o PayGoWeb está inicializado.");
  }
  if (!leitura.paygoInicializado) {
    return requisito(
      "paygo",
      "PayGoWeb",
      "pendente",
      "O PayGoWeb não está em execução nesta consulta. Este assistente não chama instalação, manutenção ou reinício."
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
  efetivo: AmbienteTefAssistente | null,
  biblioteca?: ObservacaoBibliotecaAssistente | null,
  prova?: ProvaTecnicaAssistente | null
): RequisitoInstalacao {
  if (efetivo !== "homologacao" && efetivo !== "producao") {
    return requisito(
      "ambiente",
      "Ambiente financeiro",
      "nao_verificavel",
      mensagemAmbienteNaoComprovado(evidencia, biblioteca ?? null, prova)
    );
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
    return requisito(
      "financiamento",
      "NFC-e",
      "nao_verificavel",
      "A NFC-e de produção permanece bloqueada enquanto a operação não tiver ambiente_efetivo = producao. A prova técnica da biblioteca não libera a nota."
    );
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

function provaTecnicaValida(prova?: ProvaTecnicaAssistente | null) {
  return prova?.instalacaoComprovada === true && prova.ambienteConfigurado === true;
}

function requisitoAdquirente(
  efetivo: AmbienteTefAssistente | null,
  prova?: ProvaTecnicaAssistente | null
): RequisitoInstalacao {
  if (efetivo === "producao") {
    return requisito(
      "adquirente",
      "Adquirente",
      "nao_verificavel",
      "A instalação controlada não substitui uma operação com ambiente_efetivo = producao. A C6 PAY ainda não está habilitada para pagamento real só por este cadastro."
    );
  }
  return requisito(
    "adquirente",
    "Adquirente",
    "nao_verificavel",
    provaTecnicaValida(prova)
      ? "A C6 PAY permanece desconhecida para pagamento real. A prova v2 não credencia a adquirente. Falta uma operação com ambiente_efetivo = producao e a evidência assinada de produção exigida pela cobrança."
      : "A C6 PAY permanece desconhecida para pagamento real. Falta uma operação com ambiente_efetivo = producao."
  );
}

export type EtapaInstalacaoComercial = {
  id: "connector" | "vinculo" | "credenciamento" | "pinpad" | "pronto";
  rotulo: string;
  concluida: boolean;
  explicacao: string;
};

export function etapasInstalacaoComercial(input: {
  connectorEncontrado: boolean;
  terminalVinculado: boolean;
  credenciamentoNecessario: boolean;
  credenciamentoOk: boolean;
  pinpadVerificado: boolean;
  ambienteEfetivoConfirmado: boolean;
  pontoConfirmado: boolean;
  servidorConfirmado: boolean;
}): EtapaInstalacaoComercial[] {
  const credenciamento = !input.credenciamentoNecessario || input.credenciamentoOk;
  const pronto =
    input.connectorEncontrado &&
    input.terminalVinculado &&
    credenciamento &&
    input.pinpadVerificado &&
    input.ambienteEfetivoConfirmado &&
    input.pontoConfirmado &&
    input.servidorConfirmado;
  return [
    {
      id: "connector",
      rotulo: "Instalar Connector",
      concluida: input.connectorEncontrado,
      explicacao: input.connectorEncontrado
        ? "O UltraPDV Connector respondeu neste computador."
        : "Instale o UltraPDV Connector nesta máquina. A pasta de dados do TEF fica em ProgramData e é preparada pelo instalador.",
    },
    {
      id: "vinculo",
      rotulo: "Vincular terminal",
      concluida: input.terminalVinculado,
      explicacao: input.terminalVinculado
        ? "Este computador está vinculado ao terminal da empresa."
        : "Vincule o terminal deste computador antes de cobrar.",
    },
    {
      id: "credenciamento",
      rotulo: "Configurar credenciamento",
      concluida: credenciamento,
      explicacao: input.credenciamentoNecessario
        ? input.credenciamentoOk
          ? "O credenciamento informado está completo."
          : "Informe o credenciamento quando a adquirente exigir ponto, estabelecimento e servidor."
        : "O credenciamento adicional não é exigido nesta etapa.",
    },
    {
      id: "pinpad",
      rotulo: "Verificar PinPad",
      concluida: input.pinpadVerificado,
      explicacao: input.pinpadVerificado
        ? "A comunicação do PinPad foi verificada."
        : "Verifique o PinPad neste computador. A verificação não inicia uma cobrança.",
    },
    {
      id: "pronto",
      rotulo: "TEF pronto",
      concluida: pronto,
      explicacao: pronto
        ? "Connector, vínculo, credenciamento, PinPad, ambiente efetivo, ponto e servidor estão confirmados."
        : "A cobrança permanece bloqueada até a confirmação do ambiente efetivo, do ponto de captura, do servidor e do credenciamento.",
    },
  ];
}

export type ItemPainelTef = {
  id: "credenciamento" | "connector" | "processo" | "pinpad" | "paygo" | "ambiente";
  rotulo: string;
  situacao: string;
  pendente: boolean;
  explicacao: string;
};

export function painelSituacaoTef(input: {
  credenciamentoOk: boolean;
  connector: LeituraConnector | null;
  pinpad: LeituraPinpad | null;
  pinpadExigido: boolean;
  bibliotecaValidada: boolean;
  provaTecnica?: boolean;
  ambienteComprovado: AmbienteTefAssistente | null;
  agenteCompativel?: boolean | null;
  evidenciaInstalacao?: boolean;
  falhaConsulta?: string | null;
}): ItemPainelTef[] {
  const connector = input.connector;
  const conectado = connector?.respondeu === true;
  const incompativel = conectado && input.agenteCompativel === false;
  const bibliotecaPronta = conectado && connector?.pgwebLibPronta === true;
  const pinpad = input.pinpad;
  const pinpadDisponivel = pinpad?.comunicacao === "confirmada";
  const ambiente =
    input.ambienteComprovado === "producao"
      ? "produção comprovada"
      : input.ambienteComprovado === "homologacao"
        ? "homologação comprovada"
        : "desconhecido";
  let paygo = "pendente";
  let paygoExplicacao = "A biblioteca PayGoWeb ainda não foi instalada nem validada.";
  if (input.bibliotecaValidada && input.ambienteComprovado) {
    paygo = "instalado e validado";
    paygoExplicacao = "A instalação observada confirma o ponto, o servidor e a pasta.";
  } else if (!conectado) {
    paygo = "não verificável";
    paygoExplicacao =
      input.falhaConsulta || "O Connector não respondeu, então a biblioteca não pôde ser consultada.";
  } else if (input.falhaConsulta) {
    paygo = "não verificável";
    paygoExplicacao = input.falhaConsulta;
  } else if (input.provaTecnica) {
    paygo = "instalação comprovada";
    paygoExplicacao =
      "A prova v2 confirma a instalação técnica e o ambiente configurado na biblioteca. Ela não autoriza a adquirente.";
  } else if (!connector?.paygoInicializado && !input.bibliotecaValidada && !input.evidenciaInstalacao) {
    paygoExplicacao = "Biblioteca PayGoWeb não instalada. Processo parado não significa Connector desconectado.";
  } else if (!input.ambienteComprovado) {
    paygo = "inicializado";
    paygoExplicacao = input.evidenciaInstalacao
      ? "Há evidência de instalação na biblioteca. A permissão de cobrança não comprova o ambiente efetivo da adquirente."
      : "A biblioteca está inicializada e o ambiente efetivo continua desconhecido.";
  }
  return [
    {
      id: "credenciamento",
      rotulo: "Credenciamento",
      situacao: input.credenciamentoOk ? "configurado" : "pendente",
      pendente: !input.credenciamentoOk,
      explicacao: input.credenciamentoOk
        ? "CNPJ, ponto, ambiente, servidor e estabelecimento estão confirmados."
        : "Falta confirmar o credenciamento e o servidor gravado.",
    },
    {
      id: "connector",
      rotulo: "Connector",
      situacao: !conectado ? "desconectado" : incompativel ? "incompatível" : "conectado",
      pendente: !conectado || incompativel,
      explicacao: !conectado
        ? input.falhaConsulta || "O Connector não respondeu neste computador."
        : incompativel
          ? "Atualize o Connector pelo instalador desta máquina. A versão carregada não é compatível com o TEF."
        : bibliotecaPronta
          ? "O Connector está conectado e a PGWebLib está pronta."
          : "O Connector está conectado. A PGWebLib ainda não está pronta.",
    },
    {
      id: "processo",
      rotulo: "PGWebLib",
      situacao: !conectado ? "não verificável" : bibliotecaPronta ? "pronta" : "pendente",
      pendente: !conectado || !bibliotecaPronta,
      explicacao: !conectado
        ? "A PGWebLib não pôde ser consultada porque o Connector não respondeu."
        : bibliotecaPronta
          ? "A PGWebLib.dll consultada está pronta."
          : "A PGWebLib consultada não está pronta. Nenhuma cobrança foi iniciada.",
    },
    {
      id: "pinpad",
      rotulo: "Pinpad",
      situacao: !input.pinpadExigido ? "não exigido" : pinpadDisponivel ? "disponível" : "não verificado",
      pendente: input.pinpadExigido && !pinpadDisponivel,
      explicacao: pinpadDisponivel
        ? "A comunicação do pinpad foi confirmada."
        : "O pinpad ainda não foi verificado nesta tela.",
    },
    {
      id: "paygo",
      rotulo: "PayGoWeb",
      situacao: paygo,
      pendente: paygo !== "instalado e validado" && paygo !== "instalação comprovada",
      explicacao: paygoExplicacao,
    },
    {
      id: "ambiente",
      rotulo: "Ambiente financeiro",
      situacao: ambiente,
      pendente: input.ambienteComprovado == null,
      explicacao:
        input.ambienteComprovado == null
          ? input.provaTecnica
            ? "O ambiente financeiro da adquirente continua desconhecido. A prova v2 não substitui ambiente_efetivo = producao."
            : input.evidenciaInstalacao
              ? "O ambiente efetivo da adquirente continua desconhecido. A evidência de instalação e o ambiente pedido à biblioteca são informações separadas."
              : "O ambiente efetivo continua desconhecido."
          : `O ambiente comprovado é ${ambiente}.`,
    },
  ];
}

export type SituacaoAgenteTef = {
  compativel: boolean | null;
  nome: string | null;
  versao: string | null;
  cobrancaPermitida: boolean;
  evidenciaInstalacao: boolean;
  ambienteBiblioteca: AmbienteTefAssistente | null;
  ambienteEfetivo: AmbienteTefAssistente | null;
};

export type ObservacaoBibliotecaAssistente = {
  pontoSolicitado: string;
  servidorSolicitado: string;
  ambienteSolicitado: AmbienteTefAssistente | "";
  diretorio: string;
  setEnvironmentExecutado: boolean;
  retornoSetEnvironment: number | null;
  instalacaoConcluida: boolean;
  cobrancaPermitida: boolean;
  codigoAmbiente: number | null;
  origemComprovacao: string;
};

const HOST_BIBLIOTECA_SANDBOX = /tpgweb\.io|pos-transac-sb|sandbox|homolog/i;

export function sanitizarObservacaoBiblioteca(valor: unknown): ObservacaoBibliotecaAssistente | null {
  if (!valor || typeof valor !== "object") {
    return null;
  }
  const biblioteca = valor as Record<string, unknown>;
  const retorno = Number(biblioteca.retornoSetEnvironment);
  const codigo = Number(biblioteca.codigoAmbiente);
  const ambienteSolicitado: AmbienteTefAssistente | "" =
    biblioteca.ambienteSolicitado === "producao" || biblioteca.ambienteSolicitado === "homologacao"
      ? biblioteca.ambienteSolicitado
      : "";
  return {
    pontoSolicitado: String(biblioteca.pontoSolicitado ?? "").trim().slice(0, 40),
    servidorSolicitado: String(biblioteca.servidorSolicitado ?? "").trim().slice(0, 80),
    ambienteSolicitado,
    diretorio: String(biblioteca.diretorioBiblioteca ?? biblioteca.diretorio ?? "").trim().slice(0, 20),
    setEnvironmentExecutado: biblioteca.setEnvironmentExecutado === true,
    retornoSetEnvironment: Number.isFinite(retorno) ? retorno : null,
    instalacaoConcluida: biblioteca.instalacaoConcluida === true,
    cobrancaPermitida: biblioteca.cobrancaPermitida === true,
    codigoAmbiente: Number.isFinite(codigo) ? codigo : null,
    origemComprovacao: String(biblioteca.origemComprovacao ?? "").trim().slice(0, 40),
  };
}

export function observacaoBibliotecaDoStatus(status: unknown) {
  const raiz = status && typeof status === "object" ? (status as { tef?: unknown }).tef : null;
  const tef = raiz && typeof raiz === "object" ? (raiz as { biblioteca?: unknown }).biblioteca : null;
  return sanitizarObservacaoBiblioteca(tef);
}

export function instalacaoTecnicaInformada(biblioteca: ObservacaoBibliotecaAssistente | null) {
  if (!biblioteca) {
    return false;
  }
  return (
    biblioteca.setEnvironmentExecutado &&
    biblioteca.retornoSetEnvironment === 0 &&
    biblioteca.instalacaoConcluida &&
    biblioteca.cobrancaPermitida &&
    biblioteca.diretorio === "producao" &&
    biblioteca.ambienteSolicitado === "producao" &&
    biblioteca.codigoAmbiente === 0 &&
    biblioteca.pontoSolicitado.length > 0 &&
    biblioteca.servidorSolicitado.length > 0 &&
    !HOST_BIBLIOTECA_SANDBOX.test(biblioteca.servidorSolicitado)
  );
}

export function mensagemAmbienteNaoComprovado(
  evidencia: ClassificacaoAmbienteInstalacao,
  biblioteca: ObservacaoBibliotecaAssistente | null,
  prova?: ProvaTecnicaAssistente | null
) {
  if (evidencia.situacao === "comprovado" && evidencia.ambienteEfetivo) {
    return evidencia.motivo;
  }
  if (provaTecnicaValida(prova)) {
    return "A prova ultrapdv-tef-biblioteca-v2 confirma a instalação técnica e o ambiente configurado na biblioteca. Ela não é a evidência ultrapdv-tef-instalacao-v1 e não comprova o ambiente financeiro da adquirente. A C6 PAY ainda não pode processar pagamento real.";
  }
  if (instalacaoTecnicaInformada(biblioteca)) {
    return "Instalação técnica informada pelo Connector: pasta de produção, PW_iSetEnvironment com retorno 0 e instalação concluída. A resposta de /tef/status não traz a prova assinada ultrapdv-tef-biblioteca-v2, e a evidência ultrapdv-tef-instalacao-v1 não está registrada nesta empresa. O ambiente efetivo da adquirente continua desconhecido.";
  }
  if (biblioteca?.cobrancaPermitida === true) {
    return "O Connector informou permissão de cobrança sem o conjunto da instalação técnica. Isso não comprova o ambiente efetivo da adquirente.";
  }
  return evidencia.motivo;
}

export function situacaoAgenteTef(status: unknown): SituacaoAgenteTef {
  const raiz = status && typeof status === "object" ? (status as { tef?: unknown }).tef : null;
  const tef = raiz && typeof raiz === "object" ? (raiz as Record<string, unknown>) : null;
  const pgweb = tef?.pgwebLib && typeof tef.pgwebLib === "object" ? (tef.pgwebLib as Record<string, unknown>) : null;
  const biblioteca =
    tef?.biblioteca && typeof tef.biblioteca === "object"
      ? (tef.biblioteca as Record<string, unknown>)
      : null;
  const ambienteBiblioteca: AmbienteTefAssistente | null =
    biblioteca?.ambienteSolicitado === "producao" || biblioteca?.ambienteSolicitado === "homologacao"
      ? biblioteca.ambienteSolicitado
      : null;
  const ambienteEfetivo: AmbienteTefAssistente | null =
    tef?.ambienteEfetivo === "producao" || tef?.ambienteEfetivo === "homologacao"
      ? tef.ambienteEfetivo
      : null;
  const cobrancaPermitida = biblioteca?.cobrancaPermitida === true;
  const assinada = biblioteca?.origemComprovacao === "instalacao_assinada";
  return {
    compativel: pgweb ? pgweb.pronta === true : null,
    nome: pgweb ? "PGWebLib.dll" : null,
    versao: pgweb?.versao ? String(pgweb.versao).slice(0, 40) : null,
    cobrancaPermitida,
    evidenciaInstalacao: cobrancaPermitida && assinada,
    ambienteBiblioteca,
    ambienteEfetivo,
  };
}

export function classificarFalhaFetchConnector(erro: unknown): "timeout" | "cors" | "indisponivel" {
  const nome =
    erro && typeof erro === "object" && "name" in erro ? String((erro as { name?: unknown }).name) : "";
  const mensagem = erro instanceof Error ? erro.message : String(erro ?? "");
  if (nome === "AbortError" || /timeout|aborted/i.test(mensagem)) {
    return "timeout";
  }
  if (/cors|private network|access-control|blocked by/i.test(mensagem)) {
    return "cors";
  }
  return "indisponivel";
}

export function decidirMotivoConsultaConnector(input: {
  falha: "timeout" | "cors" | "indisponivel" | "bloqueado" | "ausente" | "sem_porta" | "invalido";
  noCorsRespondeu?: boolean;
}): "timeout" | "cors" | "indisponivel" | "invalido" {
  if (input.falha === "timeout") {
    return "timeout";
  }
  if (input.falha === "cors" || input.falha === "bloqueado") {
    return "cors";
  }
  if (input.falha === "invalido") {
    return "invalido";
  }
  if (input.noCorsRespondeu === true) {
    return "cors";
  }
  return "indisponivel";
}

export function mensagemConsultaConnector(
  motivo: "timeout" | "cors" | "indisponivel" | "invalido" | "http" | "json" | "recusada",
  detalhe = ""
) {
  if (motivo === "timeout") {
    return "A consulta ao Connector expirou antes de /health ou /tef/status responder.";
  }
  if (motivo === "cors") {
    return "O navegador bloqueou a leitura do Connector por CORS ou acesso à rede local. Abrir o endereço direto não passa por essa verificação.";
  }
  if (motivo === "invalido") {
    return "Há um serviço na porta consultada, mas a resposta de /health não identificou o UltraPDV Connector.";
  }
  if (motivo === "http") {
    return `O Connector respondeu HTTP ${detalhe || "de erro"} em /tef/status.`;
  }
  if (motivo === "json") {
    return "O Connector respondeu, mas /tef/status não devolveu JSON válido.";
  }
  if (motivo === "recusada") {
    return detalhe || "GET /tef/status devolveu ok:false.";
  }
  return "O Connector não respondeu em 127.0.0.1 nas portas 18181 a 18190.";
}

export function diagnosticarConsultaConnector(input: {
  descobertaOk: boolean;
  motivoDescoberta?: string | null;
  origem?: string | null;
  versao?: string | null;
  dispositivoId?: string | null;
  statusHttp?: number | null;
  status?: unknown;
  falhaStatus?: "timeout" | "cors" | "indisponivel" | "json" | null;
}): {
  conectado: boolean;
  statusLido: boolean;
  mensagem: string;
  dispositivoId: string;
  leitura: LeituraConnector;
  agente: SituacaoAgenteTef;
  biblioteca: ObservacaoBibliotecaAssistente | null;
} {
  const agente = situacaoAgenteTef(input.status);
  const biblioteca = observacaoBibliotecaDoStatus(input.status);
  const dispositivoId = String(input.dispositivoId ?? "").trim();
  if (!input.descobertaOk) {
    const motivo = decidirMotivoConsultaConnector({
      falha:
        input.motivoDescoberta === "timeout" ||
        input.motivoDescoberta === "cors" ||
        input.motivoDescoberta === "bloqueado" ||
        input.motivoDescoberta === "invalido"
          ? input.motivoDescoberta
          : "ausente",
    });
    return {
      conectado: false,
      statusLido: false,
      mensagem: mensagemConsultaConnector(motivo),
      dispositivoId,
      leitura: interpretarStatusConnector({ descobertaOk: false }),
      agente,
      biblioteca: null,
    };
  }
  if (input.falhaStatus) {
    return {
      conectado: true,
      statusLido: false,
      mensagem: mensagemConsultaConnector(input.falhaStatus),
      dispositivoId,
      leitura: interpretarStatusConnector({
        descobertaOk: true,
        versao: input.versao,
        status: null,
      }),
      agente: situacaoAgenteTef(null),
      biblioteca: null,
    };
  }
  const http = Number(input.statusHttp ?? 200);
  if (!Number.isFinite(http) || http < 200 || http >= 300) {
    return {
      conectado: true,
      statusLido: false,
      mensagem: mensagemConsultaConnector("http", String(input.statusHttp ?? "")),
      dispositivoId,
      leitura: interpretarStatusConnector({ descobertaOk: true, versao: input.versao, status: null }),
      agente: situacaoAgenteTef(null),
      biblioteca: null,
    };
  }
  const raiz = input.status && typeof input.status === "object" ? (input.status as { ok?: unknown; erro?: unknown }) : null;
  if (!raiz || raiz.ok === false) {
    return {
      conectado: true,
      statusLido: false,
      mensagem: mensagemConsultaConnector("recusada", raiz?.erro ? String(raiz.erro).slice(0, 180) : ""),
      dispositivoId,
      leitura: interpretarStatusConnector({ descobertaOk: true, versao: input.versao, status: input.status }),
      agente,
      biblioteca: null,
    };
  }
  return {
    conectado: true,
    statusLido: true,
    mensagem: "",
    dispositivoId,
    leitura: interpretarStatusConnector({
      descobertaOk: true,
      versao: input.versao ?? agente.versao,
      status: input.status,
    }),
    agente,
    biblioteca,
  };
}

export function rotuloEtapa(etapa: EtapaAssistente) {
  const rotulos: Record<EtapaAssistente, string> = {
    credenciamento: "Credenciamento",
    connector: "Connector e pinpad",
    ativacao: "Instalação e ativação",
  };
  return rotulos[etapa];
}
