import Link from "next/link";

import type { AbaCaixa } from "@/lib/caixa/tipos";

const ABAS: Array<{ id: AbaCaixa; label: string; href: string }> = [
  { id: "atual", label: "Caixa Atual", href: "/caixa" },
  { id: "anteriores", label: "Caixas Anteriores", href: "/caixa?aba=anteriores" },
];

export function CaixaAbas({ aba }: { aba: AbaCaixa }) {
  return (
    <nav
      aria-label="Caixa"
      className="flex h-14 shrink-0 items-end px-[var(--page-pad)] pb-3"
    >
      <div className="inline-flex max-w-full overflow-x-auto rounded-xl border border-[var(--line)] bg-zinc-100/90 p-1">
        {ABAS.map((item) => {
          const ativa = item.id === aba;
          return (
            <Link
              key={item.id}
              href={item.href}
              className={[
                "relative shrink-0 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                ativa
                  ? "bg-white text-zinc-950 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-800",
              ].join(" ")}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
