import { chamarGeranetBanking } from "@/lib/geranet/cliente";
import {
  carregarApiKeyGeranet,
  carregarIntegracaoPix,
  exigirAdministradorPix,
  montarCredenciaisGeranetPix,
} from "@/lib/pagamentos/pix/contexto";
import { exigirPixGeranetAtivo } from "@/lib/pagamentos/pix/modo-ativo-servidor";
import { obterProvedorPixGeranet } from "@/lib/pagamentos/pix/provedores-geranet";
import type { AmbientePixGeranet } from "@/lib/pagamentos/pix/types";
import { erroPix, jsonPix } from "../_shared";

export async function POST() {
  try {
    const { empresaId } = await exigirAdministradorPix();
    await exigirPixGeranetAtivo(empresaId);
    const [apiKey, integracao] = await Promise.all([
      carregarApiKeyGeranet(empresaId),
      carregarIntegracaoPix(empresaId),
    ]);

    const resultado = await chamarGeranetBanking({
      apiKey,
      endpoint: "/api/v1/user",
      method: "GET",
    });

    let credenciaisOk = false;
    let credenciaisMensagem =
      "Nenhuma integração PIX salva para validar o provedor.";

    if (integracao?.provedor) {
      const meta = obterProvedorPixGeranet(integracao.provedor);
      if (!meta?.configuracaoDisponivel) {
        credenciaisMensagem =
          "Configuração deste provedor ainda não foi mapeada no UltraPDV.";
      } else {
        try {
          await montarCredenciaisGeranetPix({
            empresaId,
            provedor: integracao.provedor,
            ambiente: integracao.ambiente as AmbientePixGeranet,
            chavePixPublica: integracao.chave_pix,
          });
          credenciaisOk = true;
          credenciaisMensagem =
            "Credenciais do provedor salvo estão presentes no cofre.";
        } catch (error) {
          credenciaisMensagem =
            error instanceof Error
              ? error.message
              : "Credenciais do provedor incompletas.";
        }
      }
    }

    return jsonPix({
      ok: resultado.httpOk,
      http_status: resultado.httpStatus,
      geranet_ok: resultado.httpOk,
      integracao_configurada: Boolean(integracao?.ativo),
      provedor: integracao?.provedor ?? null,
      ambiente: integracao?.ambiente ?? null,
      credenciais_configuradas: credenciaisOk,
      cobranca_emitida: false,
      mensagem: resultado.httpOk
        ? `Conexão Geranet autenticada. ${credenciaisMensagem} Nenhuma cobrança PIX foi emitida.`
        : String(resultado.dados.mensagem ?? "A Geranet recusou a API Key."),
    });
  } catch (error) {
    return erroPix(error);
  }
}
