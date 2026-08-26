"use server";

import { revalidatePath } from "next/cache";

import { obterIdentidadeEmpresaSessao } from "@/lib/empresa/identidade-sessao";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { gerarPdfReciboEmpresa } from "@/lib/impressao/gerar-pdf-recibo";
import { pathLogoReciboPersonalizada } from "@/lib/impressao/logo-recibo-personalizada";
import {
  montarReciboVenda,
  reciboVendaExemplo,
  sanitizarLayoutRecibo,
} from "@/lib/impressao/recibo-layout";
import {
  carregarIdentidadeReciboEmpresaAtiva,
  carregarLayoutReciboDaEmpresaAtiva,
  salvarLayoutReciboDaEmpresaAtiva,
} from "@/lib/impressao/recibo-layout-servidor";
import {
  removerLogoPersonalizadaReciboDaEmpresaAtiva,
  salvarLogoPersonalizadaReciboDaEmpresaAtiva,
} from "@/lib/impressao/recibo-logo-servidor";
import { ehPapelImpressao } from "@/lib/impressao/regras";
import { createClient } from "@/lib/supabase/server";

function revalidarRecibo() {
  revalidatePath("/configuracoes/impressao/recibo");
  revalidatePath("/pdv");
  revalidatePath("/vendas");
}

export async function salvarLayoutReciboAction(layout: unknown) {
  const resultado = await salvarLayoutReciboDaEmpresaAtiva({ layout });
  if (resultado.ok) {
    revalidarRecibo();
  }
  return resultado;
}

export async function carregarLayoutReciboAction() {
  const identidade = await obterIdentidadeEmpresaSessao();
  if (!identidade?.empresaId) {
    return { ok: false as const, erro: "Empresa ativa não encontrada." };
  }
  const layout = await carregarLayoutReciboDaEmpresaAtiva({
    empresaId: identidade.empresaId,
  });
  return { ok: true as const, layout };
}

export async function salvarLogoPersonalizadaReciboAction(formData: FormData) {
  try {
    const arquivoForm = formData.get("logo");
    if (!(arquivoForm instanceof File) || arquivoForm.size <= 0) {
      return { ok: false as const, erro: "Selecione uma imagem PNG, JPEG ou WEBP." };
    }
    const resultado = await salvarLogoPersonalizadaReciboDaEmpresaAtiva({
      bytes: Buffer.from(await arquivoForm.arrayBuffer()),
      nomeArquivo: arquivoForm.name,
      mimeInformado: arquivoForm.type,
      tamanho: arquivoForm.size,
    });
    if (resultado.ok) {
      revalidarRecibo();
    }
    return resultado;
  } catch (error) {
    if (error instanceof ErroPermissao) {
      return { ok: false as const, erro: error.message };
    }
    if (error instanceof Error) {
      return { ok: false as const, erro: error.message };
    }
    return { ok: false as const, erro: "Não foi possível enviar a logo do recibo." };
  }
}

export async function removerLogoPersonalizadaReciboAction() {
  try {
    const resultado = await removerLogoPersonalizadaReciboDaEmpresaAtiva();
    if (resultado.ok) {
      revalidarRecibo();
    }
    return resultado;
  } catch (error) {
    if (error instanceof ErroPermissao) {
      return { ok: false as const, erro: error.message };
    }
    return { ok: false as const, erro: "Não foi possível remover a logo personalizada." };
  }
}

export async function gerarPdfTesteReciboVendaAction(input: {
  layout?: unknown;
  papel?: string;
}) {
  const identidade = await obterIdentidadeEmpresaSessao();
  if (!identidade?.empresaId) {
    return { ok: false as const, erro: "Empresa ativa não encontrada." };
  }

  const sanitizado = input.layout
    ? sanitizarLayoutRecibo(input.layout)
    : {
        ok: true as const,
        valor: await carregarLayoutReciboDaEmpresaAtiva({
          empresaId: identidade.empresaId,
        }),
      };
  if (!sanitizado.ok) {
    return sanitizado;
  }

  const layout = {
    ...sanitizado.valor,
    cabecalho: {
      ...sanitizado.valor.cabecalho,
      logoPersonalizadaPath: pathLogoReciboPersonalizada(
        identidade.empresaId,
        sanitizado.valor.cabecalho.logoPersonalizadaPath
      ),
    },
  };

  const empresa = await carregarIdentidadeReciboEmpresaAtiva(
    identidade.empresaId
  );
  const dados = reciboVendaExemplo(empresa);
  const papel = ehPapelImpressao(input.papel) ? input.papel : layout.papel;
  const montado = montarReciboVenda(dados, layout, {
    papel: papel === "58mm" ? "58mm" : "80mm",
  });
  const supabase = await createClient();
  const pdf = await gerarPdfReciboEmpresa({
    supabase,
    empresaId: identidade.empresaId,
    linhas: montado.linhasPdf,
    papel: papel === "a4" ? "a4" : montado.papel,
    layout: montado.layout,
  });

  return {
    ok: true as const,
    pdfBase64: Buffer.from(pdf).toString("base64"),
  };
}
