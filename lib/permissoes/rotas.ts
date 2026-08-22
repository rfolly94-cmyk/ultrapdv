import type { PermissoesEfetivas } from "./tipos";
import { temAcessoModulo, temPermissao } from "./tem-permissao";

export const ROTAS_LIVRES_PERMISSAO = [
  "/",
  "/login",
  "/logout",
  "/cadastro",
  "/onboarding",
  "/confirmar-email",
  "/recuperar-senha",
  "/nova-senha",
  "/acesso-negado",
];

export const PREFIXOS_LIVRES_PERMISSAO = [
  "/auth",
  "/admin-plataforma",
  "/catalogo",
  "/master",
];

export type ExigenciaRota =
  | { tipo: "livre" }
  | { tipo: "autenticado" }
  | { tipo: "permissao"; modulo: keyof PermissoesEfetivas; acao: string };

const PREFIXOS_AUTENTICADOS = ["/api/auth"];

export function rotaLivrePermissao(pathname: string) {
  if (ROTAS_LIVRES_PERMISSAO.includes(pathname)) {
    return true;
  }

  return PREFIXOS_LIVRES_PERMISSAO.some(
    (prefixo) => pathname === prefixo || pathname.startsWith(`${prefixo}/`)
  );
}

export function resolverExigenciaRota(
  pathname: string,
  method = "GET"
): ExigenciaRota {
  if (rotaLivrePermissao(pathname)) {
    return { tipo: "livre" };
  }

  if (
    PREFIXOS_AUTENTICADOS.some(
      (prefixo) => pathname === prefixo || pathname.startsWith(`${prefixo}/`)
    )
  ) {
    return { tipo: "autenticado" };
  }

  const metodo = method.toUpperCase();

  if (pathname.startsWith("/api/relatorios/exportar")) {
    return { tipo: "permissao", modulo: "relatorios", acao: "exportar" };
  }

  if (
    pathname.startsWith("/api/impressao/carteira-abertos")
  ) {
    return {
      tipo: "permissao",
      modulo: "clientes",
      acao: "acessar_carteira",
    };
  }

  if (
    pathname.startsWith("/relatorios") ||
    pathname.startsWith("/api/impressao/relatorio")
  ) {
    return { tipo: "permissao", modulo: "relatorios", acao: "acessar" };
  }

  if (pathname === "/assinatura" || pathname.startsWith("/assinatura/")) {
    return { tipo: "autenticado" };
  }

  if (pathname === "/painel" || pathname.startsWith("/painel/")) {
    return { tipo: "permissao", modulo: "inicio", acao: "acessar" };
  }

  if (pathname.startsWith("/pdv")) {
    return { tipo: "permissao", modulo: "pdv", acao: "acessar" };
  }

  if (
    pathname.startsWith("/clientes/") &&
    pathname.includes("/carteira")
  ) {
    return {
      tipo: "permissao",
      modulo: "clientes",
      acao: "acessar_carteira",
    };
  }

  if (
    pathname.startsWith("/api/clientes/") &&
    pathname.includes("/carteira/cancelar-itens")
  ) {
    return {
      tipo: "permissao",
      modulo: "vendas",
      acao: "cancelar",
    };
  }

  if (
    pathname.startsWith("/api/clientes/") &&
    pathname.includes("/carteira/estornar-recebimento")
  ) {
    return {
      tipo: "permissao",
      modulo: "clientes",
      acao: "receber_carteira",
    };
  }

  if (
    pathname.startsWith("/api/clientes/") &&
    pathname.includes("/carteira/receber")
  ) {
    return {
      tipo: "permissao",
      modulo: "clientes",
      acao: "receber_carteira",
    };
  }

  if (pathname.startsWith("/clientes")) {
    return { tipo: "permissao", modulo: "clientes", acao: "acessar" };
  }

  if (pathname.startsWith("/produtos") || pathname.startsWith("/cadastro") || pathname.startsWith("/categorias") || pathname.startsWith("/marcas")) {
    return { tipo: "permissao", modulo: "produtos", acao: "acessar" };
  }

  if (
    pathname.startsWith("/estoque") ||
    pathname.startsWith("/app/estoque") ||
    pathname.startsWith("/fiscal/entradas")
  ) {
    return { tipo: "permissao", modulo: "estoque", acao: "acessar" };
  }

  if (pathname.startsWith("/api/contabilidade/zip")) {
    return { tipo: "permissao", modulo: "contabilidade", acao: "baixar_xml" };
  }

  if (pathname.startsWith("/api/contabilidade/relatorio")) {
    return { tipo: "permissao", modulo: "contabilidade", acao: "relatorios" };
  }

  if (
    pathname.startsWith("/contabilidade") ||
    pathname.startsWith("/api/contabilidade")
  ) {
    return { tipo: "permissao", modulo: "contabilidade", acao: "acessar" };
  }

  if (pathname.startsWith("/vendas/pedidos")) {
    return { tipo: "permissao", modulo: "catalogo", acao: "pedidos" };
  }

  if (pathname.startsWith("/vendas/") && pathname.endsWith("/nfe")) {
    return { tipo: "permissao", modulo: "fiscal", acao: "emitir_nfe" };
  }

  if (pathname.startsWith("/vendas/") && pathname.endsWith("/nfce")) {
    return { tipo: "permissao", modulo: "fiscal", acao: "emitir_nfce" };
  }

  if (pathname.startsWith("/vendas")) {
    return { tipo: "permissao", modulo: "vendas", acao: "acessar" };
  }

  if (pathname.startsWith("/fiscal/nfe") || pathname.startsWith("/fiscal")) {
    return { tipo: "permissao", modulo: "fiscal", acao: "acessar" };
  }

  if (pathname.startsWith("/configuracoes/usuarios") || pathname.startsWith("/api/configuracoes/usuarios")) {
    if (metodo === "POST") {
      return { tipo: "permissao", modulo: "usuarios", acao: "criar" };
    }
    if (metodo === "PATCH" || metodo === "PUT" || metodo === "DELETE") {
      return { tipo: "permissao", modulo: "usuarios", acao: "editar" };
    }
    return { tipo: "permissao", modulo: "usuarios", acao: "acessar" };
  }

  if (pathname.startsWith("/configuracoes/financeiro") || pathname.startsWith("/api/pagamentos/pix")) {
    return { tipo: "permissao", modulo: "financeiro", acao: "configurar_pix" };
  }

  if (pathname.startsWith("/configuracoes/catalogo")) {
    return { tipo: "permissao", modulo: "catalogo", acao: "configurar" };
  }

  if (pathname.startsWith("/configuracoes/importar-dados")) {
    return { tipo: "permissao", modulo: "importacao_dados", acao: "acessar" };
  }

  if (
    pathname.startsWith("/configuracoes/impressao") ||
    pathname.startsWith("/api/impressao")
  ) {
    return { tipo: "permissao", modulo: "configuracoes", acao: "acessar" };
  }

  if (pathname.startsWith("/configuracoes/empresa")) {
    return { tipo: "permissao", modulo: "configuracoes", acao: "editar_empresa" };
  }

  if (pathname.startsWith("/configuracoes/fiscal")) {
    return { tipo: "permissao", modulo: "fiscal", acao: "configurar_fiscal" };
  }

  if (pathname.startsWith("/configuracoes/contabilidade")) {
    return { tipo: "permissao", modulo: "configuracoes", acao: "configuracoes_gerais" };
  }

  if (pathname.startsWith("/configuracoes") || pathname.startsWith("/transportadoras")) {
    return { tipo: "permissao", modulo: "configuracoes", acao: "acessar" };
  }

  if (pathname.startsWith("/api/vendas/") && pathname.endsWith("/cancelar")) {
    return { tipo: "permissao", modulo: "vendas", acao: "cancelar" };
  }

  if (
    pathname.startsWith("/api/fiscal/emissoes/") &&
    pathname.endsWith("/cancelar")
  ) {
    return { tipo: "permissao", modulo: "fiscal", acao: "cancelar_nota" };
  }

  if (pathname.includes("/carta-correcao") || pathname.includes("/cce")) {
    return { tipo: "permissao", modulo: "fiscal", acao: "carta_correcao" };
  }

  if (pathname.includes("inutiliz")) {
    return { tipo: "permissao", modulo: "fiscal", acao: "inutilizar" };
  }

  if (pathname.includes("reconciliar") || pathname.includes("/reconciliar")) {
    return { tipo: "permissao", modulo: "fiscal", acao: "reconciliar" };
  }

  if (
    pathname.startsWith("/api/fiscal/geranet/nfe-emitir") ||
    pathname.startsWith("/api/fiscal/geranet/nfe-emitir-venda") ||
    pathname.startsWith("/api/fiscal/geranet/nfe-emitir-operacao") ||
    pathname.startsWith("/api/fiscal/geranet/nfe-emitir-devolucao")
  ) {
    return { tipo: "permissao", modulo: "fiscal", acao: "emitir_nfe" };
  }

  if (pathname.startsWith("/api/fiscal/geranet/nfce-emitir")) {
    return { tipo: "permissao", modulo: "fiscal", acao: "emitir_nfce" };
  }

  if (pathname.startsWith("/api/fiscal")) {
    return { tipo: "permissao", modulo: "fiscal", acao: "acessar" };
  }

  return { tipo: "autenticado" };
}

