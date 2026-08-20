import { NextResponse } from "next/server";

import { carregarRelatorio } from "@/lib/relatorios/carregar";
import { parseFiltrosRelatorio, obterContextoRelatorio } from "@/lib/relatorios/contexto";
import { montarPlanilhaRelatorio, nomeArquivoRelatorio } from "@/lib/relatorios/exportar";
import { resolverPeriodoRelatorio } from "@/lib/relatorios/periodo";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  params.exportar = "1";
  const filtros = parseFiltrosRelatorio(params);
  const ctx = await obterContextoRelatorio();
  const janela = resolverPeriodoRelatorio(filtros.periodo, filtros.de, filtros.ate);
  const relatorio = await carregarRelatorio(filtros);
  const buffer = montarPlanilhaRelatorio(
    relatorio,
    ctx.empresaNome,
    janela.rotulo
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nomeArquivoRelatorio(filtros.aba, ctx.empresaId)}"`,
    },
  });
}
