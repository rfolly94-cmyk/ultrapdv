const ROTAS_INTERNAS = [
  "/auth/confirm",
  "/nova-senha",
  "/confirmar-email",
  "/onboarding",
  "/painel",
  "/login",
] as const;

export function caminhoInternoSeguro(valor: unknown) {
  const caminho = String(valor ?? "").trim();

  if (!caminho.startsWith("/") || caminho.startsWith("//")) {
    return null;
  }

  if (caminho.includes("\\") || caminho.includes("://")) {
    return null;
  }

  const interrogacao = caminho.indexOf("?");
  const pathOnly =
    interrogacao === -1 ? caminho : caminho.slice(0, interrogacao);
  const query =
    interrogacao === -1 ? "" : caminho.slice(interrogacao + 1);

  if (query.includes("//")) {
    return null;
  }

  const permitido = ROTAS_INTERNAS.some((rota) => pathOnly === rota);
  return permitido ? caminho : null;
}

export function origemPublicaApp(requestUrl?: string) {
  const env = String(process.env.NEXT_PUBLIC_SITE_URL ?? "")
    .trim()
    .replace(/\/$/, "");

  if (env) {
    return env;
  }

  if (requestUrl) {
    return new URL(requestUrl).origin;
  }

  return "";
}

export function urlAbsolutaApp(caminho: string, requestUrl?: string) {
  const seguro = caminhoInternoSeguro(caminho);

  if (!seguro) {
    throw new Error("Destino de redirect inválido.");
  }

  const origem =
    origemPublicaApp(requestUrl) ||
    (process.env.NODE_ENV !== "production"
      ? "http://127.0.0.1:3000"
      : "");

  if (!origem) {
    throw new Error("NEXT_PUBLIC_SITE_URL não configurada.");
  }

  return `${origem}${seguro}`;
}
