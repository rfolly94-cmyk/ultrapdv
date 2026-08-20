import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  ErroAdministracaoUsuarios,
  MENSAGEM_ADMIN_DIAGNOSTICO,
  obterContextoAdministracaoUsuarios,
} from "@/lib/usuarios/contexto-administracao";

type Registro = Record<
  string,
  unknown
>;

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
  return texto(valor)
    .replace(/\D/g, "");
}

function objeto(
  valor: unknown
): Registro {
  if (
    valor &&
    typeof valor ===
      "object" &&
    !Array.isArray(
      valor
    )
  ) {
    return valor as Registro;
  }

  return {};
}

function array(
  valor: unknown
): unknown[] {
  return Array.isArray(
    valor
  )
    ? valor
    : [];
}

function numero(
  valor: unknown
) {
  const n =
    Number(valor);

  return Number.isFinite(n)
    ? n
    : null;
}

async function lerJson(
  response: Response
) {
  const raw =
    await response.text();

  try {
    return JSON.parse(
      raw
    ) as unknown;
  } catch {
    return {
      raw:
        raw.slice(
          0,
          2000
        ),
    };
  }
}

export async function GET(
  request: NextRequest
) {
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

    const {
      data: empresa,
      error: empresaError,
    } =
      await supabase
        .from("empresas")
        .select(
          "id, cnpj"
        )
        .eq(
          "id",
          empresaId
        )
        .maybeSingle();

    if (
      empresaError ||
      !empresa
    ) {
      return NextResponse.json(
        {
          ok: false,
          erro:
            empresaError
              ?.message ??
            "Empresa não encontrada.",
        },
        {
          status: 404,
        }
      );
    }

    // ========================================================
    // 2. Parâmetros do diagnóstico
    // ========================================================
    const searchParams =
      request.nextUrl
        .searchParams;

    const serie =
      texto(
        searchParams.get(
          "serie"
        ) ?? "1"
      );

    const numeroNfe =
      texto(
        searchParams.get(
          "numero"
        ) ?? "5"
      );

    const chaveEsperada =
      somenteDigitos(
        searchParams.get(
          "chave"
        ) ??
          "51260842741754000142550010000000051394983380"
      );

    const cpfEsperado =
      somenteDigitos(
        searchParams.get(
          "cpf"
        ) ??
          "04623210103"
      );

    const produtoCodigo =
      texto(
        searchParams.get(
          "produto"
        ) ??
          "5207"
      );

    const totalEsperado =
      Number(
        searchParams.get(
          "total"
        ) ??
          "1"
      );

    // ========================================================
    // 3. API Key fiscal
    // ========================================================
    const {
      data: segredosData,
      error: segredosError,
    } =
      await admin.rpc(
        "obter_segredos_fiscais",
        {
          p_empresa_id:
            empresaId,
        }
      );

    if (
      segredosError
    ) {
      return NextResponse.json(
        {
          ok: false,
          erro:
            "Não foi possível ler os segredos fiscais.",
          detalhe:
            segredosError.message,
        },
        {
          status: 500,
        }
      );
    }

    const segredos =
      objeto(
        segredosData
      );

    const apiKey =
      texto(
        segredos
          .geranet_api_key
      );

    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          erro:
            "API Key Geranet não configurada.",
        },
        {
          status: 409,
        }
      );
    }

    // ========================================================
    // 4. Lista logs de sucesso
    // ========================================================
    const url =
      new URL(
        "https://nfe.geranet.net/api/v1/logs"
      );

    url.searchParams.set(
      "endpoint",
      "nfe/emitir"
    );

    url.searchParams.set(
      "cnpj",
      somenteDigitos(
        empresa.cnpj
      )
    );

    url.searchParams.set(
      "status",
      "sucesso"
    );

    url.searchParams.set(
      "por_pagina",
      "100"
    );

    const listaResponse =
      await fetch(
        url.toString(),
        {
          method: "GET",
          headers: {
            Accept:
              "application/json",
            Authorization:
              `Bearer ${apiKey}`,
          },
          cache:
            "no-store",
        }
      );

    const listaJson =
      await lerJson(
        listaResponse
      );

    if (
      !listaResponse.ok
    ) {
      return NextResponse.json(
        {
          ok: false,
          erro:
            "Falha ao consultar logs da Geranet.",
          http_status:
            listaResponse.status,
          resposta:
            listaJson,
        },
        {
          status: 502,
        }
      );
    }

    const listaObj =
      objeto(
        listaJson
      );

    const logs =
      array(
        listaObj.logs
      );

    // ========================================================
    // 5. Abre cada log de sucesso e procura a NF-e desejada
    // ========================================================
    const analisados: Array<
      Record<
        string,
        unknown
      >
    > = [];

    const encontrados: Array<
      Record<
        string,
        unknown
      >
    > = [];

    for (
      const item of logs
    ) {
      const logResumo =
        objeto(item);

      const logId =
        numero(
          logResumo.id
        );

      if (!logId) {
        continue;
      }

      const detalheResponse =
        await fetch(
          `https://nfe.geranet.net/api/v1/logs/${logId}`,
          {
            method:
              "GET",
            headers: {
              Accept:
                "application/json",
              Authorization:
                `Bearer ${apiKey}`,
            },
            cache:
              "no-store",
          }
        );

      const detalheJson =
        await lerJson(
          detalheResponse
        );

      if (
        !detalheResponse.ok
      ) {
        analisados.push({
          log_id:
            logId,
          erro_detalhe:
            detalheResponse.status,
        });
        continue;
      }

      const detalheObj =
        objeto(
          detalheJson
        );

      const log =
        objeto(
          detalheObj.log
        );

      const payload =
        objeto(
          log.payload
        );

      const resposta =
        objeto(
          log.resposta
        );

      const nfe =
        objeto(
          payload.nfe
        );

      const cliente =
        objeto(
          nfe.cliente
        );

      const itens =
        array(
          nfe.itens
        );

      const pagamento =
        objeto(
          nfe.pagamento
        );

      const detalhamento =
        array(
          pagamento
            .detalhamento
        );

      const payloadModelo =
        texto(
          nfe.modelo ??
          payload.modelo
        );

      const payloadSerie =
        texto(
          objeto(
            nfe.empresa
          ).serie
        );

      const payloadNumero =
        texto(
          nfe
            .numeroNotaEmitir
        );

      const payloadCodigoNumerico =
        texto(
          nfe
            .codigoNumerico
        );

      const payloadCpf =
        somenteDigitos(
          cliente.cpf
        );

      const respostaChave =
        somenteDigitos(
          resposta.chave
        );

      const respostaNumero =
        texto(
          resposta.numero
        );

      const respostaProtocolo =
        texto(
          resposta.protocolo
        );

      const respostaCstat =
        texto(
          resposta.cstat
        );

      const item5207 =
        itens
          .map(
            (registro) =>
              objeto(
                registro
              )
          )
          .find(
            (registro) =>
              texto(
                registro.codigo ??
                registro
                  .codigoProduto ??
                registro
                  .codigo_produto
              ) ===
              produtoCodigo
          ) ??
        null;

      const pagamentoTotal =
        detalhamento
          .map(
            (registro) =>
              objeto(
                registro
              )
          )
          .reduce(
            (
              total,
              registro
            ) =>
              total +
              (
                numero(
                  registro
                    .valor
                ) ??
                0
              ),
            0
          );

      const bateModelo =
        payloadModelo ===
        "55";

      const bateSerie =
        payloadSerie ===
        serie;

      const bateNumero =
        payloadNumero ===
          numeroNfe ||
        respostaNumero ===
          numeroNfe;

      const bateChave =
        chaveEsperada
          ? respostaChave ===
            chaveEsperada
          : false;

      const bateCpf =
        cpfEsperado
          ? payloadCpf ===
            cpfEsperado
          : false;

      const bateProduto =
        Boolean(
          item5207
        );

      const bateTotal =
        Number.isFinite(
          totalEsperado
        )
          ? Math.abs(
              pagamentoTotal -
                totalEsperado
            ) <
            0.001
          : false;

      const resumo = {
        log_id:
          logId,
        criado_em:
          logResumo
            .criado_em ??
          log.criado_em ??
          null,
        modelo:
          payloadModelo,
        serie:
          payloadSerie,
        numero:
          payloadNumero ||
          respostaNumero,
        codigo_numerico:
          payloadCodigoNumerico,
        cpf:
          payloadCpf ||
          null,
        chave:
          respostaChave ||
          null,
        protocolo:
          respostaProtocolo ||
          null,
        cstat:
          respostaCstat ||
          null,
        produto_5207:
          bateProduto,
        pagamento_total:
          pagamentoTotal,
        bate_modelo:
          bateModelo,
        bate_serie:
          bateSerie,
        bate_numero:
          bateNumero,
        bate_chave:
          bateChave,
        bate_cpf:
          bateCpf,
        bate_produto:
          bateProduto,
        bate_total:
          bateTotal,
      };

      analisados.push(
        resumo
      );

      if (
        bateChave ||
        (
          bateModelo &&
          bateSerie &&
          bateNumero
        )
      ) {
        encontrados.push(
          resumo
        );
      }
    }

    return NextResponse.json({
      ok: true,
      somente_leitura:
        true,
      alvo: {
        modelo: "55",
        serie,
        numero:
          numeroNfe,
        chave:
          chaveEsperada,
        cpf:
          cpfEsperado,
        produto:
          produtoCodigo,
        total:
          totalEsperado,
      },
      quantidade_logs_sucesso:
        logs.length,
      encontrados,
      conclusao:
        encontrados.length
          ? "Foi encontrado ao menos um log de sucesso compatível. Compare os campos bate_* antes de qualquer reconciliação."
          : "Nenhum log de sucesso compatível foi encontrado entre os últimos 100 logs consultados.",
      analisados:
        encontrados.length
          ? undefined
          : analisados.slice(
              0,
              20
            ),
    });
  } catch (error) {
    if (
      error instanceof
      ErroAdministracaoUsuarios
    ) {
      return NextResponse.json(
        {
          ok: false,
          erro:
            error.message,
        },
        {
          status:
            error.status,
        }
      );
    }

    console.error(
      "[DIAGNOSTICO DUPLICIDADE NFE]",
      error
    );

    return NextResponse.json(
      {
        ok: false,
        erro:
          error instanceof
          Error
            ? error.message
            : "Erro interno no diagnóstico.",
      },
      {
        status: 500,
      }
    );
  }
}
