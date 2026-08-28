const PREFIXOS = [
  "/produtos",
  "/estoque",
  "/clientes",
  "/vendas",
  "/fiscal",
  "/caixa",
  "/configuracoes/fiscal",
  "/relatorios",
] as const;

export function hrefSeguroAssistente(url: string | null | undefined) {
  const limpo = String(url ?? "").trim();
  if (!limpo.startsWith("/") || limpo.startsWith("//") || limpo.includes("://")) {
    return null;
  }
  if (limpo.includes("\\") || limpo.includes("\n")) {
    return null;
  }
  const permitido = PREFIXOS.some(
    (prefixo) =>
      limpo === prefixo ||
      limpo.startsWith(`${prefixo}?`) ||
      limpo.startsWith(`${prefixo}/`)
  );
  return permitido ? limpo : null;
}

export function hrefProdutoAssistente(produtoId: string) {
  return `/produtos?editar=${encodeURIComponent(produtoId)}`;
}

export function hrefVendaAssistente(vendaId: string) {
  return `/vendas/${encodeURIComponent(vendaId)}`;
}

export function hrefClienteAssistente(clienteId: string) {
  return `/clientes/${encodeURIComponent(clienteId)}`;
}

export function hrefCarteiraAssistente(clienteId: string) {
  return `/clientes/${encodeURIComponent(clienteId)}/carteira`;
}

export function hrefCaixaAssistente() {
  return "/caixa";
}

export function hrefFiscalAssistente() {
  return "/fiscal";
}

export function hrefNotificacoesAssistente() {
  return "/configuracoes/notificacoes";
}
