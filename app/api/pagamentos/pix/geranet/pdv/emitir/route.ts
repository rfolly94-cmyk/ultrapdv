import { NextRequest } from "next/server";

import { exigirPixIntegradoEmpresa } from "@/lib/pagamentos/pix/acesso-operacao";
import { resolverEmpresaPix } from "@/lib/pagamentos/pix/contexto";
import { emitirCobrancaPixPdv } from "@/lib/pagamentos/pix/geranet-pdv";
import { rejeitarModoAdulteradoNoCliente } from "@/lib/pagamentos/pix/modo-ativo";
import { erroPix, jsonPix } from "../../_shared";

export async function POST(request: NextRequest) {
  try {
    const { empresaId } = await resolverEmpresaPix();
    await exigirPixIntegradoEmpresa({
      empresaId,
      origem: "POST /api/pagamentos/pix/geranet/pdv/emitir",
    });
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
