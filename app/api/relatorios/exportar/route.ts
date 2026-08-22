import { NextResponse } from "next/server";

import { carregarRelatorio } from "@/lib/relatorios/carregar";
import { parseFiltrosRelatorio, obterContextoRelatorio } from "@/lib/relatorios/contexto";
import { montarPlanilhaRelatorio, nomeArquivoRelatorio } from "@/lib/relatorios/exportar";
import { resolverPeriodoRelatorio } from "@/lib/relatorios/periodo";
import {
  exigirOperacaoRelatorio,
  respostaNegacaoRelatorio,
} from "@/lib/relatorios/acesso";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  params.exportar = "1";
  const filtros = parseFiltrosRelatorio(params);
  const ctx = await obterContextoRelatorio();

  try {
    await exigirOperacaoRelatorio({
      empresaId: ctx.empresaId,
      acao: "exportar",
      origem: "GET /api/relatorios/exportar",
    });
  } catch (error) {
    const negacao = respostaNegacaoRelatorio(error);
    if (negacao) {
      return negacao;
    }
    throw error;
  }

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
