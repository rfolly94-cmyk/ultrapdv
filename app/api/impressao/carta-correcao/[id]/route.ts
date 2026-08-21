import { NextResponse } from "next/server";

import {
  carregarCartaCorrecaoDaEmpresaAtiva,
  linhasCartaCorrecao,
} from "@/lib/impressao/carregar-cce";
import { gerarPdfSimples } from "@/lib/impressao/pdf-simples";
import { respostaPdf } from "@/lib/impressao/resposta-pdf";
import { buscarVinculoEmpresaAtiva } from "@/lib/empresa/empresa-ativa";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
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

  const dados = await carregarCartaCorrecaoDaEmpresaAtiva({
    supabase,
    empresaId: vinculo.empresa_id,
    eventoId: id,
  });

  if (!dados) {
    return NextResponse.json(
      { erro: "Carta de Correção não encontrada ou não autorizada." },
      { status: 404 }
    );
  }

  const pdf = gerarPdfSimples({
    papel: "a4",
    linhas: linhasCartaCorrecao(dados),
  });

  return respostaPdf(pdf, "carta-correcao.pdf");
}
