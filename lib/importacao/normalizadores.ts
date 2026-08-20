import { somenteDigitos } from "@/lib/fiscal/status-fiscal-produto";
import {
  UNIDADE_MEDIDA_PADRAO,
  normalizarUnidadeMedida,
  unidadeMedidaValida,
  type UnidadeMedida,
} from "@/lib/produtos/unidades-medida";

const ALIAS_UNIDADE: Record<string, UnidadeMedida> = {
  UN: "UN",
  UND: "UN",
  UNID: "UN",
  UNIDADE: "UN",
  PC: "PC",
  PÇ: "PC",
  PEC: "PC",
  PECA: "PC",
  PEÇA: "PC",
  CX: "CX",
  CAIXA: "CX",
  KG: "KG",
  KILO: "KG",
  KILOS: "KG",
  MT: "M",
  M: "M",
  METRO: "M",
  L: "L",
  LT: "LT",
  G: "G",
  ML: "ML",
};

export function textoCelula(valor: unknown) {
  if (valor == null) {
    return "";
  }
  if (typeof valor === "string") {
    return valor.replace(/\u00a0/g, " ").trim();
  }
  if (typeof valor === "number") {
    if (!Number.isFinite(valor)) {
      return "";
    }
    if (Number.isInteger(valor) || Math.abs(valor - Math.round(valor)) < 1e-9) {
      return String(Math.round(valor));
    }
    return String(valor);
  }
  if (typeof valor === "boolean") {
    return valor ? "1" : "0";
  }
  if (valor instanceof Date && !Number.isNaN(valor.getTime())) {
    return valor.toISOString();
  }
  return String(valor).trim();
}

export function normalizarChaveNome(valor: string) {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function normalizarEan(valor: unknown) {
  if (typeof valor === "number" && Number.isFinite(valor)) {
    if (Number.isInteger(valor) || Math.abs(valor - Math.round(valor)) < 1e-9) {
      return String(Math.round(valor));
    }
  }

  const texto = textoCelula(valor);
  const cientifico = /^([0-9]+(?:[.,][0-9]+)?)e\+?([0-9]+)$/i.exec(texto);
  if (!cientifico) {
    return texto;
  }

  const mantissa = (cientifico[1] ?? "0").replace(",", ".");
  const expoente = Number(cientifico[2] ?? "0");
  const [inteiro, fracao = ""] = mantissa.split(".");
  const digits = `${inteiro}${fracao}`;
  const casas = inteiro.length + expoente;
  if (!Number.isFinite(casas) || casas > 18 || casas < digits.length) {
    return texto;
  }

  return digits.padEnd(casas, "0");
}

export function normalizarNcm(valor: unknown) {
  const digitos = somenteDigitos(textoCelula(valor));
  return digitos;
}

export function normalizarDocumento(valor: unknown) {
  return somenteDigitos(textoCelula(valor));
}

export function normalizarTelefone(valor: unknown) {
  return somenteDigitos(textoCelula(valor));
}

export function normalizarEmail(valor: unknown) {
  return textoCelula(valor).toLowerCase();
}

export function parseMonetario(valor: unknown): number | null {
  let texto = textoCelula(valor);
  if (!texto) {
    return null;
  }

  texto = texto.replace(/R\$\s?/gi, "").replace(/\s/g, "");

  if (!texto || !/^[+-]?\d/.test(texto)) {
    return null;
  }

  if (texto.includes(".") && texto.includes(",")) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  } else if (texto.includes(",")) {
    texto = texto.replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(texto)) {
    texto = texto.replace(/\./g, "");
  }

  const numero = Number(texto);
  if (!Number.isFinite(numero)) {
    return null;
  }

  return numero;
}

export function parseQuantidade(valor: unknown): number | null {
  return parseMonetario(valor);
}

export function quantidadeEhInvalida(valor: unknown) {
  const texto = textoCelula(valor);
  if (!texto) {
    return { vazio: true, invalida: false as const, quantidade: null };
  }
  const quantidade = parseQuantidade(texto);
  if (quantidade === null || quantidade < 0) {
    return { vazio: false, invalida: true as const, quantidade: null };
  }
  return { vazio: false, invalida: false as const, quantidade };
}

export function formatarQuantidadeEstoque(valor: number) {
  if (!Number.isFinite(valor)) {
    return "0";
  }
  if (Number.isInteger(valor) || Math.abs(valor - Math.round(valor)) < 1e-9) {
    return String(Math.round(valor));
  }
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export function formatarAjusteEstoque(valor: number) {
  const texto = formatarQuantidadeEstoque(Math.abs(valor));
  if (valor > 0) {
    return `+${texto}`;
  }
  if (valor < 0) {
    return `-${texto}`;
  }
  return texto;
}

export function calcularAjusteEstoque(
  estoqueSistema: number,
  estoquePlanilha: number
) {
  const atual = Number.isFinite(estoqueSistema) ? estoqueSistema : 0;
  const desejado = Number.isFinite(estoquePlanilha) ? estoquePlanilha : 0;
  return {
    estoqueSistema: atual,
    estoquePlanilha: desejado,
    ajuste: desejado - atual,
    estoqueApos: desejado,
  };
}

export function normalizarUnidadeImportacao(valor: unknown) {
  const bruto = normalizarUnidadeMedida(textoCelula(valor)).replace(".", "");
  if (!bruto) {
    return UNIDADE_MEDIDA_PADRAO;
  }
  const alias = ALIAS_UNIDADE[bruto];
  if (alias) {
    return alias;
  }
  if (unidadeMedidaValida(bruto)) {
    return bruto as UnidadeMedida;
  }
  return null;
}

export function parseBooleano(valor: unknown): boolean | null {
  const texto = textoCelula(valor).toLowerCase();
  if (!texto) {
    return null;
  }
  if (["1", "s", "sim", "true", "verdadeiro", "ativo", "on"].includes(texto)) {
    return true;
  }
  if (["0", "n", "nao", "não", "false", "falso", "inativo", "off"].includes(texto)) {
    return false;
  }
  return null;
}

export function parseTipoPessoa(valor: unknown) {
  const texto = textoCelula(valor).toUpperCase();
  if (!texto) {
    return "";
  }
  if (["F", "PF", "FISICA", "FÍSICA", "CPF"].includes(texto)) {
    return "F";
  }
  if (["J", "PJ", "JURIDICA", "JURÍDICA", "CNPJ"].includes(texto)) {
    return "J";
  }
  return texto === "F" || texto === "J" ? texto : "";
}
