import { NextRequest } from "next/server";

import { jsonCors, respostaNegacaoApi, respostaOptions } from "@/lib/api/cors-mobile";
import { resolverContextoEmpresaAtiva } from "@/lib/api/contexto-empresa-ativa";
import { exigirOperacaoProduto } from "@/lib/produtos/acesso-operacao";
import { carregarOpcoesProdutoApi } from "@/lib/produtos/persistir-api";
import { planoPermiteRecursoEmpresa } from "@/lib/plataforma/entitlements/exigir-recurso";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return respostaOptions("GET, OPTIONS");
}

export async function GET(request: NextRequest) {
  const contexto = await resolverContextoEmpresaAtiva(
    request.headers.get("authorization")
  );
  if (!contexto.ok) {
    return jsonCors(
      { ok: false, erro: contexto.erro, codigo: contexto.codigo },
      contexto.status,
      "GET, OPTIONS"
    );
  }

  try {
    await exigirOperacaoProduto({
      empresaId: contexto.empresaId,
      acao: "acessar",
      origem: "GET /api/produtos/opcoes",
    });
  } catch (error) {
    return respostaNegacaoApi(error) ?? jsonCors({ ok: false, erro: "Acesso negado." }, 403);
  }

  const catalogo = await planoPermiteRecursoEmpresa(contexto.empresaId, "catalogo");
  const opcoes = await carregarOpcoesProdutoApi({
    supabase: contexto.supabase,
    empresaId: contexto.empresaId,
  });

  return jsonCors(
    {
      ok: true,
      ...opcoes,
      catalogoNoPlano: catalogo.permitido,
    },
    200,
    "GET, OPTIONS"
  );
}
