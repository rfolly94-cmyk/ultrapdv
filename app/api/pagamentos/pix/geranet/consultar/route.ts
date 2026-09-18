import { NextRequest } from "next/server";

import { exigirPixIntegradoEmpresa } from "@/lib/pagamentos/pix/acesso-operacao";
import { resolverEmpresaPix } from "@/lib/pagamentos/pix/contexto";
import { consultarCobrancaPix } from "@/lib/pagamentos/pix/geranet";
import { rejeitarModoAdulteradoNoCliente } from "@/lib/pagamentos/pix/modo-ativo";
import { erroPix, jsonPix } from "../_shared";

export async function POST(request: NextRequest) {
  try {
    const { empresaId } = await resolverEmpresaPix();
    await exigirPixIntegradoEmpresa({
      empresaId,
      origem: "POST /api/pagamentos/pix/geranet/consultar",
    });
    const body = (await request.json()) as { cobranca_id?: string };
    rejeitarModoAdulteradoNoCliente(body as Record<string, unknown>);

    if (!body.cobranca_id) {
      return jsonPix({ ok: false, erro: "Informe cobranca_id." }, 422);
    }

    const resultado = await consultarCobrancaPix({
      empresaId,
      cobrancaId: body.cobranca_id,
    });
    const extraC6 =
      "e2eid_mascarado" in resultado
        ? {
            e2eid_mascarado: (
              resultado as { e2eid_mascarado?: string | null }
            ).e2eid_mascarado,
            estado: (resultado as { estado?: string }).estado,
          }
        : {};

    return jsonPix({
      ok: true,
      cobranca: resultado.cobranca,
      resposta: resultado.respostaSanitizada,
      txid: resultado.txid,
      evidencia: resultado.evidencia,
      contrato: resultado.contrato,
      valor_pago: resultado.cobranca.valor_pago,
      pago_em: resultado.cobranca.pago_em,
      ...extraC6,
    });
  } catch (error) {
    return erroPix(error);
  }
}
