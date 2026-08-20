import Link from "next/link";
import { notFound } from "next/navigation";

import { MasterAcoesAssinatura } from "@/components/master/master-acoes-assinatura";
import { StatusBadge } from "@/components/ui/status-badge";
import { detalheEmpresaMaster } from "@/lib/master/empresas";
import { rotuloStatusAssinatura } from "@/lib/assinatura/empresa-pode-operar";
import { formatarData, formatarDataHora } from "@/lib/relatorios/formatacao";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Empresa",
};

const ROTULOS_EVENTO: Record<string, string> = {
  empresa_ativada: "Assinatura reativada",
  empresa_suspensa: "Empresa suspensa",
  empresa_carencia: "Empresa em carência",
  empresa_liberada_temporariamente: "Liberação temporária",
  plano_alterado: "Plano alterado",
  assinatura_cancelada: "Assinatura cancelada",
  vencimento_alterado: "Vencimento alterado",
};

type PageProps = {
  params: Promise<{ id: string }>;
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

function Campo({
  rotulo,
  valor,
}: {
  rotulo: string;
  valor: string;
}) {
  return (
    <div>
      <dt className="text-[12px] text-zinc-500">{rotulo}</dt>
      <dd className="mt-0.5 font-medium text-zinc-950">{valor}</dd>
    </div>
  );
}

export default async function MasterEmpresaDetalhePage({ params }: PageProps) {
  const { id } = await params;
  const detalhe = await detalheEmpresaMaster(id);
  if (!detalhe) {
    notFound();
  }

  const { empresa, assinatura, planos, historico } = detalhe;
  const nome = empresa.nomeFantasia || empresa.razaoSocial || "Empresa";
  const status = String(assinatura?.status ?? "");
  const rotuloStatus = rotuloStatusAssinatura(assinatura);

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/master/empresas"
          className="text-sm text-zinc-500 hover:text-zinc-900 hover:underline"
        >
          ← Empresas
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-950">
              {nome}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Detalhe comercial. Dados operacionais preservados.
            </p>
          </div>
          <StatusBadge status={status || "ativa"}>{rotuloStatus}</StatusBadge>
        </div>
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">Empresa</h2>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
            <Campo rotulo="Nome fantasia" valor={empresa.nomeFantasia || "—"} />
            <Campo rotulo="Razão social" valor={empresa.razaoSocial || "—"} />
            <Campo rotulo="CNPJ" valor={formatarCnpj(empresa.cnpj)} />
            <Campo rotulo="Cadastro" valor={formatarData(empresa.cadastro)} />
          </dl>
        </article>

        <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">Assinatura</h2>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
            <Campo rotulo="Plano" valor={assinatura?.plano_nome || "—"} />
            <div>
              <dt className="text-[12px] text-zinc-500">Status</dt>
              <dd className="mt-1">
                <StatusBadge status={status || "ativa"}>{rotuloStatus}</StatusBadge>
              </dd>
            </div>
            <Campo rotulo="Início" valor={formatarData(assinatura?.inicio_em)} />
            <Campo rotulo="Vencimento" valor={formatarData(assinatura?.vencimento_em)} />
            <Campo rotulo="Carência" valor={formatarData(assinatura?.carencia_ate)} />
            <Campo
              rotulo="Liberação temporária"
              valor={formatarDataHora(assinatura?.liberado_ate)}
            />
          </dl>
          {assinatura?.observacao ? (
            <p className="mt-4 rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
              {assinatura.observacao}
            </p>
          ) : null}
        </article>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-900">Ações</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Alterações comerciais desta empresa. Os dados de venda e cadastro são
          preservados.
        </p>
        <div className="mt-4">
          <MasterAcoesAssinatura
            empresaId={empresa.id}
            planoId={assinatura?.plano_id ?? null}
            vencimento={assinatura?.vencimento_em ?? null}
            status={status}
            planos={planos}
          />
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-900">Histórico</h2>
        </div>
        {historico.length === 0 ? (
          <p className="px-5 py-8 text-sm text-zinc-500">
            Nenhum evento Master nesta empresa.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="updv-table min-w-[640px]">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Evento</th>
                  <th>Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {historico.map((item) => (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap text-zinc-500">
                      {formatarDataHora(item.createdAt)}
                    </td>
                    <td className="font-medium">
                      {ROTULOS_EVENTO[item.tipo] || item.tipo}
                    </td>
                    <td className="text-zinc-600">
                      {[
                        item.dados.motivo
                          ? `Motivo: ${String(item.dados.motivo)}`
                          : "",
                        item.dados.plano_de || item.dados.plano_para
                          ? `${String(item.dados.plano_de || "—")} → ${String(item.dados.plano_para || "—")}`
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
