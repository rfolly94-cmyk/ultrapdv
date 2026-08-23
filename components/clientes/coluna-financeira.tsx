import { formatarMoeda } from "@/lib/relatorios/formatacao";
import type { ItemColunaFinanceira } from "@/lib/clientes/listagem";

const COR: Record<ItemColunaFinanceira["variante"], string> = {
  debito: "text-red-600",
  vencido: "text-red-600",
  credito: "text-emerald-600",
  quitado: "text-zinc-500",
};

export function ColunaFinanceiraCliente({
  itens,
  onDebito,
  onCredito,
}: {
  itens: ItemColunaFinanceira[];
  onDebito?: () => void;
  onCredito?: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      {itens.map((item) => {
        const clicavel =
          (item.variante === "debito" || item.variante === "vencido") && onDebito
            ? onDebito
            : item.variante === "credito" &&
                item.rotulo === "Crédito" &&
                onCredito
              ? onCredito
              : undefined;

        if (!clicavel || item.variante === "quitado") {
          return (
            <span
              key={`${item.variante}-${item.valor}`}
              className={`tabular-nums text-[13px] font-medium ${COR[item.variante]}`}
            >
              {item.variante === "quitado" ? "Quitado" : formatarMoeda(item.valor)}
            </span>
          );
        }

        return (
          <button
            key={`${item.variante}-${item.valor}`}
            type="button"
            onClick={clicavel}
            aria-label={item.rotulo}
            className={`tabular-nums text-[13px] font-medium hover:underline ${COR[item.variante]}`}
          >
            {formatarMoeda(item.valor)}
          </button>
        );
      })}
    </div>
  );
}
