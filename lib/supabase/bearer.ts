export function extrairBearerAuthorization(valor: string | null | undefined) {
  const texto = String(valor ?? "").trim();
  const match = /^Bearer\s+(\S+)$/i.exec(texto);
  return match?.[1] ?? null;
}
