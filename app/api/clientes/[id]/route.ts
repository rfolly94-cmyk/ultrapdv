import { NextRequest } from "next/server";

import { jsonCors, respostaNegacaoApi, respostaOptions } from "@/lib/api/cors-mobile";
import { resolverContextoEmpresaAtiva } from "@/lib/api/contexto-empresa-ativa";
import { exigirOperacaoCliente } from "@/lib/clientes/acesso-operacao";
import {
  carregarClienteApi,
  persistirClienteApi,
} from "@/lib/clientes/persistir-api";
import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import { temPermissao } from "@/lib/permissoes/tem-permissao";
import { planoPermiteRecursoEmpresa } from "@/lib/plataforma/entitlements/exigir-recurso";

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
    await exigirOperacaoCliente({
      empresaId: ctx.empresaId,
      acao: "acessar",
      origem: "GET /api/clientes/[id]",
    });
  } catch (error) {
    return respostaNegacaoApi(error) ?? jsonCors({ ok: false, erro: "Acesso negado." }, 403);
  }

  const cliente = await carregarClienteApi({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    clienteId: id,
  });

  if (!cliente) {
    return jsonCors({ ok: false, erro: "Cliente não encontrado." }, 404);
  }

  const [sessao, carteira] = await Promise.all([
    obterPermissoesSessao(),
    planoPermiteRecursoEmpresa(ctx.empresaId, "carteira"),
  ]);

  return jsonCors({
    ok: true,
    cliente,
    carteiraNoPlano: carteira.permitido,
    podeEditar: Boolean(sessao && temPermissao(sessao.permissoes, "clientes", "editar")),
    podeReceber: Boolean(
      sessao && temPermissao(sessao.permissoes, "clientes", "receber_carteira")
    ),
    podeCancelarItens: Boolean(
      sessao && temPermissao(sessao.permissoes, "vendas", "cancelar")
    ),
    podeAcessarCarteira: Boolean(
      sessao && temPermissao(sessao.permissoes, "clientes", "acessar_carteira")
    ),
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
    await exigirOperacaoCliente({
      empresaId: ctx.empresaId,
      acao: "editar",
      origem: "PATCH /api/clientes/[id]",
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

  const resultado = await persistirClienteApi({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    clienteId: id,
    dados: body,
  });

  if (!resultado.ok) {
    return jsonCors(resultado, 400);
  }

  return jsonCors(resultado);
}
