import { hashSha256 } from "@/lib/fiscal/base-oficial/parser";

function ordenar(valor: unknown): unknown {
  if (Array.isArray(valor)) {
    return valor.map(ordenar);
  }
  if (valor && typeof valor === "object") {
    const saida: Record<string, unknown> = {};
    for (const chave of Object.keys(valor as Record<string, unknown>).sort()) {
      saida[chave] = ordenar((valor as Record<string, unknown>)[chave]);
    }
    return saida;
  }
  return valor ?? null;
}

export function hashEstadoEntidade(campos: Record<string, unknown>) {
  return hashSha256(JSON.stringify(ordenar(campos)));
}

export function estadosIguais(atual: string, esperado: string) {
  return atual === esperado;
}
