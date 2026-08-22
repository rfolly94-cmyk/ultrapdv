import { temAcessoModulo, temPermissao } from "@/lib/permissoes/tem-permissao";
import type { PermissoesEfetivas } from "@/lib/permissoes/tipos";

export function podeAcessarContabilidade(
  permissoes: PermissoesEfetivas | null | undefined
) {
  return temAcessoModulo(permissoes, "contabilidade");
}

export function podeLiberarCompetencia(
  permissoes: PermissoesEfetivas | null | undefined
) {
  return temPermissao(permissoes, "contabilidade", "fechamento");
}

export function podeGerarInventario(
  permissoes: PermissoesEfetivas | null | undefined
) {
  return temPermissao(permissoes, "contabilidade", "inventario");
}

export function ehContador(perfil: string) {
  return String(perfil ?? "").trim().toLowerCase() === "contador";
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
