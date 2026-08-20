import Link from "next/link";

import { StatusBadge } from "@/components/ui/status-badge";
import type { DashboardListaItem } from "@/lib/dashboard/carregar-dashboard";

function iniciais(texto: string) {
  return texto
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() ?? "")
    .join("");
}

export function DashboardRecentList({
  itens,
  vazio,
  acao = "Detalhes",
}: {
  itens: DashboardListaItem[];
  vazio: string;
  acao?: string;
}) {
  if (itens.length === 0) {
    return <p className="py-8 text-center text-[13px] text-zinc-400">{vazio}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
        <tbody>
          {itens.map((item) => (
            <tr key={item.id} className="border-b border-zinc-100 last:border-0">
              <td className="py-3 pr-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[10px] font-bold text-indigo-600">
                    {iniciais(item.detalhe || item.titulo) || "—"}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-zinc-900">
                      {item.titulo}
                    </p>
                    <p className="truncate text-[12px] text-zinc-400">
                      {item.detalhe}
                    </p>
                  </div>
                </div>
              </td>
              <td className="py-3 pr-3">
                {item.status ? <StatusBadge status={item.status} /> : null}
              </td>
              <td className="py-3 pr-3 font-semibold text-zinc-800">
                {item.extra}
              </td>
              <td className="py-3 text-right">
                <Link
                  href={item.href}
                  className="inline-flex h-8 items-center rounded-lg bg-[#4A3AFF] px-3 text-[12px] font-semibold text-white hover:bg-[#3b2fe0]"
                >
                  {acao}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
