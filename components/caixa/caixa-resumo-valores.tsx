import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  CircleDollarSign,
  Scale,
  ScanLine,
} from "lucide-react";

import { KpiCard, type KpiCardTom } from "@/components/ui/kpi-card";
import { formatarMoeda } from "@/lib/relatorios/formatacao";

export function CaixaResumoValores({
  saldoInicial,
  suprimentos,
  sangrias,
  saldoAtual,
  rotuloSaldoAtual = "Saldo esperado em dinheiro",
  dinheiroContado,
  diferenca,
}: {
  saldoInicial: number;
  suprimentos: number;
  sangrias: number;
  saldoAtual: number | null;
  rotuloSaldoAtual?: string;
  dinheiroContado?: number | null;
  diferenca?: number | null;
}) {
  const tomDiferenca: KpiCardTom =
    diferenca == null || diferenca === 0
      ? "neutro"
      : diferenca > 0
        ? "positivo"
        : "negativo";

  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <KpiCard
        label="Saldo inicial"
        value={formatarMoeda(saldoInicial)}
        icon={<Banknote className="h-3.5 w-3.5" strokeWidth={1.75} />}
      />
      <KpiCard
        label="Suprimentos"
        value={formatarMoeda(suprimentos)}
        tom="positivo"
        icon={<ArrowDownToLine className="h-3.5 w-3.5" strokeWidth={1.75} />}
      />
      <KpiCard
        label="Sangrias"
        value={formatarMoeda(sangrias)}
        tom="negativo"
        icon={<ArrowUpFromLine className="h-3.5 w-3.5" strokeWidth={1.75} />}
      />
      {saldoAtual != null ? (
        <KpiCard
          label={rotuloSaldoAtual}
          value={formatarMoeda(saldoAtual)}
          tom="destaque"
          icon={<CircleDollarSign className="h-3.5 w-3.5" strokeWidth={1.75} />}
        />
      ) : null}
      {dinheiroContado != null ? (
        <KpiCard
          label="Dinheiro contado"
          value={formatarMoeda(dinheiroContado)}
          tom="info"
          icon={<ScanLine className="h-3.5 w-3.5" strokeWidth={1.75} />}
        />
      ) : null}
      {diferenca != null ? (
        <KpiCard
          label="Diferença"
          value={formatarMoeda(diferenca)}
          tom={tomDiferenca}
          icon={<Scale className="h-3.5 w-3.5" strokeWidth={1.75} />}
        />
      ) : null}
    </dl>
  );
}
