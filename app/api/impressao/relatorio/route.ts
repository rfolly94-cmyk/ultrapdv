import { linhasRelatorioPdf } from "@/lib/impressao/linhas-relatorio";
import { gerarPdfSimples } from "@/lib/impressao/pdf-simples";
import { respostaPdf } from "@/lib/impressao/resposta-pdf";
import { carregarRelatorio } from "@/lib/relatorios/carregar";
import { parseFiltrosRelatorio, obterContextoRelatorio } from "@/lib/relatorios/contexto";
import { resolverPeriodoRelatorio } from "@/lib/relatorios/periodo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  params.exportar = "1";
  const filtros = parseFiltrosRelatorio(params);
  const ctx = await obterContextoRelatorio();
  const janela = resolverPeriodoRelatorio(filtros.periodo, filtros.de, filtros.ate);
  const relatorio = await carregarRelatorio(filtros);
  const pdf = gerarPdfSimples({
    papel: "a4",
    linhas: linhasRelatorioPdf({
      empresaNome: ctx.empresaNome,
      periodo: janela.rotulo,
      relatorio,
    }),
  });

  return respostaPdf(pdf, `relatorio-${filtros.aba}.pdf`);
}
