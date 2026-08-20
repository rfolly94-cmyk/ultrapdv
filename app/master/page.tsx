import { metricasMaster } from "@/lib/master/empresas";
import { formatarMoeda } from "@/lib/relatorios/formatacao";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dashboard",
};

export default async function MasterDashboardPage() {
  const metricas = await metricasMaster();
  const cards = [
    { label: "Empresas", valor: String(metricas.empresas) },
    { label: "Ativas", valor: String(metricas.ativas) },
    { label: "Em trial", valor: String(metricas.trial) },
    { label: "Em carência", valor: String(metricas.carencia) },
    { label: "Suspensas", valor: String(metricas.suspensas) },
    {
      label: "Receita mensal estimada",
      valor: formatarMoeda(metricas.receitaMensalEstimada),
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-950">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Visão comercial da plataforma. Sem cobrança automática nesta etapa.
        </p>
      </div>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <article
            key={card.label}
            className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
          >
            <p className="text-sm text-zinc-500">{card.label}</p>
            <p className="mt-3 text-3xl font-bold tracking-tight text-zinc-950">
              {card.valor}
            </p>
          </article>
        ))}
      </section>
    </div>
  );
}
