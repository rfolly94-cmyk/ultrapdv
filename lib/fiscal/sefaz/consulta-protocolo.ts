import { Buffer } from "node:buffer";

import {
  decodificarArquivoFiscal,
  extrairChaveAcessoXml,
} from "@/lib/fiscal/documento-fiscal";
import { mensagemReconciliacaoInconclusiva } from "@/lib/fiscal/geranet/classificar-emissao";
import {
  montarAtualizacaoEmissao,
  type EmissaoParaConsulta,
  type SituacaoConsultaFiscal,
} from "@/lib/fiscal/geranet/classificar-consulta";
import {
  endpointConsultaProtocoloMt,
  SOAP_ACTION_NFE_CONSULTA_PROTOCOLO,
  UF_SEFAZ_MT,
} from "@/lib/fiscal/sefaz/endpoints-mt";

export const MENSAGEM_NFE_AUTORIZADA_SEFAZ =
  "NF-e localizada e autorizada na SEFAZ.";

export const MENSAGEM_NFE_AUTORIZADA_SEM_XML =
  "NF-e autorizada na SEFAZ. O protocolo foi recuperado, mas o XML processado ainda não está disponível.";

export const MENSAGEM_NFE_217_QUEBRA =
  "Esta NF-e não consta na SEFAZ e existe numeração posterior autorizada. A numeração pode ser inutilizada.";

export const MENSAGEM_CERTIFICADO_A1_AUSENTE =
  "Não foi possível consultar a SEFAZ porque o certificado A1 da empresa não está configurado. Nenhuma NF-e foi emitida. A numeração continua preservada.";

export const MENSAGEM_CERTIFICADO_A1_INVALIDO =
  "Falha no certificado A1 ao consultar a SEFAZ. Nenhuma NF-e foi emitida. A numeração continua preservada.";

const SITUACOES_GERANET_CONCLUSIVAS = new Set<SituacaoConsultaFiscal>([
  "autorizada",
  "rejeitada",
  "cancelada",
  "nao_existe",
]);

const CSTAT_DENEGADA = new Set(["110", "301", "302"]);

export type RetornoConsSitNFe = {
  tpAmb: string | null;
  verAplic: string | null;
  cStat: string | null;
  xMotivo: string | null;
  chNFe: string | null;
  nProt: string | null;
  dhRecbto: string | null;
  digVal: string | null;
  cStatProtocolo: string | null;
  xMotivoProtocolo: string | null;
  protNFe: string | null;
};

export type EntradaConsultaProtocolo = {
  chaveAcesso: string;
  ambiente: "1" | "2";
  modelo: "55" | "65";
  certificadoHex: string;
  senha: string;
  endpoint: string;
  soapAction: string;
  soap: string;
};

export function deveConsultarSefazDireta(params: {
  modelo: string;
  situacaoGeranet: SituacaoConsultaFiscal;
}) {
  return (
    params.modelo === "55" &&
    !SITUACOES_GERANET_CONCLUSIVAS.has(params.situacaoGeranet)
  );
}

export async function resolverFonteReconciliacao(params: {
  modelo: string;
  situacaoGeranet: SituacaoConsultaFiscal;
  consultarSefaz: () => Promise<void>;
}) {
  if (!deveConsultarSefazDireta(params)) {
    return "geranet" as const;
  }

  await params.consultarSefaz();
  return "sefaz_direta" as const;
}

function somenteDigitos(valor: unknown) {
  return String(valor ?? "").replace(/\D/g, "");
}

function tag(xml: string, nome: string) {
  const match = xml.match(
    new RegExp(`<(?:\\w+:)?${nome}[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${nome}>`, "i")
  );
  const valor = (match?.[1] ?? "").trim();
  return valor || null;
}

function elemento(xml: string, nome: string) {
  const match = xml.match(
    new RegExp(`<(?:\\w+:)?${nome}\\b[^>]*>[\\s\\S]*?<\\/(?:\\w+:)?${nome}>`, "i")
  );
  return match?.[0] ?? null;
}

export function xmlConsSitNFe(params: { tpAmb: "1" | "2"; chave: string }) {
  return (
    '<consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">' +
    `<tpAmb>${params.tpAmb}</tpAmb>` +
    "<xServ>CONSULTAR</xServ>" +
    `<chNFe>${params.chave}</chNFe>` +
    "</consSitNFe>"
  );
}

export function envelopeSoapConsultaProtocolo(dados: string) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    "<soap12:Body>" +
    '<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4">' +
    dados +
    "</nfeDadosMsg>" +
    "</soap12:Body>" +
    "</soap12:Envelope>"
  );
}

