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
      className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto px-[var(--page-pad)]"
    >
      {ABAS.map((item) => {
        const ativa = item.id === aba;
        return (
          <Link
            key={item.id}
            href={item.href}
            className={[
              "relative shrink-0 px-2.5 py-1.5 text-[13px] font-medium",
              ativa ? "text-[var(--primary)]" : "text-zinc-500 hover:text-zinc-800",
            ].join(" ")}
          >
            {item.label}
            {ativa ? (
              <span className="absolute inset-x-2 bottom-0 h-0.5 bg-[var(--primary)]" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
