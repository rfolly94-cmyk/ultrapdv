import Link from "next/link";
import { redirect } from "next/navigation";

import { resolverAssinaturaEmpresaAtiva } from "@/lib/assinatura/resolver-assinatura-empresa";
import {
  carenciaValida,
  liberacaoTemporariaValida,
  rotuloStatusAssinatura,
} from "@/lib/assinatura/empresa-pode-operar";
import { formatarData, formatarDataHora } from "@/lib/relatorios/formatacao";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Assinatura",
};

export default async function AssinaturaPage() {
  const resolvida = await resolverAssinaturaEmpresaAtiva();
  if (!resolvida) {
    redirect("/login");
  }

  const { assinatura, operacional } = resolvida;
  const status = rotuloStatusAssinatura(assinatura);
  const emCarencia = carenciaValida(
    assinatura?.status,
    assinatura?.carencia_ate
  );
  const temporaria = liberacaoTemporariaValida(assinatura?.liberado_ate);

  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-950">Assinatura</h1>
        <p className="mt-1 text-sm text-zinc-500">Situação comercial da empresa ativa.</p>
      </div>

      {!operacional ? (
        <section className="rounded-2xl border border-zinc-200 bg-white p-6">
          <h2 className="text-lg font-semibold">Assinatura suspensa</h2>
          <p className="mt-2 text-sm text-zinc-600">
            O acesso às funções operacionais do UltraPDV está temporariamente
            restrito.
          </p>
          <p className="mt-2 text-sm text-zinc-600">
            Entre em contato para regularizar sua assinatura.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/assinatura" className="updv-btn updv-btn-primary">
              Ver assinatura
            </Link>
            <a href="/logout" className="updv-btn updv-btn-ghost">
              Sair
            </a>
          </div>
        </section>
      ) : null}

      {operacional && emCarencia ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Sua assinatura está pendente. Regularize até{" "}
          {formatarData(assinatura?.carencia_ate)} para evitar a suspensão.
        </p>
      ) : null}

      {operacional && !emCarencia && assinatura?.status === "ativa" ? (
        <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Sua assinatura está ativa.
        </p>
      ) : null}

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm">
        <dl className="grid gap-3">
          <div>
            <dt className="text-zinc-500">Plano</dt>
            <dd className="font-medium">{assinatura?.plano_nome || "—"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Status</dt>
            <dd className="font-medium">{status}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Vencimento</dt>
            <dd>{formatarData(assinatura?.vencimento_em)}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Liberação temporária</dt>
            <dd>
              {temporaria
                ? formatarDataHora(assinatura?.liberado_ate)
                : "Nenhuma"}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
