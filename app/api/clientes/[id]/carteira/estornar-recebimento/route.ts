import { NextRequest, NextResponse } from "next/server";

import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import { createClient } from "@/lib/supabase/server";

type Context = {
  params: Promise<{
    id: string;
  }>;
};

function resposta(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(request: NextRequest, context: Context) {
  const { id: clienteId } = await context.params;
  const supabase = await createClient();

  const { data: claimsData, error: authError } =
    await supabase.auth.getClaims();

  if (authError || !claimsData?.claims?.sub) {
    return resposta({ ok: false, erro: "Não autenticado." }, 401);
  }

  const { data: vinculo, error: vinculoError } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id")
    .eq("usuario_id", String(claimsData.claims.sub))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (vinculoError || !vinculo) {
    return resposta(
      { ok: false, erro: "Empresa ativa não encontrada." },
      403
    );
  }

  try {
    await exigirPermissao({ modulo: "clientes", acao: "receber_carteira" });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      return resposta({ ok: false, erro: error.message }, error.status);
    }
    throw error;
  }

  const { data: cliente, error: clienteError } = await supabase
    .from("clientes")
    .select("id")
    .eq("empresa_id", vinculo.empresa_id)
    .eq("id", clienteId)
    .maybeSingle();

  if (clienteError || !cliente) {
    return resposta({ ok: false, erro: "Cliente não encontrado." }, 404);
  }

  let body: {
    recebimento_id?: string;
    motivo?: string;
    confirmar_fiscal_comercial?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return resposta({ ok: false, erro: "JSON inválido." }, 400);
  }

  const recebimentoId = String(body.recebimento_id ?? "").trim();
  const motivo = String(body.motivo ?? "").trim();

  if (!recebimentoId) {
    return resposta({ ok: false, erro: "Recebimento inválido." }, 400);
  }

  if (motivo.length < 5) {
    return resposta(
      { ok: false, erro: "Informe o motivo com pelo menos 5 caracteres." },
      400
    );
  }

  const { data: recebimento } = await supabase
    .from("carteira_cliente_recebimentos")
    .select("id")
    .eq("empresa_id", vinculo.empresa_id)
    .eq("cliente_id", clienteId)
    .eq("id", recebimentoId)
    .maybeSingle();

  if (!recebimento) {
    return resposta({ ok: false, erro: "Recebimento não encontrado." }, 404);
  }

  const { data, error } = await supabase.rpc(
    "rpc_estornar_recebimento_carteira",
    {
      p_empresa_id: vinculo.empresa_id,
      p_cliente_id: clienteId,
      p_recebimento_id: recebimentoId,
      p_motivo: motivo,
    }
  );

  if (error) {
    return resposta({ ok: false, erro: error.message }, 422);
  }

  return resposta({ ok: true, resultado: data });
}
