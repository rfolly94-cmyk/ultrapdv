import { ambienteInformado, digitosCnpj } from "@/lib/pdv/tef/assistente-instalacao";
import { validarServidorPayGo } from "@/lib/pdv/tef/servidor-paygo";

const PONTO = /^[A-Za-z0-9._-]{1,40}$/;

export type EfeitoInstalacaoControlada = "instalar" | "recusar" | "bloqueada";

export type DecisaoInstalacaoControlada = {
  efeito: EfeitoInstalacaoControlada;
  motivo: string;
};

export function instalacaoLocalMudou(input: {
  pontoAtual: string;
  ambienteAtual: string;
  servidorAtual: string;
  pontoNovo: string;
  ambienteNovo: string;
  servidorNovo: string;
}) {
  const pontoAtual = input.pontoAtual.trim();
  if (!pontoAtual) {
    return false;
  }
  const pontoNovo = input.pontoNovo.trim();
  const ambienteAtual = ambienteInformado(input.ambienteAtual);
  const ambienteNovo = ambienteInformado(input.ambienteNovo);
  const servidorAtual = input.servidorAtual.trim();
  const servidorNovo = input.servidorNovo.trim();
  return (
    (pontoNovo !== "" && pontoNovo !== pontoAtual) ||
    (ambienteAtual !== "" && ambienteNovo !== "" && ambienteNovo !== ambienteAtual) ||
    (servidorNovo !== "" && servidorNovo !== servidorAtual)
  );
}

export function decidirMigracaoPonto(input: {
  pontoAtual: string;
  ambienteAtual: string;
  servidorAtual: string;
  pontoNovo: string;
  ambienteNovo: string;
  servidorNovo: string;
  procedimentoOficialConfirmado: boolean;
  autorizacaoExplicitaReset: boolean;
}): DecisaoInstalacaoControlada & { necessario: boolean } {
  if (!instalacaoLocalMudou(input)) {
    return { necessario: false, efeito: "recusar", motivo: "" };
  }
  if (input.procedimentoOficialConfirmado && input.autorizacaoExplicitaReset) {
    return {
      necessario: true,
      efeito: "bloqueada",
      motivo:
        "A troca do ponto depende de reset. A PayGo ainda não publicou um procedimento que o UltraPDV possa executar. PWOPER_MAINTENANCE não será chamado.",
    };
  }
  return {
    necessario: true,
    efeito: "bloqueada",
    motivo:
      "Este computador já tem um ponto instalado. A troca de ponto, ambiente ou servidor permanece bloqueada até a PayGo confirmar o procedimento oficial e a autorização explícita. O UltraPDV não executa PWOPER_MAINTENANCE.",
  };
}

