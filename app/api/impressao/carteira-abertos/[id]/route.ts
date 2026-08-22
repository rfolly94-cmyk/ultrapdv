import { NextResponse } from "next/server";

import {
  exigirOperacaoCarteira,
  respostaNegacaoCarteira,
} from "@/lib/carteira/acesso-operacao";
import {
  carregarItensAbertosCarteiraDaEmpresaAtiva,
  linhasItensAbertosCarteira,
} from "@/lib/impressao/carregar-carteira";
import { gerarPdfSimples } from "@/lib/impressao/pdf-simples";
import { ehPapelImpressao } from "@/lib/impressao/regras";
import { respostaPdf } from "@/lib/impressao/resposta-pdf";
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

  try {
    await exigirOperacaoCarteira({
      empresaId: String(vinculo.empresa_id),
      acao: "acessar_carteira",
      origem: "GET /api/impressao/carteira-abertos",
    });
  } catch (error) {
    const negacao = respostaNegacaoCarteira(error);
    if (negacao) {
      return negacao;
    }
    throw error;
  }

  const dados = await carregarItensAbertosCarteiraDaEmpresaAtiva({
    supabase,
    empresaId: vinculo.empresa_id,
    clienteId: id,
  });

  if (!dados) {
    return NextResponse.json({ erro: "Cliente não encontrado." }, { status: 404 });
  }

  const papelParam = new URL(request.url).searchParams.get("papel");
  const papel = ehPapelImpressao(papelParam) ? papelParam : "80mm";
  const pdf = gerarPdfSimples({
    papel,
    linhas: linhasItensAbertosCarteira(dados),
  });

  return respostaPdf(pdf, "carteira-itens-abertos.pdf");
}
