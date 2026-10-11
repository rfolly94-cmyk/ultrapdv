import { NextRequest, NextResponse } from "next/server";

import {
  capturaErroAutorizacaoFiscal,
  exigirEmissaoNfe,
} from "@/lib/fiscal/acesso-operacao";
import { obterLogomarcaFiscalHex } from "@/lib/empresa/obter-logomarca-fiscal-hex";
import { formatarDataHoraGeranet } from "@/lib/fiscal/geranet/data-hora";
import { exigirFusoHorarioFiscalDaEmissao } from "@/lib/fiscal/fuso-horario-empresa";
import { ocultarSegredosPayloadNfe } from "@/lib/fiscal/geranet/montar-payload-nfe";
import { prepararNfeOperacao } from "@/lib/fiscal/nfe55/preparar-nfe-operacao";
import { montarPayloadNfeOperacaoPreparada } from "@/lib/fiscal/nfe55/payload-nfe-operacao";
import {
  CODIGO_NUMERICO_PREVIEW_NFE,
  NUMERO_NOTA_PREVIEW_NFE,
} from "@/lib/fiscal/nfe55/payload-nfe-venda";
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
        origem: "nfe-preview-operacao",
      });
    } catch (error) {
      const authz = capturaErroAutorizacaoFiscal(error);
      if (authz) {
        return json({ ok: false, preview: true, erro: authz.mensagem }, authz.status);
      }
      throw error;
    }

    const operacaoId = String(request.nextUrl.searchParams.get("operacaoId") ?? "").trim();
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        operacaoId
      )
    ) {
      return json({ ok: false, preview: true, erro: "operacaoId inválido." }, 400);
    }

    const preparado = await prepararNfeOperacao({
      supabase,
      admin,
      empresaId: String(vinculo.empresa_id),
      operacaoId,
      modo: "preview",
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

    let fusoHorario: string;
    try {
      fusoHorario = exigirFusoHorarioFiscalDaEmissao({
        empresaIdDaEmissao: String(vinculo.empresa_id),
        fiscal: preparado.fiscal,
      });
    } catch (errorFuso) {
      const mensagem =
        errorFuso instanceof Error
          ? errorFuso.message
          : "Fuso horário fiscal da empresa não está configurado.";
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

    const dataHora = formatarDataHoraGeranet(new Date(), fusoHorario);
    let montado;
    try {
      montado = montarPayloadNfeOperacaoPreparada({
        preparada: preparado,
        logomarca: await obterLogomarcaFiscalHex(String(vinculo.empresa_id)),
        serie: preparado.numeracao.serie ?? 1,
        numeroNota: NUMERO_NOTA_PREVIEW_NFE,
        codigoNumerico: CODIGO_NUMERICO_PREVIEW_NFE,
        dataHora,
        fusoHorario,
      });
    } catch (error) {
      const mensagem =
        error instanceof Error ? error.message : "Identidade fiscal incompleta.";
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
        natureza: montado.identidade.descricao,
        finalidade: montado.identidade.finNfe,
        tipoOperacao: montado.identidade.tpNf,
        crt: preparado.crt,
      },
      payload: ocultarSegredosPayloadNfe(montado.payload),
    });
  } catch (error) {
    console.error(
      "[NFE55 PREVIEW OPERACAO]",
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