export function decidirInstalacaoControlada(input: {
  empresaSessaoId: string;
  empresaInformada: string;
  permissaoEditar: boolean;
  administrador: boolean;
  plataformaHabilitada: boolean;
  pendenciaFinanceira: boolean;
  confirmacaoExplicita: boolean;
  credencialInformada: boolean;
  pontoJaInstalado: boolean;
  procedimentoOficialConfirmado: boolean;
  autorizacaoExplicitaReset: boolean;
  pontoAtual: string;
  ambienteAtual: string;
  servidorAtual: string;
  pontoOficial: string;
  ambienteOficial: string;
  servidorOficial: string;
  cnpjEmpresa: string;
  estabelecimentoOficial: string;
  pontoVinculado: string;
  ambienteVinculado: string;
  servidorVinculado: string;
  dispositivoPareado: boolean;
  dispositivoOutraEmpresa: boolean;
}): DecisaoInstalacaoControlada {
  if (input.empresaInformada && input.empresaInformada !== input.empresaSessaoId) {
    return {
      efeito: "recusar",
      motivo: "A empresa da sessão não confere com a empresa informada.",
    };
  }
  if (!input.permissaoEditar || !input.administrador) {
    return {
      efeito: "recusar",
      motivo: "Somente um administrador com permissão de edição do financeiro pode instalar o TEF.",
    };
  }
  if (input.pendenciaFinanceira) {
    return {
      efeito: "recusar",
      motivo: "Há transação TEF pendente. A instalação fica bloqueada até a recuperação financeira.",
    };
  }
  if (!input.plataformaHabilitada) {
    return {
      efeito: "recusar",
      motivo: "A plataforma TEF não está habilitada para esta empresa.",
    };
  }
  const migracao = decidirMigracaoPonto({
    pontoAtual: input.pontoJaInstalado ? input.pontoAtual : "",
    ambienteAtual: input.ambienteAtual,
    servidorAtual: input.servidorAtual,
    pontoNovo: input.pontoOficial,
    ambienteNovo: input.ambienteOficial,
    servidorNovo: input.servidorOficial,
    procedimentoOficialConfirmado: input.procedimentoOficialConfirmado,
    autorizacaoExplicitaReset: input.autorizacaoExplicitaReset,
  });
  if (migracao.necessario) {
    return { efeito: "bloqueada", motivo: migracao.motivo };
  }
  if (input.pontoJaInstalado) {
    return {
      efeito: "recusar",
      motivo: "O ponto já está instalado. A instalação não será repetida e a empresa não será reativada.",
    };
  }
  if (!input.confirmacaoExplicita) {
    return {
      efeito: "recusar",
      motivo: "A instalação só começa depois da confirmação explícita.",
    };
  }
  if (!input.credencialInformada) {
    return {
      efeito: "recusar",
      motivo: "Informe a credencial técnica no momento da instalação. Ela não fica gravada.",
    };
  }
  const ambienteOficial = ambienteInformado(input.ambienteOficial);
  if (!ambienteOficial) {
    return { efeito: "recusar", motivo: "Informe o ambiente autorizado: homologação ou produção." };
  }
  if (
    input.ambienteVinculado &&
    ambienteInformado(input.ambienteVinculado) &&
    ambienteInformado(input.ambienteVinculado) !== ambienteOficial
  ) {
    return {
      efeito: "recusar",
      motivo: "O ambiente do vínculo deste computador diverge do ambiente oficial da empresa.",
    };
  }
  const servidor = validarServidorPayGo(input.servidorOficial);
  if (!servidor.ok) {
    return { efeito: "recusar", motivo: servidor.motivo };
  }
  if (
    input.servidorVinculado.trim() &&
    input.servidorVinculado.trim() !== servidor.servidor
  ) {
    return {
      efeito: "recusar",
      motivo: "O servidor vinculado a este computador diverge do servidor oficial da empresa.",
    };
  }
  if (digitosCnpj(input.cnpjEmpresa).length !== 14) {
    return { efeito: "recusar", motivo: "O cadastro da empresa não possui CNPJ." };
  }
  if (!PONTO.test(input.pontoOficial.trim())) {
    return { efeito: "recusar", motivo: "Informe o ponto de captura atribuído pelo PayGoWeb." };
  }
  if (
    input.pontoVinculado.trim() &&
    input.pontoVinculado.trim() !== input.pontoOficial.trim()
  ) {
    return {
      efeito: "recusar",
      motivo: "O ponto vinculado a este computador diverge do ponto oficial da empresa.",
    };
  }
  const estabelecimento = input.estabelecimentoOficial.trim();
  if (!estabelecimento || estabelecimento.length > 40) {
    return { efeito: "recusar", motivo: "Informe o estabelecimento informado pelo PayGoWeb." };
  }
  if (!input.dispositivoPareado || input.dispositivoOutraEmpresa) {
    return {
      efeito: "recusar",
      motivo: "Vincule este computador à empresa autenticada antes de instalar o ponto.",
    };
  }
  return {
    efeito: "instalar",
    motivo: "A instalação pode ser enviada ao Connector deste computador.",
  };
}

export function efeitoAposFalhaInstalacao() {
  return {
    ativaEmpresa: false,
    repetirAutomaticamente: false,
    preservaPendencia: true,
  };
}
