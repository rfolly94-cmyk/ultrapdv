"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type MenuItem = {
  label: string;
  href: string;
};

const gestao: MenuItem[] = [
  {
    label: "Painel",
    href: "/painel",
  },
  {
    label: "Produtos",
    href: "/produtos",
  },
  {
    label: "Clientes",
    href: "/clientes",
  },
  {
    label: "PDV",
    href: "/pdv",
  },
  {
    label: "Estoque",
    href: "/estoque",
  },
];

const cadastros: MenuItem[] = [
  {
    label: "Categorias",
    href: "/produtos/categorias",
  },
  {
    label: "Marcas",
    href: "/produtos/marcas",
  },
  {
    label: "Grupos fiscais",
    href: "/produtos/grupos-fiscais",
  },
];

const fiscal: MenuItem[] = [
  {
    label: "Configurações fiscais",
    href: "/configuracoes/fiscal",
  },
  {
    label: "Prontidão NFC-e",
    href: "/configuracoes/fiscal/prontidao",
  },
  {
    label: "Integração Geranet",
    href: "/configuracoes/fiscal/integracao",
  },
];

function rotaAtiva(
  pathname: string,
  href: string
) {
  if (href === "/painel") {
    return pathname === "/painel";
  }

  return (
    pathname === href ||
    pathname.startsWith(
      `${href}/`
    )
  );
}

function MenuLink({
  item,
  pathname,
  onNavigate,
}: {
  item: MenuItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const ativo =
    rotaAtiva(
      pathname,
      item.href
    );

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={[
        "block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        ativo
          ? "bg-zinc-900 text-white"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
      ].join(" ")}
    >
      {item.label}
    </Link>
  );
}

function GrupoMenu({
  titulo,
  itens,
  pathname,
  onNavigate,
}: {
  titulo: string;
  itens: MenuItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div>
      <p className="px-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        {titulo}
      </p>

      <nav className="mt-2 space-y-1">
        {itens.map(
          (item) => (
            <MenuLink
              key={item.href}
              item={item}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          )
        )}
      </nav>
    </div>
  );
}

function SidebarContent({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-200 px-5 py-5">
        <Link
          href="/painel"
          onClick={onNavigate}
          className="block"
        >
          <p className="text-xl font-bold tracking-tight text-zinc-900">
            UltraPDV
          </p>

          <p className="mt-0.5 text-xs text-zinc-500">
            Gestão comercial e fiscal
          </p>
        </Link>
      </div>

      <div className="flex-1 space-y-7 overflow-y-auto px-3 py-5">
        <GrupoMenu
          titulo="Gestão"
          itens={gestao}
          pathname={pathname}
          onNavigate={onNavigate}
        />

        <GrupoMenu
          titulo="Cadastros"
          itens={cadastros}
          pathname={pathname}
          onNavigate={onNavigate}
        />

        <GrupoMenu
          titulo="Fiscal"
          itens={fiscal}
          pathname={pathname}
          onNavigate={onNavigate}
        />
      </div>

      <div className="border-t border-zinc-200 px-5 py-4">
        <p className="text-xs text-zinc-400">
          UltraPDV
        </p>
      </div>
    </div>
  );
}

export function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname =
    usePathname();

  const [
    menuAberto,
    setMenuAberto,
  ] = useState(false);

  const semChrome =
    pathname === "/" ||
    pathname.startsWith(
      "/login"
    ) ||
    pathname.startsWith(
      "/onboarding"
    ) ||
    pathname.startsWith(
      "/pdv"
    );

  if (semChrome) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-zinc-100">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-zinc-200 bg-white lg:block">
        <SidebarContent
          pathname={pathname}
        />
      </aside>

      {menuAberto && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() =>
              setMenuAberto(
                false
              )
            }
            className="absolute inset-0 bg-black/30"
          />

          <aside className="relative h-full w-72 max-w-[85vw] border-r border-zinc-200 bg-white shadow-xl">
            <SidebarContent
              pathname={pathname}
              onNavigate={() =>
                setMenuAberto(
                  false
                )
              }
            />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center border-b border-zinc-200 bg-white/95 px-4 backdrop-blur md:px-6 lg:hidden">
          <button
            type="button"
            onClick={() =>
              setMenuAberto(
                true
              )
            }
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Menu
          </button>

          <Link
            href="/painel"
            className="ml-4 font-bold text-zinc-900"
          >
            UltraPDV
          </Link>
        </header>

        <div className="min-h-screen">
          {children}
        </div>
      </div>
    </div>
  );
}
