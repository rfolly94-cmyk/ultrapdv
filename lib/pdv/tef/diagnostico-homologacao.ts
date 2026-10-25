export const FUNCOES_DIAGNOSTICO_HOMOLOGACAO = [
  "LoadLibrary",
  "PW_iInit",
  "PW_iSetEnvironment",
  "PW_iPPCommTest",
  "PW_End",
] as const;

export const FUNCOES_BLOQUEADAS_DIAGNOSTICO = [
  "PW_iNewTransac",
  "PW_iExecTransac",
  "PW_iAddParam",
  "PW_iConfirmation",
  "PW_GetData",
] as const;

export const ENVRMNT_TEST = 1;
export const PORTA_DIAGNOSTICO_AUTOMATICA = 0;

export type PlanoDiagnosticoHomologacao = {
  motor: "pgweb";
  diretorioExclusivo: boolean;
  chamaPwInit: boolean;
  chamaSetEnvironment: boolean;
  ambienteBiblioteca: typeof ENVRMNT_TEST | null;
  porta: typeof PORTA_DIAGNOSTICO_AUTOMATICA;
  chamaInstalacao: false;
  chamaExecTransac: false;
  chamaAddParam: false;
  chamaConfirmation: false;
  funcoesPermitidas: readonly string[];
  funcoesBloqueadas: readonly string[];
  mensagem: string;
  observacao: string;
};

const OBSERVACAO =
  "PW_iSetEnvironment(ENVRMNT_TEST) só ocorre antes de PW_iInit e somente quando o ponto ainda não está instalado. PW_iPPCommTest recebe a porta 0 e a biblioteca devolve a COM. Com PWRET_OK e a porta identificada, o diagnóstico não chama PW_iPPEventLoop. Essa função permanece no ciclo de captura em andamento. O diagnóstico não chama PW_End. O Connector 1.3.19 não recebe este pedido. ABI_COMPROVADO e LAYOUT_HOMOLOGADO continuam falsos.";

export type MemoriaComunicacaoPinpad = {
  comunicacao: "confirmada";
  portaUtilizada: number | null;
  portaNome: string;
};

export type RetornoPinpadHomologacao = {
  ok?: boolean;
  codigo?: string;
  mensagem?: string;
  erro?: string;
  comunicacao?: string;
  porta?: number | null;
  portaNome?: string;
  identificacao?: string;
  fase?: string;
};

export type ExibicaoPinpadHomologacao = {
  identificacao: string;
  comunicacao: string;
  portaUtilizada: number | null;
  portaNome: string;
  mensagem: string;
  erro: boolean;
};

function portaInformada(porta: number | null | undefined) {
  return typeof porta === "number" && Number.isInteger(porta) && porta > 0 && porta < 255 ? porta : null;
}

function nomePorta(porta: number | null, portaNome?: string) {
  if (portaNome && /^COM\d+$/.test(portaNome)) {
    return portaNome;
  }
  return porta ? `COM${porta}` : "";
}

