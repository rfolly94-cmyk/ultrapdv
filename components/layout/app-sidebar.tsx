"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoEmpresa } from "@/components/empresa/logo-empresa";
import type { IdentidadeEmpresaPublica } from "@/lib/empresa/logo";
import { logoUrlUtilizavel } from "@/lib/empresa/logo-url";
import { useRecursoLiberado } from "@/lib/plataforma/entitlements/contexto-ui";
import { usePermissoesUi } from "@/lib/permissoes/contexto-ui";
import { hrefsMenuPermitidos } from "@/lib/permissoes/menu";
import { primeiraRotaPermitida } from "@/lib/permissoes/rotas";
import { temAcessoModulo } from "@/lib/permissoes/tem-permissao";
import {
  PERFIS_USUARIO_LABEL,
  type PerfilUsuario,
} from "@/lib/usuarios/perfis";
import {
  Calculator,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Settings,
  ShoppingCart,
  Users,
  Warehouse,
  BarChart3,
  CreditCard,
  Wallet,
} from "lucide-react";

type MenuItem = {
  label: string;
  href: string;
  icon: typeof ShoppingCart;
  match?: (pathname: string) => boolean;
};

const menu: MenuItem[] = [
  {
    label: "Início",
    href: "/painel",
    icon: LayoutDashboard,
    match: (p) => p === "/painel",
  },
  {
    label: "Vendas",
    href: "/vendas",
    icon: ShoppingCart,
    match: (p) => p.startsWith("/vendas") || p.startsWith("/pdv"),
  },
  {
    label: "Caixa",
    href: "/caixa",
    icon: Wallet,
  },
  {
    label: "Clientes",
    href: "/clientes",
    icon: Users,
  },
  {
    label: "Produtos",
    href: "/produtos",
    icon: Package,
  },
  {
    label: "Estoque",
    href: "/estoque",
    icon: Warehouse,
    match: (p) =>
      p.startsWith("/estoque") || p.startsWith("/fiscal/entradas"),
  },
  {
    label: "Relatórios",
    href: "/relatorios",
    icon: BarChart3,
  },
  {
    label: "Contabilidade",
    href: "/contabilidade",
    icon: Calculator,
  },
];

const menuRodape: MenuItem[] = [
  {
    label: "Assinatura",
    href: "/assinatura",
    icon: CreditCard,
  },
  {
    label: "Configurações",
    href: "/configuracoes",
    icon: Settings,
    match: (p) =>
      p.startsWith("/configuracoes") || p.startsWith("/transportadoras"),
  },
];

