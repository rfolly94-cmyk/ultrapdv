export function ultimoAdministradorFicariaIndefeso(input: {
  eraAdminAtivo: boolean;
  novoPerfil: string;
  novoAtivo: boolean;
  outrosAdminsAtivos: number;
}) {
  if (!input.eraAdminAtivo) {
    return false;
  }

  const permaneceAdminAtivo =
    String(input.novoPerfil).trim().toLowerCase() === "administrador" &&
    input.novoAtivo === true;

  if (permaneceAdminAtivo) {
    return false;
  }

  return input.outrosAdminsAtivos < 1;
}
