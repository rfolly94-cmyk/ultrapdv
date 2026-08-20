"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { MasterNavSuporte } from "@/components/master/master-nav-suporte";

const NAV = [
  { href: "/master", label: "Dashboard" },
  { href: "/master/empresas", label: "Empresas" },
  { href: "/master/planos", label: "Planos" },
];

export function MasterChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-zinc-100 lg:flex">
      <aside className="w-full border-b border-zinc-200 bg-white lg:w-56 lg:border-b-0 lg:border-r">
        <div className="px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            UltraPDV Master
          </p>
          <p className="mt-1 text-sm text-zinc-400">Administração da plataforma</p>
        </div>
        <nav className="flex flex-wrap gap-1 px-3 pb-3 lg:flex-col">
          {NAV.map((item) => {
            const ativo =
              item.href === "/master"
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  ativo ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <MasterNavSuporte
            href="/master/suporte"
            ativo={pathname === "/master/suporte" || pathname.startsWith("/master/suporte/")}
          />
          <Link
            href="/painel"
            className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100"
          >
            Voltar ao UltraPDV
          </Link>
          <a
            href="/logout"
            className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100"
          >
            Sair
          </a>
        </nav>
      </aside>
      <div className="min-w-0 flex-1 px-4 py-8 lg:px-8">{children}</div>
    </div>
  );
}
