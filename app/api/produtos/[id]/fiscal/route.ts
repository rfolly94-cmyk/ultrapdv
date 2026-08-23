import { NextRequest } from "next/server";

import { jsonCors, respostaNegacaoApi, respostaOptions } from "@/lib/api/cors-mobile";
import { resolverContextoEmpresaAtiva } from "@/lib/api/contexto-empresa-ativa";
import { exigirOperacaoProduto } from "@/lib/produtos/acesso-operacao";
import { persistirFiscalProdutoApi } from "@/lib/produtos/persistir-api";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function OPTIONS() {
  return respostaOptions("PATCH, OPTIONS");
}

export async function PATCH(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const ctx = await resolverContextoEmpresaAtiva(
    request.headers.get("authorization")
  );
  if (!ctx.ok) {
    return jsonCors(
      { ok: false, erro: ctx.erro, codigo: ctx.codigo },
      ctx.status,
      "PATCH, OPTIONS"
    );
  }

  try {
    await exigirOperacaoProduto({
      empresaId: ctx.empresaId,
      acao: "editar",
      origem: "PATCH /api/produtos/[id]/fiscal",
    });
  } catch (error) {
    return (
      respostaNegacaoApi(error) ??
      jsonCors({ ok: false, erro: "Acesso negado." }, 403, "PATCH, OPTIONS")
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonCors({ ok: false, erro: "Payload inválido." }, 400, "PATCH, OPTIONS");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonCors({ ok: false, erro: "Payload inválido." }, 400, "PATCH, OPTIONS");
  }

  const dados = body as Record<string, unknown>;
  const resultado = await persistirFiscalProdutoApi({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    produtoId: id,
    ncm: typeof dados.ncm === "string" ? dados.ncm : "",
    cest: typeof dados.cest === "string" ? dados.cest : "",
    origemProduto: typeof dados.origemProduto === "string" ? dados.origemProduto : "0",
    grupoFiscalId: typeof dados.grupoFiscalId === "string" ? dados.grupoFiscalId : null,
  });

  if (!resultado.ok) {
    return jsonCors(resultado, 400, "PATCH, OPTIONS");
  }

  return jsonCors(resultado, 200, "PATCH, OPTIONS");
}