export function validarEntradaConsultaProtocolo(params: {
  chaveAcesso: string;
  ambiente: unknown;
  modelo: unknown;
  certificadoHex: string;
  senha: string;
}):
  | { ok: true; entrada: EntradaConsultaProtocolo }
  | { ok: false; falha: "validacao" | "certificado"; mensagem: string } {
  const chave = somenteDigitos(params.chaveAcesso);
  const ambiente = String(params.ambiente ?? "").trim();
  const modelo = String(params.modelo ?? "").trim();
  const certificadoHex = params.certificadoHex.replace(/\s/g, "");
  const senha = params.senha.trim();

  if (chave.length !== 44 || chave.slice(0, 2) !== UF_SEFAZ_MT) {
    return {
      ok: false,
      falha: "validacao",
      mensagem:
        "Não foi possível consultar a SEFAZ porque a chave da NF-e não está disponível para MT. Nenhuma NF-e foi emitida.",
    };
  }

  if (ambiente !== "1" && ambiente !== "2") {
    return {
      ok: false,
      falha: "validacao",
      mensagem:
        "Não foi possível consultar a SEFAZ porque o ambiente da emissão é inválido. Nenhuma NF-e foi emitida.",
    };
  }

  if (modelo !== "55" && modelo !== "65") {
    return {
      ok: false,
      falha: "validacao",
      mensagem:
        "Consulta direta à SEFAZ nesta reconciliação está disponível para NF-e modelo 55. Nenhuma NF-e foi emitida.",
    };
  }

  if (chave.slice(20, 22) !== modelo) {
    return {
      ok: false,
      falha: "validacao",
      mensagem:
        "A chave da NF-e não corresponde ao modelo da emissão. Nenhuma NF-e foi emitida.",
    };
  }

  if (
    !certificadoHex ||
    certificadoHex.length % 2 !== 0 ||
    !/^[0-9a-fA-F]+$/.test(certificadoHex) ||
    !senha
  ) {
    return {
      ok: false,
      falha: "certificado",
      mensagem: MENSAGEM_CERTIFICADO_A1_AUSENTE,
    };
  }

  const endpoint = endpointConsultaProtocoloMt({ modelo, ambiente });
  if (!endpoint || (modelo === "55" && endpoint.includes("nfcews"))) {
    return {
      ok: false,
      falha: "validacao",
      mensagem:
        "Não há endpoint de consulta de protocolo para este modelo e ambiente. Nenhuma NF-e foi emitida.",
    };
  }

  const dados = xmlConsSitNFe({ tpAmb: ambiente, chave });
  return {
    ok: true,
    entrada: {
      chaveAcesso: chave,
      ambiente,
      modelo,
      certificadoHex,
      senha,
      endpoint,
      soapAction: SOAP_ACTION_NFE_CONSULTA_PROTOCOLO,
      soap: envelopeSoapConsultaProtocolo(dados),
    },
  };
}

export function interpretarRetConsSitNFe(soap: string): RetornoConsSitNFe | null {
  const retorno = elemento(soap, "retConsSitNFe");
  if (!retorno) {
    return null;
  }

  const infProt = elemento(retorno, "infProt") ?? "";
  const procEvento = elemento(retorno, "procEventoNFe") ?? "";
  const cStat = somenteDigitos(tag(retorno, "cStat")).slice(0, 3) || null;
  const nProtInf = somenteDigitos(tag(infProt, "nProt"));
  const nProtEvento = somenteDigitos(tag(procEvento, "nProt"));
  const nProt =
    (cStat === "101" ? nProtEvento || nProtInf : nProtInf || nProtEvento) ||
    null;

  return {
    tpAmb: tag(retorno, "tpAmb"),
    verAplic: tag(retorno, "verAplic"),
    cStat,
    xMotivo: tag(retorno, "xMotivo"),
    chNFe: somenteDigitos(tag(retorno, "chNFe")) || null,
    nProt,
    dhRecbto: tag(infProt, "dhRecbto"),
    digVal: tag(infProt, "digVal"),
    cStatProtocolo: somenteDigitos(tag(infProt, "cStat")).slice(0, 3) || null,
    xMotivoProtocolo: tag(infProt, "xMotivo"),
    protNFe: elemento(retorno, "protNFe"),
  };
}

