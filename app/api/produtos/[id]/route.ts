import { NextRequest } from "next/server";

import { jsonCors, respostaNegacaoApi, respostaOptions } from "@/lib/api/cors-mobile";
import { resolverContextoEmpresaAtiva } from "@/lib/api/contexto-empresa-ativa";
import { exigirOperacaoProduto } from "@/lib/produtos/acesso-operacao";
import {
  carregarProdutoApi,
  persistirProdutoComercialApi,
} from "@/lib/produtos/persistir-api";
import { planoPermiteRecursoEmpresa } from "@/lib/plataforma/entitlements/exigir-recurso";
import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import { temPermissao } from "@/lib/permissoes/tem-permissao";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function OPTIONS() {
  return respostaOptions();
}

export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const ctx = await resolverContextoEmpresaAtiva(
    request.headers.get("authorization")
  );
  if (!ctx.ok) {
    return jsonCors({ ok: false, erro: ctx.erro, codigo: ctx.codigo }, ctx.status);
  }

  try {
    await exigirOperacaoProduto({
      empresaId: ctx.empresaId,
      acao: "acessar",
      origem: "GET /api/produtos/[id]",
    });
  } catch (error) {
    return respostaNegacaoApi(error) ?? jsonCors({ ok: false, erro: "Acesso negado." }, 403);
  }

  const dados = await carregarProdutoApi({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    produtoId: id,
  });

  if (!dados) {
    return jsonCors({ ok: false, erro: "Produto não encontrado." }, 404);
  }

  const [catalogo, sessao] = await Promise.all([
    planoPermiteRecursoEmpresa(ctx.empresaId, "catalogo"),
    obterPermissoesSessao(),
  ]);

  return jsonCors({
    ok: true,
    ...dados,
    catalogoNoPlano: catalogo.permitido,
    podeEditar: Boolean(sessao && temPermissao(sessao.permissoes, "produtos", "editar")),
  });
}

export async function PATCH(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const ctx = await resolverContextoEmpresaAtiva(
    request.headers.get("authorization")
  );
  if (!ctx.ok) {
    return jsonCors({ ok: false, erro: ctx.erro, codigo: ctx.codigo }, ctx.status);
  }

  try {
    await exigirOperacaoProduto({
      empresaId: ctx.empresaId,
      acao: "editar",
      origem: "PATCH /api/produtos/[id]",
    });
  } catch (error) {
    return respostaNegacaoApi(error) ?? jsonCors({ ok: false, erro: "Acesso negado." }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonCors({ ok: false, erro: "Payload inválido." }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonCors({ ok: false, erro: "Payload inválido." }, 400);
  }

  const dados = body as Record<string, unknown>;
  const resultado = await persistirProdutoComercialApi({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    produtoId: id,
    dados: {
      codigo: typeof dados.codigo === "string" ? dados.codigo : null,
      codigoBarras: typeof dados.codigoBarras === "string" ? dados.codigoBarras : null,
      nome: typeof dados.nome === "string" ? dados.nome : null,
      descricao: typeof dados.descricao === "string" ? dados.descricao : null,
      categoriaId: typeof dados.categoriaId === "string" ? dados.categoriaId : null,
      marcaId: typeof dados.marcaId === "string" ? dados.marcaId : null,
      unidade: typeof dados.unidade === "string" ? dados.unidade : null,
      precoCusto: dados.precoCusto as number | string | null,
      precoVenda: dados.precoVenda as number | string | null,
      ativo: dados.ativo !== false,
    },
  });

  if (!resultado.ok) {
    return jsonCors(resultado, 400);
  }

  return jsonCors(resultado);
}
