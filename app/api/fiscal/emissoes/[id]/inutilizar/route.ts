import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { inutilizarNumeracaoFiscal } from "@/lib/fiscal/inutilizar-numeracao";
import {
  capturaErroAutorizacaoFiscal,
  exigirInutilizacaoFiscal,
} from "@/lib/fiscal/acesso-operacao";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(
  request: NextRequest,
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
      await exigirInutilizacaoFiscal({
        empresaId: String(vinculo.empresa_id),
        origem: "inutilizar-numeracao",
      });
    } catch (error) {
      const authz = capturaErroAutorizacaoFiscal(error);
      if (authz) {
        return json({ ok: false, erro: authz.mensagem }, authz.status);
      }
      throw error;
    }

    let body: { justificativa?: string } = {};
    try {
      body = (await request.json()) as { justificativa?: string };
    } catch {
      body = {};
    }

    const resultado = await inutilizarNumeracaoFiscal({
      admin,
      empresaId: vinculo.empresa_id,
      emissaoId,
      justificativa: String(body.justificativa ?? ""),
    });

    return json({
      ...resultado,
      reenviou: false,
    });
  } catch (error) {
    const mensagem =
      error instanceof Error
        ? error.message
        : "Não foi possível inutilizar a numeração.";

    const status = /não autenticado|não encontrada|bloqueada|Antes de inutilizar|já está|justificativa|Somente numeração|ambiente|UF|incompletos/i.test(
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