export function classificarFalhaConsultaSefaz(error: unknown, httpStatus = 0) {
  const codigo =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const mensagem = error instanceof Error ? error.message : String(error ?? "");
  const texto = `${codigo} ${mensagem}`;

  if (/senha|passphrase|pfx|BEGIN |certificado hexadecimal/i.test(texto)) {
    return {
      falha: "certificado" as const,
      erroTecnico: "sefaz_direta:certificado",
      mensagem: MENSAGEM_CERTIFICADO_A1_INVALIDO,
    };
  }

  if (/certificate|UNABLE_TO_|ERR_OSSL|mac verify|bad decrypt/i.test(texto)) {
    return {
      falha: "certificado" as const,
      erroTecnico: "sefaz_direta:certificado",
      mensagem: MENSAGEM_CERTIFICADO_A1_INVALIDO,
    };
  }

  if (/timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(texto)) {
    return {
      falha: "transporte" as const,
      erroTecnico: "sefaz_direta:timeout",
      mensagem: mensagemReconciliacaoInconclusiva("55"),
    };
  }

  if (/ENOTFOUND|EAI_AGAIN|Host not found|getaddrinfo/i.test(texto)) {
    return {
      falha: "transporte" as const,
      erroTecnico: "sefaz_direta:dns",
      mensagem: mensagemReconciliacaoInconclusiva("55"),
    };
  }

  if (httpStatus === 500 || httpStatus === 502 || httpStatus === 503 || httpStatus >= 500) {
    return {
      falha: "transporte" as const,
      erroTecnico: `sefaz_direta:http_${httpStatus || 500}`,
      mensagem: mensagemReconciliacaoInconclusiva("55"),
    };
  }

  return {
    falha: "soap" as const,
    erroTecnico: "sefaz_direta:soap",
    mensagem: mensagemReconciliacaoInconclusiva("55"),
  };
}

function situacaoDoCstat(cstat: string): SituacaoConsultaFiscal | "denegada" {
  if (cstat === "100" || cstat === "150") {
    return "autorizada";
  }
  if (cstat === "101") {
    return "cancelada";
  }
  if (cstat === "217") {
    return "nao_existe";
  }
  if (CSTAT_DENEGADA.has(cstat)) {
    return "denegada";
  }
  return "inconclusiva";
}

function xmlTexto(valor: string) {
  if (valor.startsWith("<")) {
    return valor;
  }

  const buffer = decodificarArquivoFiscal(valor, "xml");
  return buffer ? buffer.toString("utf8") : "";
}

export function montarNfeProcSeCompativel(params: {
  xmlArmazenado?: string | null;
  chave: string;
  protNFe?: string | null;
  protocolo?: string | null;
}) {
  const bruto = String(params.xmlArmazenado ?? "").trim();
  const armazenado = bruto ? xmlTexto(bruto) : "";
  const protNFe = params.protNFe ?? "";
  const chaveProt = somenteDigitos(tag(protNFe, "chNFe"));

  if (!armazenado) {
    return { xml: null as string | null, semXml: true, chaveDivergente: false };
  }

  const chaveXml = somenteDigitos(extrairChaveAcessoXml(armazenado));
  if (chaveXml.length === 44 && chaveXml !== params.chave) {
    return { xml: null, semXml: false, chaveDivergente: true };
  }

  if (chaveXml.length !== 44) {
    return { xml: null, semXml: false, chaveDivergente: true };
  }

  if (chaveProt && chaveProt !== params.chave) {
    return { xml: null, semXml: false, chaveDivergente: true };
  }

  const protocoloAtual = somenteDigitos(tag(armazenado, "nProt"));
  if (protocoloAtual && params.protocolo && protocoloAtual !== params.protocolo) {
    return { xml: null, semXml: false, chaveDivergente: false };
  }

  if (protocoloAtual) {
    return { xml: null, semXml: false, chaveDivergente: false };
  }

  const nfe = elemento(armazenado, "NFe");
  if (!nfe || !protNFe) {
    return { xml: null, semXml: false, chaveDivergente: false };
  }

  return {
    xml:
      '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">' +
      nfe +
      protNFe +
      "</nfeProc>",
    semXml: false,
    chaveDivergente: false,
  };
}

