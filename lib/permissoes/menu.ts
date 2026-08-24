import type { PermissoesEfetivas } from "./tipos";
import { temAcessoModulo, temPermissao } from "./tem-permissao";

export type ItemMenuPermissao = {
  href: string;
  visivel: (permissoes: PermissoesEfetivas) => boolean;
};

export const ITENS_MENU_PERMISSAO: ItemMenuPermissao[] = [
  { href: "/painel", visivel: (p) => temAcessoModulo(p, "inicio") },
  {
    href: "/vendas",
    visivel: (p) => temAcessoModulo(p, "vendas") || temAcessoModulo(p, "pdv"),
  },
  { href: "/clientes", visivel: (p) => temAcessoModulo(p, "clientes") },
  { href: "/produtos", visivel: (p) => temAcessoModulo(p, "produtos") },
  { href: "/estoque", visivel: (p) => temAcessoModulo(p, "estoque") },
  { href: "/caixa", visivel: (p) => temAcessoModulo(p, "caixa") },
  { href: "/relatorios", visivel: (p) => temAcessoModulo(p, "relatorios") },
  { href: "/assinatura", visivel: () => true },
  { href: "/contabilidade", visivel: (p) => temAcessoModulo(p, "contabilidade") },
  { href: "/configuracoes", visivel: (p) => temAcessoModulo(p, "configuracoes") },
];

export function hrefsMenuPermitidos(permissoes: PermissoesEfetivas | null) {
  if (!permissoes) {
    return [];
  }

  return ITENS_MENU_PERMISSAO.filter((item) => item.visivel(permissoes)).map(
    (item) => item.href
  );
}

export const ABAS_CONFIGURACOES_PERMISSAO = [
  {
    label: "Fiscal",
    href: "/configuracoes/fiscal",
    modulo: "fiscal" as const,
    acao: "configurar_fiscal" as const,
  },
  {
    label: "Usuários",
    href: "/configuracoes/usuarios",
    modulo: "usuarios" as const,
    acao: "acessar" as const,
  },
  {
    label: "Financeiro",
    href: "/configuracoes/financeiro/pix",
    modulo: "financeiro" as const,
    acao: "configurar_pix" as const,
  },
  {
    label: "Contabilidade",
    href: "/configuracoes/contabilidade",
    modulo: "configuracoes" as const,
    acao: "configuracoes_gerais" as const,
  },
  {
    label: "Catálogo Online",
    href: "/configuracoes/catalogo",
    modulo: "catalogo" as const,
    acao: "configurar" as const,
    recurso: "catalogo" as const,
  },
  {
    label: "Importar dados",
    href: "/configuracoes/importar-dados",
    modulo: "importacao_dados" as const,
    acao: "acessar" as const,
    recurso: "importador" as const,
  },
  {
    label: "Impressão",
    href: "/configuracoes/impressao",
    modulo: "configuracoes" as const,
    acao: "acessar" as const,
    recurso: "impressao_automatica" as const,
  },
];
