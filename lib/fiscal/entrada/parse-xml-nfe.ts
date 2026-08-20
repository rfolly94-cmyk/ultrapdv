import { extrairChaveAcessoXml } from "@/lib/fiscal/documento-fiscal";

export type ItemNfeEntradaXml = {
  numeroItem: number;
  codigoFornecedor: string;
  descricao: string;
  ean: string;
  ncm: string;
  cest: string;
  cfop: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  desconto: number;
  frete: number;
  dadosFiscais: Record<string, unknown>;
};

export type NfeEntradaXml = {
  chaveAcesso: string;
  modelo: string;
  serie: string;
  numero: string;
  dataEmissao: string | null;
  cnpjEmitente: string;
  razaoSocialEmitente: string;
  ieEmitente: string;
  cnpjDestinatario: string;
  valorProdutos: number;
  valorTotal: number;
  protocolo: string;
  itens: ItemNfeEntradaXml[];
};

const MENSAGEM_XML_INVALIDO =
  "O arquivo não é um XML de NF-e válido.";

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function somenteDigitos(valor: unknown) {
  return texto(valor).replace(/\D/g, "");
}

function numero(valor: unknown) {
  const bruto = texto(valor).replace(",", ".");
  const n = Number(bruto);
  return Number.isFinite(n) ? n : 0;
}

function tag(xml: string, nome: string) {
  const re = new RegExp(
    `<(?:[\\w.-]+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${nome}>`,
    "i"
  );
  return texto(re.exec(xml)?.[1] ?? "");
}

function attr(xml: string, nome: string) {
  const re = new RegExp(`\\b${nome}\\s*=\\s*"([^"]+)"`, "i");
  return texto(re.exec(xml)?.[1] ?? "");
}

function tags(xml: string, nome: string) {
  const re = new RegExp(
    `<(?:[\\w.-]+:)?${nome}\\b([^>]*)>([\\s\\S]*?)</(?:[\\w.-]+:)?${nome}>`,
    "gi"
  );
  const encontrados: Array<{ attrs: string; corpo: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    encontrados.push({
      attrs: match[1] ?? "",
      corpo: match[2] ?? "",
    });
  }
  return encontrados;
}

function chaveDeInfNfe(xml: string) {
  const inf = /<(?:[\w.-]+:)?infNFe\b([^>]*)>/i.exec(xml)?.[1] ?? "";
  const bruto = attr(inf, "Id");
  const chave = somenteDigitos(bruto.replace(/^NFe/i, ""));
  return chave.length === 44 ? chave : "";
}

