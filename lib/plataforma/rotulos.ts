export function rotuloProprietario(
  dono: { nome?: string | null } | null | undefined
) {
  if (!dono) {
    return "Não definido";
  }

  return String(dono.nome ?? "").trim() || "—";
}

export function rotuloEmailConfirmado(confirmado: boolean | null | undefined) {
  if (confirmado == null) {
    return "—";
  }
  return confirmado ? "Sim" : "Não";
}
