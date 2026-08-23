import { NextRequest } from "next/server";

import { jsonCors, respostaNegacaoApi, respostaOptions } from "@/lib/api/cors-mobile";
import { resolverContextoEmpresaAtiva } from "@/lib/api/contexto-empresa-ativa";
import { exigirOperacaoProduto } from "@/lib/produtos/acesso-operacao";
import { cadastrarProdutoApi } from "@/lib/produtos/persistir-api";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return respostaOptions("POST, OPTIONS");
}

export async function POST(request: NextRequest) {
  const contexto = await resolverContextoEmpresaAtiva(
    request.headers.get("authorization")
  );
  if (!contexto.ok) {
    return jsonCors(
      { ok: false, erro: contexto.erro, codigo: contexto.codigo },
      contexto.status,
      "POST, OPTIONS"
    );
  }

  try {
    await exigirOperacaoProduto({
      empresaId: contexto.empresaId,
      acao: "criar",
      origem: "POST /api/produtos",
    });
  } catch (error) {
    return (
      respostaNegacaoApi(error) ??
      jsonCors({ ok: false, erro: "Acesso negado." }, 403, "POST, OPTIONS")
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonCors({ ok: false, erro: "Payload inválido." }, 400, "POST, OPTIONS");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonCors({ ok: false, erro: "Payload inválido." }, 400, "POST, OPTIONS");
  }

  const dados = body as Record<string, unknown>;
  const resultado = await cadastrarProdutoApi({
    supabase: contexto.supabase,
    empresaId: contexto.empresaId,
    dados: {
      codigoAutomatico: dados.codigoAutomatico === true,
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
    return jsonCors(resultado, 400, "POST, OPTIONS");
  }

  return jsonCors(resultado, 200, "POST, OPTIONS");
}
