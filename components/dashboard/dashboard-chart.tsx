const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

const coresBarra = [
  "bg-orange-400",
  "bg-emerald-400",
  "bg-pink-400",
  "bg-indigo-400",
  "bg-sky-400",
  "bg-amber-400",
];

export function DashboardBarChart({
  pontos,
}: {
  pontos: Array<{ rotulo: string; valor: number }>;
}) {
  const maximo = Math.max(...pontos.map((ponto) => ponto.valor), 0);

  if (pontos.every((ponto) => ponto.valor === 0)) {
    return (
      <p className="py-16 text-center text-[13px] text-zinc-400">
        Sem faturamento no período do gráfico.
      </p>
    );
  }

  return (
    <div className="flex h-52 items-end gap-2">
      {pontos.map((ponto, index) => {
        const altura =
          maximo > 0 ? Math.max(8, (ponto.valor / maximo) * 100) : 8;

        return (
          <div
            key={`${ponto.rotulo}-${index}`}
            className="flex min-w-0 flex-1 flex-col items-center gap-2"
            title={`${ponto.rotulo}: ${moeda.format(ponto.valor)}`}
          >
            <div className="flex h-44 w-full items-end justify-center">
              <div
                className={`w-3/5 max-w-8 rounded-t-md ${coresBarra[index % coresBarra.length]}`}
                style={{ height: `${altura}%` }}
              />
            </div>
            <span className="text-[11px] text-zinc-400">{ponto.rotulo}</span>
          </div>
        );
      })}
    </div>
  );
}

export function DashboardPaymentBars({
  itens,
}: {
  itens: Array<{ nome: string; valor: number }>;
}) {
  const maximo = Math.max(...itens.map((item) => item.valor), 0);
  const cores = [
    "bg-indigo-500",
    "bg-orange-400",
    "bg-emerald-400",
    "bg-pink-400",
    "bg-sky-400",
    "bg-amber-400",
  ];

  if (itens.length === 0) {
    return (
      <p className="py-16 text-center text-[13px] text-zinc-400">
        Sem pagamentos confirmados no período.
      </p>
    );
  }

  return (
    <ul className="space-y-4">
      {itens.map((item, index) => {
        const largura = maximo > 0 ? (item.valor / maximo) * 100 : 0;

        return (
          <li key={item.nome}>
            <div className="mb-1.5 flex items-center justify-between text-[13px]">
              <span className="truncate text-zinc-500">{item.nome}</span>
              <span className="ml-3 font-semibold text-zinc-900">
                {moeda.format(item.valor)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
              <div
                className={`h-full rounded-full ${cores[index % cores.length]}`}
                style={{ width: `${largura}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
