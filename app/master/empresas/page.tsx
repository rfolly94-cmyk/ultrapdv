import Link from "next/link";
import { Search } from "lucide-react";

import { RowActions } from "@/components/ui/row-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatarCnpjMaster } from "@/lib/master/apresentacao-empresa";
import {
  listarEmpresasMaster,
  listarPlanosMaster,
  metricasMaster,
} from "@/lib/master/empresas";
import { formatarData, formatarMoeda } from "@/lib/relatorios/formatacao";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Empresas",
};

const FILTROS = [
  { id: "", label: "Todas" },
  { id: "ativa", label: "Ativas" },
  { id: "trial", label: "Em teste" },
  { id: "carencia", label: "Carência" },
  { id: "suspensa", label: "Suspensas" },
  { id: "cancelada", label: "Canceladas" },
];

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function param(valor: string | string[] | undefined) {
  return Array.isArray(valor) ? valor[0] : valor ?? "";
}

function hrefLista(params: {
  q: string;
  status: string;
  planoId: string;
  page?: number;
}) {
  const busca = new URLSearchParams();
  if (params.q) {
    busca.set("q", params.q);
  }
  if (params.status) {
    busca.set("status", params.status);
  }
  if (params.planoId) {
    busca.set("plano", params.planoId);
  }
  if (params.page && params.page > 1) {
    busca.set("page", String(params.page));
  }
  const query = busca.toString();
  return query ? `/master/empresas?${query}` : "/master/empresas";
}

export default async function MasterEmpresasPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = param(params.q);
  const status = param(params.status);
  const planoId = param(params.plano);
  const page = Number(param(params.page) || 1);
  const [lista, metricas, planos] = await Promise.all([
    listarEmpresasMaster({ q, status, planoId, page }),
    metricasMaster(),
    listarPlanosMaster(),
  ]);
  const totalPaginas = Math.max(1, Math.ceil(lista.total / lista.pageSize));
  const cards = [
    { label: "Total de empresas", valor: String(metricas.empresas) },
    { label: "Ativas", valor: String(metricas.ativas) },
    { label: "Em teste", valor: String(metricas.trial) },
    { label: "Suspensas", valor: String(metricas.suspensas) },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-950">Empresas</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Administração comercial das empresas da plataforma.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <article
            key={card.label}
            className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm"
          >
            <p className="text-[12px] text-zinc-500">{card.label}</p>
            <p className="mt-1 text-2xl font-bold tracking-tight text-zinc-950">
              {card.valor}
            </p>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-100 px-4 py-3">
          <form
            action="/master/empresas"
            className="flex flex-col gap-3 lg:flex-row lg:items-center"
          >
            <input type="hidden" name="status" value={lista.status} />
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                name="q"
                defaultValue={lista.q}
                placeholder="Buscar nome fantasia, razão social ou CNPJ"
                className="updv-input updv-input-search w-full"
              />
            </div>
            <select
              name="plano"
              defaultValue={lista.planoId}
              className="updv-input w-full lg:w-52"
            >
              <option value="">Todos os planos</option>
              {planos.map((plano) => (
                <option key={plano.id} value={plano.id}>
                  {plano.nome}
                </option>
              ))}
            </select>
            <button type="submit" className="updv-btn updv-btn-primary shrink-0">
              Buscar
            </button>
          </form>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {FILTROS.map((filtro) => {
              const ativo = lista.status === filtro.id;
              return (
                <Link
                  key={filtro.id || "todas"}
                  href={hrefLista({
                    q: lista.q,
                    status: filtro.id,
                    planoId: lista.planoId,
                  })}
                  className={`inline-flex h-8 items-center rounded-md px-3 text-[13px] font-medium ${
                    ativo
                      ? "bg-zinc-900 text-white"
                      : "bg-zinc-50 text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-100"
                  }`}
                >
                  {filtro.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="updv-table min-w-[980px]">
            <thead>
              <tr>
                <th>Ações</th>
                <th>Empresa</th>
                <th>CNPJ</th>
                <th>Plano</th>
                <th>Status</th>
                <th>Valor contratado</th>
                <th>Usuários</th>
                <th>Cadastro</th>
              </tr>
            </thead>
            <tbody>
              {lista.linhas.length === 0 ? (
                <tr>
                  <td colSpan={8} className="updv-table-empty">
                    Nenhuma empresa encontrada.
                  </td>
                </tr>
              ) : (
                lista.linhas.map((linha) => (
                  <tr key={linha.id}>
                    <td>
                      <RowActions
                        editHref={`/master/empresas/${linha.id}`}
                        editLabel="Abrir"
                      />
                    </td>
                    <td>
                      <Link
                        href={`/master/empresas/${linha.id}`}
                        className="font-medium text-zinc-950 hover:underline"
                      >
                        {linha.nome}
                      </Link>
                    </td>
                    <td>{formatarCnpjMaster(linha.cnpj)}</td>
                    <td>{linha.plano}</td>
                    <td>
                      <StatusBadge status={linha.status}>
                        {linha.rotuloStatus}
                      </StatusBadge>
                    </td>
                    <td>
                      {linha.valorContratado == null
                        ? "—"
                        : formatarMoeda(linha.valorContratado)}
                    </td>
                    <td>{linha.usuarios ?? "—"}</td>
                    <td>{formatarData(linha.cadastro)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 px-4 py-3">
          <p className="text-sm text-zinc-500">
            {lista.total} empresa{lista.total === 1 ? "" : "s"}
            {totalPaginas > 1 ? ` · Página ${lista.page} de ${totalPaginas}` : ""}
          </p>
          <div className="flex gap-2">
            {lista.page > 1 ? (
              <Link
                href={hrefLista({
                  q: lista.q,
                  status: lista.status,
                  planoId: lista.planoId,
                  page: lista.page - 1,
                })}
                className="updv-btn updv-btn-ghost"
              >
                Anterior
              </Link>
            ) : null}
            {lista.page < totalPaginas ? (
              <Link
                href={hrefLista({
                  q: lista.q,
                  status: lista.status,
                  planoId: lista.planoId,
                  page: lista.page + 1,
                })}
                className="updv-btn updv-btn-ghost"
              >
                Próxima
              </Link>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
