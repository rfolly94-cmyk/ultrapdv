"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/admin-plataforma", label: "Painel" },
  { href: "/admin-plataforma/empresas", label: "Empresas" },
];

export function AdminPlataformaChrome({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-zinc-100">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              UltraPDV Administração
            </p>
            <p className="text-sm text-zinc-400">Painel da plataforma</p>
          </div>
          <nav className="flex flex-wrap items-center gap-2 text-sm">
            {NAV.map((item) => {
              const ativo =
                item.href === "/admin-plataforma"
                  ? pathname === item.href
                  : pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-3 py-2 font-medium ${
                    ativo
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-600 hover:bg-zinc-100"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
            <Link
              href="/painel"
              className="rounded-lg px-3 py-2 font-medium text-zinc-600 hover:bg-zinc-100"
            >
              Voltar ao UltraPDV
            </Link>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-8">{children}</div>
    </div>
  );
}