function ativo(pathname: string, item: MenuItem) {
  if (item.match) {
    return item.match(pathname);
  }

  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function rotuloPerfil(perfil?: string | null) {
  if (!perfil) {
    return null;
  }

  return (
    PERFIS_USUARIO_LABEL[perfil as PerfilUsuario] ??
    (perfil === "proprietario" ? "Proprietário" : perfil)
  );
}

function iniciais(nome?: string | null) {
  const partes = String(nome ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (partes.length === 0) {
    return "U";
  }
  if (partes.length === 1) {
    return partes[0].slice(0, 2).toUpperCase();
  }
  return `${partes[0][0]}${partes[partes.length - 1][0]}`.toUpperCase();
}

export function AppSidebar({
  recolhida,
  onToggle,
  onNavigate,
  perfil,
  identidade,
  usuario,
  assinaturaSuspensa = false,
}: {
  recolhida: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
  perfil?: string | null;
  identidade?: IdentidadeEmpresaPublica | null;
  usuario?: string | null;
  assinaturaSuspensa?: boolean;
}) {
  const pathname = usePathname();
  const permissoes = usePermissoesUi();
  const relatoriosNoPlano = useRecursoLiberado("relatorios");
  const contabilidadeNoPlano = useRecursoLiberado("contabilidade");
  const produtosNoPlano = useRecursoLiberado("produtos");
  const clientesNoPlano = useRecursoLiberado("clientes");
  const estoqueNoPlano = useRecursoLiberado("estoque");
  const vendasNoPlano = useRecursoLiberado("vendas");
  const pdvNoPlano = useRecursoLiberado("pdv");
  const caixaNoPlano = useRecursoLiberado("caixa");
  const permitidos = new Set(hrefsMenuPermitidos(permissoes));
  const itens = menu.filter((item) => {
    if (!permitidos.has(item.href)) {
      return false;
    }
    if (item.href === "/relatorios") {
      return relatoriosNoPlano;
    }
    if (item.href === "/contabilidade") {
      return contabilidadeNoPlano;
    }
    if (item.href === "/produtos") {
      return produtosNoPlano;
    }
    if (item.href === "/clientes") {
      return clientesNoPlano;
    }
    if (item.href === "/estoque") {
      return estoqueNoPlano;
    }
    if (item.href === "/vendas") {
      if (vendasNoPlano) {
        return true;
      }
      return Boolean(
        pdvNoPlano && permissoes && temAcessoModulo(permissoes, "pdv")
      );
    }
    if (item.href === "/caixa") {
      return caixaNoPlano;
    }
    return true;
  });
  const itensRodape = menuRodape.filter((item) => permitidos.has(item.href));
  const home = permissoes ? primeiraRotaPermitida(permissoes) : "/painel";
  const logoUrl = logoUrlUtilizavel(identidade?.logoUrl);
  const perfilRotulo = rotuloPerfil(perfil);
  const temConta = Boolean(identidade?.nome || usuario || perfil);
  const marcaIniciais = iniciais(identidade?.nome || usuario);

  function linkMenu(item: MenuItem) {
    const Icon = item.icon;
    const estaAtivo = ativo(pathname, item);
    const href =
      item.href === "/vendas" && !vendasNoPlano ? "/pdv" : item.href;

    return (
      <Link
        key={item.href}
        href={href}
        onClick={onNavigate}
        title={item.label}
        data-active={estaAtivo}
        data-collapsed={recolhida}
        className="updv-nav-item"
      >
        <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
        {!recolhida && <span className="truncate">{item.label}</span>}
      </Link>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[var(--sidebar-bg)]">
      <div
        className={
          recolhida
            ? "flex shrink-0 flex-col items-center gap-2 border-b border-zinc-100 px-2 py-3"
            : "flex h-16 shrink-0 items-center gap-1 border-b border-zinc-100 px-3"
        }
      >
        <button
          type="button"
          onClick={onToggle}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
          aria-label={recolhida ? "Expandir menu" : "Recolher menu"}
        >
          <Menu className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </button>
        {!recolhida && (
          <Link
            href={home}
            onClick={onNavigate}
            className="flex min-w-0 flex-1 items-center px-1"
          >
            <LogoEmpresa src={logoUrl} nome={identidade?.nome} />
          </Link>
        )}
        {recolhida && logoUrl ? (
          <LogoEmpresa src={logoUrl} nome={identidade?.nome} compacto />
        ) : null}
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        {itens.map((item) => linkMenu(item))}
      </nav>

      <div className="mt-auto border-t border-zinc-100 pt-2">
        {itensRodape.map((item) => linkMenu(item))}
        {temConta ? (
          <div
            className="updv-sidebar-account"
            data-collapsed={recolhida}
            title={
              recolhida
                ? [identidade?.nome, usuario, perfilRotulo]
                    .filter(Boolean)
                    .join(" · ")
                : undefined
            }
          >
            <div
              className={
                recolhida
                  ? "flex flex-col items-center gap-2"
                  : "flex min-w-0 items-center gap-2.5"
              }
            >
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-[11px] font-semibold text-[var(--primary)]"
              >
                {marcaIniciais}
              </span>
              {!recolhida ? (
                <div className="min-w-0 flex-1">
                  {identidade?.nome ? (
                    <p className="truncate text-[13px] font-semibold text-zinc-900">
                      {identidade.nome}
                    </p>
                  ) : null}
                  {assinaturaSuspensa ? (
                    <p className="mt-0.5 text-[11px] font-medium text-amber-700">
                      Assinatura suspensa
                    </p>
                  ) : null}
                  {usuario || perfilRotulo ? (
                    <p className="truncate text-[11px] text-zinc-500">
                      {[usuario, perfilRotulo].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <a
              href="/logout"
              title="Sair"
              onClick={onNavigate}
              className={
                recolhida
                  ? "flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                  : "mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
              }
            >
              <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              {!recolhida ? <span>Sair</span> : null}
            </a>
          </div>
        ) : (
          <a
            href="/logout"
            title="Sair"
            data-collapsed={recolhida}
            className="updv-nav-item"
          >
            <LogOut className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
            {!recolhida && <span>Sair</span>}
          </a>
        )}
      </div>
    </div>
  );
}
