import { formatarMoeda } from "@/lib/relatorios/formatacao";
import type { CaixaTotais } from "@/lib/caixa/tipos";

const CARDS: Array<{
  chave: keyof Pick<
    CaixaTotais,
    | "vendasTotal"
    | "vendasDinheiro"
    | "vendasPix"
    | "vendasCredito"
    | "vendasDebito"
    | "vendasOutros"
    | "saldoAtual"
  >;
  rotulo: string;
  destaque?: "fisico" | "entrada";
}> = [
  { chave: "vendasDinheiro", rotulo: "Dinheiro físico" },
  { chave: "vendasPix", rotulo: "PIX" },
  { chave: "vendasCredito", rotulo: "Crédito" },
  { chave: "vendasDebito", rotulo: "Débito" },
  { chave: "vendasOutros", rotulo: "Outros" },
  { chave: "vendasTotal", rotulo: "Total recebido em vendas", destaque: "entrada" },
  { chave: "saldoAtual", rotulo: "Saldo físico", destaque: "fisico" },
];

export function CaixaResumoVendas({ totais }: { totais: CaixaTotais }) {
  const cards = CARDS.filter((card) => totais[card.chave] != null);
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.chave}
          className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2"
        >
          <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            {card.rotulo}
          </dt>
          <dd
            className={`mt-1 text-[15px] font-semibold ${
              card.destaque === "fisico"
                ? "text-zinc-950"
                : card.destaque === "entrada"
                  ? "text-emerald-700"
                  : "text-zinc-950"
            }`}
          >
            {formatarMoeda(totais[card.chave])}
          </dd>
        </div>
      ))}
    </dl>
  );
}
