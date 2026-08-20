import { NextResponse } from "next/server";

import { ErroComunicacaoGeranetBanking } from "@/lib/geranet/cliente";
import { ErroPixGeranet } from "@/lib/pagamentos/pix/contexto";

export function jsonPix(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export function erroPix(error: unknown) {
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
