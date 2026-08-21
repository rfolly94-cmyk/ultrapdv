import { NextResponse } from "next/server";

import { carregarReciboVendaDaEmpresaAtiva, linhasReciboComercial } from "@/lib/impressao/carregar-recibo";
import { gerarPdfSimples } from "@/lib/impressao/pdf-simples";
import { ehPapelImpressao } from "@/lib/impressao/regras";
import { buscarVinculoEmpresaAtiva } from "@/lib/empresa/empresa-ativa";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();
  const usuarioId = claimsData?.claims?.sub;

  if (error || !usuarioId) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const { data: vinculo } = await buscarVinculoEmpresaAtiva<{
    empresa_id: string;
  }>(supabase, usuarioId, "empresa_id");

  if (!vinculo) {
    return NextResponse.json(
      { erro: "Empresa ativa não encontrada." },
      { status: 403 }
    );
  }

  const recibo = await carregarReciboVendaDaEmpresaAtiva({
    supabase,
    empresaId: vinculo.empresa_id,
    vendaId: id,
  });

  if (!recibo) {
    return NextResponse.json({ erro: "Venda não encontrada." }, { status: 404 });
  }

  const papelParam = new URL(request.url).searchParams.get("papel");
  const papel = ehPapelImpressao(papelParam) ? papelParam : "80mm";
  const pdf = gerarPdfSimples({
    papel,
    linhas: linhasReciboComercial(recibo),
  });

  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="recibo-${recibo.numero}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
