import {
  NextResponse,
} from "next/server";

import * as https from "node:https";

import {
  ErroAdministracaoUsuarios,
  MENSAGEM_ADMIN_DIAGNOSTICO,
  obterContextoAdministracaoUsuarios,
} from "@/lib/usuarios/contexto-administracao";

export const runtime =
  "nodejs";

function texto(
  valor: unknown
) {
  return String(
    valor ?? ""
  ).trim();
}

function extrairTag(
  xml: string,
  tag: string
) {
  const regex =
    new RegExp(
      `<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
      "i"
    );

  return (
    xml.match(regex)?.[1] ??
    ""
  ).trim();
}

function enviarSoap({
  certificadoHex,
  senha,
}: {
  certificadoHex: string;
  senha: string;
}) {
  const endpoint =
    "https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeStatusServico4";

 const dados =
  '<consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>2</tpAmb><cUF>51</cUF><xServ>STATUS</xServ></consStatServ>';

const soap =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
  '<soap12:Body>' +
  '<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">' +
  dados +
  '</nfeDadosMsg>' +
  '</soap12:Body>' +
  '</soap12:Envelope>';

  return new Promise<{
    httpStatus: number;
    body: string;
  }>((resolve, reject) => {
    const pfx =
      Buffer.from(
        certificadoHex,
        "hex"
      );

    const req =
      https.request(
        endpoint,
        {
          method: "POST",

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
              'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF"',

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
            (chunk) => {
              body += chunk;
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
      30000,
      () => {
        req.destroy(
          new Error(
            "Timeout ao consultar a SEFAZ-MT."
          )
        );
      }
    );

    req.on(
      "error",
      reject
    );

    req.write(soap);
    req.end();
  });
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
    } =
      await admin.rpc(
        "obter_segredos_fiscais",
        {
          p_empresa_id:
            empresaId,
        }
      );

    if (segredosError) {
      throw new Error(
        segredosError.message
      );
    }

    const segredos =
      (segredosData ?? {}) as {
        certificado_a1?:
          string | null;

        senha_certificado?:
          string | null;
      };

    const certificadoHex =
      texto(
        segredos.certificado_a1
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
      !certificadoHex
    ) {
      throw new Error(
        "Certificado A1 não configurado."
      );
    }

    if (!senha) {
      throw new Error(
        "Senha do certificado não configurada."
      );
    }

    if (
      !/^[0-9a-fA-F]+$/.test(
        certificadoHex
      ) ||
      certificadoHex.length %
        2 !==
        0
    ) {
      throw new Error(
        "Certificado A1 armazenado não está em formato hexadecimal válido."
      );
    }

    const resposta =
      await enviarSoap({
        certificadoHex,
        senha,
      });

    const cStat =
      extrairTag(
        resposta.body,
        "cStat"
      );

    const xMotivo =
      extrairTag(
        resposta.body,
        "xMotivo"
      );

    const tpAmb =
      extrairTag(
        resposta.body,
        "tpAmb"
      );

    return NextResponse.json({
      ok:
        resposta.httpStatus >=
          200 &&
        resposta.httpStatus <
          300,

      teste:
        "SEFAZ-MT NFC-e homologação direto",

      emitiu_nota: false,

      ambiente: "2",

      endpoint:
        "NfeStatusServico4",

      http_status:
        resposta.httpStatus,

      cstat:
        cStat || null,

      motivo:
        xMotivo || null,

      tpAmb:
        tpAmb || null,

      servico_operando:
        cStat === "107",
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
      "[SEFAZ MT STATUS HOMOLOGACAO]",
      e
    );

    return NextResponse.json(
      {
        ok: false,

        emitiu_nota:
          false,

        erro:
          e instanceof Error
            ? e.message
            : "Erro desconhecido.",
      },
      {
        status: 500,
      }
    );
  }
}