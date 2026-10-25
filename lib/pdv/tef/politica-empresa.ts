import type { SituacaoCredenciamento } from "@/lib/pdv/tef/credenciamento-comercial";

export type AmbienteTefEmpresa = "homologacao" | "producao";

export type EstadoTefEmpresa =
  | "nao_configurado"
  | "aguardando_instalacao"
  | "instalado_homologacao"
  | "aguardando_credenciamento_producao"
  | "producao_aguardando_validacao"
  | "producao_habilitada"
  | "erro_comunicacao"
  | "pendencia_financeira";

export type ConfiguracaoTefEmpresa = {
  existe: boolean;
  habilitado: boolean;
  ambiente: AmbienteTefEmpresa;
  producaoAutorizada: boolean;
  credenciamentoComprovado: boolean;
  referenciaCredenciamento: string;
  situacaoCredenciamento: SituacaoCredenciamento;
  comprovadoEm: string | null;
  servidorComercial: string;
  servidorComercialValidado: boolean;
};

export type SinaisTefEmpresa = {
  conectorRespondeu: boolean;
  pontoInstalado: boolean;
  pontoProducaoInstalado: boolean;
  pendenciaFinanceira: boolean;
  pinpadAprovado: boolean;
  credenciamentoProducao: boolean;
  servidorComercialValidado: boolean;
};

export type RequisitoProducao = {
  id: string;
  ok: boolean;
  texto: string;
};

export function requisitosProducao(sinais: SinaisTefEmpresa, autorizada: boolean): RequisitoProducao[] {
  return [
    { id: "credenciamento", ok: sinais.credenciamentoProducao, texto: "Credenciamento comercial da empresa no provedor" },
    { id: "servidor", ok: sinais.servidorComercialValidado, texto: "Servidor comercial de produção confirmado pela biblioteca" },
    { id: "ponto", ok: sinais.pontoProducaoInstalado, texto: "Ponto de produção instalado pela biblioteca, em diretório separado da homologação" },
    { id: "pinpad", ok: sinais.pinpadAprovado, texto: "Comunicação com o PinPad aprovada no ponto de produção" },
    { id: "pendencia", ok: !sinais.pendenciaFinanceira, texto: "Nenhuma pendência financeira impeditiva" },
    { id: "aprovacao", ok: autorizada, texto: "Aprovação explícita do administrador da empresa" },
  ];
}

export function decidirConfiguracaoProducao(input: {
  administrador: boolean;
  credenciamentoProducao: boolean;
  pendenciaFinanceira: boolean;
  servidorDeclarado: boolean;
}) {
  if (!input.administrador) {
    return { pode: false, mensagem: "Somente o administrador da empresa pode configurar o ponto de produção." };
  }
  if (!input.credenciamentoProducao) {
    return { pode: false, mensagem: "O credenciamento comercial desta empresa não está comprovado. A configuração não foi iniciada." };
  }
  if (!input.servidorDeclarado) {
    return { pode: false, mensagem: "Informe o servidor comercial de produção fornecido pela PayGo. A configuração não foi iniciada." };
  }
  if (input.pendenciaFinanceira) {
    return { pode: false, mensagem: "Há pendência financeira no ponto de produção. A configuração não foi iniciada." };
  }
  return { pode: true, mensagem: "" };
}

export function decidirInstalacaoProducao(input: {
  administrador: boolean;
  credenciamentoProducao: boolean;
  pendenciaFinanceira: boolean;
  servidorComercialValidado: boolean;
}) {
  if (!input.administrador) {
    return { pode: false, mensagem: "Somente o administrador da empresa pode instalar o ponto de produção." };
  }
  if (!input.credenciamentoProducao) {
    return { pode: false, mensagem: "O credenciamento comercial desta empresa não está comprovado. A instalação de produção não foi iniciada." };
  }
  if (!input.servidorComercialValidado) {
    return { pode: false, mensagem: "O servidor comercial de produção ainda não foi confirmado pela biblioteca. A instalação não foi iniciada." };
  }
  if (input.pendenciaFinanceira) {
    return { pode: false, mensagem: "Há pendência financeira no ponto de produção. A instalação não foi iniciada." };
  }
  return { pode: true, mensagem: "" };
}

