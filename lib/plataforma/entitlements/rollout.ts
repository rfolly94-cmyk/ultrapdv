export const RECURSOS_COM_ENFORCEMENT = new Set<string>([
  "importador",
  "impressao_automatica",
  "relatorios",
  "contabilidade",
  "pix_integrado",
  "carteira",
  "produtos",
  "clientes",
  "estoque",
  "nfce",
  "nfe",
  "cce",
  "inutilizacao_fiscal",
  "vendas",
  "pdv",
  "catalogo",
  "caixa",
]);

export type ModoEntitlement = "off" | "observe" | "enforce";

export function recursoTemEnforcement(chave: string) {
  return RECURSOS_COM_ENFORCEMENT.has(String(chave ?? "").trim());
}

export function modoEntitlementDoRecurso(chave: string): ModoEntitlement {
  return recursoTemEnforcement(chave) ? "enforce" : "off";
}
