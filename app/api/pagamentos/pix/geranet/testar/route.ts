import { exigirPixIntegradoEmpresa } from "@/lib/pagamentos/pix/acesso-operacao";
import { exigirAdministradorPix } from "@/lib/pagamentos/pix/contexto";
import { testarConexaoPixGeranet } from "@/lib/pagamentos/pix/geranet";
import { exigirPixGeranetAtivo } from "@/lib/pagamentos/pix/modo-ativo-servidor";
import { erroPix, jsonPix } from "../_shared";

export async function POST() {
  try {
    const { empresaId } = await exigirAdministradorPix();
    await exigirPixIntegradoEmpresa({
      empresaId,
      origem: "POST /api/pagamentos/pix/geranet/testar",
    });
    await exigirPixGeranetAtivo(empresaId);
    const resultado = await testarConexaoPixGeranet(empresaId);

    return jsonPix({
      ok: resultado.ok,
      resultado: resultado.resultado,
      http_status: resultado.httpStatus,
      geranet_ok: resultado.resultado === "sucesso",
      integracao_configurada: true,
      provedor: resultado.provedor,
      ambiente: resultado.ambiente,
      credenciais_configuradas: resultado.credenciaisConfiguradas,
      cobranca_emitida: resultado.cobrancaEmitida,
      metodo_teste: resultado.metodoTeste,
      provedor_autenticado: resultado.provedorAutenticado,
      mensagem: resultado.mensagem,
      limitacao: resultado.limitacao,
      resposta: resultado.respostaSanitizada,
      payload_enviado: resultado.payloadEnviado,
    });
  } catch (error) {
    return erroPix(error);
  }
}
