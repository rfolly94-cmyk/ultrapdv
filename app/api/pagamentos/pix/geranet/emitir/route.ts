import { NextRequest } from "next/server";

import { exigirPixIntegradoEmpresa } from "@/lib/pagamentos/pix/acesso-operacao";
import { resolverEmpresaPix } from "@/lib/pagamentos/pix/contexto";
import { emitirCobrancaPixTeste } from "@/lib/pagamentos/pix/geranet";
import { rejeitarModoAdulteradoNoCliente } from "@/lib/pagamentos/pix/modo-ativo";
import { erroPix, jsonPix } from "../_shared";

export async function POST(request: NextRequest) {
  try {
    const { empresaId } = await resolverEmpresaPix();
    await exigirPixIntegradoEmpresa({
      empresaId,
      origem: "POST /api/pagamentos/pix/geranet/emitir",
    });
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
