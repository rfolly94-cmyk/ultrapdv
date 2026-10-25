export const VERSAO_DLL_PGWEB = "4.1.50.924";
export const CONFIRMACAO_INSTALACAO_PRODUCAO = "AUTORIZO_INSTALACAO_PRODUCAO";

export const ESTADOS_DISPONIBILIDADE_TEF = [
  "tef_desabilitado",
  "sem_connector",
  "connector_incompativel",
  "biblioteca_ausente",
  "credenciais_incompletas",
  "ponto_nao_instalado",
  "terminal_nao_vinculado",
  "ambiente_incorreto",
  "pinpad_indisponivel",
  "homologacao_disponivel_para_testes",
  "producao_aguardando_liberacao",
  "tef_operacional",
  "transacao_em_andamento",
  "recuperacao_necessaria",
] as const;

export type EstadoDisponibilidadeTef = (typeof ESTADOS_DISPONIBILIDADE_TEF)[number];

export type EntradaDisponibilidadeTef = {
  habilitado: boolean;
  ambiente: "" | "homologacao" | "producao";
  credenciaisCompletas: boolean | null;
  pontoInstalado: boolean | null;
  terminalVinculado: boolean | null;
  connectorPresente: boolean | null;
  connectorCompativel: boolean | null;
  bibliotecaPresente: boolean | null;
  pinpadDisponivel: boolean | null;
  ambienteCompativel: boolean;
  cobrancaRealBloqueada: boolean;
  ativacaoExplicita: boolean;
  transacaoEmAndamento: boolean;
  recuperacaoNecessaria: boolean;
};

const ROTULOS: Record<EstadoDisponibilidadeTef, string> = {
  tef_desabilitado: "TEF desabilitado",
  sem_connector: "Sem Connector",
  connector_incompativel: "Connector incompatível",
  biblioteca_ausente: "Biblioteca ausente",
  credenciais_incompletas: "Credenciais incompletas",
  ponto_nao_instalado: "Ponto não instalado",
  terminal_nao_vinculado: "Terminal não vinculado",
  ambiente_incorreto: "Ambiente incorreto",
  pinpad_indisponivel: "PinPad indisponível",
  homologacao_disponivel_para_testes: "Homologação disponível para testes",
  producao_aguardando_liberacao: "Produção aguardando liberação",
  tef_operacional: "TEF operacional",
  transacao_em_andamento: "Transação em andamento",
  recuperacao_necessaria: "Recuperação necessária",
};

const MOTIVOS: Record<EstadoDisponibilidadeTef, string> = {
  tef_desabilitado:
    "O TEF desta empresa está desligado. Débito e crédito não podem ser recebidos como pagamento comum.",
  sem_connector: "O UltraPDV Connector não está disponível neste computador.",
  connector_incompativel: "O Connector encontrado não é compatível com o TEF 2.0.",
  biblioteca_ausente: `A PGWebLib ${VERSAO_DLL_PGWEB} não está disponível no perfil deste ambiente.`,
  credenciais_incompletas: "Host, porta ou ponto de captura deste ambiente ainda não foram salvos.",
  ponto_nao_instalado: "Salvar as credenciais não instala o ponto. A instalação deste ambiente ainda não foi confirmada.",
  terminal_nao_vinculado: "Este computador não está vinculado ao terminal autorizado da empresa.",
  ambiente_incorreto: "O ambiente configurado não pode ser usado. Produção não é escolhida por falha de configuração.",
  pinpad_indisponivel: "O PinPad não respondeu neste computador.",
  homologacao_disponivel_para_testes:
    "A homologação está configurada. A cobrança real continua bloqueada até a evidência da DLL e a ativação explícita.",
  producao_aguardando_liberacao:
    "A produção só cobra com o contrato Windows da PGWebLib conferido em PGWebLib.h e a liberação explícita da cobrança. O ponto de captura instalado continua obrigatório.",
  tef_operacional: "O TEF está operacional para o ambiente configurado desta empresa.",
  transacao_em_andamento: "Já existe uma transação TEF em andamento neste caixa.",
  recuperacao_necessaria: "Há pendência financeira desta empresa. Uma nova cobrança não foi iniciada.",
};

function estado(codigo: EstadoDisponibilidadeTef) {
  return {
    estado: codigo,
    rotulo: ROTULOS[codigo],
    motivo: MOTIVOS[codigo],
    receber: codigo === "tef_operacional",
    simularSucesso: false as const,
  };
}