export function montarAtualizacaoConsultaSefaz(params: {
  emissao: EmissaoParaConsulta;
  retorno: RetornoConsSitNFe;
  origem: "manual" | "cron";
  posteriorAutorizada?: boolean;
}) {
  const chaveEmissao = somenteDigitos(params.emissao.chave_acesso);
  const chaveRetorno = somenteDigitos(params.retorno.chNFe);
  const ambienteEmissao = String(params.emissao.ambiente ?? "").trim();
  const respostaDeOutraChave =
    chaveRetorno.length === 44 &&
    chaveEmissao.length === 44 &&
    chaveRetorno !== chaveEmissao;
  const ambienteDivergente = Boolean(
    params.retorno.tpAmb &&
      ambienteEmissao &&
      params.retorno.tpAmb !== ambienteEmissao
  );
  const cstat =
    respostaDeOutraChave || ambienteDivergente ? "" : (params.retorno.cStat ?? "");
  const classe = situacaoDoCstat(cstat);
  const situacao: SituacaoConsultaFiscal =
    classe === "denegada" ? "rejeitada" : classe;
  const chave = chaveEmissao || chaveRetorno;
  const protocolo =
    respostaDeOutraChave || ambienteDivergente
      ? ""
      : somenteDigitos(params.retorno.nProt);
  const motivo =
    respostaDeOutraChave || ambienteDivergente
      ? ""
      : params.retorno.xMotivo || params.retorno.xMotivoProtocolo || "";
  const nfeProc = montarNfeProcSeCompativel({
    xmlArmazenado: params.emissao.xml_hex,
    chave,
    protNFe:
      respostaDeOutraChave || ambienteDivergente ? null : params.retorno.protNFe,
    protocolo,
  });
  const semXmlProcessado = classe === "autorizada" && nfeProc.semXml;

  let mensagem = motivo;
  if (classe === "autorizada") {
    mensagem = semXmlProcessado
      ? MENSAGEM_NFE_AUTORIZADA_SEM_XML
      : MENSAGEM_NFE_AUTORIZADA_SEFAZ;
  } else if (classe === "nao_existe" && params.posteriorAutorizada) {
    mensagem = MENSAGEM_NFE_217_QUEBRA;
  } else if (classe === "denegada") {
    mensagem =
      motivo ||
      "A SEFAZ registrou um estado fiscal definitivo para esta NF-e. A numeração não será retransmitida.";
  } else if (classe === "inconclusiva") {
    mensagem = mensagemReconciliacaoInconclusiva(params.emissao.modelo);
  } else if (classe === "cancelada") {
    mensagem = motivo || "Cancelamento de NF-e homologado.";
  } else if (classe === "nao_existe") {
    mensagem =
      motivo ||
      "NF-e não consta na base da SEFAZ. Nenhuma inutilização foi enviada.";
  }

  const atualizacao = montarAtualizacaoEmissao({
    emissao: params.emissao,
    situacao,
    log: {
      id: null,
      endpoint: "sefaz:NfeConsulta4",
      criado_em: params.retorno.dhRecbto,
      http_status: 200,
      sucesso: classe === "autorizada" || classe === "cancelada",
      chave,
      protocolo: protocolo || null,
      cstat,
      numero: null,
      situacao,
      mensagem: motivo || mensagem,
      xml: null,
      pdf: null,
      modelo: String(params.emissao.modelo),
      serie: null,
      ambiente: String(params.emissao.ambiente),
      codigo_numerico: null,
      numero_venda: null,
      contingencia: null,
    },
    origem: params.origem,
    posteriorAutorizada: params.posteriorAutorizada,
  });

  atualizacao.mensagem = mensagem;
  atualizacao.patch.motivo = mensagem;
  if (cstat) {
    atualizacao.patch.cstat = cstat;
  }

  const resumo = {
    ...(atualizacao.patch.resposta_resumo as Record<string, unknown>),
  };
  resumo.fonte_resultado = "sefaz_direta";
  resumo.origem_classificacao = "consulta_sefaz_direta";
  resumo.mensagem = mensagem;
  resumo.sefaz = {
    servico: "NfeConsulta4",
    tpAmb: params.retorno.tpAmb,
    verAplic: params.retorno.verAplic,
    cStat: cstat || null,
    xMotivo: motivo || null,
    nProt: protocolo || null,
    dhRecbto: params.retorno.dhRecbto,
    digVal: params.retorno.digVal,
    cStatProtocolo: params.retorno.cStatProtocolo,
  };

  if (classe === "autorizada") {
    resumo.xml_processado_disponivel = !semXmlProcessado;
    if (semXmlProcessado) {
      resumo.documento_autorizado_sem_xml = true;
    }
  }

  if (classe === "denegada") {
    resumo.estado_fiscal_definitivo = true;
    resumo.denegada = true;
    resumo.situacao_remota = "denegada";
    resumo.classificacao = "rejeitada";
  }

  if (classe === "inconclusiva") {
    resumo.situacao_remota = "inconclusiva";
    resumo.classificacao = "ambigua";
    atualizacao.patch.erro_comunicacao = mensagem;
  }

  atualizacao.patch.resposta_resumo = resumo;

  if (nfeProc.xml && !nfeProc.chaveDivergente) {
    atualizacao.patch.xml_hex = Buffer.from(nfeProc.xml, "utf8").toString("hex");
  } else {
    delete atualizacao.patch.xml_hex;
  }

  delete atualizacao.patch.geranet_log_id;
  delete atualizacao.patch.geranet_http_status;
  delete atualizacao.patch.geranet_situacao;

  return {
    atualizacao,
    situacao,
    classe,
    semXmlProcessado,
    chaveDivergente: nfeProc.chaveDivergente,
  };
}
