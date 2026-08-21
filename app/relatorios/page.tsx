import Link from "next/link";
import { Suspense } from "react";

import { RelatorioAcoes } from "@/components/relatorios/relatorio-acoes";
import { RelatorioConteudo } from "@/components/relatorios/relatorio-conteudo";
import { RelatorioFiltros } from "@/components/relatorios/relatorio-filtros";
import { RelatorioImpressaoCabecalho } from "@/components/relatorios/relatorio-impressao-cabecalho";
import { RelatorioResumo } from "@/components/relatorios/relatorio-resumo";
import { RelatoriosAbas } from "@/components/relatorios/relatorios-abas";
import { PageShell } from "@/components/layout/page-shell";
import { DashboardBarChart } from "@/components/dashboard/dashboard-chart";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { obterIdentidadeEmpresaSessao } from "@/lib/empresa/identidade-sessao";
import { carregarRelatorio } from "@/lib/relatorios/carregar";
import { parseFiltrosRelatorio } from "@/lib/relatorios/contexto";
import { resolverPeriodoRelatorio } from "@/lib/relatorios/periodo";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Relatórios",
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function hrefComParams(
  params: Record<string, string | string[] | undefined>,
  extra: Record<string, string>
) {
  const busca = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    const texto = Array.isArray(valor) ? valor[0] : valor;
    if (texto) {
      busca.set(chave, texto);
    }
  }
  for (const [chave, valor] of Object.entries(extra)) {
    busca.set(chave, valor);
  }
  return `/relatorios?${busca.toString()}`;
}

export default async function RelatoriosPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filtros = parseFiltrosRelatorio(params);
  const janela = resolverPeriodoRelatorio(filtros.periodo, filtros.de, filtros.ate);
  const [relatorio, identidade] = await Promise.all([
    carregarRelatorio(filtros),
    obterIdentidadeEmpresaSessao(),
  ]);

  const totalPaginas = Math.max(
    1,
    Math.ceil(relatorio.totalFiltrado / filtros.porPagina)
  );
  const exportQuery = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    const texto = Array.isArray(valor) ? valor[0] : valor;
    if (texto) {
      exportQuery.set(chave, texto);
    }
  }
  exportQuery.set("aba", filtros.aba);
  exportQuery.set("exportar", "1");

  return (
    <PageShell
      title="Relatórios"
      description="Acompanhe os resultados da empresa."
      tabs={
        <Suspense>
          <RelatoriosAbas />
        </Suspense>
      }
      toolbar={<RelatorioFiltros filtros={filtros} opcoes={relatorio.opcoes} />}
      actions={
        filtros.aba === "estoque" ? (
          <div className="print-hide flex gap-2">
            <Link
              href={`/relatorios?aba=estoque`}
              className={`updv-btn ${filtros.subaba !== "movimentacoes" ? "updv-btn-primary" : "updv-btn-ghost"}`}
            >
              Posição
            </Link>
            <Link
              href={`/relatorios?aba=estoque&subaba=movimentacoes&periodo=${filtros.periodo}`}
              className={`updv-btn ${filtros.subaba === "movimentacoes" ? "updv-btn-primary" : "updv-btn-ghost"}`}
            >
              Movimentações
            </Link>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-5 px-4 py-4">
        <RelatorioImpressaoCabecalho
          logoUrl={identidade?.logoUrl}
          empresaNome={identidade?.nome || "Empresa"}
          titulo={relatorio.titulo}
          periodo={janela.rotulo}
        />

        <RelatorioResumo indicadores={relatorio.indicadores} />

        {relatorio.grafico && relatorio.grafico.length > 1 ? (
          <DashboardSection title="Vendas por dia">
            <DashboardBarChart pontos={relatorio.grafico} />
          </DashboardSection>
        ) : null}

        <RelatorioConteudo relatorio={relatorio} />

        <div className="print-hide flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12px] text-zinc-500">
            {relatorio.totalFiltrado} registro(s) · página {filtros.pagina} de{" "}
            {totalPaginas}
          </p>
          <div className="flex items-center gap-2">
            {filtros.pagina > 1 ? (
              <Link
                href={hrefComParams(params, { pagina: String(filtros.pagina - 1) })}
                className="updv-btn updv-btn-ghost"
              >
                Anterior
              </Link>
            ) : null}
            {filtros.pagina < totalPaginas ? (
              <Link
                href={hrefComParams(params, { pagina: String(filtros.pagina + 1) })}
                className="updv-btn updv-btn-ghost"
              >
                Próxima
              </Link>
            ) : null}
            <RelatorioAcoes
              exportHref={`/api/relatorios/exportar?${exportQuery.toString()}`}
              printHref={`/api/impressao/relatorio?${exportQuery.toString()}`}
            />
          </div>
        </div>
      </div>
    </PageShell>
  );
}
