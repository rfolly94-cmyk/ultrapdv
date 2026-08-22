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
import {
  exigirAcessoOperacao,
  exigirRecursoEmpresa,
  planoPermiteRecursoEmpresa,
  resultadoErroEntitlement,
} from "@/lib/plataforma/entitlements/exigir-recurso";
import { ErroPermissao } from "@/lib/permissoes/erro";

export async function autorizarUsoConectorImpressaoAction() {
  const identidade = await obterIdentidadeEmpresaSessao();
  if (!identidade?.empresaId) {
    return {
      ok: false as const,
      erro: "Empresa ativa não encontrada.",
      codigo: "RECURSO_NAO_CONTRATADO" as const,
    };
  }

  try {
    await exigirRecursoEmpresa({
      empresaId: identidade.empresaId,
      recurso: "impressao_automatica",
      origem: "conector-impressao",
    });
    return { ok: true as const, empresaId: identidade.empresaId };
  } catch (error) {
    return (
      resultadoErroEntitlement(error) ?? {
        ok: false as const,
        erro:
          error instanceof Error
            ? error.message
            : "Impressão pelo UltraPDV Conector não está disponível no plano atual.",
        codigo: "RECURSO_NAO_CONTRATADO" as const,
      }
    );
  }
}

export async function buscarConfiguracoesImpressaoAction(
  dispositivoId: string
) {
  const identidade = await obterIdentidadeEmpresaSessao();
  const resultado = await buscarConfiguracoesImpressao(dispositivoId);
  if (!resultado.ok) {
    return resultado;
  }

  const conectorLiberado = identidade?.empresaId
    ? (await planoPermiteRecursoEmpresa(identidade.empresaId, "impressao_automatica"))
        .permitido
    : false;

  return {
    ...resultado,
    empresaNome: identidade?.nome ?? "Empresa",
    conectorLiberado,
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
  const identidade = await obterIdentidadeEmpresaSessao();
  if (!identidade?.empresaId) {
    return { ok: false as const, erro: "Empresa ativa não encontrada." };
  }

  try {
    await exigirAcessoOperacao({
      empresaId: identidade.empresaId,
      recurso: "impressao_automatica",
      modulo: "configuracoes",
      acao: "acessar",
      origem: "salvarConfiguracaoImpressaoAction",
    });
  } catch (error) {
    const entitlement = resultadoErroEntitlement(error);
    if (entitlement) {
      return entitlement;
    }
    if (error instanceof ErroPermissao) {
      return { ok: false as const, erro: error.message };
    }
    throw error;
  }

  return gravarConfiguracao(input);
}

export async function gerarPdfTesteImpressaoAction(input: {
  tipoDocumento: TipoDocumentoImpressao;
  papel: string;
  impressora: string;
}) {
  const identidade = await obterIdentidadeEmpresaSessao();
  if (!identidade?.empresaId) {
    return { ok: false as const, erro: "Empresa ativa não encontrada." };
  }

  try {
    await exigirRecursoEmpresa({
      empresaId: identidade.empresaId,
      recurso: "impressao_automatica",
      origem: "gerarPdfTesteImpressaoAction",
    });
  } catch (error) {
    const entitlement = resultadoErroEntitlement(error);
    if (entitlement) {
      return entitlement;
    }
    throw error;
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