export function primeiraRotaPermitida(permissoes: PermissoesEfetivas) {
  const ordem: Array<{ href: string; modulo: keyof PermissoesEfetivas }> = [
    { href: "/painel", modulo: "inicio" },
    { href: "/pdv", modulo: "pdv" },
    { href: "/vendas", modulo: "vendas" },
    { href: "/contabilidade", modulo: "contabilidade" },
    { href: "/clientes", modulo: "clientes" },
    { href: "/produtos", modulo: "produtos" },
    { href: "/estoque", modulo: "estoque" },
    { href: "/configuracoes", modulo: "configuracoes" },
  ];

  return (
    ordem.find((item) => temAcessoModulo(permissoes, item.modulo))?.href ??
    "/acesso-negado"
  );
}

export function decidirAcessoRota(input: {
  pathname: string;
  method?: string;
  permissoes: PermissoesEfetivas | null;
}): { ok: true } | { ok: false; redirect: string } {
  const exigencia = resolverExigenciaRota(input.pathname, input.method);

  if (exigencia.tipo === "livre") {
    return { ok: true };
  }

  if (!input.permissoes) {
    return { ok: false, redirect: "/login" };
  }

  if (exigencia.tipo === "autenticado") {
    return { ok: true };
  }

  if (
    temPermissao(
      input.permissoes,
      exigencia.modulo,
      exigencia.acao as never
    )
  ) {
    return { ok: true };
  }

  return {
    ok: false,
    redirect: primeiraRotaPermitida(input.permissoes),
  };
}
