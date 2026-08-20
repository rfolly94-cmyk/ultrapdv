import {
  NextResponse,
} from "next/server";

import {
  ErroAdministracaoUsuarios,
  MENSAGEM_ADMIN_DIAGNOSTICO,
  obterContextoAdministracaoUsuarios,
} from "@/lib/usuarios/contexto-administracao";

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

function texto(
  valor: unknown
) {
  return String(
    valor ?? ""
  ).trim();
}

export async function GET() {
  try {
    const {
      admin,
      empresaId,
    } =
      await obterContextoAdministracaoUsuarios({
        mensagemNaoAdmin:
          MENSAGEM_ADMIN_DIAGNOSTICO,
      });

    const {
      data: segredosData,
      error: segredosError,
    } = await admin.rpc(
      "obter_segredos_fiscais",
      {
        p_empresa_id:
          empresaId,
      }
    );

    if (segredosError) {
      return respostaErro(
        "Não foi possível ler os segredos fiscais no servidor.",
        500
      );
    }

    const segredos =
      (segredosData ?? {}) as {
        geranet_api_key?:
          | string
          | null;
      };

    const apiKey =
      texto(
        segredos.geranet_api_key
      );

    if (!apiKey) {
      return respostaErro(
        "API Key da Geranet não está configurada.",
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
        "https://nfe.geranet.net/api/v1/user",
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

    // Não retornamos o objeto completo
    // de /api/v1/user porque não é
    // necessário para validar a integração.
    return NextResponse.json({
      ok: true,

      conectado: true,

      api_key_valida: true,

      geranet_http_status:
        resposta.status,

      empresa_id:
        empresaId,

      aviso:
        "Conexão com a Geranet validada. Nenhuma nota foi emitida e nenhuma numeração fiscal foi alterada.",
    });
  } catch (error) {
    if (
      error instanceof
      ErroAdministracaoUsuarios
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
