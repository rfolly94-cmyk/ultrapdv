import { NextRequest, NextResponse } from "next/server";

import {
  exigirOperacaoContabilidade,
  respostaNegacaoContabilidade,
} from "@/lib/contabilidade/acesso-operacao";
import { parseCompetencia } from "@/lib/contabilidade/competencia";
import { obterContextoContabilidade } from "@/lib/contabilidade/contexto";
import { registrarEventoContabilidade } from "@/lib/contabilidade/eventos";
import { montarZipCompetencia } from "@/lib/contabilidade/zip-competencia";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const ctx = await obterContextoContabilidade();

  try {
    await exigirOperacaoContabilidade({
      empresaId: ctx.empresaId,
      acao: "baixar_xml",
      origem: "GET /api/contabilidade/zip",
    });
  } catch (error) {
    const negacao = respostaNegacaoContabilidade(error);
    if (negacao) {
      return negacao;
    }
    throw error;
  }

  const competencia = parseCompetencia(
    request.nextUrl.searchParams.get("competencia")
  );

  try {
    const zip = await montarZipCompetencia({
      supabase: ctx.supabase,
      admin: createAdminClient(),
      empresaId: ctx.empresaId,
      empresaNome: ctx.empresaNome,
      competencia,
      fuso: ctx.fusoHorario,
    });

    await registrarEventoContabilidade(ctx.supabase, {
      empresaId: ctx.empresaId,
      tipo: "ZIP_GERADO",
      usuarioId: ctx.usuarioId,
      ano: competencia.ano,
      mes: competencia.mes,
      detalhe: `${zip.arquivos} arquivos, ${zip.pendentes} XML(s) pendente(s).`,
    });

    return new NextResponse(new Uint8Array(zip.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zip.nome}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        erro:
          error instanceof Error
            ? error.message
            : "Não foi possível gerar o ZIP da competência.",
      },
      { status: 422 }
    );
  }
}
