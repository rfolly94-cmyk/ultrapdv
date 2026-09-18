import {
  NextResponse,
} from "next/server";

import {
  GERANET_NFE_BASE_URL,
  MENSAGEM_API_GERANET_PLATAFORMA_AUSENTE,
  obterApiKeyGeranetPlataforma,
} from "@/lib/fiscal/geranet/credencial-plataforma";
import { ErroMaster, exigirMaster } from "@/lib/master/exigir-master";
import { ErroAdminPlataforma } from "@/lib/plataforma/contexto";

function respostaErro(
  mensagem: string,
  status = 422
) {
  return NextResponse.json(
    {
      ok: false,
      erro: mensagem,
    },
    { status }
  );
}

export async function GET() {
  try {
    const { admin } = await exigirMaster();

    let apiKey = "";
    try {
      apiKey = await obterApiKeyGeranetPlataforma(admin);
    } catch {
      return respostaErro(
        "Não foi possível ler a API Geranet da plataforma.",
        500
      );
    }

    if (!apiKey) {
      return respostaErro(
        MENSAGEM_API_GERANET_PLATAFORMA_AUSENTE,
        422
      );
    }

    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () =>
          controller.abort(),
        15_000
      );

    let resposta: Response;

    try {
      resposta = await fetch(
        `${GERANET_NFE_BASE_URL}/user`,
        {
          method: "GET",

          headers: {
            Accept:
              "application/json",

            Authorization:
              `Bearer ${apiKey}`,
          },

          cache: "no-store",

          signal:
            controller.signal,
        }
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "AbortError"
      ) {
        return respostaErro(
          "Tempo limite ao conectar com a Geranet.",
          504
        );
      }

      return respostaErro(
        "Falha de comunicação com a Geranet.",
        502
      );
    } finally {
      clearTimeout(timeout);
    }

    if (
      resposta.status === 401
    ) {
      return NextResponse.json(
        {
          ok: false,

          conectado: true,

          api_key_valida: false,

          geranet_http_status:
            401,

          erro:
            "A Geranet respondeu, mas a API Key foi recusada.",
        },
        { status: 401 }
      );
    }

    if (!resposta.ok) {
      return NextResponse.json(
        {
          ok: false,

          conectado: true,

          api_key_valida:
            null,

          geranet_http_status:
            resposta.status,

          erro:
            "A Geranet respondeu com um status inesperado.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,

      conectado: true,

      api_key_valida: true,

      geranet_http_status:
        resposta.status,

      aviso:
        "Conexão com a Geranet validada. Nenhuma nota foi emitida e nenhuma numeração fiscal foi alterada.",
    });
  } catch (error) {
    if (
      error instanceof ErroMaster ||
      error instanceof ErroAdminPlataforma
    ) {
      return respostaErro(
        error.message,
        error.status
      );
    }

    console.error(
      "[GERANET TESTAR CONEXAO]",
      error instanceof Error
        ? error.message
        : "Erro desconhecido"
    );

    return respostaErro(
      "Erro interno ao testar a conexão com a Geranet.",
      500
    );
  }
}
