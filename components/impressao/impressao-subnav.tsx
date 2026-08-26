"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ABAS = [
  { href: "/configuracoes/impressao", label: "Impressoras", exact: true },
  { href: "/configuracoes/impressao/recibo", label: "Recibo de venda" },
];

export function ImpressaoSubnav() {
  const pathname = usePathname();
  return (
    <div className="flex flex-wrap gap-2 px-5 py-2">
      {ABAS.map((aba) => {
        const ativo = aba.exact
          ? pathname === aba.href
          : pathname.startsWith(aba.href);
        return (
          <Link
            key={aba.href}
            href={aba.href}
            className={`rounded-full px-3 py-1.5 text-[13px] ${
              ativo
                ? "bg-zinc-950 text-white"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
            }`}
          >
            {aba.label}
          </Link>
        );
      })}
    </div>
  );
}
