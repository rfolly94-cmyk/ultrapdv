import { NextRequest } from "next/server";

import { jsonCors, respostaNegacaoApi, respostaOptions } from "@/lib/api/cors-mobile";
import { resolverContextoEmpresaAtiva } from "@/lib/api/contexto-empresa-ativa";
import { exigirOperacaoProduto } from "@/lib/produtos/acesso-operacao";
import { exigirRecursoEmpresa } from "@/lib/plataforma/entitlements/exigir-recurso";
import { persistirCatalogoProdutoApi } from "@/lib/produtos/persistir-api";

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
    await exigirRecursoEmpresa({
      empresaId: ctx.empresaId,
      recurso: "catalogo",
      origem: "PATCH /api/produtos/[id]/catalogo",
    });
    await exigirOperacaoProduto({
      empresaId: ctx.empresaId,
      acao: "editar",
      origem: "PATCH /api/produtos/[id]/catalogo",
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
  const resultado = await persistirCatalogoProdutoApi({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    produtoId: id,
    catalogo: {
      publicado: dados.publicado === true,
      destaque: dados.destaque === true,
      mostrarPreco: dados.mostrarPreco !== false,
      descricao: typeof dados.descricao === "string" ? dados.descricao : null,
      removerImagem: dados.removerImagem === true,
      imagemBase64: typeof dados.imagemBase64 === "string" ? dados.imagemBase64 : null,
      imagemTipo: typeof dados.imagemTipo === "string" ? dados.imagemTipo : null,
    },
  });

  if (!resultado.ok) {
    return jsonCors(resultado, 400, "PATCH, OPTIONS");
  }

  return jsonCors(resultado, 200, "PATCH, OPTIONS");
}
