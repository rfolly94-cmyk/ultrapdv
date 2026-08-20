import {
  NextRequest,
  NextResponse,
} from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { MENSAGEM_NATUREZA_VENDA_INVALIDA } from "@/lib/fiscal/operacoes/catalogo";
import { naturezaEstaCompleta } from "@/lib/fiscal/operacoes/resolver-natureza";
import type { NaturezaOperacaoFiscal } from "@/lib/fiscal/operacoes/catalogo";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  const supabase = await createClient();
  const admin = createAdminClient();

  try {
    const { data: claimsData, error: authError } =
      await supabase.auth.getClaims();

    if (authError || !claimsData?.claims?.sub) {
      return json({ ok: false, erro: "Não autenticado." }, 401);
    }

    const { data: vinculo } = await supabase
      .from("usuarios_empresas")
      .select("empresa_id")
      .eq("usuario_id", String(claimsData.claims.sub))
      .eq("principal", true)
      .eq("ativo", true)
      .maybeSingle();

    if (!vinculo) {
      return json({ ok: false, erro: "Empresa ativa não encontrada." }, 403);
    }

    const empresaId = vinculo.empresa_id;
    const { id: vendaId } = await context.params;

    const body = (await request.json().catch(() => ({}))) as {
      natureza_id?: unknown;
    };
    const naturezaId = texto(body.natureza_id);

    if (!naturezaId) {
      return json(
        { ok: false, erro: "Selecione uma natureza de operação." },
        400
      );
    }

    const { data: venda, error: vendaError } = await admin
      .from("vendas")
      .select("id, status, empresa_id")
      .eq("empresa_id", empresaId)
      .eq("id", vendaId)
      .maybeSingle();

    if (vendaError || !venda || !registroPertenceAEmpresaAtiva(venda, empresaId)) {
      return json({ ok: false, erro: "Venda não encontrada." }, 404);
    }

    if (venda.status !== "finalizada") {
      return json(
        {
          ok: false,
          erro: "Somente venda finalizada pode alterar a natureza da NF-e.",
        },
        409
      );
    }

    const { data: emissoesBloqueantes, error: fiscalError } = await admin
      .from("fiscal_emissoes")
      .select("id, status")
      .eq("empresa_id", empresaId)
      .eq("origem_tipo", "venda")
      .eq("origem_id", vendaId)
      .in("status", [
        "reservada",
        "enviando",
        "autorizada",
        "erro_comunicacao",
        "aguardando_reconciliacao",
        "aguardando_transmissao_contingencia",
        "transmitindo_contingencia",
      ])
      .limit(1);

    if (fiscalError) {
      return json({ ok: false, erro: fiscalError.message }, 500);
    }

    if ((emissoesBloqueantes ?? []).length > 0) {
      return json(
        {
          ok: false,
          erro: `A natureza não pode ser alterada porque existe documento fiscal em estado ${emissoesBloqueantes?.[0]?.status ?? "sensível"}.`,
        },
        409
      );
    }

    const { data: natureza, error: naturezaError } = await admin
      .from("fiscal_naturezas_operacao")
      .select(`
        id,
        empresa_id,
        tipo_operacao_interno,
        descricao,
        tp_nf,
        fin_nfe,
        padrao,
        ativo
      `)
      .eq("id", naturezaId)
      .eq("empresa_id", empresaId)
      .eq("tipo_operacao_interno", "venda")
      .eq("ativo", true)
      .maybeSingle();

    const naturezaVenda = natureza as NaturezaOperacaoFiscal | null;

    if (
      naturezaError ||
      !naturezaVenda ||
      !registroPertenceAEmpresaAtiva(naturezaVenda, empresaId) ||
      naturezaVenda.tipo_operacao_interno !== "venda" ||
      naturezaVenda.ativo !== true ||
      !naturezaEstaCompleta(naturezaVenda, empresaId)
    ) {
      return json(
        { ok: false, erro: MENSAGEM_NATUREZA_VENDA_INVALIDA },
        422
      );
    }

    const { error: updateError } = await admin
      .from("vendas")
      .update({ natureza_id: naturezaVenda.id })
      .eq("id", vendaId)
      .eq("empresa_id", empresaId);

    if (updateError) {
      return json({ ok: false, erro: updateError.message }, 500);
    }

    return json({
      ok: true,
      natureza_id: naturezaVenda.id,
      descricao: naturezaVenda.descricao,
      tp_nf: naturezaVenda.tp_nf,
      fin_nfe: naturezaVenda.fin_nfe,
      mensagem: "Natureza de operação salva para esta venda.",
    });
  } catch (error) {
    return json(
      {
        ok: false,
        erro:
          error instanceof Error
            ? error.message
            : "Erro interno ao salvar a natureza de operação.",
      },
      500
    );
  }
}
