import { createHash } from "node:crypto";

export function hashSha256(conteudo: string | Buffer) {
  return createHash("sha256").update(conteudo).digest("hex");
}

export function parseDataOficial(valor: unknown): string | null {
  const texto = String(valor ?? "").trim();
  const iso = texto.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso?.[1]) {
    return iso[1];
  }
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) {
    return `${br[3]}-${br[2]}-${br[1]}`;
  }
  return null;
}

export type NcmOficialParseado = {
  codigo: string;
  descricao: string;
  vigenciaInicio: string;
  vigenciaFim: string | null;
};

export function parsearNomenclaturaClassif(json: unknown): {
  versao: string;
  publicacao: string | null;
  itens: NcmOficialParseado[];
} {
  const raiz =
    json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  if (!raiz) {
    throw new Error("Arquivo NCM oficial inválido: JSON raiz ausente.");
  }
  const listaBruta = Array.isArray(raiz.Nomenclaturas)
    ? raiz.Nomenclaturas
    : Array.isArray(raiz.nomenclaturas)
      ? raiz.nomenclaturas
      : Array.isArray(raiz)
        ? raiz
        : null;
  if (!listaBruta) {
    throw new Error("Arquivo NCM oficial inválido: lista Nomenclaturas ausente.");
  }

  const publicacao =
    parseDataOficial(raiz.Data_Ultima_Atualizacao_NCM) ??
    parseDataOficial(raiz.data_ultima_atualizacao_ncm);
  const ato = String(raiz.Ato ?? raiz.ato ?? "").trim();
  const itens: NcmOficialParseado[] = [];

  for (const bruto of listaBruta) {
    if (!bruto || typeof bruto !== "object") {
      continue;
    }
    const row = bruto as Record<string, unknown>;
    const codigo = String(row.Codigo ?? row.codigo ?? "")
      .replace(/\D/g, "");
    const descricao = String(row.Descricao ?? row.descricao ?? "").trim();
    if (codigo.length !== 8 || !descricao) {
      continue;
    }
    const inicio =
      parseDataOficial(row.Data_Inicio ?? row.data_inicio) ?? "2017-01-01";
    const fimBruto = parseDataOficial(row.Data_Fim ?? row.data_fim);
    const fim = fimBruto && fimBruto.startsWith("9999") ? null : fimBruto;
    itens.push({
      codigo,
      descricao,
      vigenciaInicio: inicio,
      vigenciaFim: fim,
    });
  }

  if (itens.length === 0) {
    throw new Error("Arquivo NCM oficial inválido: nenhum código de 8 dígitos.");
  }

  const versao = ato || publicacao || `classif-${itens.length}`;
  return { versao, publicacao, itens };
}

export type CestOficialParseado = {
  codigo: string;
  descricao: string;
  ncm: string | null;
  segmento: string | null;
  vigenciaInicio: string;
  vigenciaFim: string | null;
};

export function parsearCestOficial(json: unknown): {
  versao: string;
  publicacao: string | null;
  itens: CestOficialParseado[];
} {
  const raiz =
    json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  if (!raiz) {
    throw new Error("Arquivo CEST oficial inválido.");
  }
  const lista = Array.isArray(raiz.itens)
    ? raiz.itens
    : Array.isArray(raiz.CEST)
      ? raiz.CEST
      : Array.isArray(raiz)
        ? raiz
        : null;
  if (!lista) {
    throw new Error("Arquivo CEST oficial inválido: lista de itens ausente.");
  }
  const versao = String(raiz.versao ?? raiz.convenio ?? "").trim();
  const publicacao = parseDataOficial(raiz.publicacao ?? raiz.data);
  const itens: CestOficialParseado[] = [];
  for (const bruto of lista) {
    if (!bruto || typeof bruto !== "object") {
      continue;
    }
    const row = bruto as Record<string, unknown>;
    const codigo = String(row.cest ?? row.CEST ?? row.codigo ?? "").replace(/\D/g, "");
    const descricao = String(row.descricao ?? row.Descricao ?? "").trim();
    const ncmBruto = String(row.ncm ?? row.NCM ?? "").replace(/\D/g, "");
    if (codigo.length !== 7 || !descricao) {
      continue;
    }
    itens.push({
      codigo,
      descricao,
      ncm: ncmBruto.length === 8 ? ncmBruto : null,
      segmento: row.segmento ? String(row.segmento) : null,
      vigenciaInicio:
        parseDataOficial(row.vigenciaInicio ?? row.vigencia_inicio) ??
        "2018-10-01",
      vigenciaFim: parseDataOficial(row.vigenciaFim ?? row.vigencia_fim),
    });
  }
  if (itens.length === 0) {
    throw new Error("Arquivo CEST oficial inválido: nenhum CEST de 7 dígitos.");
  }
  return {
    versao: versao || publicacao || `cest-${itens.length}`,
    publicacao,
    itens,
  };
}
