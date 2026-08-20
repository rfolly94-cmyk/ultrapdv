import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { reconciliarEmissaoFiscal } from "@/lib/fiscal/reconciliar-emissao";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(
  _request: NextRequest,
  context: RouteContext
) {
  const { id: emissaoId } = await context.params;
  const supabase = await createClient();
  const admin = createAdminClient();

  try {
    const { data: claimsData, error: authError } =
      await supabase.auth.getClaims();

    if (authError || !claimsData?.claims?.sub) {
      return json({ ok: false, erro: "Não autenticado." }, 401);
    }

    const { data: vinculo } = await supabase
      .from("usuarios_empresas")
      .select("empresa_id")
      .eq("usuario_id", String(claimsData.claims.sub))
      .eq("principal", true)
      .eq("ativo", true)
      .maybeSingle();

    if (!vinculo) {
      return json(
        { ok: false, erro: "Empresa ativa não encontrada." },
        403
      );
    }

    try {
      await exigirPermissao({ modulo: "fiscal", acao: "reconciliar" });
    } catch (error) {
      if (error instanceof ErroPermissao) {
        return json({ ok: false, erro: error.message }, error.status);
      }
      throw error;
    }

    const resultado = await reconciliarEmissaoFiscal({
      admin,
      empresaId: vinculo.empresa_id,
      emissaoId,
      origem: "manual",
    });

    return json({
      ...resultado,
      reenviou: false,
    });
  } catch (error) {
    const mensagem =
      error instanceof Error
        ? error.message
        : "Não foi possível reconciliar a emissão.";

    const status = /não autenticado|não encontrada|não pode ser consultada|somente para/i.test(
      mensagem
    )
      ? 409
      : 502;

    return json(
      {
        ok: false,
        erro: mensagem,
        reenviou: false,
      },
      status
    );
  }
}
