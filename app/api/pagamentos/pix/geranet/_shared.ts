import { NextResponse } from "next/server";

import { ErroComunicacaoGeranetBanking } from "@/lib/geranet/cliente";
import { ErroPixGeranet } from "@/lib/pagamentos/pix/contexto";
import { resultadoErroEntitlement } from "@/lib/plataforma/entitlements/exigir-recurso";

export function jsonPix(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export function erroPix(error: unknown) {
  const entitlement = resultadoErroEntitlement(error);
  if (entitlement) {
    return jsonPix(entitlement, 403);
  }

  if (error instanceof ErroPixGeranet) {
    return jsonPix(
      {
        ok: false,
        erro: error.message,
        ...(error.codigo ? { codigo: error.codigo } : {}),
      },
      error.status
    );
  }

  if (error instanceof ErroComunicacaoGeranetBanking) {
    return jsonPix({ ok: false, erro: error.message }, 503);
  }

  return jsonPix(
    {
      ok: false,
      erro:
        error instanceof Error
          ? error.message
          : "Falha inesperada na operação PIX.",
    },
    500
  );
}
