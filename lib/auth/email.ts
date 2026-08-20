export function mascararEmail(email: string) {
  const valor = String(email ?? "")
    .trim()
    .toLowerCase();
  const partes = valor.split("@");

  if (partes.length !== 2 || !partes[0] || !partes[1]) {
    return "";
  }

  const local = partes[0];
  const visivel = local.slice(0, 1);
  return `${visivel}***@${partes[1]}`;
}

export function emailConfirmado(
  user: { email_confirmed_at?: string | null } | null | undefined
) {
  return Boolean(user?.email_confirmed_at);
}
