import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

export type CamposProvaTef = {
  acao: "pagamento" | "confirmar" | "desfazer" | "identidade" | "pareamento";
  desafio: string;
  identificador: string;
  valorCentavos: number;
  nsu: string;
  autorizacao: string;
  rede: string;
  finalizacao: string;
  sucesso: boolean;
  codigo: string;
  bandeira?: string;
  cnpjCredenciadora?: string;
  cnpjRecebedor?: string;
  instituicao?: string;
};

export type DadosFiscaisProvaTef = {
  bandeira: string;
  cnpjCredenciadora: string;
  cnpjRecebedor: string;
  instituicao: string;
};

function campo(valor: string) {
  return String(valor ?? "").trim().replace(/[\r\n]/g, "");
}

function digitos(valor: string) {
  return campo(valor).replace(/\D/g, "");
}

/**
 * Bandeira vem de CARDNAMESTD ou CARDNAME.
 * O nome da rede não vira bandeira. CNPJ só entra com os dígitos recebidos.
 * Manter igual a print-agent/src/tef-prova.mjs.
 */
export function dadosFiscaisProvaTef(resultado: {
  nomeBandeiraPadrao?: string | null;
  nomeCartao?: string | null;
  bandeira?: string | null;
  rede?: string | null;
  cnpjCredenciadora?: string | null;
  cnpjRecebedor?: string | null;
  instituicao?: string | null;
} | null | undefined): DadosFiscaisProvaTef {
  const nomePadrao = campo(String(resultado?.nomeBandeiraPadrao ?? ""));
  const nomeCartao = campo(String(resultado?.nomeCartao ?? ""));
  const rede = campo(String(resultado?.rede ?? ""));
  const bandeiraAcbr = campo(String(resultado?.bandeira ?? ""));
  let bandeira = nomePadrao || nomeCartao;
  if (!bandeira && bandeiraAcbr && bandeiraAcbr.toUpperCase() !== rede.toUpperCase()) {
    bandeira = bandeiraAcbr;
  }
  return {
    bandeira,
    cnpjCredenciadora: digitos(String(resultado?.cnpjCredenciadora ?? "")),
    cnpjRecebedor: digitos(String(resultado?.cnpjRecebedor ?? "")),
    instituicao: campo(String(resultado?.instituicao ?? "")),
  };
}

export function mensagemProvaTef(campos: CamposProvaTef) {
  const linhas = [
    "ultrapdv-tef-v1",
    campo(campos.acao),
    campo(campos.desafio),
    campo(campos.identificador),
    String(Math.round(campos.valorCentavos)),
    campo(campos.nsu),
    campo(campos.autorizacao),
    campo(campos.rede),
    campo(campos.finalizacao),
    campos.sucesso ? "1" : "0",
    campo(campos.codigo),
  ];
  if (campos.acao === "pagamento") {
    linhas.push(
      campo(campos.bandeira ?? ""),
      digitos(campos.cnpjCredenciadora ?? ""),
      digitos(campos.cnpjRecebedor ?? ""),
      campo(campos.instituicao ?? "")
    );
  }
  return linhas.join("\n");
}

export function mensagemPareamentoTef(codigoHash: string, dispositivoId: string) {
  return mensagemProvaTef({
    acao: "pareamento",
    desafio: codigoHash,
    identificador: dispositivoId,
    valorCentavos: 0,
    nsu: "",
    autorizacao: "",
    rede: "",
    finalizacao: "",
    sucesso: true,
    codigo: "",
  });
}

export function mensagemIdentidadeTef(dispositivoId: string) {
  return mensagemProvaTef({
    acao: "identidade",
    desafio: "",
    identificador: dispositivoId,
    valorCentavos: 0,
    nsu: "",
    autorizacao: "",
    rede: "",
    finalizacao: "",
    sucesso: true,
    codigo: "",
  });
}

export type CamposAmbienteTef = {
  desafio: string;
  identificador: string;
  valorCentavos: number;
  nsu: string;
  autorizacao: string;
  rede: string;
  finalizacao: string;
  pontoCaptura: string;
  host: string;
  comprovanteSha256: string;
};

/**
 * Prova separada da mensagem ultrapdv-tef-v1.
 * Cobre host, ponto e hash do comprovante.
 * Manter igual a print-agent/src/tef-prova.mjs.
 */
