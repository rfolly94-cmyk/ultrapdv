import { NextRequest } from "next/server";

import { resolverEmpresaPix } from "@/lib/pagamentos/pix/contexto";
import { consultarCobrancaPix } from "@/lib/pagamentos/pix/geranet";
import { rejeitarModoAdulteradoNoCliente } from "@/lib/pagamentos/pix/modo-ativo";
import { erroPix, jsonPix } from "../_shared";

export async function POST(request: NextRequest) {
  try {
    const { empresaId } = await resolverEmpresaPix();
    const body = (await request.json()) as { cobranca_id?: string };
    rejeitarModoAdulteradoNoCliente(body as Record<string, unknown>);

    if (!body.cobranca_id) {
      return jsonPix({ ok: false, erro: "Informe cobranca_id." }, 422);
    }

    const resultado = await consultarCobrancaPix({
      empresaId,
      cobrancaId: body.cobranca_id,
    });

    return jsonPix({
      ok: true,
      cobranca: resultado.cobranca,
      resposta: resultado.respostaSanitizada,
      txid: resultado.txid,
      evidencia: resultado.evidencia,
      contrato: resultado.contrato,
    });
  } catch (error) {
    return erroPix(error);
  }
}
