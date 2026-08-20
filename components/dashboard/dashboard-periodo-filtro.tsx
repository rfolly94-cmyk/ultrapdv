"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import {
  PERIODOS_DASHBOARD,
  periodoValido,
} from "@/lib/dashboard/periodo";

const rotulos: Record<(typeof PERIODOS_DASHBOARD)[number], string> = {
  hoje: "Hoje",
  "7d": "7 dias",
  "30d": "30 dias",
  mes: "Mês atual",
};

export function DashboardPeriodoFiltro() {
  const params = useSearchParams();
  const atual = periodoValido(params.get("periodo") ?? undefined);

  return (
    <div className="flex items-center gap-1 rounded-xl bg-white p-1 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
      {PERIODOS_DASHBOARD.map((periodo) => (
        <Link
          key={periodo}
          href={`/painel?periodo=${periodo}`}
          className={`inline-flex h-8 items-center rounded-lg px-3 text-[12px] font-semibold ${
            atual === periodo
              ? "bg-[#4A3AFF] text-white"
              : "text-zinc-400 hover:text-zinc-700"
          }`}
        >
          {rotulos[periodo]}
        </Link>
      ))}
    </div>
  );
}
