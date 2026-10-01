import { NextRequest, NextResponse } from "next/server";

import {
  capturaErroAutorizacaoFiscal,
  exigirEmissaoNfe,
} from "@/lib/fiscal/acesso-operacao";
import { assertIdentidadeFiscalNfe } from "@/lib/fiscal/operacoes/resolver-natureza";
import { MENSAGEM_NATUREZA_VENDA_AUSENTE } from "@/lib/fiscal/operacoes/catalogo";
import { obterLogomarcaFiscalHex } from "@/lib/empresa/obter-logomarca-fiscal-hex";
import { resolverPayloadCabecalhoNfe } from "@/lib/fiscal/nfe55/cabecalho-fiscal";
import {
  lerAutorizadosXmlDoSnapshot,
  validarAutorizadosXml,
} from "@/lib/fiscal/nfe55/autorizados-xml";
import {
  lerEnderecoEntregaDoSnapshot,
  validarEnderecoEntrega,
} from "@/lib/fiscal/nfe55/endereco-entrega";
import { prepararNfeVenda } from "@/lib/fiscal/nfe55/preparar-nfe-venda";
import {
  argumentosCabecalhoNfeVenda,
  argumentosIdentidadeInicialNfeVenda,
  CODIGO_NUMERICO_PREVIEW_NFE,
  montarPayloadNfeVendaPreparada,
  NUMERO_NOTA_PREVIEW_NFE,
} from "@/lib/fiscal/nfe55/payload-nfe-venda";
import { ocultarSegredosPayloadNfe } from "@/lib/fiscal/geranet/montar-payload-nfe";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MENSAGEM_PREVIEW =
  "Pré-visualização da NF-e. Nenhum documento foi transmitido e nenhuma numeração fiscal foi consumida.";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const admin = createAdminClient();

  try {
    const { data: claimsData, error: authError } = await supabase.auth.getClaims();
    if (authError || !claimsData?.claims?.sub) {
      return json({ ok: false, preview: true, erro: "Não autenticado." }, 401);
    }

    const { data: vinculo } = await supabase
      .from("usuarios_empresas")
      .select("empresa_id")
      .eq("usuario_id", String(claimsData.claims.sub))
      .eq("principal", true)
      .eq("ativo", true)
      .maybeSingle();

    if (!vinculo) {
      return json(
        { ok: false, preview: true, erro: "Empresa ativa não encontrada." },
        403
      );
    }

    try {
      await exigirEmissaoNfe({
        empresaId: String(vinculo.empresa_id),
        origem: "nfe-preview-venda",
      });
    } catch (error) {
      const authz = capturaErroAutorizacaoFiscal(error);
      if (authz) {
        return json({ ok: false, preview: true, erro: authz.mensagem }, authz.status);
      }
      throw error;
    }

    const vendaId = String(request.nextUrl.searchParams.get("vendaId") ?? "").trim();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        vendaId
      )
    ) {
      return json({ ok: false, preview: true, erro: "vendaId inválido." }, 400);
    }

    const serieParam = request.nextUrl.searchParams.get("serie");
    const serie =
      serieParam == null || serieParam.trim() === ""
        ? null
        : Number(serieParam);

    const preparado = await prepararNfeVenda({
      supabase,
      admin,
      empresaId: String(vinculo.empresa_id),
      vendaId,
      modo: "preview",
      serie,
    });

    if (!preparado.ok) {
      return json(
        {
          ok: false,
          preview: true,
          transmitido: false,
          numeroReservado: false,
          pronta: false,
          mensagem: "NF-e ainda não está pronta para emissão",
          erro: preparado.erro,
          pendencias: [preparado.erro],
        },
        preparado.status
      );
    }

    const erroEntrega = validarEnderecoEntrega(
      lerEnderecoEntregaDoSnapshot(preparado.snapshotOperacao)
    );
    if (erroEntrega) {
      return json(
        {
          ok: false,
          preview: true,
          transmitido: false,
          numeroReservado: false,
          pronta: false,
          mensagem: "NF-e ainda não está pronta para emissão",
          erro: erroEntrega,
          pendencias: [erroEntrega],
        },
        422
      );
    }

    const erroAutorizadosXml = validarAutorizadosXml(
      lerAutorizadosXmlDoSnapshot(preparado.snapshotOperacao)
    );
    if (erroAutorizadosXml) {
      return json(
        {
          ok: false,
          preview: true,
          transmitido: false,
          numeroReservado: false,
          pronta: false,
          mensagem: "NF-e ainda não está pronta para emissão",
          erro: erroAutorizadosXml,
          pendencias: [erroAutorizadosXml],
        },
        422
      );
    }

    const cabecalhoNfe = resolverPayloadCabecalhoNfe(
      argumentosCabecalhoNfeVenda(preparado)
    );

    let identidade;
    try {
      identidade = assertIdentidadeFiscalNfe(
        argumentosIdentidadeInicialNfeVenda(preparado, cabecalhoNfe)
      );
    } catch (error) {
      const mensagem =
        error instanceof Error ? error.message : MENSAGEM_NATUREZA_VENDA_AUSENTE;
      return json(
        {
          ok: false,
          preview: true,
          transmitido: false,
          numeroReservado: false,
          pronta: false,
          mensagem: "NF-e ainda não está pronta para emissão",
          erro: mensagem,
          pendencias: [mensagem],
        },
        422
      );
    }

    const montado = montarPayloadNfeVendaPreparada({
      preparada: preparado,
      logomarca: await obterLogomarcaFiscalHex(String(vinculo.empresa_id)),
      serie: preparado.numeracao.serie ?? 1,
      numeroNota: NUMERO_NOTA_PREVIEW_NFE,
      codigoNumerico: CODIGO_NUMERICO_PREVIEW_NFE,
      dataSaida: cabecalhoNfe.dataSaida,
      dataEmissao: cabecalhoNfe.dataEmissao,
      indicadorPresenca: cabecalhoNfe.indicadorPresenca,
      indicativoIntermediador: cabecalhoNfe.indicativoIntermediador,
      tpNf: cabecalhoNfe.tpNf,
      identidade,
    });

    const payload = ocultarSegredosPayloadNfe(montado.payload);

    return json({
      ok: true,
      preview: true,
      transmitido: false,
      numeroReservado: false,
      pronta: true,
      mensagem: MENSAGEM_PREVIEW,
      dados: {
        serie: preparado.numeracao.serie,
        numero: "Será atribuído na emissão",
        ambiente: preparado.ambiente,
        natureza: identidade.descricao,
        finalidade: identidade.finNfe,
        tipoOperacao: identidade.tpNf,
        crt: preparado.crt,
        pagamentos: preparado.pagamentosConfirmados.map((pagamento) => ({
          nome: pagamento.forma_pagamento_nome ?? null,
          codigo: pagamento.forma_pagamento_codigo ?? null,
          tPag: pagamento.codigo_fiscal ?? null,
          valor: pagamento.valor ?? null,
        })),
      },
      payload,
    });
  } catch (error) {
    console.error(
      "[NFE55 PREVIEW VENDA]",
      error instanceof Error ? error.message : "Erro desconhecido"
    );
    return json(
      {
        ok: false,
        preview: true,
        transmitido: false,
        numeroReservado: false,
        erro: "Não foi possível montar a pré-visualização da NF-e.",
      },
      500
    );
  }
}