export function classificarDisponibilidadePdv(input: EntradaDisponibilidadeTef) {
  if (input.recuperacaoNecessaria) return estado("recuperacao_necessaria");
  if (input.transacaoEmAndamento) return estado("transacao_em_andamento");
  if (!input.habilitado) return estado("tef_desabilitado");
  if (input.ambiente !== "homologacao" && input.ambiente !== "producao") return estado("ambiente_incorreto");
  if (input.ambienteCompativel === false) return estado("ambiente_incorreto");
  if (input.connectorPresente === false) return estado("sem_connector");
  if (input.connectorCompativel === false) return estado("connector_incompativel");
  if (input.bibliotecaPresente === false) return estado("biblioteca_ausente");
  if (input.credenciaisCompletas === false) return estado("credenciais_incompletas");
  if (input.pontoInstalado === false) return estado("ponto_nao_instalado");
  if (input.terminalVinculado === false) return estado("terminal_nao_vinculado");
  if (input.pinpadDisponivel === false) return estado("pinpad_indisponivel");
  const liberada = input.cobrancaRealBloqueada === false && input.ativacaoExplicita === true;
  if (!liberada && input.ambiente === "homologacao") return estado("homologacao_disponivel_para_testes");
  if (!liberada) return estado("producao_aguardando_liberacao");
  return estado("tef_operacional");
}

export function prepararInstalacaoCliente(input: {
  ambiente: "" | "homologacao" | "producao";
  empresaId: string;
  terminalId: string;
  confirmacao: string;
  connectorPresente: boolean;
  bibliotecaConferida: boolean;
  diretorioExclusivo: boolean;
  credenciaisDesteAmbiente: boolean;
  copiarOutroAmbiente: boolean;
  jaInstalado: boolean;
}) {
  const base = {
    executar: false as const,
    operacao: "PWOPER_INSTALL" as const,
    auditoria: {
      empresaId: input.empresaId,
      terminalId: input.terminalId,
      ambiente: input.ambiente,
    },
  };
  if (input.copiarOutroAmbiente) {
    return { ...base, codigo: "isolamento" as const, motivo: "Credenciais e arquivos de um ambiente não são copiados para o outro." };
  }
  if (input.ambiente !== "homologacao" && input.ambiente !== "producao") {
    return { ...base, codigo: "ambiente" as const, motivo: "O ambiente da instalação precisa ser escolhido. Produção não é o padrão." };
  }
  if (input.ambiente === "producao" && input.confirmacao !== CONFIRMACAO_INSTALACAO_PRODUCAO) {
    return { ...base, codigo: "confirmacao" as const, motivo: "A instalação de produção exige confirmação explícita." };
  }
  if (input.jaInstalado) {
    return { ...base, codigo: "reinstalacao" as const, motivo: "O ponto deste ambiente já está instalado. A reinstalação não foi iniciada." };
  }
  if (!input.connectorPresente || !input.bibliotecaConferida || !input.diretorioExclusivo || !input.credenciaisDesteAmbiente || !input.empresaId || !input.terminalId) {
    return { ...base, codigo: "preparo" as const, motivo: "Connector, biblioteca, diretório, credenciais, empresa ou terminal ainda não conferem." };
  }
  return {
    ...base,
    codigo: "pronto_sem_execucao" as const,
    motivo: "O preparo foi conferido. PWOPER_INSTALL não foi chamado.",
  };
}

export function prepararComprovantesTef(input: {
  status: string;
  pagamentoRecebido: boolean;
  transacaoConfirmada: boolean;
  viaEstabelecimento: string;
  viaCliente: string;
  vendaId: string;
  rede: string;
  quando: string;
}) {
  if (input.status !== "confirmada" || input.pagamentoRecebido !== true || input.transacaoConfirmada !== true) {
    return {
      imprimir: false as const,
      motivo: "Sem autorização confirmada. Nenhum comprovante foi impresso.",
    };
  }
  const estabelecimento = input.viaEstabelecimento.trim();
  const cliente = input.viaCliente.trim();
  if (!estabelecimento || !cliente || !input.vendaId || !input.rede || !input.quando) {
    return {
      imprimir: false as const,
      motivo: "A transação confirmada não trouxe as duas vias e as referências da venda.",
    };
  }
  return {
    imprimir: true as const,
    motivo: "",
    vias: [
      { destino: "estabelecimento" as const, texto: estabelecimento },
      { destino: "cliente" as const, texto: cliente },
    ],
  };
}
