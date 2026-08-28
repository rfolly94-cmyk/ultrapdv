import { ignorarEmpresaIdDoCliente } from "../contexto";

const CAMPOS_IDENTIDADE_PROIBIDOS = [
  "empresa_id",
  "empresaId",
  "usuario_id",
  "usuarioId",
  "user_id",
  "userId",
];

export function sanitizarTermoBuscaIa(valor: unknown, max = 80) {
  return String(valor ?? "")
    .replace(/[%_,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function chavesPermitidasDoSchema(schema: {
  properties?: Record<string, unknown>;
}) {
  return Object.keys(schema.properties ?? {});
}

export function sanitizarArgumentosFerramentaIa(
  bruto: Record<string, unknown>,
  permitidos: readonly string[]
) {
  const limpo = ignorarEmpresaIdDoCliente(bruto);
  const saida: Record<string, unknown> = {};
  const allow = new Set(permitidos);
  for (const [chave, valor] of Object.entries(limpo)) {
    if (CAMPOS_IDENTIDADE_PROIBIDOS.includes(chave)) {
      continue;
    }
    if (!allow.has(chave)) {
      continue;
    }
    saida[chave] = valor;
  }
  return saida;
}

export function argumentosTentaramEmpresaId(bruto: Record<string, unknown>) {
  return (
    "empresa_id" in bruto ||
    "empresaId" in bruto ||
    "usuario_id" in bruto ||
    "usuarioId" in bruto
  );
}
