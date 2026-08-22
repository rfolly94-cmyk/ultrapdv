import Link from "next/link";
import {
  Building2,
  CircleAlert,
  CreditCard,
  Sparkles,
} from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import type { DashboardMasterPainelDados } from "@/lib/master/dashboard-calculo";
import { formatarData, formatarDataHora, formatarMoeda } from "@/lib/relatorios/formatacao";

function partesSaoPaulo(data: Date) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(data);
  const valor = (tipo: string) =>
    partes.find((item) => item.type === tipo)?.value ?? "";
  return {
    chave: `${valor("year")}-${valor("month")}-${valor("day")}`,
    hora: `${valor("hour")}:${valor("minute")}`,
  };
}

function rotuloQuando(iso: string, agora = new Date()) {
  if (!iso) {
    return "—";
  }
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) {
    return "—";
  }
  const hoje = partesSaoPaulo(agora);
  const alvo = partesSaoPaulo(data);
  const ontemDate = new Date(agora.getTime() - 86_400_000);
  const ontem = partesSaoPaulo(ontemDate);
  if (alvo.chave === hoje.chave) {
    return `Hoje, ${alvo.hora}`;
  }
  if (alvo.chave === ontem.chave) {
    return `Ontem, ${alvo.hora}`;
  }
  return formatarDataHora(iso);
}

function CardIndicador({
  label,
  valor,
  hint,
  href,
  title,
}: {
  label: string;
  valor: string;
  hint?: string;
  href?: string;
  title?: string;
}) {
  const conteudo = (
    <>
      <p className="text-[12px] text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-bold tracking-tight text-zinc-950">{valor}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-zinc-400">{hint}</p> : null}
    </>
  );
  const classe =
    "block rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm";

  if (href) {
    return (
      <Link href={href} className={`${classe} hover:border-zinc-300`} title={title}>
        {conteudo}
      </Link>
    );
  }

  return (
    <article className={classe} title={title}>
      {conteudo}
    </article>
  );
}

