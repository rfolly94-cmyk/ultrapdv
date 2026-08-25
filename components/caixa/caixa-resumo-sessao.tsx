import { formatarMoeda } from "@/lib/relatorios/formatacao";
import type { CaixaTotais } from "@/lib/caixa/tipos";

const CARDS: Array<{
  chave: keyof Pick<
    CaixaTotais,
    | "saldoInicial"
    | "vendasTotal"
    | "recebimentosCarteira"
    | "suprimentos"
    | "sangrias"
    | "estornos"
    | "saldoAtual"
    | "meiosPix"
    | "meiosDebito"
    | "meiosCredito"
    | "meiosOutros"
  >;
  rotulo: string;
  tom?: "entrada" | "saida" | "fisico";
}> = [
  { chave: "saldoInicial", rotulo: "Saldo inicial em dinheiro" },
  { chave: "vendasTotal", rotulo: "Vendas líquidas", tom: "entrada" },
  { chave: "recebimentosCarteira", rotulo: "Recebimentos da Carteira", tom: "entrada" },
  { chave: "suprimentos", rotulo: "Suprimentos", tom: "entrada" },
  { chave: "sangrias", rotulo: "Sangrias", tom: "saida" },
  { chave: "estornos", rotulo: "Estornos", tom: "saida" },
  { chave: "saldoAtual", rotulo: "Dinheiro físico esperado", tom: "fisico" },
  { chave: "meiosPix", rotulo: "PIX" },
  { chave: "meiosDebito", rotulo: "Débito" },
  { chave: "meiosCredito", rotulo: "Crédito" },
  { chave: "meiosOutros", rotulo: "Outros meios" },
];

export function CaixaResumoSessao({ totais }: { totais: CaixaTotais }) {
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
              card.tom === "fisico"
                ? "text-zinc-950"
                : card.tom === "entrada"
                  ? "text-emerald-700"
                  : card.tom === "saida"
                    ? "text-rose-700"
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
