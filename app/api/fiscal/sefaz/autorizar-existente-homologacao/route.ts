import {
  NextRequest,
  NextResponse,
} from "next/server";

import * as https from "node:https";

import {
  ErroAdministracaoUsuarios,
  MENSAGEM_ADMIN_DIAGNOSTICO,
  obterContextoAdministracaoUsuarios,
} from "@/lib/usuarios/contexto-administracao";

export const runtime = "nodejs";

function texto(
  valor: unknown
) {
  return String(
    valor ?? ""
  ).trim();
}

function extrairTags(
  xml: string,
  tag: string
) {
  const regex =
    new RegExp(
      `<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
      "gi"
    );

  const valores: string[] = [];

  let match:
    RegExpExecArray | null;

  while (
    (match =
      regex.exec(xml)) !==
    null
  ) {
    valores.push(
      String(
        match[1] ?? ""
      ).trim()
    );
  }

  return valores;
}

async function enviarParaSefaz({
  certificadoHex,
  senha,
  xmlNfe,
}: {
  certificadoHex: string;
  senha: string;
  xmlNfe: string;
}) {
  const endpoint =
    "https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeAutorizacao4";

  // Remove apenas a declaração XML.
  // NÃO alteramos o conteúdo assinado da NFe.
  const nfe =
    xmlNfe
      .replace(
        /^\uFEFF/,
        ""
      )
      .replace(
        /^<\?xml[^>]*\?>/,
        ""
      )
      .trim();

  if (
    !nfe.startsWith(
      "<NFe"
    )
  ) {
    throw new Error(
      "O XML armazenado não começa com <NFe>."
    );
  }

  /*
   * A NFe já está assinada.
   *
   * Apenas envolvemos no lote enviNFe.
   * indSinc=1 = processamento síncrono.
   */
  const lote =
    '<enviNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">' +
    "<idLote>3</idLote>" +
    "<indSinc>1</indSinc>" +
    nfe +
    "</enviNFe>";

  // Sem quebras/espaços entre tags do SOAP,
  // evitando novamente cStat 588.
  const soap =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    "<soap12:Body>" +
    '<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">' +
    lote +
    "</nfeDadosMsg>" +
    "</soap12:Body>" +
    "</soap12:Envelope>";

  const pfx =
    Buffer.from(
      certificadoHex,
      "hex"
    );

  return new Promise<{
    httpStatus: number;
    body: string;
  }>(
    (
      resolve,
      reject
    ) => {
      const req =
        https.request(
          endpoint,
          {
            method:
              "POST",

            pfx,

            passphrase:
              senha,

            minVersion:
              "TLSv1.2",

            rejectUnauthorized:
              true,

            headers: {
              Accept:
                "application/soap+xml, text/xml",

              "Content-Type":
                'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote"',

              "Content-Length":
                Buffer.byteLength(
                  soap
                ),
            },
          },
          (res) => {
            let body = "";

            res.setEncoding(
              "utf8"
            );

            res.on(
              "data",
              (
                chunk
              ) => {
                body +=
                  chunk;
              }
            );

            res.on(
              "end",
              () => {
                resolve({
                  httpStatus:
                    res.statusCode ??
                    0,

                  body,
                });
              }
            );
          }
        );

      req.setTimeout(
        45000,
        () => {
          req.destroy(
            new Error(
              "Timeout na autorização direta SEFAZ-MT."
            )
          );
        }
      );

      req.on(
        "error",
        reject
      );

      req.write(
        soap
      );

      req.end();
    }
  );
}

export async function POST(
  request: NextRequest
) {
  try {
    const {
      admin,
      empresaId,
    } =
      await obterContextoAdministracaoUsuarios({
        mensagemNaoAdmin:
          MENSAGEM_ADMIN_DIAGNOSTICO,
      });

    const body =
      (await request.json()) as {
        emissao_id?:
          string;

        confirmar?:
          string;
      };

    if (
      body.confirmar !==
      "AUTORIZAR_DIRETO_SEFAZ_HOMOLOGACAO"
    ) {
      return NextResponse.json(
        {
          ok: false,
          erro:
            "Confirmação inválida.",
        },
        {
          status: 422,
        }
      );
    }

    const emissaoId =
      texto(
        body.emissao_id
      );

    if (
      !emissaoId
    ) {
      return NextResponse.json(
        {
          ok: false,
          erro:
            "emissao_id não informado.",
        },
        {
          status: 422,
        }
      );
    }

    const {
      data: emissao,
      error:
        emissaoError,
    } =
      await admin
        .from(
          "fiscal_emissoes"
        )
        .select(`
          id,
          empresa_id,
          modelo,
          serie,
          numero,
          ambiente,
          status,
          chave_acesso,
          protocolo,
          xml_hex,
          resposta_resumo
        `)
        .eq(
          "id",
          emissaoId
        )
        .eq(
          "empresa_id",
          empresaId
        )
        .maybeSingle();

    if (
      emissaoError ||
      !emissao
    ) {
      throw new Error(
        "Emissão fiscal não encontrada."
      );
    }

    /*
     * TRAVAS IMPORTANTES
     */

    if (
      Number(
        emissao.ambiente
      ) !== 2
    ) {
      throw new Error(
        "A emissão não pertence ao ambiente de homologação."
      );
    }

    if (
      String(
        emissao.modelo
      ) !== "65"
    ) {
      throw new Error(
        "Somente NFC-e modelo 65 pode ser usada neste diagnóstico."
      );
    }

    if (
      emissao.status ===
      "autorizada"
    ) {
      throw new Error(
        "Esta emissão já está marcada como autorizada. Nenhuma retransmissão será realizada."
      );
    }

    if (
      emissao.protocolo
    ) {
      throw new Error(
        "A emissão já possui protocolo. Nenhuma retransmissão será realizada."
      );
    }

    const statusEmissao =
      texto(
        emissao.status
      );
    const classificacaoResumo =
      texto(
        emissao.resposta_resumo &&
          typeof emissao.resposta_resumo ===
            "object"
          ? (
              emissao.resposta_resumo as {
                classificacao?:
                  unknown;
              }
            ).classificacao
          : ""
      );

    if (
      statusEmissao ===
        "aguardando_reconciliacao" ||
      statusEmissao ===
        "enviando" ||
      statusEmissao ===
        "transmitindo_contingencia" ||
      statusEmissao ===
        "aguardando_transmissao_contingencia" ||
      (
        statusEmissao ===
          "erro_comunicacao" &&
        classificacaoResumo !==
          "erro_envio"
      )
    ) {
      throw new Error(
        "Situação remota não conclusiva. Reconcilie esta NFC-e; não retransmita o XML diretamente à SEFAZ."
      );
    }

    const xmlHex =
      texto(
        emissao.xml_hex
      );

    if (
      !xmlHex
    ) {
      throw new Error(
        "A emissão não possui XML armazenado."
      );
    }

    if (
      !/^[0-9a-fA-F]+$/.test(
        xmlHex
      )
    ) {
      throw new Error(
        "xml_hex inválido."
      );
    }

    const xmlNfe =
      Buffer.from(
        xmlHex,
        "hex"
      ).toString(
        "utf8"
      );

    /*
     * Segredos fiscais
     */

    const {
      data:
        segredosData,
      error:
        segredosError,
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
      throw new Error(
        segredosError.message
      );
    }

    const segredos =
      (segredosData ??
        {}) as {
        certificado_a1?:
          string | null;

        senha_certificado?:
          string | null;
      };

    const certificadoHex =
      texto(
        segredos
          .certificado_a1
      ).replace(
        /\s/g,
        ""
      );

    const senha =
      texto(
        segredos
          .senha_certificado
      );

    if (
      !certificadoHex ||
      !senha
    ) {
      throw new Error(
        "Certificado A1 ou senha não configurados."
      );
    }

    /*
     * ENVIO DIRETO
     */

    const resposta =
      await enviarParaSefaz({
        certificadoHex,
        senha,
        xmlNfe,
      });

    const cstats =
      extrairTags(
        resposta.body,
        "cStat"
      );

    const motivos =
      extrairTags(
        resposta.body,
        "xMotivo"
      );

    const protocolos =
      extrairTags(
        resposta.body,
        "nProt"
      );

    const chaves =
      extrairTags(
        resposta.body,
        "chNFe"
      );

    return NextResponse.json({
      ok: true,

      teste:
        "Autorização direta SEFAZ-MT homologação",

      geranet:
        false,

      nova_numeracao:
        false,

      emissao_id:
        emissao.id,

      serie:
        emissao.serie,

      numero:
        String(
          emissao.numero
        ),

      ambiente:
        "2",

      http_status:
        resposta.httpStatus,

      cstats,

      motivos,

      protocolo:
        protocolos[0] ??
        null,

      chave:
        chaves[0] ??
        null,

      /*
       * Retornamos também a resposta para
       * diagnóstico.
       *
       * Não contém senha ou certificado.
       */
      resposta_xml:
        resposta.body,
    });
  } catch (e) {
    if (
      e instanceof
      ErroAdministracaoUsuarios
    ) {
      return NextResponse.json(
        {
          ok: false,
          erro:
            e.message,
        },
        {
          status:
            e.status,
        }
      );
    }

    console.error(
      "[SEFAZ MT AUTORIZACAO DIRETA]",
      e
    );

    return NextResponse.json(
      {
        ok: false,

        erro:
          e instanceof Error
            ? e.message
            : "Erro desconhecido.",

        nova_numeracao:
          false,
      },
      {
        status: 500,
      }
    );
  }
}
