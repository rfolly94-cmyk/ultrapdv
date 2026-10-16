import { createHash } from "node:crypto";

export type EfeitoAmbienteTransacao = "producao" | "homologacao" | "desconhecido";

export type DecisaoAmbientePagamento = {
  efeito: EfeitoAmbienteTransacao;
  fluxoTeste: boolean;
  motivo: string;
  diagnostico: string;
  proibirDesfazimento: boolean;
  ponto: string;
  host: string;
  hash: string;
};

const MARCADOR_SANDBOX =
  /AMBIENTE\s+SANDBOX|SEM\s+VALOR\s+FINANCEIRO|TRANSACAO\s+TESTE|TRANSA[CÇ][AÃ]O\s+TESTE|SIMULAD/i;

const HOST_SANDBOX = /tpgweb\.io|pos-transac-sb|sandbox|homolog/i;

export function juntarComprovante(via1: string, via2: string) {
  return `${String(via1 ?? "")}\n${String(via2 ?? "")}`;
}

export function normalizarComprovante(texto: string) {
  return String(texto ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .replace(/[ \t]+/g, " ")
    .toUpperCase();
}

export function hashComprovante(texto: string) {
  return createHash("sha256").update(normalizarComprovante(texto)).digest("hex");
}

export function normalizarHost(valor: string) {
  return String(valor ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
}

export function extrairPontoComprovante(texto: string) {
  const encontrado = String(texto ?? "").match(/PDC:\s*([A-Za-z0-9._-]{1,32})/i);
  return encontrado?.[1] ?? "";
}

function limitar(valor: string, maximo: number) {
  const texto = String(valor ?? "").trim();
  if (texto.length > maximo) {
    return "";
  }
  return texto;
}

export function classificarAmbienteTransacao(input: {
  comprovante: string;
  host: string;
  pontoCaptura: string;
  pontoOficial: string;
  hostOficial: string;
  assinaturaValida: boolean;
}) {
  const hash = input.assinaturaValida ? hashComprovante(input.comprovante) : "";
  if (!input.assinaturaValida) {
    return {
      efeito: "desconhecido" as const,
      motivo:
        "O Connector não assinou o host, o ponto e o comprovante desta transação.",
      ponto: "",
      host: "",
      hash: "",
    };
  }

  const pontoAssinado = limitar(input.pontoCaptura, 32);
  const pontoComprovante = extrairPontoComprovante(input.comprovante);
  const host = limitar(input.host, 120);
  const pontoOficial = limitar(input.pontoOficial, 32);
  const hostOficial = limitar(input.hostOficial, 120);
  if (pontoAssinado && pontoComprovante && pontoAssinado !== pontoComprovante) {
    return {
      efeito: "desconhecido" as const,
      motivo: "O ponto do comprovante não confere com o ponto assinado pelo Connector.",
      ponto: "",
      host: "",
      hash: "",
    };
  }
  const ponto = pontoAssinado || pontoComprovante;
  if (MARCADOR_SANDBOX.test(input.comprovante)) {
    return {
      efeito: "homologacao" as const,
      motivo: `O comprovante informa ambiente de teste, sem valor financeiro. Ponto ${ponto || "ausente"}. Host ${host || "ausente"}.`,
      ponto,
      host,
      hash,
    };
  }
  if (host && HOST_SANDBOX.test(host)) {
    return {
      efeito: "homologacao" as const,
      motivo: `O host utilizado é de homologação (${host}). Ponto ${ponto || "ausente"}.`,
      ponto,
      host,
      hash,
    };
  }
  if (!input.comprovante.trim() || !host || !ponto) {
    return {
      efeito: "desconhecido" as const,
      motivo: "Faltam host, ponto ou comprovante para comprovar que a transação é de produção.",
      ponto,
      host,
      hash,
    };
  }
  if (!pontoOficial || !hostOficial) {
    return {
      efeito: "desconhecido" as const,
      motivo:
        "O estabelecimento não tem ponto e servidor oficiais de produção para comparar com esta transação.",
      ponto,
      host,
      hash,
    };
  }
  if (ponto !== pontoOficial) {
    return {
      efeito: "homologacao" as const,
      motivo: `O ponto utilizado (${ponto}) não é o ponto oficial de produção (${pontoOficial}).`,
      ponto,
      host,
      hash,
    };
  }
  if (normalizarHost(host) !== normalizarHost(hostOficial)) {
    return {
      efeito: "homologacao" as const,
      motivo: `O host utilizado (${host}) não é o servidor de produção autorizado (${hostOficial}).`,
      ponto,
      host,
      hash,
    };
  }
  return {
    efeito: "producao" as const,
    motivo: "",
    ponto,
    host,
    hash,
  };
}

export function decidirEfeitoPagamento(input: {
  classificacao: EfeitoAmbienteTransacao;
  motivo: string;
  fluxoHomologacao: boolean;
  ponto: string;
  host: string;
  hash: string;
}): DecisaoAmbientePagamento {
  if (input.classificacao === "producao") {
    return {
      efeito: "producao",
      fluxoTeste: false,
      motivo: "",
      diagnostico: "",
      proibirDesfazimento: false,
      ponto: input.ponto,
      host: input.host,
      hash: input.hash,
    };
  }
  const motivo = input.motivo.slice(0, 240);
  if (input.classificacao === "homologacao" && input.fluxoHomologacao) {
    return {
      efeito: "homologacao",
      fluxoTeste: false,
      motivo,
      diagnostico: `${motivo} Homologação identificada. Nenhuma receita e nenhuma NFC-e de produção foram registradas. A confirmação permanece pendente até a reconciliação. Não cobre novamente.`,
      proibirDesfazimento: true,
      ponto: input.ponto,
      host: input.host,
      hash: input.hash,
    };
  }
  const diagnostico = `${motivo} A venda e a NFC-e não foram concluídas. Não cobre novamente. Abra Configurações, Financeiro, TEF para o diagnóstico do terminal.`;
  return {
    efeito: input.classificacao === "homologacao" ? "homologacao" : "desconhecido",
    fluxoTeste: false,
    motivo,
    diagnostico,
    proibirDesfazimento: true,
    ponto: input.ponto,
    host: input.host,
    hash: input.hash,
  };
}

export function origemProducaoComprovada(
  parcial: Partial<Pick<DecisaoAmbientePagamento, "ponto" | "host" | "hash">> = {}
): DecisaoAmbientePagamento {
  return decidirEfeitoPagamento({
    classificacao: "producao",
    motivo: "",
    fluxoHomologacao: false,
    ponto: parcial.ponto ?? "6696546",
    host: parcial.host ?? "pos-transac.pgweb.io:31735",
    hash: parcial.hash ?? "a".repeat(64),
  });
}

export function decidirPorEvidencia(input: {
  comprovante: string;
  host: string;
  pontoCaptura: string;
  pontoOficial: string;
  hostOficial: string;
  assinaturaValida: boolean;
  fluxoHomologacao: boolean;
}) {
  const classe = classificarAmbienteTransacao(input);
  return decidirEfeitoPagamento({
    classificacao: classe.efeito,
    motivo: classe.motivo,
    fluxoHomologacao: input.fluxoHomologacao,
    ponto: classe.ponto,
    host: classe.host,
    hash: classe.hash,
  });
}
