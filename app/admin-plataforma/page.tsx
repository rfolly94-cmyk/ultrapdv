import Link from "next/link";

import { obterContextoAdminPlataforma } from "@/lib/plataforma/contexto";
import { metricasPlataforma } from "@/lib/plataforma/empresas";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Painel",
};

function formatarData(valor: string) {
  if (!valor) {
    return "—";
  }
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(data);
}

export default async function AdminPlataformaPage() {
  const { admin } = await obterContextoAdminPlataforma();
  const metricas = await metricasPlataforma(admin);

  const cards = [
    { label: "Total de empresas", valor: metricas.totalEmpresas },
    { label: "Total de usuários", valor: metricas.totalUsuarios },
    {
      label: "Proprietários confirmados",
      valor: metricas.proprietariosConfirmados,
    },
    {
      label: "Proprietários pendentes",
      valor: metricas.proprietariosPendentes,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-950">
          Painel
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Métricas da plataforma. Empresas sem proprietário definido não entram
          em confirmados nem pendentes.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-900">
            Empresas recentes
          </h2>
          <Link
            href="/admin-plataforma/empresas"
            className="text-sm font-medium text-zinc-700 underline"
          >
            Ver todas
          </Link>
        </div>
        <ul className="divide-y divide-zinc-100">
          {metricas.empresasRecentes.length === 0 && (
            <li className="px-5 py-6 text-sm text-zinc-500">
              Nenhuma empresa cadastrada.
            </li>
          )}
          {metricas.empresasRecentes.map((empresa) => (
            <li key={String(empresa.id)}>
              <Link
                href={`/admin-plataforma/empresas/${empresa.id}`}
                className="flex items-center justify-between gap-4 px-5 py-3 text-sm hover:bg-zinc-50"
              >
                <span className="font-medium text-zinc-900">
                  {String(
                    empresa.nome_fantasia || empresa.razao_social || "Empresa"
                  )}
                </span>
                <span className="text-zinc-500">
                  {formatarData(String(empresa.created_at ?? ""))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
