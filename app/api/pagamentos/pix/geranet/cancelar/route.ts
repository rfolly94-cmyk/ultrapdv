import { NextRequest } from "next/server";

import { exigirPixIntegradoEmpresa } from "@/lib/pagamentos/pix/acesso-operacao";
import { resolverEmpresaPix } from "@/lib/pagamentos/pix/contexto";
import { cancelarCobrancaPix } from "@/lib/pagamentos/pix/geranet";
import { rejeitarModoAdulteradoNoCliente } from "@/lib/pagamentos/pix/modo-ativo";
import { erroPix, jsonPix } from "../_shared";

export async function POST(request: NextRequest) {
  try {
    const { empresaId } = await resolverEmpresaPix();
    await exigirPixIntegradoEmpresa({
      empresaId,
      origem: "POST /api/pagamentos/pix/geranet/cancelar",
    });
    const body = (await request.json()) as { cobranca_id?: string };
    rejeitarModoAdulteradoNoCliente(body as Record<string, unknown>);

    if (!body.cobranca_id) {
      return jsonPix({ ok: false, erro: "Informe cobranca_id." }, 422);
    }

    const resultado = await cancelarCobrancaPix({
      empresaId,
      cobrancaId: body.cobranca_id,
    });

    return jsonPix({
      ok: true,
      cobranca: resultado.cobranca,
      resposta: resultado.respostaSanitizada,
      txid: resultado.txid,
    });
  } catch (error) {
    return erroPix(error);
  }
}
