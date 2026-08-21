"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useState } from "react";

const links = [
  { href: "#recursos", label: "Recursos" },
  { href: "#como-funciona", label: "Como funciona" },
] as const;

export function LandingHeader() {
  const [aberto, setAberto] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200 bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link
          href="/"
          className="text-[17px] font-bold tracking-tight text-zinc-900"
        >
          UltraPDV
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-zinc-600 hover:text-zinc-900"
            >
              {link.label}
            </a>
          ))}
          <Link
            href="/cadastro"
            className="inline-flex min-h-10 items-center rounded-lg bg-blue-600 px-3.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Criar conta
          </Link>
          <Link
            href="/login"
            className="inline-flex min-h-10 items-center rounded-lg border border-zinc-300 px-3.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
          >
            Entrar
          </Link>
        </nav>

        <button
          type="button"
          className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-zinc-200 text-zinc-700 md:hidden"
          aria-expanded={aberto}
          aria-label={aberto ? "Fechar menu" : "Abrir menu"}
          onClick={() => setAberto((atual) => !atual)}
        >
          {aberto ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {aberto ? (
        <div className="border-t border-zinc-200 bg-white px-4 py-3 md:hidden">
          <nav className="flex flex-col gap-1">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-lg px-3 py-2.5 text-sm text-zinc-700"
                onClick={() => setAberto(false)}
              >
                {link.label}
              </a>
            ))}
            <Link
              href="/cadastro"
              className="mt-2 inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-600 px-3 text-sm font-medium text-white"
              onClick={() => setAberto(false)}
            >
              Criar conta
            </Link>
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-800"
              onClick={() => setAberto(false)}
            >
              Entrar
            </Link>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
