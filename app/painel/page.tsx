import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Banknote,
  Receipt,
  ShoppingCart,
  Wallet,
} from "lucide-react";

import { DashboardAlertList } from "@/components/dashboard/dashboard-alert-list";
import {
  DashboardBarChart,
  DashboardPaymentBars,
} from "@/components/dashboard/dashboard-chart";
import { DashboardMetricCard } from "@/components/dashboard/dashboard-metric-card";
import { DashboardPeriodoFiltro } from "@/components/dashboard/dashboard-periodo-filtro";
import { DashboardRecentList } from "@/components/dashboard/dashboard-recent-list";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { DashboardSummaryCard } from "@/components/dashboard/dashboard-summary-card";
import { PageShell } from "@/components/layout/page-shell";
import { carregarDashboard } from "@/lib/dashboard/carregar-dashboard";
import { periodoValido } from "@/lib/dashboard/periodo";
import { temAcessoModulo } from "@/lib/permissoes/tem-permissao";
import { obterPermissoesSessao } from "@/lib/permissoes/sessao";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Início",
};

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const quantidade = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 2,
});

type PageProps = {
  searchParams: Promise<{
    periodo?: string;
  }>;
};

export default async function PainelPage({ searchParams }: PageProps) {
  const sessao = await obterPermissoesSessao();
  if (!temAcessoModulo(sessao?.permissoes, "inicio")) {
    redirect("/acesso-negado");
  }

  const params = await searchParams;
  const periodo = periodoValido(params.periodo);
  const dados = await carregarDashboard(periodo);

  if ("redirect" in dados) {
    redirect(dados.redirect);
  }

  return (
    <PageShell
      title="Início"
      description={`${dados.empresaNome} · ${dados.periodoRotulo}`}
      actions={
        <Suspense>
          <DashboardPeriodoFiltro />
        </Suspense>
      }
    >
      <div className="space-y-6 px-4 py-4">
        <div className="grid gap-6 xl:grid-cols-12">
          <div className="grid gap-6 sm:grid-cols-2 xl:col-span-7">
            <DashboardMetricCard
              label="Vendas"
              value={String(dados.kpis.vendas)}
              hint="Concluídas no período"
              href="/vendas"
              accent="indigo"
              icon={<ShoppingCart className="h-4 w-4" />}
            />
            <DashboardMetricCard
              label="Faturamento"
              value={moeda.format(dados.kpis.faturamento)}
              href="/vendas"
              accent="orange"
              icon={<Banknote className="h-4 w-4" />}
            />
            <DashboardMetricCard
              label="Ticket médio"
              value={moeda.format(dados.kpis.ticketMedio)}
              accent="green"
              icon={<Receipt className="h-4 w-4" />}
            />
            <DashboardMetricCard
              label="Recebido"
              value={moeda.format(dados.kpis.recebido)}
              hint="Pagamentos confirmados + carteira"
              accent="pink"
              icon={<Wallet className="h-4 w-4" />}
            />
          </div>

          <div className="xl:col-span-5">
            <DashboardSection title="Faturamento por dia">
              <DashboardBarChart pontos={dados.graficoVendas} />
            </DashboardSection>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-12">
          <div className="xl:col-span-8">
            <DashboardSection title="Formas de pagamento">
              <p className="mb-5 text-[28px] font-bold tracking-tight text-zinc-950">
                {moeda.format(dados.kpis.recebido)}
              </p>
              <DashboardPaymentBars itens={dados.graficoPagamentos} />
            </DashboardSection>
          </div>

          <div className="grid gap-6 xl:col-span-4">
            <DashboardSummaryCard
              label="Clientes atendidos"
              value={String(dados.kpis.clientesAtendidos)}
              hint="Clientes distintos nas vendas do período"
            />
            <DashboardSummaryCard
              label="A receber"
              value={moeda.format(dados.carteira.saldoAberto)}
              hint={`${dados.carteira.clientesDevedores} cliente(s) com saldo`}
              tone={dados.carteira.saldoAberto > 0 ? "alert" : "default"}
            />
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <DashboardSummaryCard
            label="Autorizadas"
            value={String(dados.fiscal.autorizadas)}
            hint="NFC-e / NF-e no período"
            tone="ok"
          />
          <DashboardSummaryCard
            label="Pendências fiscais"
            value={String(
              dados.fiscal.aguardandoReconciliacao +
                dados.fiscal.aguardandoInutilizacao +
                dados.fiscal.comErro
            )}
            hint={`${dados.fiscal.aguardandoReconciliacao} reconciliação · ${dados.fiscal.comErro} erro`}
            tone={
              dados.fiscal.aguardandoReconciliacao +
                dados.fiscal.aguardandoInutilizacao +
                dados.fiscal.comErro >
              0
                ? "alert"
                : "ok"
            }
          />
          <DashboardSummaryCard
            label="Estoque crítico"
            value={String(dados.estoque.zerados + dados.estoque.baixo)}
            hint={`${dados.estoque.zerados} zerados · ${dados.estoque.baixo} baixos`}
            tone={
              dados.estoque.zerados + dados.estoque.baixo > 0
                ? "alert"
                : "ok"
            }
          />
        </div>

        <DashboardSection title="Alertas">
          <DashboardAlertList alertas={dados.alertas} />
        </DashboardSection>

        <DashboardSection title="Últimas vendas" href="/vendas" actionLabel="Ver todas">
          <DashboardRecentList
            itens={dados.ultimasVendas}
            vazio="Nenhuma venda recente."
          />
        </DashboardSection>

        <div className="grid gap-6 xl:grid-cols-2">
          <DashboardSection title="Últimas emissões" href="/fiscal" actionLabel="Fiscal">
            <DashboardRecentList
              itens={dados.ultimasEmissoes}
              vazio="Nenhuma emissão recente."
            />
          </DashboardSection>
          <DashboardSection title="Movimentações de estoque" href="/estoque" actionLabel="Estoque">
            <DashboardRecentList
              itens={dados.ultimasMovimentacoes}
              vazio="Nenhuma movimentação registrada."
              acao="Abrir"
            />
          </DashboardSection>
        </div>

        <DashboardSection title="Estoque">
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <p className="text-[12px] text-zinc-400">Sem estoque</p>
              <p className="mt-1 text-[20px] font-bold text-zinc-950">
                {dados.estoque.zerados}
              </p>
            </div>
            <div>
              <p className="text-[12px] text-zinc-400">Estoque baixo</p>
              <p className="mt-1 text-[20px] font-bold text-zinc-950">
                {dados.estoque.baixo}
              </p>
            </div>
            <div>
              <p className="text-[12px] text-zinc-400">Itens em estoque</p>
              <p className="mt-1 text-[20px] font-bold text-zinc-950">
                {quantidade.format(dados.estoque.quantidadeTotal)}
              </p>
            </div>
            <div>
              <p className="text-[12px] text-zinc-400">Valor a custo</p>
              <p className="mt-1 text-[20px] font-bold text-zinc-950">
                {moeda.format(dados.estoque.valorCusto)}
              </p>
            </div>
          </div>
          {dados.estoque.ultimaMovimentacao && (
            <p className="mt-4 text-[12px] text-zinc-400">
              Última: {dados.estoque.ultimaMovimentacao}
            </p>
          )}
        </DashboardSection>

        <DashboardSection title="Ações rápidas">
          <div className="flex flex-wrap gap-2">
            <Link href="/pdv" className="updv-btn updv-btn-primary">
              Nova venda
            </Link>
            <Link href="/clientes?novo=1" className="updv-btn updv-btn-ghost">
              Novo cliente
            </Link>
            <Link href="/produtos?novo=1" className="updv-btn updv-btn-ghost">
              Novo produto
            </Link>
            <Link href="/estoque" className="updv-btn updv-btn-ghost">
              Abrir estoque
            </Link>
            <Link href="/fiscal" className="updv-btn updv-btn-ghost">
              Abrir fiscal
            </Link>
            <Link href="/clientes" className="updv-btn updv-btn-ghost">
              Clientes / carteira
            </Link>
          </div>
        </DashboardSection>
      </div>
    </PageShell>
  );
}
