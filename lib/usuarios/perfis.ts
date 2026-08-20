/**
 * Perfis graváveis em public.usuarios_empresas.perfil.
 * Mesma convenção da constraint usuarios_empresas_perfil_valido: lowercase.
 */
export const PERFIS_USUARIO = [
  "administrador",
  "gerente",
  "vendedor",
  "caixa",
  "operador",
  "contador",
] as const;

export type PerfilUsuario =
  (typeof PERFIS_USUARIO)[number];

export const PERFIS_USUARIO_LABEL: Record<
  PerfilUsuario,
  string
> = {
  administrador: "Administrador",
  gerente: "Gerente",
  vendedor: "Vendedor",
  caixa: "Caixa",
  operador: "Operador",
  contador: "Contador",
};

export function perfilUsuarioValido(
  valor: unknown
): valor is PerfilUsuario {
  return PERFIS_USUARIO.includes(
    String(valor ?? "")
      .trim()
      .toLowerCase() as PerfilUsuario
  );
}