export function parseXmlNfeEntrada(xmlBruto: string): NfeEntradaXml {
  const xml = texto(xmlBruto);
  if (/<(?:[\w.-]+:)?(?:procEventoNFe|retEvento)\b/i.test(xml) &&
      !/<(?:[\w.-]+:)?infNFe\b/i.test(xml)) {
    throw new Error("O XML é um evento, não uma NF-e de mercadoria.");
  }

  if (!xml.includes("<") || !/<(?:[\w.-]+:)?(?:nfeProc|NFe|infNFe)\b/i.test(xml)) {
    throw new Error(MENSAGEM_XML_INVALIDO);
  }

  const ide = tag(xml, "ide");
  const emit = tag(xml, "emit");
  const dest = tag(xml, "dest");
  const total = tag(xml, "ICMSTot") || tag(xml, "total");
  const prot = tag(xml, "infProt") || tag(xml, "protNFe");

  const chave =
    chaveDeInfNfe(xml) ||
    somenteDigitos(tag(prot, "chNFe")) ||
    extrairChaveAcessoXml(xml) ||
    "";

  if (chave.length !== 44) {
    throw new Error("A NF-e não possui chave de acesso de 44 dígitos.");
  }

  const cnpjEmitente = somenteDigitos(tag(emit, "CNPJ"));
  if (cnpjEmitente.length !== 14) {
    throw new Error("A NF-e não possui CNPJ do emitente.");
  }

  const modelo = texto(tag(ide, "mod")) || "55";
  if (modelo !== "55") {
    throw new Error("Somente NF-e modelo 55 pode ser importada como nota de entrada nesta etapa.");
  }

  const dets = tags(xml, "det");
  if (dets.length === 0) {
    throw new Error("A NF-e não possui itens.");
  }

  const itens = dets.map((det, indice) => {
    const prod = tag(det.corpo, "prod") || det.corpo;
    const imposto = tag(det.corpo, "imposto");
    const nItem = Number(attr(det.attrs, "nItem")) || indice + 1;
    const quantidade = numero(tag(prod, "qCom") || tag(prod, "qTrib"));

    return {
      numeroItem: nItem,
      codigoFornecedor: texto(tag(prod, "cProd")),
      descricao: texto(tag(prod, "xProd")) || "Item sem descrição",
      ean: somenteDigitos(tag(prod, "cEAN") || tag(prod, "cEANTrib")),
      ncm: somenteDigitos(tag(prod, "NCM")),
      cest: somenteDigitos(tag(prod, "CEST")),
      cfop: somenteDigitos(tag(prod, "CFOP")),
      unidade: texto(tag(prod, "uCom")).toUpperCase() || "UN",
      quantidade,
      valorUnitario: numero(tag(prod, "vUnCom")),
      valorTotal: numero(tag(prod, "vProd")),
      desconto: numero(tag(prod, "vDesc")),
      frete: numero(tag(prod, "vFrete")),
      dadosFiscais: {
        cProd: texto(tag(prod, "cProd")),
        xProd: texto(tag(prod, "xProd")),
        NCM: texto(tag(prod, "NCM")),
        CEST: texto(tag(prod, "CEST")),
        CFOP: texto(tag(prod, "CFOP")),
        uCom: texto(tag(prod, "uCom")),
        qCom: texto(tag(prod, "qCom")),
        vUnCom: texto(tag(prod, "vUnCom")),
        vProd: texto(tag(prod, "vProd")),
        vDesc: texto(tag(prod, "vDesc")),
        vFrete: texto(tag(prod, "vFrete")),
        imposto: imposto ? { xml: imposto.slice(0, 4000) } : null,
      },
    };
  });

  const dhEmi = texto(tag(ide, "dhEmi") || tag(ide, "dEmi"));

  return {
    chaveAcesso: chave,
    modelo,
    serie: texto(tag(ide, "serie")) || "1",
    numero: texto(tag(ide, "nNF")),
    dataEmissao: dhEmi || null,
    cnpjEmitente,
    razaoSocialEmitente: texto(tag(emit, "xNome")) || "Fornecedor",
    ieEmitente: texto(tag(emit, "IE")),
    cnpjDestinatario: somenteDigitos(tag(dest, "CNPJ") || tag(dest, "CPF")),
    valorProdutos: numero(tag(total, "vProd")),
    valorTotal: numero(tag(total, "vNF")),
    protocolo: texto(tag(prot, "nProt")),
    itens,
  };
}

export function destinatarioConfereComEmpresa(
  cnpjDestinatario: string,
  cnpjEmpresa: string
) {
  const dest = somenteDigitos(cnpjDestinatario);
  const empresa = somenteDigitos(cnpjEmpresa);
  if (!empresa || empresa.length !== 14) {
    return true;
  }
  return dest === empresa;
}

export type EnderecoEmitenteNfe = {
  cnpj: string;
  razaoSocial: string;
  ie: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  codigoMunicipio: string;
  uf: string;
  cep: string;
  telefone: string;
};

export function parseEmitenteNfeEntrada(xmlBruto: string): EnderecoEmitenteNfe {
  const xml = texto(xmlBruto);
  const emit = tag(xml, "emit");
  const ender = tag(emit, "enderEmit") || tag(xml, "enderEmit");

  return {
    cnpj: somenteDigitos(tag(emit, "CNPJ")),
    razaoSocial: texto(tag(emit, "xNome")),
    ie: texto(tag(emit, "IE")),
    logradouro: texto(tag(ender, "xLgr")),
    numero: texto(tag(ender, "nro")) || "S/N",
    complemento: texto(tag(ender, "xCpl")),
    bairro: texto(tag(ender, "xBairro")),
    municipio: texto(tag(ender, "xMun")),
    codigoMunicipio: somenteDigitos(tag(ender, "cMun")),
    uf: texto(tag(ender, "UF")).toUpperCase(),
    cep: somenteDigitos(tag(ender, "CEP")),
    telefone: somenteDigitos(tag(ender, "fone") || tag(emit, "fone")),
  };
}

const GRUPOS_ICMS_XML = [
  "ICMS00",
  "ICMS10",
  "ICMS20",
  "ICMS30",
  "ICMS40",
  "ICMS51",
  "ICMS60",
  "ICMS70",
  "ICMS90",
  "ICMSPart",
  "ICMSST",
  "ICMSSN101",
  "ICMSSN102",
  "ICMSSN103",
  "ICMSSN201",
  "ICMSSN202",
  "ICMSSN203",
  "ICMSSN300",
  "ICMSSN400",
  "ICMSSN500",
  "ICMSSN900",
] as const;

