import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  CircleDollarSign,
  CreditCard,
  QrCode,
  RotateCcw,
  TrendingUp,
  Wallet,
  MoreHorizontal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { KpiCard, type KpiCardTom } from "@/components/ui/kpi-card";
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
  tom?: "entrada" | "saida" | "fisico" | "info";
  icone: LucideIcon;
}> = [
  { chave: "saldoInicial", rotulo: "Saldo inicial em dinheiro", icone: Banknote },
  { chave: "vendasTotal", rotulo: "Vendas líquidas", tom: "entrada", icone: TrendingUp },
  {
    chave: "recebimentosCarteira",
    rotulo: "Recebimentos da Carteira",
    tom: "entrada",
    icone: Wallet,
  },
  { chave: "suprimentos", rotulo: "Suprimentos", tom: "entrada", icone: ArrowDownToLine },
  { chave: "sangrias", rotulo: "Sangrias", tom: "saida", icone: ArrowUpFromLine },
  { chave: "estornos", rotulo: "Estornos", tom: "saida", icone: RotateCcw },
  {
    chave: "saldoAtual",
    rotulo: "Dinheiro físico esperado",
    tom: "fisico",
    icone: CircleDollarSign,
  },
  { chave: "meiosPix", rotulo: "PIX", tom: "info", icone: QrCode },
  { chave: "meiosDebito", rotulo: "Débito", tom: "info", icone: CreditCard },
  { chave: "meiosCredito", rotulo: "Crédito", tom: "info", icone: CreditCard },
  { chave: "meiosOutros", rotulo: "Outros meios", tom: "info", icone: MoreHorizontal },
];

function tomDoCard(tom?: "entrada" | "saida" | "fisico" | "info"): KpiCardTom {
  if (tom === "entrada") return "positivo";
  if (tom === "saida") return "negativo";
  if (tom === "fisico") return "destaque";
  if (tom === "info") return "info";
  return "neutro";
}

export function CaixaResumoSessao({ totais }: { totais: CaixaTotais }) {
  const cards = CARDS.filter((card) => totais[card.chave] != null);

  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {cards.map((card) => {
        const Icone = card.icone;
        return (
          <KpiCard
            key={card.chave}
            label={card.rotulo}
            value={formatarMoeda(totais[card.chave])}
            tom={tomDoCard(card.tom)}
            icon={<Icone className="h-3.5 w-3.5" strokeWidth={1.75} />}
          />
        );
      })}
    </dl>
  );
}
