import {
  CAMPOS_FILTRO_ANALITICO,
  OPERADORES_FILTRO_ANALITICO,
  type CampoFiltroAnalitico,
  type FiltroAnalitico,
  type OperadorFiltroAnalitico,
} from "./tipos";

export function campoFiltroAnalitico(valor: unknown): CampoFiltroAnalitico | null {
  const texto = String(valor ?? "");
  return (CAMPOS_FILTRO_ANALITICO as readonly string[]).includes(texto)
    ? (texto as CampoFiltroAnalitico)
    : null;
}

export function operadorFiltroAnalitico(valor: unknown): OperadorFiltroAnalitico | null {
  const texto = String(valor ?? "");
  return (OPERADORES_FILTRO_ANALITICO as readonly string[]).includes(texto)
    ? (texto as OperadorFiltroAnalitico)
    : null;
}

export function valorFiltroEhSeguro(valor: unknown): boolean {
  if (typeof valor === "boolean" || typeof valor === "number") {
    return Number.isFinite(valor as number) || typeof valor === "boolean";
  }
  if (typeof valor === "string") {
    if (valor.length > 80) {
      return false;
    }
    return !/[;'"]|--|\/\*|\b(select|insert|update|delete|drop|from|join)\b/i.test(
      valor
    );
  }
  if (Array.isArray(valor)) {
    return valor.length <= 40 && valor.every((item) => valorFiltroEhSeguro(item));
  }
  return false;
}

export function idsDoFiltro(filtros: FiltroAnalitico[], campo: CampoFiltroAnalitico) {
  const saida: string[] = [];
  for (const filtro of filtros) {
    if (filtro.campo !== campo) {
      continue;
    }
    const bruto = filtro.valor;
    if (Array.isArray(bruto)) {
      saida.push(...bruto.map((item) => String(item)));
    } else {
      saida.push(String(bruto));
    }
  }
  return saida.filter(Boolean);
}

export function compararFiltro(
  atual: number | string | boolean | null | undefined,
  operador: OperadorFiltroAnalitico,
  esperado: string | number | boolean | Array<string | number>
) {
  if (operador === "in") {
    const lista = Array.isArray(esperado) ? esperado.map(String) : [String(esperado)];
    return lista.includes(String(atual ?? ""));
  }
  if (typeof esperado === "boolean" || typeof atual === "boolean") {
    const a = Boolean(atual);
    const b = Boolean(esperado);
    if (operador === "eq") return a === b;
    if (operador === "neq") return a !== b;
    return false;
  }
  const a = typeof atual === "string" && !Number.isFinite(Number(atual))
    ? atual
    : Number(atual ?? 0);
  const b = typeof esperado === "string" && !Number.isFinite(Number(esperado))
    ? esperado
    : Number(esperado);
  if (typeof a === "string" || typeof b === "string") {
    if (operador === "eq") return String(a) === String(b);
    if (operador === "neq") return String(a) !== String(b);
    return false;
  }
  if (operador === "eq") return a === b;
  if (operador === "neq") return a !== b;
  if (operador === "gt") return a > b;
  if (operador === "gte") return a >= b;
  if (operador === "lt") return a < b;
  if (operador === "lte") return a <= b;
  return false;
}
