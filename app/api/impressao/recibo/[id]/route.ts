import { NextResponse } from "next/server";

import { aplicarCors, respostaOptions } from "@/lib/api/cors-mobile";
import { buscarVinculoEmpresaAtiva } from "@/lib/empresa/empresa-ativa";
import {
  carregarReciboVendaDaEmpresaAtiva,
  linhasReciboComercial,
} from "@/lib/impressao/carregar-recibo";
import { gerarPdfSimples } from "@/lib/impressao/pdf-simples";
import { ehPapelImpressao } from "@/lib/impressao/regras";
import { respostaPdf } from "@/lib/impressao/resposta-pdf";
import { obterClaimsSessao } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const METODOS = "GET, OPTIONS";

export async function OPTIONS() {
  return respostaOptions(METODOS);
}

function jsonErro(erro: string, status: number) {
  return aplicarCors(NextResponse.json({ erro }, { status }), METODOS);
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const { data: claimsData, error } = await obterClaimsSessao(supabase);
  const usuarioId = claimsData?.claims?.sub;

  if (error || !usuarioId) {
    return jsonErro("Não autenticado.", 401);
  }

  const { data: vinculo } = await buscarVinculoEmpresaAtiva<{
    empresa_id: string;
  }>(supabase, usuarioId, "empresa_id");

  if (!vinculo) {
    return jsonErro("Empresa ativa não encontrada.", 403);
  }

  const recibo = await carregarReciboVendaDaEmpresaAtiva({
    supabase,
    empresaId: vinculo.empresa_id,
    vendaId: id,
  });

  if (!recibo) {
    return jsonErro("Venda não encontrada.", 404);
  }

  const papelParam = new URL(request.url).searchParams.get("papel");
  const papel = ehPapelImpressao(papelParam) ? papelParam : "80mm";
  const pdf = gerarPdfSimples({
    papel,
    linhas: linhasReciboComercial(recibo),
  });

  return aplicarCors(
    respostaPdf(pdf, `recibo-${recibo.numero}.pdf`, "inline"),
    METODOS
  );
}
