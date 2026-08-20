import Link from "next/link";
import { Search } from "lucide-react";

import { RowActions } from "@/components/ui/row-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { listarEmpresasMaster } from "@/lib/master/empresas";
import { formatarData } from "@/lib/relatorios/formatacao";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Empresas",
};

const FILTROS = [
  { id: "", label: "Todas" },
  { id: "ativa", label: "Ativas" },
  { id: "trial", label: "Trial" },
  { id: "carencia", label: "Carência" },
  { id: "suspensa", label: "Suspensas" },
  { id: "cancelada", label: "Canceladas" },
];

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function formatarCnpj(valor: string) {
  const digitos = valor.replace(/\D/g, "");
  if (digitos.length !== 14) {
    return valor || "—";
  }
  return digitos.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    "$1.$2.$3/$4-$5"
  );
}

function hrefLista(params: { q: string; status: string; page?: number }) {
  const busca = new URLSearchParams();
  if (params.q) {
    busca.set("q", params.q);
  }
  if (params.status) {
    busca.set("status", params.status);
  }
  if (params.page && params.page > 1) {
    busca.set("page", String(params.page));
  }
  const query = busca.toString();
  return query ? `/master/empresas?${query}` : "/master/empresas";
}

export default async function MasterEmpresasPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = Array.isArray(params.q) ? params.q[0] : params.q ?? "";
  const status = Array.isArray(params.status) ? params.status[0] : params.status ?? "";
  const page = Number(Array.isArray(params.page) ? params.page[0] : params.page ?? 1);
  const lista = await listarEmpresasMaster({ q, status, page });
  const totalPaginas = Math.max(1, Math.ceil(lista.total / lista.pageSize));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-950">Empresas</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Plano, status e vencimento de cada empresa da plataforma.
        </p>
      </div>

      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-100 px-4 py-3">
          <form
            action="/master/empresas"
            className="flex flex-col gap-3 sm:flex-row sm:items-center"
          >
            <input type="hidden" name="status" value={lista.status} />
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                name="q"
                defaultValue={lista.q}
                placeholder="Buscar por nome ou CNPJ"
                className="updv-input updv-input-search w-full"
              />
            </div>
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
                  href={hrefLista({ q: lista.q, status: filtro.id })}
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
          <table className="updv-table min-w-[920px]">
            <thead>
              <tr>
                <th>Ações</th>
                <th>Empresa</th>
                <th>CNPJ</th>
                <th>Plano</th>
                <th>Status</th>
                <th>Vencimento</th>
                <th>Cadastro</th>
              </tr>
            </thead>
            <tbody>
              {lista.linhas.length === 0 ? (
                <tr>
                  <td colSpan={7} className="updv-table-empty">
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
                    <td>{formatarCnpj(linha.cnpj)}</td>
                    <td>{linha.plano}</td>
                    <td>
                      <StatusBadge status={linha.status}>
                        {linha.rotuloStatus}
                      </StatusBadge>
                    </td>
                    <td>{formatarData(linha.vencimento)}</td>
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
