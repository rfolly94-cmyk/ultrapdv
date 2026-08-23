import { NextRequest } from "next/server";

import { jsonCors, respostaNegacaoApi, respostaOptions } from "@/lib/api/cors-mobile";
import { resolverContextoEmpresaAtiva } from "@/lib/api/contexto-empresa-ativa";
import { exigirOperacaoCarteira } from "@/lib/carteira/acesso-operacao";
import { carregarCarteiraApi } from "@/lib/clientes/carregar-carteira-api";
import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import { temPermissao } from "@/lib/permissoes/tem-permissao";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function OPTIONS() {
  return respostaOptions("GET, OPTIONS");
}

export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
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
    await exigirOperacaoCarteira({
      empresaId: ctx.empresaId,
      acao: "acessar_carteira",
      origem: "GET /api/clientes/[id]/carteira",
    });
  } catch (error) {
    return (
      respostaNegacaoApi(error) ??
      jsonCors({ ok: false, erro: "Acesso negado." }, 403, "GET, OPTIONS")
    );
  }

  const carteira = await carregarCarteiraApi({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    clienteId: id,
  });

  if (!carteira) {
    return jsonCors({ ok: false, erro: "Cliente não encontrado." }, 404, "GET, OPTIONS");
  }

  const sessao = await obterPermissoesSessao();

  return jsonCors(
    {
      ok: true,
      ...carteira,
      podeReceber: Boolean(
        sessao && temPermissao(sessao.permissoes, "clientes", "receber_carteira")
      ),
      podeCancelarItens: Boolean(
        sessao && temPermissao(sessao.permissoes, "vendas", "cancelar")
      ),
    },
    200,
    "GET, OPTIONS"
  );
}