export type TributosOriginaisNfe = {
  origem: string;
  tipoGrupoIcms: string;
  cstOriginal: string;
  csosnOriginal: string;
  icmsCstCsosn: string;
  baseIcms: number;
  aliquotaIcms: number;
  valorIcms: number;
  baseIcmsSt: number;
  aliquotaIcmsSt: number;
  valorIcmsSt: number;
  valorFcp: number;
  valorFcpSt: number;
  pisCst: string;
  pisAliquota: number;
  cofinsCst: string;
  cofinsAliquota: number;
  ipiCst: string;
  ipiAliquota: number;
  ipiEnquadramento: string;
  pendencias: string[];
};

function primeiro(xml: string, nomes: string[]) {
  for (const nome of nomes) {
    const valor = texto(tag(xml, nome));
    if (valor) {
      return valor;
    }
  }
  return "";
}

function detectarGrupoIcms(icmsXml: string) {
  for (const grupo of GRUPOS_ICMS_XML) {
    const re = new RegExp(
      `<(?:[\\w.-]+:)?${grupo}\\b`,
      "i"
    );
    if (re.test(icmsXml)) {
      return grupo;
    }
  }
  return "";
}

export function parseTributosOriginaisNfe(
  impostoXml: string | null | undefined
): TributosOriginaisNfe {
  const xml = texto(impostoXml);
  const icms = tag(xml, "ICMS") || xml;
  const pis = tag(xml, "PIS") || xml;
  const cofins = tag(xml, "COFINS") || xml;
  const ipi = tag(xml, "IPI");
  const tipoGrupoIcms = detectarGrupoIcms(icms);

  const origem = somenteDigitos(primeiro(icms, ["orig"]));
  const csosnOriginal = somenteDigitos(primeiro(icms, ["CSOSN"]));
  const cstNoIcms = somenteDigitos(primeiro(icms, ["CST"]));
  const cstOriginal = tipoGrupoIcms.startsWith("ICMSSN") ? "" : cstNoIcms;
  const icmsCstCsosn = csosnOriginal || cstOriginal;
  const pisCst = somenteDigitos(primeiro(pis, ["CST"]));
  const cofinsCst = somenteDigitos(primeiro(cofins, ["CST"]));
  const ipiCst = somenteDigitos(primeiro(ipi, ["CST"]));
  const ipiEnquadramento = texto(primeiro(ipi, ["cEnq"]));

  const pendencias: string[] = [];
  if (!/^\d$/.test(origem)) {
    pendencias.push("Origem da mercadoria ausente no XML original.");
  }
  if (!csosnOriginal && !cstOriginal) {
    pendencias.push("CST ou CSOSN de ICMS ausente no XML original.");
  }
  if (!/^\d{2}$/.test(pisCst)) {
    pendencias.push("CST de PIS ausente no XML original.");
  }
  if (!/^\d{2}$/.test(cofinsCst)) {
    pendencias.push("CST de COFINS ausente no XML original.");
  }

  return {
    origem,
    tipoGrupoIcms,
    cstOriginal,
    csosnOriginal,
    icmsCstCsosn,
    baseIcms: numero(primeiro(icms, ["vBC"])),
    aliquotaIcms: numero(primeiro(icms, ["pICMS"])),
    valorIcms: numero(primeiro(icms, ["vICMS"])),
    baseIcmsSt: numero(primeiro(icms, ["vBCST"])),
    aliquotaIcmsSt: numero(primeiro(icms, ["pICMSST"])),
    valorIcmsSt: numero(primeiro(icms, ["vICMSST"])),
    valorFcp: numero(primeiro(icms, ["vFCP"])),
    valorFcpSt: numero(primeiro(icms, ["vFCPST"])),
    pisCst,
    pisAliquota: numero(primeiro(pis, ["pPIS"])),
    cofinsCst,
    cofinsAliquota: numero(primeiro(cofins, ["pCOFINS"])),
    ipiCst,
    ipiAliquota: numero(primeiro(ipi, ["pIPI"])),
    ipiEnquadramento,
    pendencias,
  };
}

export function impostoXmlDoSnapshot(dados: unknown) {
  if (!dados || typeof dados !== "object") {
    return "";
  }
  const bruto = dados as { imposto?: { xml?: unknown } };
  return texto(bruto.imposto?.xml);
}
