import { NextRequest } from "next/server";

import { jsonCors, respostaNegacaoApi, respostaOptions } from "@/lib/api/cors-mobile";
import { resolverContextoEmpresaAtiva } from "@/lib/api/contexto-empresa-ativa";
import { exigirOperacaoCliente } from "@/lib/clientes/acesso-operacao";
import { cadastrarClienteApi } from "@/lib/clientes/persistir-api";

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
    await exigirOperacaoCliente({
      empresaId: contexto.empresaId,
      acao: "criar",
      origem: "POST /api/clientes",
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

  const resultado = await cadastrarClienteApi({
    supabase: contexto.supabase,
    empresaId: contexto.empresaId,
    dados: body,
  });

  if (!resultado.ok) {
    return jsonCors(resultado, 400, "POST, OPTIONS");
  }

  return jsonCors(resultado, 200, "POST, OPTIONS");
}
