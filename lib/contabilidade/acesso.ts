export const PERFIS_CONTABILIDADE = [
  "administrador",
  "gerente",
  "contador",
] as const;

export function podeAcessarContabilidade(perfil: string) {
  return PERFIS_CONTABILIDADE.includes(
    perfil as (typeof PERFIS_CONTABILIDADE)[number]
  );
}

export function ehContador(perfil: string) {
  return perfil === "contador";
}

export function podeLiberarCompetencia(perfil: string) {
  return perfil === "administrador" || perfil === "gerente";
}

export function podeGerarInventario(perfil: string) {
  return perfil === "administrador" || perfil === "gerente";
}

export function podeOperarErp(perfil: string) {
  return !ehContador(perfil);
}

export const ROTAS_LIVRES_CONTADOR = [
  "/contabilidade",
  "/login",
  "/logout",
  "/cadastro",
  "/onboarding",
  "/confirmar-email",
  "/recuperar-senha",
  "/nova-senha",
  "/auth",
  "/admin-plataforma",
];

export function rotaPermitidaContador(pathname: string) {
  if (
    ROTAS_LIVRES_CONTADOR.some(
      (rota) => pathname === rota || pathname.startsWith(`${rota}/`)
    )
  ) {
    return true;
  }

  if (pathname.startsWith("/api/contabilidade")) {
    return true;
  }

  if (/^\/api\/fiscal\/emissoes\/[^/]+\/arquivo\/?$/.test(pathname)) {
    return true;
  }

  if (/^\/api\/fiscal\/eventos\/[^/]+\/arquivo\/?$/.test(pathname)) {
    return true;
  }

  if (/^\/api\/fiscal\/emissoes\/[^/]+\/reconciliar\/?$/.test(pathname)) {
    return true;
  }

  return false;
}
