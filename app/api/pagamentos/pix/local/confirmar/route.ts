import { NextRequest } from "next/server";

import { confirmarRecebimentoPixLocal } from "@/lib/pagamentos/pix/local-pdv";
import { rejeitarModoAdulteradoNoCliente } from "@/lib/pagamentos/pix/modo-ativo";
import { erroPix, jsonPix } from "../../geranet/_shared";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    rejeitarModoAdulteradoNoCliente(body);
    const recebimentoId = String(body.recebimento_id ?? "").trim();

    if (!recebimentoId) {
      return jsonPix({ ok: false, erro: "Informe o recebimento PIX." }, 422);
    }

    const resultado = await confirmarRecebimentoPixLocal(recebimentoId, body);

    return jsonPix({
      ok: true,
      ...resultado,
    });
  } catch (error) {
    return erroPix(error);
  }
}
