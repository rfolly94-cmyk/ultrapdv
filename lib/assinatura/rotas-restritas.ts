import { ehRotaPublicaIntencional } from "@/lib/auth/gate-rotas";

export function rotaMaster(pathname: string) {
  return pathname === "/master" || pathname.startsWith("/master/");
}

export function rotaAssinaturaEmpresa(pathname: string) {
  return pathname === "/assinatura" || pathname.startsWith("/assinatura/");
}

export function rotaLivreNoModoRestrito(pathname: string) {
  if (
    pathname === "/login" ||
    pathname === "/logout" ||
    pathname === "/acesso-negado" ||
    pathname === "/acesso-desativado" ||
    pathname.startsWith("/acesso-desativado/") ||
    pathname === "/assinatura" ||
    pathname.startsWith("/assinatura/") ||
    pathname === "/painel" ||
    pathname.startsWith("/painel/") ||
    pathname === "/configuracoes/empresa" ||
    pathname.startsWith("/configuracoes/empresa/") ||
    pathname.startsWith("/auth") ||
    rotaMaster(pathname) ||
    pathname === "/admin-plataforma" ||
    pathname.startsWith("/admin-plataforma/")
  ) {
    return true;
  }

  return false;
}

export function rotaOperacionalBloqueadaQuandoSuspensa(pathname: string) {
  if (rotaLivreNoModoRestrito(pathname)) {
    return false;
  }

  if (ehRotaPublicaIntencional(pathname)) {
    return false;
  }

  const prefixos = [
    "/pdv",
    "/caixa",
    "/produtos",
    "/clientes",
    "/estoque",
    "/cadastro",
    "/vendas",
    "/fiscal",
    "/contabilidade",
    "/relatorios",
    "/transportadoras",
    "/configuracoes/importar-dados",
    "/configuracoes/catalogo",
    "/configuracoes/financeiro",
    "/configuracoes/fiscal",
    "/configuracoes/caixa",
    "/api/",
  ];

  return prefixos.some(
    (prefixo) => pathname === prefixo || pathname.startsWith(prefixo)
  );
}
