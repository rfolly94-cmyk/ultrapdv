import Link from "next/link";

import type { DashboardAlerta } from "@/lib/dashboard/carregar-dashboard";

const ponto: Record<DashboardAlerta["tipo"], string> = {
  fiscal: "bg-orange-400",
  estoque: "bg-amber-400",
  carteira: "bg-rose-400",
};

export function DashboardAlertList({
  alertas,
}: {
  alertas: DashboardAlerta[];
}) {
  if (alertas.length === 0) {
    return (
      <p className="py-2 text-[13px] text-zinc-400">
        Nenhuma pendência operacional no momento.
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {alertas.map((alerta) => (
        <li key={`${alerta.tipo}-${alerta.titulo}`}>
          <Link
            href={alerta.href}
            className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 text-[13px] hover:bg-[#F8F9FD]"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${ponto[alerta.tipo]}`}
              />
              <span className="truncate font-medium text-zinc-800">
                {alerta.titulo}
              </span>
            </span>
            <span className="shrink-0 text-[12px] text-zinc-400">
              {alerta.detalhe}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
