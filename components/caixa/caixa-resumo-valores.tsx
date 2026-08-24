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
  saldoAtual: number;
  rotuloSaldoAtual?: string;
  dinheiroContado?: number | null;
  diferenca?: number | null;
}) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
        <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Saldo inicial
        </dt>
        <dd className="mt-1 text-[15px] font-semibold text-zinc-950">
          {formatarMoeda(saldoInicial)}
        </dd>
      </div>
      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
        <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Suprimentos
        </dt>
        <dd className="mt-1 text-[15px] font-semibold text-emerald-700">
          {formatarMoeda(suprimentos)}
        </dd>
      </div>
      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
        <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Sangrias
        </dt>
        <dd className="mt-1 text-[15px] font-semibold text-rose-700">
          {formatarMoeda(sangrias)}
        </dd>
      </div>
      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
        <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          {rotuloSaldoAtual}
        </dt>
        <dd className="mt-1 text-[15px] font-semibold text-zinc-950">
          {formatarMoeda(saldoAtual)}
        </dd>
      </div>
      {dinheiroContado != null ? (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Dinheiro contado
          </dt>
          <dd className="mt-1 text-[15px] font-semibold text-zinc-950">
            {formatarMoeda(dinheiroContado)}
          </dd>
        </div>
      ) : null}
      {diferenca != null ? (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
          <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Diferença
          </dt>
          <dd
            className={`mt-1 text-[15px] font-semibold ${
              diferenca === 0
                ? "text-zinc-950"
                : diferenca > 0
                  ? "text-emerald-700"
                  : "text-rose-700"
            }`}
          >
            {formatarMoeda(diferenca)}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