export function combinarDiagnosticoHomologacao(input: {
  acao: "identificar" | "testar";
  anterior: MemoriaComunicacaoPinpad | null;
  retorno: RetornoPinpadHomologacao;
}): { exibicao: ExibicaoPinpadHomologacao; memoria: MemoriaComunicacaoPinpad | null } {
  const consultaConcluida = input.retorno.ok === true && input.retorno.codigo === "PWRET_OK";
  const portaRetorno = portaInformada(input.retorno.porta);
  const nomeRetorno = nomePorta(portaRetorno, input.retorno.portaNome);
  const anteriorConfirmada = input.anterior?.comunicacao === "confirmada" ? input.anterior : null;

  if (input.acao === "identificar") {
    const retornoConfirma = consultaConcluida && input.retorno.comunicacao === "confirmada";
    const preservada = anteriorConfirmada ?? (retornoConfirma
      ? {
          comunicacao: "confirmada" as const,
          portaUtilizada: portaRetorno,
          portaNome: nomeRetorno || (portaRetorno ? `COM${portaRetorno}` : ""),
        }
      : null);
    const identificacao =
      input.retorno.identificacao ||
      (consultaConcluida
        ? "Identificação concluída. Esta consulta não testa a comunicação do PinPad."
        : input.retorno.mensagem || input.retorno.erro || "A identificação não foi concluída.");
    return {
      memoria: preservada,
      exibicao: {
        identificacao,
        comunicacao: preservada ? "confirmada" : consultaConcluida ? "nao_executada" : "",
        portaUtilizada: preservada?.portaUtilizada ?? null,
        portaNome: preservada?.portaNome ?? "",
        mensagem: !consultaConcluida
          ? identificacao
          : preservada
            ? `Identificação concluída. A comunicação permanece confirmada${preservada.portaNome ? ` em ${preservada.portaNome}` : ""}.`
            : "Identificação concluída. A comunicação do PinPad não foi testada nesta consulta.",
        erro: !consultaConcluida,
      },
    };
  }

  if (!consultaConcluida || input.retorno.comunicacao !== "confirmada") {
    return {
      memoria: null,
      exibicao: {
        identificacao: "",
        comunicacao: "",
        portaUtilizada: null,
        portaNome: "",
        mensagem: input.retorno.mensagem || input.retorno.erro || "O teste de comunicação não retornou PWRET_OK.",
        erro: true,
      },
    };
  }

  const memoria: MemoriaComunicacaoPinpad = {
    comunicacao: "confirmada",
    portaUtilizada: portaRetorno,
    portaNome: nomeRetorno || (portaRetorno ? `COM${portaRetorno}` : ""),
  };
  return {
    memoria,
    exibicao: {
      identificacao: "",
      comunicacao: "confirmada",
      portaUtilizada: memoria.portaUtilizada,
      portaNome: memoria.portaNome,
      mensagem:
        input.retorno.mensagem ||
        (memoria.portaNome
          ? `Pinpad conectado e comunicação confirmada. Porta utilizada ${memoria.portaNome}.`
          : "Pinpad conectado e comunicação confirmada."),
      erro: false,
    },
  };
}

export function planejarDiagnosticoHomologacao(input: {
  diretorio: string;
  pontoInstalado?: boolean;
}): PlanoDiagnosticoHomologacao {
  const diretorio = input.diretorio.trim().toLowerCase();
  const diretorioExclusivo =
    diretorio.length > 0 &&
    !diretorio.includes("producao") &&
    !diretorio.includes("\\paygo\\") &&
    diretorio.includes("homolog");
  const base = {
    motor: "pgweb" as const,
    porta: PORTA_DIAGNOSTICO_AUTOMATICA as typeof PORTA_DIAGNOSTICO_AUTOMATICA,
    chamaInstalacao: false as const,
    chamaExecTransac: false as const,
    chamaAddParam: false as const,
    chamaConfirmation: false as const,
    funcoesPermitidas: FUNCOES_DIAGNOSTICO_HOMOLOGACAO,
    funcoesBloqueadas: FUNCOES_BLOQUEADAS_DIAGNOSTICO,
    observacao: OBSERVACAO,
  };
  if (!diretorioExclusivo) {
    return {
      ...base,
      diretorioExclusivo: false,
      chamaPwInit: false,
      chamaSetEnvironment: false,
      ambienteBiblioteca: null,
      mensagem: "O diagnóstico de homologação recusou este diretório. A sessão de produção permanece como está.",
    };
  }
  return {
    ...base,
    diretorioExclusivo: true,
    chamaPwInit: true,
    chamaSetEnvironment: input.pontoInstalado !== true,
    ambienteBiblioteca: ENVRMNT_TEST,
    mensagem:
      "Ponto ainda não instalado: PW_iSetEnvironment(ENVRMNT_TEST) antes de PW_iInit, depois PW_iPPCommTest na porta automática. Ponto instalado: somente PW_iInit e o teste, sem PW_iSetEnvironment, sem PWOPER_INSTALL e sem PW_End.",
  };
}
