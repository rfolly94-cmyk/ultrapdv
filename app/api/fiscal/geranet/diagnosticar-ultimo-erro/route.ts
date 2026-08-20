import {
  NextResponse,
} from "next/server";

import {
  ErroAdministracaoUsuarios,
  MENSAGEM_ADMIN_DIAGNOSTICO,
  obterContextoAdministracaoUsuarios,
} from "@/lib/usuarios/contexto-administracao";

function erro(
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

function somenteDigitos(
  valor: unknown
) {
  return texto(valor).replace(
    /\D/g,
    ""
  );
}

function sanitizar(
  valor: unknown
): unknown {
  if (
    valor === null ||
    valor === undefined
  ) {
    return valor;
  }

  if (Array.isArray(valor)) {
    return valor.map(sanitizar);
  }

  if (
    typeof valor !== "object"
  ) {
    if (typeof valor === "string") {
      const bruto = valor.trim();
      if (bruto.startsWith("{") || bruto.startsWith("[")) {
        try {
          return sanitizar(JSON.parse(bruto));
        } catch {
          return valor;
        }
      }
    }

    return valor;
  }

  const entrada =
    valor as Record<
      string,
      unknown
    >;

  const saida:
    Record<string, unknown> =
      {};

  for (
    const [
      chave,
      conteudo,
    ] of Object.entries(
      entrada
    )
  ) {
    const nome =
      chave.toLowerCase();

    const sensivel =
      nome.includes(
        "certificado"
      ) ||
      nome.includes("senha") ||
      nome === "csc" ||
      nome.includes(
        "codigosegurancacontribuinte"
      ) ||
      nome.includes("token") ||
      nome.includes("secret") ||
      nome.includes("apikey") ||
      nome.includes("api_key");

    const binarioGrande =
      nome === "xml" ||
      nome === "pdf";

    if (sensivel) {
      saida[chave] =
        "[REDACTED]";
    } else if (
      binarioGrande
    ) {
      saida[chave] =
        conteudo
          ? "[CONTEÚDO OMITIDO]"
          : conteudo;
    } else {
      saida[chave] =
        sanitizar(conteudo);
    }
  }

  return saida;
}

async function getJson(
  url: string,
  apiKey: string
) {
  const resposta =
    await fetch(url, {
      method: "GET",
      headers: {
        Accept:
          "application/json",
        Authorization:
          `Bearer ${apiKey}`,
      },
      cache: "no-store",
    });

  const raw =
    await resposta.text();

  let dados:
    unknown = {};

  try {
    dados =
      raw
        ? JSON.parse(raw)
        : {};
  } catch {
    dados = {
      mensagem:
        "Resposta não JSON.",
    };
  }

  return {
    resposta,
    dados,
  };
}

export async function GET() {
  try {
    const {
      supabase,
      admin,
      empresaId,
    } =
      await obterContextoAdministracaoUsuarios({
        mensagemNaoAdmin:
          MENSAGEM_ADMIN_DIAGNOSTICO,
      });

    const [
      empresaResult,
      segredosResult,
    ] = await Promise.all([
      supabase
        .from("empresas")
        .select("cnpj")
        .eq("id", empresaId)
        .maybeSingle(),

      admin.rpc(
        "obter_segredos_fiscais",
        {
          p_empresa_id:
            empresaId,
        }
      ),
    ]);

    if (
      empresaResult.error ||
      !empresaResult.data
    ) {
      return erro(
        "Empresa não encontrada.",
        500
      );
    }

    if (
      segredosResult.error
    ) {
      return erro(
        "Não foi possível ler a API Key da Geranet.",
        500
      );
    }

    const segredos =
      (segredosResult.data ??
        {}) as {
        geranet_api_key?:
          | string
          | null;
      };

    const apiKey =
      texto(
        segredos
          .geranet_api_key
      );

    if (!apiKey) {
      return erro(
        "API Key Geranet não configurada."
      );
    }

    const cnpj =
      somenteDigitos(
        empresaResult.data.cnpj
      );

    const query =
      new URLSearchParams({
        endpoint:
          "nfe/emitir",
        cnpj,
        status: "erro",
        por_pagina: "10",
      });

    const listaUrl =
      `https://nfe.geranet.net/api/v1/logs?${query.toString()}`;

    const {
      resposta:
        respostaLista,
      dados: dadosLista,
    } = await getJson(
      listaUrl,
      apiKey
    );

    if (!respostaLista.ok) {
      return erro(
        `Geranet não permitiu consultar logs (HTTP ${respostaLista.status}).`,
        502
      );
    }

    const lista =
      dadosLista as {
        logs?: Array<{
          id?: number;
          criado_em?: string;
          endpoint?: string;
          http_status?: number;
          sucesso?: boolean;
          tem_orientacao_correcao?:
            boolean;
        }>;
      };

    const logs =
      lista.logs ?? [];

    if (logs.length === 0) {
      return NextResponse.json({
        ok: true,
        encontrado: false,
        mensagem:
          "Nenhum log de erro nfe/emitir foi encontrado para este CNPJ.",
      });
    }

    // A listagem oficial retorna os mais
    // recentes na primeira página.
    const ultimo =
      logs[0];

    if (!ultimo.id) {
      return erro(
        "Log encontrado sem ID.",
        502
      );
    }

    const detalheUrl =
      `https://nfe.geranet.net/api/v1/logs/${ultimo.id}`;

    const {
      resposta:
        respostaDetalhe,
      dados: dadosDetalhe,
    } = await getJson(
      detalheUrl,
      apiKey
    );

    if (
      !respostaDetalhe.ok
    ) {
      return erro(
        `Não foi possível consultar o detalhe do log Geranet ${ultimo.id}.`,
        502
      );
    }

    return NextResponse.json({
      ok: true,
      encontrado: true,

      aviso:
        "Diagnóstico somente leitura. Nenhuma nota foi emitida e nenhuma numeração foi alterada.",

      log_resumo:
        ultimo,

      detalhe:
        sanitizar(
          dadosDetalhe
        ),
    });
  } catch (e) {
    if (
      e instanceof
      ErroAdministracaoUsuarios
    ) {
      return erro(
        e.message,
        e.status
      );
    }

    console.error(
      "[GERANET DIAGNOSTICO LOG]",
      e instanceof Error
        ? e.message
        : "Erro desconhecido"
    );

    return erro(
      "Erro interno ao consultar o log Geranet.",
      500
    );
  }
}