export function decidirTestePinPadProducao(input: {
  administrador: boolean;
  autorizacaoExplicita: boolean;
  pontoProducaoInstalado: boolean;
  pendenciaFinanceira: boolean;
}) {
  if (!input.administrador || !input.autorizacaoExplicita) {
    return { pode: false, mensagem: "O teste do PinPad de produção exige autorização explícita do administrador." };
  }
  if (!input.pontoProducaoInstalado) {
    return { pode: false, mensagem: "O ponto de produção não está instalado. O teste não foi iniciado." };
  }
  if (input.pendenciaFinanceira) {
    return { pode: false, mensagem: "Há pendência financeira no ponto de produção. O teste não foi iniciado." };
  }
  return { pode: true, mensagem: "" };
}

export function producaoLiberada(sinais: SinaisTefEmpresa, autorizada: boolean) {
  return requisitosProducao(sinais, autorizada).every((item) => item.ok);
}

const REQUISITOS_ANTES_DA_AVALIACAO = ["credenciamento", "servidor", "ponto", "pinpad", "pendencia"];

export function podeConcluirAvaliacaoProducao(requisitos: RequisitoProducao[], administrador: boolean) {
  if (!administrador) return false;
  return REQUISITOS_ANTES_DA_AVALIACAO.every((id) => requisitos.some((item) => item.id === id && item.ok));
}

export function classificarEstadoTef(config: ConfiguracaoTefEmpresa | null, sinais: SinaisTefEmpresa): EstadoTefEmpresa {
  if (!sinais.conectorRespondeu) return "erro_comunicacao";
  if (sinais.pendenciaFinanceira) return "pendencia_financeira";
  if (!config?.existe) return "nao_configurado";
  if (config.ambiente === "producao") {
    if (producaoLiberada(sinais, config.producaoAutorizada)) return "producao_habilitada";
    if (!sinais.credenciamentoProducao) return "aguardando_credenciamento_producao";
    return "producao_aguardando_validacao";
  }
  if (!sinais.pontoInstalado) return "aguardando_instalacao";
  return "instalado_homologacao";
}

export function avaliarInicioCobranca(config: ConfiguracaoTefEmpresa | null, sinais: SinaisTefEmpresa) {
  if (!sinais.conectorRespondeu) {
    return { pode: false, mensagem: "O Connector local não respondeu. Nenhuma cobrança foi iniciada." };
  }
  if (sinais.pendenciaFinanceira) {
    return { pode: false, mensagem: "Há pendência financeira deste terminal. Nenhuma cobrança foi iniciada." };
  }
  if (!config?.existe) {
    return {
      pode: sinais.pontoInstalado,
      mensagem: sinais.pontoInstalado
        ? ""
        : "O ponto de homologação não está instalado. Nenhuma cobrança foi iniciada.",
    };
  }
  if (!config.habilitado) {
    return { pode: false, mensagem: "O TEF desta empresa está desabilitado. Nenhuma cobrança foi iniciada." };
  }
  if (config.ambiente === "producao") {
    const liberada = producaoLiberada(sinais, config.producaoAutorizada);
    return {
      pode: liberada,
      mensagem: liberada ? "" : "A produção TEF não está habilitada. Nenhuma cobrança foi iniciada.",
    };
  }
  if (!sinais.pontoInstalado) {
    return { pode: false, mensagem: "O ponto de homologação não está instalado. Nenhuma cobrança foi iniciada." };
  }
  return { pode: true, mensagem: "" };
}

export const ROTULOS_ESTADO_TEF: Record<EstadoTefEmpresa, string> = {
  nao_configurado: "Não configurado",
  aguardando_instalacao: "Aguardando instalação",
  instalado_homologacao: "Instalado em homologação",
  aguardando_credenciamento_producao: "Aguardando credenciamento de produção",
  producao_aguardando_validacao: "Produção configurada, aguardando validação",
  producao_habilitada: "Produção habilitada",
  erro_comunicacao: "Erro de comunicação",
  pendencia_financeira: "Pendência financeira impeditiva",
};
