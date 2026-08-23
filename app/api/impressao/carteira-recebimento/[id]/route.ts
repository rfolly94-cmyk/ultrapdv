import { NextResponse } from "next/server";

import { aplicarCors, respostaOptions } from "@/lib/api/cors-mobile";

import {
  exigirOperacaoCarteira,
  respostaNegacaoCarteira,
} from "@/lib/carteira/acesso-operacao";
import { carregarReciboRecebimentoCarteiraDaEmpresaAtiva } from "@/lib/impressao/carregar-recibo-carteira";
import { gerarPdfSimples } from "@/lib/impressao/pdf-simples";
import {
  linhasReciboRecebimentoCarteira,
  nomeArquivoReciboRecebimento,
} from "@/lib/impressao/recibo-carteira";
import { ehPapelImpressao } from "@/lib/impressao/regras";
import { respostaPdf } from "@/lib/impressao/resposta-pdf";
import { buscarVinculoEmpresaAtiva } from "@/lib/empresa/empresa-ativa";
import { obterClaimsSessao } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function OPTIONS() {
  return respostaOptions("GET, OPTIONS");
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const clienteId = String(url.searchParams.get("cliente") ?? "").trim();
  const supabase = await createClient();
  const { data: claimsData, error } = await obterClaimsSessao(supabase);
  const usuarioId = claimsData?.claims?.sub;

  if (error || !usuarioId) {
    return aplicarCors(
      NextResponse.json({ erro: "Não autenticado." }, { status: 401 }),
      "GET, OPTIONS"
    );
  }

  const { data: vinculo } = await buscarVinculoEmpresaAtiva<{
    empresa_id: string;
  }>(supabase, usuarioId, "empresa_id");

  if (!vinculo) {
    return aplicarCors(
      NextResponse.json(
        { erro: "Empresa ativa não encontrada." },
        { status: 403 }
      ),
      "GET, OPTIONS"
    );
  }

  try {
    await exigirOperacaoCarteira({
      empresaId: String(vinculo.empresa_id),
      acao: "acessar_carteira",
      origem: "GET /api/impressao/carteira-recebimento",
    });
  } catch (error) {
    const negacao = respostaNegacaoCarteira(error);
    if (negacao) {
      return aplicarCors(negacao, "GET, OPTIONS");
    }
    throw error;
  }

  if (!clienteId) {
    return aplicarCors(
      NextResponse.json({ erro: "Cliente não informado." }, { status: 400 }),
      "GET, OPTIONS"
    );
  }

  const dados = await carregarReciboRecebimentoCarteiraDaEmpresaAtiva({
    supabase,
    empresaId: String(vinculo.empresa_id),
    clienteId,
    recebimentoId: id,
  });

  if (!dados) {
    return aplicarCors(
      NextResponse.json(
        { erro: "Recebimento não encontrado." },
        { status: 404 }
      ),
      "GET, OPTIONS"
    );
  }

  const papelParam = url.searchParams.get("papel");
  const papel = ehPapelImpressao(papelParam) ? papelParam : "80mm";
  const pdf = gerarPdfSimples({
    papel,
    linhas: linhasReciboRecebimentoCarteira(dados),
  });

  return aplicarCors(
    respostaPdf(
      pdf,
      nomeArquivoReciboRecebimento({
        clienteNome: dados.clienteNome,
        dataIso: dados.dataIso,
        recebimentoId: dados.recebimentoId,
      }),
      "attachment"
    ),
    "GET, OPTIONS"
  );
}
