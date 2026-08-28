import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

import { atualizarBaseFiscalOficial } from "@/lib/fiscal/base-oficial/atualizar";
import { registrarImpactoNovaVersao } from "@/lib/fiscal/motor/impacto-versao";
import { createAdminClient } from "@/lib/supabase/admin";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

async function executar(request: NextRequest) {
  const segredo = process.env.CRON_SECRET?.trim();
  if (!segredo) {
    return json(
      { ok: false, erro: "CRON_SECRET não está configurado no servidor." },
      503
    );
  }
  const authorization = request.headers.get("authorization")?.trim();
  if (authorization !== `Bearer ${segredo}`) {
    return json({ ok: false, erro: "Não autorizado." }, 401);
  }

  const admin = createAdminClient();
  const resultado = await atualizarBaseFiscalOficial({ admin });
  const ativadas = resultado.fontes.filter((item) => item.status === "ativada");
  for (const fonte of ativadas) {
    const { data } = await admin
      .from("fiscal_base_versoes")
      .select("id")
      .eq("fonte_codigo", fonte.fonte)
      .eq("status", "ativa")
      .maybeSingle();
    if (data?.id) {
      await registrarImpactoNovaVersao({
        admin,
        versaoId: String(data.id),
      });
    }
  }

  return json({
    ok: true,
    frequencia: "1x ao dia",
    ...resultado,
  });
}

export async function GET(request: NextRequest) {
  return executar(request);
}

export async function POST(request: NextRequest) {
  return executar(request);
}
