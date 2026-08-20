import Link from "next/link";

import { MasterSuporteAtendimento } from "@/components/master/suporte-atendimento";
import { StatusBadge } from "@/components/ui/status-badge";
import { listarFilaSuporteMaster } from "@/app/master/suporte/actions";
import { formatarDataHora } from "@/lib/relatorios/formatacao";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Suporte",
};

const FILTROS = [
  { id: "", label: "Todas" },
  { id: "aguardando_suporte", label: "Aguardando suporte" },
  { id: "aguardando_cliente", label: "Aguardando cliente" },
  { id: "encerrada", label: "Encerradas" },
];

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function valor(params: Record<string, string | string[] | undefined>, chave: string) {
  const atual = params[chave];
  return Array.isArray(atual) ? atual[0] ?? "" : atual ?? "";
}

export default async function MasterSuportePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = valor(params, "q");
  const status = valor(params, "status");
  const conversaId = valor(params, "id");
  const fila = await listarFilaSuporteMaster({ q, status });
  const linhas = fila.ok ? fila.linhas : [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-950">Suporte</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Atendimentos das empresas da plataforma.
        </p>
      </div>

      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <form
          action="/master/suporte"
          className="flex flex-col gap-3 border-b border-zinc-100 px-4 py-3 sm:flex-row sm:items-center"
        >
          <input type="hidden" name="status" value={status} />
          <input
            name="q"
            defaultValue={q}
            placeholder="Buscar empresa"
            className="updv-input min-w-0 flex-1"
          />
          <button type="submit" className="updv-btn updv-btn-primary">
            Buscar
          </button>
        </form>
        <div className="flex flex-wrap gap-1.5 px-4 py-3">
          {FILTROS.map((filtro) => (
            <Link
              key={filtro.id || "todas"}
              href={`/master/suporte?status=${filtro.id}&q=${encodeURIComponent(q)}`}
              className={`inline-flex h-8 items-center rounded-md px-3 text-[13px] font-medium ${
                status === filtro.id
                  ? "bg-zinc-900 text-white"
                  : "bg-zinc-50 text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-100"
              }`}
            >
              {filtro.label}
            </Link>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="updv-table min-w-[860px]">
            <thead>
              <tr>
                <th>Ações</th>
                <th>Empresa</th>
                <th>Usuário</th>
                <th>Última mensagem</th>
                <th>Status</th>
                <th>Horário</th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="updv-table-empty">
                    Nenhum atendimento aguardando suporte.
                  </td>
                </tr>
              ) : (
                linhas.map((linha) => (
                  <tr
                    key={linha.id}
                    className={conversaId === linha.id ? "bg-sky-50" : undefined}
                  >
                    <td>
                      <Link
                        href={`/master/suporte?id=${linha.id}&status=${status}&q=${encodeURIComponent(q)}`}
                        className="updv-btn-row"
                      >
                        Abrir
                      </Link>
                    </td>
                    <td className="font-medium">{linha.empresa_nome}</td>
                    <td>{linha.usuario_nome}</td>
                    <td className="max-w-xs truncate">{linha.ultima_mensagem}</td>
                    <td>
                      <StatusBadge status={String(linha.status)} />
                    </td>
                    <td>{formatarDataHora(linha.ultima_mensagem_em)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {conversaId ? <MasterSuporteAtendimento conversaId={conversaId} /> : null}
    </div>
  );
}