export function mensagemAmbienteTef(campos: CamposAmbienteTef) {
  return [
    "ultrapdv-tef-ambiente-v1",
    campo(campos.desafio),
    campo(campos.identificador),
    String(Math.round(campos.valorCentavos)),
    campo(campos.nsu),
    campo(campos.autorizacao),
    campo(campos.rede),
    campo(campos.finalizacao),
    campo(campos.pontoCaptura),
    campo(campos.host),
    campo(campos.comprovanteSha256),
  ].join("\n");
}

export function verificarAmbienteTef(
  chavePublicaPem: string,
  campos: CamposAmbienteTef,
  prova: string
) {
  if (!chavePublicaPem || !prova) {
    return false;
  }
  try {
    const publica = createPublicKey(chavePublicaPem);
    return verify(
      null,
      Buffer.from(mensagemAmbienteTef(campos)),
      publica,
      Buffer.from(prova, "base64")
    );
  } catch {
    return false;
  }
}

export function assinarAmbienteTef(chavePrivadaPem: string, campos: CamposAmbienteTef) {
  const privada = createPrivateKey(chavePrivadaPem);
  return sign(null, Buffer.from(mensagemAmbienteTef(campos)), privada).toString("base64");
}

export type CamposModalidadeTef = {
  desafio: string;
  identificador: string;
  valorCentavos: number;
  nsu: string;
  autorizacao: string;
  tipoCartao: number | null;
};

/**
 * Prova separada da mensagem ultrapdv-tef-v1.
 * Cobre só o inteiro de PWINFO_CARDTYPE. Texto de comprovante não entra.
 * Manter igual a print-agent/src/tef-prova.mjs.
 */
export function mensagemModalidadeTef(campos: CamposModalidadeTef) {
  const tipo = campos.tipoCartao == null ? "" : String(campos.tipoCartao);
  return [
    "ultrapdv-tef-modalidade-v1",
    campo(campos.desafio),
    campo(campos.identificador),
    String(Math.round(campos.valorCentavos)),
    campo(campos.nsu),
    campo(campos.autorizacao),
    tipo,
  ].join("\n");
}

export function verificarModalidadeTef(
  chavePublicaPem: string,
  campos: CamposModalidadeTef,
  prova: string
) {
  if (!chavePublicaPem || !prova) {
    return false;
  }
  try {
    const publica = createPublicKey(chavePublicaPem);
    return verify(
      null,
      Buffer.from(mensagemModalidadeTef(campos)),
      publica,
      Buffer.from(prova, "base64")
    );
  } catch {
    return false;
  }
}

export function assinarModalidadeTef(chavePrivadaPem: string, campos: CamposModalidadeTef) {
  const privada = createPrivateKey(chavePrivadaPem);
  return sign(null, Buffer.from(mensagemModalidadeTef(campos)), privada).toString("base64");
}

export function hashSegredoVinculo(segredo: string) {
  return createHash("sha256").update(campo(segredo)).digest("hex");
}

export function verificarProvaTef(
  chavePublicaPem: string,
  campos: CamposProvaTef,
  prova: string
) {
  if (!chavePublicaPem || !prova) {
    return false;
  }
  try {
    const publica = createPublicKey(chavePublicaPem);
    return verify(
      null,
      Buffer.from(mensagemProvaTef(campos)),
      publica,
      Buffer.from(prova, "base64")
    );
  } catch {
    return false;
  }
}

export function assinarProvaTef(chavePrivadaPem: string, campos: CamposProvaTef) {
  const privada = createPrivateKey(chavePrivadaPem);
  return sign(null, Buffer.from(mensagemProvaTef(campos)), privada).toString("base64");
}

export function verificarIdentidadeTef(
  chavePublicaPem: string,
  dispositivoId: string,
  assinatura: string
) {
  return verificarProvaTef(
    chavePublicaPem,
    {
      acao: "identidade",
      desafio: "",
      identificador: dispositivoId,
      valorCentavos: 0,
      nsu: "",
      autorizacao: "",
      rede: "",
      finalizacao: "",
      sucesso: true,
      codigo: "",
    },
    assinatura
  );
}
