"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { ABAS_RELATORIO } from "@/lib/relatorios/tipos";

const ROTULOS: Record<(typeof ABAS_RELATORIO)[number], string> = {
  vendas: "Vendas",
  produtos: "Produtos",
  estoque: "Estoque",
  clientes: "Clientes",
  carteira: "Carteira",
  pagamentos: "Pagamentos",
  fiscal: "Fiscal",
};

export function RelatoriosAbas() {
  const params = useSearchParams();
  const atual = params.get("aba") || "vendas";
  const periodo = params.get("periodo") || "mes";

  return (
    <nav
      aria-label="Relatórios"
      className="print-hide flex h-10 shrink-0 items-center gap-1 overflow-x-auto px-[var(--page-pad)]"
    >
      {ABAS_RELATORIO.map((aba) => {
        const href = `/relatorios?aba=${aba}&periodo=${periodo}`;
        const ativa = atual === aba;

        return (
          <Link
            key={aba}
            href={href}
            className={[
              "relative shrink-0 px-2.5 py-1.5 text-[13px] font-medium",
              ativa ? "text-[var(--primary)]" : "text-zinc-500 hover:text-zinc-800",
            ].join(" ")}
          >
            {ROTULOS[aba]}
            {ativa && (
              <span className="absolute inset-x-2 bottom-0 h-0.5 bg-[var(--primary)]" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
