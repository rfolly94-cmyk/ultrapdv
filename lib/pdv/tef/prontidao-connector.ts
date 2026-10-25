import type { PoliticaCartaoTef } from "@/lib/pdv/tef/cartao-checkout";

export const ESPERA_CONSULTA_TEF_MS = 12_000;

export const MENSAGEM_CONSULTA_TEF_TIMEOUT =
  "A consulta de disponibilidade do TEF excedeu 12 segundos. Nenhuma cobrança foi iniciada.";

export type ConsultaTefCheckout = {
  ok: boolean;
  habilitado: boolean;
  ambiente: "" | "homologacao" | "producao";
  empresaId: string | null;
  estabelecimento: string;
  pendencias: unknown[];
  politica: PoliticaCartaoTef;
};

export type ProntidaoConnector = {
  connectorHttp: boolean;
  pgwebLibPronta: boolean;
  pontoComprovado: boolean | null;
  pinpadNoStatus: null;
  podeEncaminharPgWeb: boolean;
  codigo: string;
  mensagem: string;
};

function texto(valor: unknown) {
  return typeof valor === "string" ? valor.trim() : "";
}

function registro(valor: unknown) {
  return valor && typeof valor === "object" ? (valor as Record<string, unknown>) : null;
}

export function interpretarConsultaTef(httpOk: boolean, dados: unknown): ConsultaTefCheckout {
  const corpo = registro(dados);
  const vazio: ConsultaTefCheckout = {
    ok: false,
    habilitado: false,
    ambiente: "",
    empresaId: null,
    estabelecimento: "",
    pendencias: [],
    politica: {
      plataformaHabilitada: false,
      empresaHabilitada: false,
      permitirOperacaoManual: false,
      ambiente: "",
    },
  };
  if (!httpOk || !corpo) return vazio;
  const ambiente =
    corpo.ambiente === "homologacao" || corpo.ambiente === "producao" ? corpo.ambiente : "";
  return {
    ok: true,
    habilitado: corpo.habilitado === true,
    ambiente,
    empresaId: typeof corpo.empresaId === "string" ? corpo.empresaId : null,
    estabelecimento: typeof corpo.estabelecimento === "string" ? corpo.estabelecimento : "",
    pendencias: Array.isArray(corpo.pendencias) ? corpo.pendencias : [],
    politica: {
      plataformaHabilitada: corpo.plataformaHabilitada === true,
      empresaHabilitada: corpo.empresaHabilitada === true,
      permitirOperacaoManual: corpo.permitirOperacaoManual === true,
      ambiente,
    },
  };
}

export function aguardarConsultaTef<T>(
  consulta: Promise<T>,
  timeoutMs = ESPERA_CONSULTA_TEF_MS
): Promise<{ ok: true; valor: T } | { ok: false; codigo: "timeout"; mensagem: string }> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<{ ok: false; codigo: "timeout"; mensagem: string }>((resolve) => {
    temporizador = setTimeout(() => {
      resolve({ ok: false, codigo: "timeout", mensagem: MENSAGEM_CONSULTA_TEF_TIMEOUT });
    }, timeoutMs);
  });
  return Promise.race([consulta.then((valor) => ({ ok: true as const, valor })), limite]).finally(() => {
    if (temporizador) clearTimeout(temporizador);
  });
}

/**
 * A prontidão da cobrança é o resultado real de `pgwebLib`, lido do arquivo
 * PGWebLib.dll x64 pelo Connector.
 */
export function classificarProntidaoConnector(tef: unknown): ProntidaoConnector {
  const corpo = registro(tef);
  const pgweb = registro(corpo?.pgwebLib);
  const biblioteca = registro(corpo?.biblioteca);
  const pgwebPronta = pgweb?.pronta === true;
  const ponto = biblioteca ? biblioteca.instalacaoPontoComprovada === true : null;
  const base = {
    connectorHttp: corpo != null,
    pgwebLibPronta: pgwebPronta,
    pontoComprovado: ponto,
    pinpadNoStatus: null as null,
  };
  if (!corpo) {
    return {
      ...base,
      podeEncaminharPgWeb: false,
      codigo: "status",
      mensagem: "O Connector não devolveu o status do TEF. Nenhuma cobrança foi iniciada.",
    };
  }
  if (pgwebPronta) {
    return {
      ...base,
      podeEncaminharPgWeb: true,
      codigo: "pgweb_pronta",
      mensagem: "",
    };
  }
  const causa = texto(pgweb?.mensagem);
  return {
    ...base,
    podeEncaminharPgWeb: false,
    codigo: "pgweblib",
    mensagem: pgweb
      ? causa || "A PGWebLib consultada pelo Connector não está pronta. Nenhuma cobrança foi iniciada."
      : "O Connector não informou pgwebLib. A PGWebLib.dll não foi consultada neste status. Nenhuma cobrança foi iniciada.",
  };
}

export function decidirInicializacaoPascal(tef: unknown) {
  if (!classificarProntidaoConnector(tef).podeEncaminharPgWeb) return "biblioteca" as const;
  return "pgweb_pronta" as const;
}

export function mensagemRecusaInicializacao(inicio: unknown) {
  const corpo = registro(inicio);
  const causa = texto(corpo?.mensagem) || texto(corpo?.erro);
  const codigo = texto(corpo?.codigo);
  if (!causa) return "O Connector TEF não está pronto.";
  return codigo ? `${codigo}: ${causa}` : causa;
}
