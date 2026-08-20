import { NextRequest } from "next/server";

import { resolverEmpresaPix } from "@/lib/pagamentos/pix/contexto";
import { emitirCobrancaPixTeste } from "@/lib/pagamentos/pix/geranet";
import { rejeitarModoAdulteradoNoCliente } from "@/lib/pagamentos/pix/modo-ativo";
import { erroPix, jsonPix } from "../_shared";

export async function POST(request: NextRequest) {
  try {
    const { empresaId } = await resolverEmpresaPix();
    const body = (await request.json()) as {
      valor?: number;
      devedor_nome?: string;
      devedor_cpf_cnpj?: string;
    };
    rejeitarModoAdulteradoNoCliente(body as Record<string, unknown>);

    const resultado = await emitirCobrancaPixTeste({
      empresaId,
      valor: Number(body.valor ?? 1),
      devedor:
        body.devedor_nome || body.devedor_cpf_cnpj
          ? {
              nome: body.devedor_nome,
              cpfCnpj: body.devedor_cpf_cnpj,
            }
          : undefined,
    });

    return jsonPix({
      ok: true,
      cobranca: resultado.cobranca,
      resposta: resultado.respostaSanitizada,
      payload_enviado: resultado.payloadEnviado,
    });
  } catch (error) {
    return erroPix(error);
  }
}
