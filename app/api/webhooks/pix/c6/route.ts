import { NextRequest, NextResponse } from "next/server";

import { processarWebhookPixC6 } from "@/lib/pagamentos/pix/c6/adapter";
import { LIMITE_BODY_WEBHOOK_C6_BYTES } from "@/lib/pagamentos/pix/c6/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (
    contentType &&
    !contentType.toLowerCase().includes("application/json")
  ) {
    return json({ ok: false, erro: "Content-Type inválido." }, 415);
  }

  let bruto = "";
  try {
    bruto = await request.text();
  } catch {
    return json({ ok: false, erro: "Não foi possível ler o corpo." }, 400);
  }

  if (bruto.length > LIMITE_BODY_WEBHOOK_C6_BYTES) {
    return json({ ok: false, erro: "Payload excedido." }, 413);
  }

  let payload: unknown = null;
  if (bruto.trim()) {
    try {
      payload = JSON.parse(bruto) as unknown;
    } catch {
      return json({ ok: false, erro: "JSON inválido." }, 400);
    }
  }

  try {
    const resultado = await processarWebhookPixC6({ payload });
    return json(resultado.body, resultado.status);
  } catch {
    return json(
      { ok: false, processado: false, motivo: "consulta_indisponivel" },
      503
    );
  }
}

export async function GET() {
  return json({ ok: false, erro: "Método não permitido." }, 405);
}

export async function PUT() {
  return json({ ok: false, erro: "Método não permitido." }, 405);
}
