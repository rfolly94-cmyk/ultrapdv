export function rotaAdminPlataforma(pathname: string) {
  return (
    pathname === "/admin-plataforma" ||
    pathname.startsWith("/admin-plataforma/")
  );
}

export function decidirAcessoAdminPlataforma({
  usuarioId,
  autenticado,
  admin,
}: {
  usuarioId: string | null;
  autenticado: boolean;
  admin: { usuario_id: string; ativo: boolean } | null;
}): { ok: true } | { ok: false; status: 401 | 404 } {
  if (!autenticado || !usuarioId) {
    return { ok: false, status: 401 };
  }

  if (
    !admin ||
    !admin.ativo ||
    admin.usuario_id !== usuarioId
  ) {
    return { ok: false, status: 404 };
  }

  return { ok: true };
}
