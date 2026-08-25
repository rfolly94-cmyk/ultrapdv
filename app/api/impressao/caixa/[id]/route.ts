import { NextResponse } from "next/server";

import { exigirOperacaoCaixa } from "@/lib/caixa/acesso-operacao";
import { carregarDetalheCaixa } from "@/lib/caixa/carregar";
import { podeRevelarEsperadoCaixaCego } from "@/lib/caixa/conferencia";
import {
  linhasRelatorioCaixaPdf,
  nomeArquivoRelatorioCaixa,
} from "@/lib/caixa/relatorio";
import { carregarEmpresaRelatorioCaixa } from "@/lib/caixa/relatorio-servidor";
import { uuidCaixaValido } from "@/lib/caixa/valor";
import { buscarVinculoEmpresaAtiva } from "@/lib/empresa/empresa-ativa";
import { gerarPdfSimples } from "@/lib/impressao/pdf-simples";
import { respostaPdf } from "@/lib/impressao/resposta-pdf";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { ErroEntitlement } from "@/lib/plataforma/entitlements/erro";
import { obterClaimsSessao } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function jsonErro(erro: string, status: number) {
  return NextResponse.json({ erro }, { status });
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

  const empresaId = String(vinculo.empresa_id);
  let podeRevelarEsperadoCego = false;

  try {
    const sessao = await exigirOperacaoCaixa({
      empresaId,
      acao: "acessar",
      origem: "GET /api/impressao/caixa/[id]",
    });
    podeRevelarEsperadoCego = podeRevelarEsperadoCaixaCego(sessao.permissoes);
  } catch (negacao) {
    if (negacao instanceof ErroPermissao && negacao.status === 401) {
      return jsonErro("Não autenticado.", 401);
    }
    if (negacao instanceof ErroEntitlement || negacao instanceof ErroPermissao) {
      return jsonErro(negacao.message, negacao.status === 403 ? 403 : 403);
    }
    throw negacao;
  }

  if (!uuidCaixaValido(id)) {
    return jsonErro("Caixa não encontrado.", 404);
  }

  const [caixa, empresa] = await Promise.all([
    carregarDetalheCaixa({
      empresaId,
      caixaId: id,
      podeRevelarEsperadoCego,
    }),
    carregarEmpresaRelatorioCaixa({ supabase, empresaId }),
  ]);

  if (!caixa || caixa.empresa_id !== empresaId || !empresa) {
    return jsonErro("Caixa não encontrado.", 404);
  }

  const baixar = new URL(request.url).searchParams.get("download") === "1";
  const nome = nomeArquivoRelatorioCaixa({
    numero: caixa.numero,
    aberto_em: caixa.aberto_em,
  });
  const pdf = gerarPdfSimples({
    papel: "a4",
    linhas: linhasRelatorioCaixaPdf({
      empresa,
      caixa,
      ocultarEsperado:
        caixa.status === "aberto" &&
        !podeRevelarEsperadoCego &&
        caixa.saldoAtual == null,
    }),
  });

  return respostaPdf(pdf, nome, baixar ? "attachment" : "inline");
}
