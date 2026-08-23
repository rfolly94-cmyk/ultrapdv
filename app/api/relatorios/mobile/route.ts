import { NextRequest } from "next/server";

import {
  aplicarCors,
  jsonCors,
  respostaNegacaoApi,
  respostaOptions,
} from "@/lib/api/cors-mobile";
import { resolverContextoEmpresaAtiva } from "@/lib/api/contexto-empresa-ativa";
import {
  exigirOperacaoRelatorio,
  respostaNegacaoRelatorio,
} from "@/lib/relatorios/acesso";
import { carregarRelatorio } from "@/lib/relatorios/carregar";
import { parseFiltrosRelatorio } from "@/lib/relatorios/contexto";

export const dynamic = "force-dynamic";

const ABAS_MOBILE = new Set([
  "vendas",
  "pagamentos",
  "produtos",
  "estoque",
  "clientes",
  "carteira",
]);

export async function OPTIONS() {
  return respostaOptions("GET, OPTIONS");
}

export async function GET(request: NextRequest) {
  const ctx = await resolverContextoEmpresaAtiva(
    request.headers.get("authorization")
  );
  if (!ctx.ok) {
    return jsonCors(
      { ok: false, erro: ctx.erro, codigo: ctx.codigo },
      ctx.status,
      "GET, OPTIONS"
    );
  }

  try {
    await exigirOperacaoRelatorio({
      empresaId: ctx.empresaId,
      acao: "acessar",
      origem: "GET /api/relatorios/mobile",
    });
  } catch (error) {
    const negacao = respostaNegacaoRelatorio(error) ?? respostaNegacaoApi(error);
    if (negacao) {
      return aplicarCors(negacao, "GET, OPTIONS");
    }
    return jsonCors({ ok: false, erro: "Acesso negado." }, 403, "GET, OPTIONS");
  }

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const filtros = parseFiltrosRelatorio(params);
  if (!ABAS_MOBILE.has(filtros.aba)) {
    return jsonCors(
      { ok: false, erro: "Relatório indisponível no app." },
      400,
      "GET, OPTIONS"
    );
  }

  const porPagina = Number(params.por_pagina || 8);
  filtros.porPagina = Number.isFinite(porPagina)
    ? Math.min(Math.max(Math.floor(porPagina), 5), 25)
    : 8;

  const relatorio = await carregarRelatorio(filtros);

  return jsonCors(
    {
      ok: true,
      periodo: filtros.periodo,
      de: filtros.de,
      ate: filtros.ate,
      aba: filtros.aba,
      titulo: relatorio.titulo,
      vazio: relatorio.vazio,
      indicadores: relatorio.indicadores,
      colunas: relatorio.colunas,
      linhas: relatorio.linhas,
      totalFiltrado: relatorio.totalFiltrado,
      grafico: relatorio.grafico ?? [],
      extra: relatorio.extra
        ? {
            titulo: relatorio.extra.titulo,
            colunas: relatorio.extra.colunas,
            linhas: relatorio.extra.linhas,
          }
        : null,
    },
    200,
    "GET, OPTIONS"
  );
}
