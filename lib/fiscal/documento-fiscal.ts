export type StatusDocumentoFiscal = string;

export type PlanoRecuperacaoPdf =
  | { acao: "usar_local" }
  | { acao: "usar_anexo_pdf" }
  | { acao: "gerar_pdf"; xml: "local" | "anexo" }
  | { acao: "erro"; motivo: string };

export function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

export function documentoPodeSerAberto(status: StatusDocumentoFiscal) {
  return status === "autorizada" || status === "cancelada";
}

export function pareceHex(valor: string) {
  const limpo = valor.startsWith("0x") ? valor.slice(2) : valor;
  return (
    limpo.length > 0 &&
    limpo.length % 2 === 0 &&
    /^[0-9a-f]+$/i.test(limpo)
  );
}

export function decodificarArquivoFiscal(
  valor: string,
  tipo: "xml" | "pdf"
): Buffer | null {
  const bruto = texto(valor);
  if (!bruto) {
    return null;
  }

  if (tipo === "xml" && bruto.startsWith("<")) {
    return Buffer.from(bruto, "utf8");
  }

  if (pareceHex(bruto)) {
    const limpo = bruto.startsWith("0x") ? bruto.slice(2) : bruto;
    const buffer = Buffer.from(limpo, "hex");
    if (tipo === "pdf" && bufferParecePdf(buffer)) {
      return buffer;
    }
    if (tipo === "xml" && bufferPareceXml(buffer)) {
      return buffer;
    }
  }

  if (
    bruto.length >= 8 &&
    bruto.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(bruto)
  ) {
    const buffer = Buffer.from(bruto, "base64");
    if (tipo === "pdf" && bufferParecePdf(buffer)) {
      return buffer;
    }
    if (tipo === "xml" && bufferPareceXml(buffer)) {
      return buffer;
    }
  }

  if (tipo === "xml" && bruto.includes("<")) {
    return Buffer.from(bruto, "utf8");
  }

  return null;
}

export function bufferParecePdf(buffer: Buffer) {
  return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

export function bufferPareceXml(buffer: Buffer) {
  return buffer.subarray(0, 256).toString("utf8").includes("<");
}

export function xmlPareceAutorizado(xml: string) {
  const bruto = texto(xml);
  if (!bruto.includes("<")) {
    return false;
  }

  const temNota = /<(?:\w+:)?(?:nfeProc|NFe|infNFe)\b/i.test(bruto);
  const soEvento =
    /<(?:\w+:)?(?:procEventoNFe|retEvento|infEvento)\b/i.test(bruto) &&
    !temNota;

  return temNota && !soEvento;
}

export function paraHex(buffer: Buffer) {
  return buffer.toString("hex");
}

const PLACEHOLDER_DOCUMENTO_FISCAL =
  /conte[uú]do omitido|consulte os anexos do log|placeholder/i;

export function documentoFiscalEhPlaceholder(valor: unknown) {
  const bruto = texto(valor);
  if (!bruto) {
    return false;
  }

  if (PLACEHOLDER_DOCUMENTO_FISCAL.test(bruto)) {
    return true;
  }

  if (pareceHex(bruto)) {
    const limpo = bruto.startsWith("0x") ? bruto.slice(2) : bruto;
    return PLACEHOLDER_DOCUMENTO_FISCAL.test(
      Buffer.from(limpo, "hex").toString("utf8")
    );
  }

  return false;
}

export function hexDocumentoFiscalPersistivel(
  valor: unknown,
  tipo: "xml" | "pdf"
): string | null {
  if (documentoFiscalEhPlaceholder(valor)) {
    return null;
  }

  const buffer = decodificarArquivoFiscal(texto(valor), tipo);
  if (!buffer) {
    return null;
  }

  if (
    tipo === "xml" &&
    PLACEHOLDER_DOCUMENTO_FISCAL.test(buffer.toString("utf8"))
  ) {
    return null;
  }

  return paraHex(buffer);
}

export function xmlParaEnvioGeranet(xmlArmazenado: string) {
  const buffer = decodificarArquivoFiscal(xmlArmazenado, "xml");
  if (!buffer) {
    return null;
  }

  const textoXml = buffer.toString("utf8");
  if (!xmlPareceAutorizado(textoXml)) {
    return null;
  }

  return pareceHex(texto(xmlArmazenado))
    ? texto(xmlArmazenado).replace(/^0x/i, "")
    : paraHex(buffer);
}

export function decidirRecuperacaoPdf({
  status,
  pdfLocal,
  xmlLocal,
  pdfAnexo,
  xmlAnexo,
}: {
  status: string;
  pdfLocal: boolean;
  xmlLocal: boolean;
  pdfAnexo: boolean;
  xmlAnexo: boolean;
}): PlanoRecuperacaoPdf {
  if (!documentoPodeSerAberto(status)) {
    return {
      acao: "erro",
      motivo:
        status === "rejeitada"
          ? "Não é possível gerar DANFE de documento rejeitado."
          : "Arquivo disponível somente para documento autorizado/cancelado.",
    };
  }

  if (pdfLocal) {
    return { acao: "usar_local" };
  }

  if (pdfAnexo) {
    return { acao: "usar_anexo_pdf" };
  }

  if (xmlLocal) {
    return { acao: "gerar_pdf", xml: "local" };
  }

  if (xmlAnexo) {
    return { acao: "gerar_pdf", xml: "anexo" };
  }

  return {
    acao: "erro",
    motivo:
      "Não foi possível recuperar o DANFE. O XML autorizado também não está disponível.",
  };
}

export function extrairChaveAcessoXml(
  xmlArmazenado: string | null | undefined
) {
  if (!xmlArmazenado) {
    return null;
  }

  const buffer = decodificarArquivoFiscal(xmlArmazenado, "xml");
  if (!buffer) {
    return null;
  }

  const xml = buffer.toString("utf8");
  const id = xml.match(/Id\s*=\s*"NFe(\d{44})"/i);
  if (id?.[1]) {
    return id[1];
  }

  const chNfe = xml.match(/<(?:\w+:)?chNFe>(\d{44})<\/(?:\w+:)?chNFe>/i);
  return chNfe?.[1] ?? null;
}