function GraficoCrescimento({
  pontos,
}: {
  pontos: DashboardMasterPainelDados["crescimento"];
}) {
  const maximo = Math.max(...pontos.map((item) => item.valor), 0);

  if (pontos.every((item) => item.valor === 0)) {
    return (
      <p className="py-10 text-center text-sm text-zinc-400">
        Ainda não há cadastros no período.
      </p>
    );
  }

  return (
    <div className="flex h-40 items-end gap-2">
      {pontos.map((ponto) => {
        const altura = maximo > 0 ? Math.max(6, (ponto.valor / maximo) * 100) : 6;
        return (
          <div
            key={ponto.chave}
            className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
            title={`${ponto.rotulo}: ${ponto.valor}`}
          >
            <span className="text-[11px] font-medium text-zinc-500">
              {ponto.valor}
            </span>
            <div className="flex h-28 w-full items-end justify-center">
              <div
                className="w-3/5 max-w-7 rounded-t-md bg-zinc-800"
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

function deltaNovas(delta: number) {
  if (delta === 0) {
    return "Igual ao mês anterior";
  }
  const sinal = delta > 0 ? "+" : "";
  return `${sinal}${delta} em relação ao mês anterior`;
}

export function DashboardMasterPainel({
  dados,
}: {
  dados: DashboardMasterPainelDados;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-950">Master</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Visão geral da plataforma UltraPDV
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/master/empresas" className="updv-btn updv-btn-primary">
            <Building2 className="h-3.5 w-3.5" />
            Ver empresas
          </Link>
          <Link href="/master/planos" className="updv-btn updv-btn-ghost">
            <CreditCard className="h-3.5 w-3.5" />
            Gerenciar planos
          </Link>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CardIndicador
          label="Empresas"
          valor={String(dados.empresas)}
          href="/master/empresas"
        />
        <CardIndicador
          label="Ativas"
          valor={String(dados.ativas)}
          href="/master/empresas?status=ativa"
        />
        <CardIndicador
          label="Em teste"
          valor={String(dados.trial)}
          href="/master/empresas?status=trial"
        />
        <CardIndicador
          label="Suspensas"
          valor={String(dados.suspensas)}
          href="/master/empresas?status=suspensa"
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CardIndicador
          label="MRR contratado"
          valor={formatarMoeda(dados.mrrContratado)}
          hint="Soma mensal dos contratos ativos. Não representa pagamentos recebidos."
          title="Soma mensal dos contratos ativos. Não representa pagamentos recebidos."
        />
        <CardIndicador
          label="Novas no mês"
          valor={String(dados.novasNoMes)}
          hint={deltaNovas(dados.deltaNovas)}
          href="/master/empresas"
        />
        <CardIndicador
          label="Plano mais utilizado"
          valor={dados.planoLider?.nome || "—"}
          hint={
            dados.planoLider
              ? `${dados.planoLider.quantidade} ${
                  dados.planoLider.quantidade === 1 ? "empresa" : "empresas"
                }`
              : "Sem assinaturas com plano"
          }
          href={
            dados.planoLider?.planoId
              ? `/master/empresas?plano=${dados.planoLider.planoId}`
              : undefined
          }
        />
        <CardIndicador
          label="Assinaturas ativas"
          valor={String(dados.assinaturasAtivas)}
          href="/master/empresas?status=ativa"
        />
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white px-4 py-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-900">
            Crescimento de empresas
          </h2>
          <div className="flex gap-1.5">
            <Link
              href="/master"
              className={`inline-flex h-7 items-center rounded-md px-2.5 text-[12px] font-medium ${
                dados.meses === 6
                  ? "bg-zinc-900 text-white"
                  : "bg-zinc-50 text-zinc-600 ring-1 ring-zinc-200"
              }`}
            >
              6 meses
            </Link>
            <Link
              href="/master?meses=12"
              className={`inline-flex h-7 items-center rounded-md px-2.5 text-[12px] font-medium ${
                dados.meses === 12
                  ? "bg-zinc-900 text-white"
                  : "bg-zinc-50 text-zinc-600 ring-1 ring-zinc-200"
              }`}
            >
              12 meses
            </Link>
          </div>
        </div>
        <GraficoCrescimento pontos={dados.crescimento} />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-zinc-200 bg-white px-4 py-4 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">Empresas por plano</h2>
          {dados.distribuicao.length === 0 ? (
            <p className="mt-6 text-sm text-zinc-500">Nenhuma empresa cadastrada.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {dados.distribuicao.map((item) => {
                const conteudo = (
                  <>
                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                      <span className="truncate font-medium text-zinc-900">
                        {item.nome}
                      </span>
                      <span className="shrink-0 text-zinc-500">
                        {item.quantidade}
                        <span className="ml-2 text-zinc-400">{item.percentual}%</span>
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100">
                      <div
                        className="h-full rounded-full bg-zinc-800"
                        style={{ width: `${Math.min(100, item.percentual)}%` }}
                      />
                    </div>
                  </>
                );
                if (item.planoId) {
                  return (
                    <li key={item.planoId}>
                      <Link
                        href={`/master/empresas?plano=${item.planoId}`}
                        className="block rounded-md hover:opacity-80"
                      >
                        {conteudo}
                      </Link>
                    </li>
                  );
                }
                return <li key="sem-assinatura">{conteudo}</li>;
              })}
            </ul>
          )}
        </article>

        <article className="rounded-2xl border border-zinc-200 bg-white px-4 py-4 shadow-sm">
          <div className="flex items-center gap-2">
            <CircleAlert className="h-4 w-4 text-amber-600" />
            <h2 className="text-sm font-semibold text-zinc-900">
              Precisam de atenção
            </h2>
          </div>
          {dados.atencao.length === 0 ? (
            <p className="mt-6 text-sm text-zinc-500">
              Nenhuma empresa precisa de atenção agora.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-zinc-100">
              {dados.atencao.map((item) => (
                <li
                  key={item.empresaId}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-950">
                      {item.nome}
                    </p>
                    <p className="text-[12px] text-zinc-500">{item.motivo}</p>
                  </div>
                  <Link
                    href={`/master/empresas/${item.empresaId}`}
                    className="updv-btn-row shrink-0"
                  >
                    Ver empresa
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-zinc-200 bg-white px-4 py-4 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-900">Empresas recentes</h2>
          {dados.recentes.length === 0 ? (
            <p className="mt-6 text-sm text-zinc-500">Nenhum cadastro ainda.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="updv-table min-w-[420px]">
                <thead>
                  <tr>
                    <th>Empresa</th>
                    <th>Plano</th>
                    <th>Status</th>
                    <th>Cadastro</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.recentes.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <Link
                          href={`/master/empresas/${item.id}`}
                          className="font-medium text-zinc-950 hover:underline"
                        >
                          {item.nome}
                        </Link>
                      </td>
                      <td>{item.plano}</td>
                      <td>
                        <StatusBadge status={item.status || "inativo"}>
                          {item.rotuloStatus}
                        </StatusBadge>
                      </td>
                      <td>{formatarData(item.cadastro)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>

        <article className="rounded-2xl border border-zinc-200 bg-white px-4 py-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-zinc-500" />
            <h2 className="text-sm font-semibold text-zinc-900">
              Atividade Master
            </h2>
          </div>
          {dados.atividade.length === 0 ? (
            <p className="mt-6 text-sm text-zinc-500">
              Nenhum evento administrativo recente.
            </p>
          ) : (
            <ol className="mt-3 space-y-3">
              {dados.atividade.map((item) => (
                <li key={item.id} className="border-b border-zinc-100 pb-3 last:border-0 last:pb-0">
                  <p className="text-[11px] text-zinc-400">{rotuloQuando(item.quando)}</p>
                  <p className="mt-0.5 text-sm font-medium text-zinc-950">{item.rotulo}</p>
                  {item.empresaId ? (
                    <Link
                      href={`/master/empresas/${item.empresaId}`}
                      className="text-sm text-zinc-600 hover:underline"
                    >
                      {item.empresaNome}
                    </Link>
                  ) : null}
                  {item.detalhe ? (
                    <p className="text-sm text-zinc-600">{item.detalhe}</p>
                  ) : null}
                  <p className="text-[12px] text-zinc-400">
                    por {item.administrador || "—"}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </article>
      </section>
    </div>
  );
}
