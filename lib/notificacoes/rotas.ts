import type { TipoNotificacao } from "./tipos";

export function chaveNotificacao(
  tipo: TipoNotificacao,
  entidadeId: string
) {
  return `${tipo}:${entidadeId}`;
}

const PREFIXOS_ACTION_URL = [
  "/produtos",
  "/estoque",
  "/clientes",
  "/vendas",
  "/fiscal",
  "/caixa",
  "/configuracoes/fiscal",
] as const;

export function hrefProdutoNotificacao(produtoId: string) {
  return `/produtos?editar=${encodeURIComponent(produtoId)}`;
}

export function hrefCarteiraNotificacao(clienteId: string) {
  return `/clientes/${encodeURIComponent(clienteId)}/carteira`;
}

export function hrefCaixaNotificacao() {
  return "/caixa";
}

export function hrefFiscalConfigNotificacao() {
  return "/configuracoes/fiscal";
}

export function hrefFiscalFallbackNotificacao() {
  return "/fiscal";
}

export function actionUrlSegura(url: string | null | undefined) {
  const limpo = String(url ?? "").trim();
  if (!limpo.startsWith("/") || limpo.startsWith("//") || limpo.includes("://")) {
    return null;
  }
  if (limpo.includes("\\") || limpo.includes("\n")) {
    return null;
  }

  const permitido = PREFIXOS_ACTION_URL.some(
    (prefixo) =>
      limpo === prefixo ||
      limpo.startsWith(`${prefixo}?`) ||
      limpo.startsWith(`${prefixo}/`)
  );
  return permitido ? limpo : null;
}
