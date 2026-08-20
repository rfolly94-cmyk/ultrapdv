import { NextRequest } from "next/server";

import { emitirCobrancaPixPdv } from "@/lib/pagamentos/pix/geranet-pdv";
import { rejeitarModoAdulteradoNoCliente } from "@/lib/pagamentos/pix/modo-ativo";
import { erroPix, jsonPix } from "../../_shared";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    rejeitarModoAdulteradoNoCliente(body);

    const resultado = await emitirCobrancaPixPdv({
      valor: Number(body.valor ?? 0),
      checkoutKey: String(body.checkout_key ?? ""),
      clienteId: body.cliente_id ? String(body.cliente_id) : null,
      saldoRestanteCentavos: Number(body.saldo_restante_centavos),
      body,
    });

    return jsonPix({
      ok: true,
      ...resultado,
    });
  } catch (error) {
    return erroPix(error);
  }
}
