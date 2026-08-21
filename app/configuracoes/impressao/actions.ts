"use server";

import { obterIdentidadeEmpresaSessao } from "@/lib/empresa/identidade-sessao";
import {
  buscarConfiguracoesImpressao,
  buscarEmissaoAutorizadaDaVenda,
  salvarConfiguracaoImpressao as gravarConfiguracao,
} from "@/lib/impressao/configuracoes-servidor";
import { gerarPdfSimples, linhasTesteImpressao } from "@/lib/impressao/pdf-simples";
import { ehPapelImpressao, rotuloTipoDocumentoImpressao } from "@/lib/impressao/regras";
import type { TipoDocumentoImpressao } from "@/lib/impressao/tipos";

export async function buscarConfiguracoesImpressaoAction(
  dispositivoId: string
) {
  const identidade = await obterIdentidadeEmpresaSessao();
  const resultado = await buscarConfiguracoesImpressao(dispositivoId);
  if (!resultado.ok) {
    return resultado;
  }
  return {
    ...resultado,
    empresaNome: identidade?.nome ?? "Empresa",
  };
}

export async function salvarConfiguracaoImpressaoAction(input: {
  dispositivoId: string;
  tipoDocumento: TipoDocumentoImpressao;
  impressoraNome?: string | null;
  papel?: string;
  copias?: number;
  impressaoAutomatica?: boolean;
}) {
  return gravarConfiguracao(input);
}

export async function gerarPdfTesteImpressaoAction(input: {
  tipoDocumento: TipoDocumentoImpressao;
  papel: string;
  impressora: string;
}) {
  const identidade = await obterIdentidadeEmpresaSessao();
  if (!identidade) {
    return { ok: false as const, erro: "Empresa ativa não encontrada." };
  }

  const papel = ehPapelImpressao(input.papel) ? input.papel : "a4";
  const pdf = gerarPdfSimples({
    papel,
    linhas: linhasTesteImpressao({
      empresaNome: identidade.nome ?? "Empresa",
      tipoRotulo: rotuloTipoDocumentoImpressao(input.tipoDocumento),
      impressora: input.impressora,
    }),
  });

  return {
    ok: true as const,
    pdfBase64: Buffer.from(pdf).toString("base64"),
  };
}

export async function buscarEmissaoAutorizadaVendaAction(
  vendaId: string,
  modelo: "55" | "65"
) {
  return buscarEmissaoAutorizadaDaVenda({ vendaId, modelo });
}
