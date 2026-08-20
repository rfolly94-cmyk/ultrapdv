import { NextRequest } from "next/server";

import { gerarRecebimentoPixLocal } from "@/lib/pagamentos/pix/local-pdv";
import { rejeitarModoAdulteradoNoCliente } from "@/lib/pagamentos/pix/modo-ativo";
import { erroPix, jsonPix } from "../../geranet/_shared";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    rejeitarModoAdulteradoNoCliente(body);
    const valor = Number(body.valor);

    const resultado = await gerarRecebimentoPixLocal(valor, {
      saldoRestanteCentavos: Number(body.saldo_restante_centavos),
    });

    return jsonPix({
      ok: true,
      ...resultado,
    });
  } catch (error) {
    return erroPix(error);
  }
}
