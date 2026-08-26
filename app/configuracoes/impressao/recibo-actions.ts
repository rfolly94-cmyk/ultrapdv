"use server";

import { revalidatePath } from "next/cache";

import { obterIdentidadeEmpresaSessao } from "@/lib/empresa/identidade-sessao";
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
import { gerarPdfReciboEmpresa } from "@/lib/impressao/gerar-pdf-recibo";
import { ehPapelImpressao } from "@/lib/impressao/regras";
import { createClient } from "@/lib/supabase/server";

export async function salvarLayoutReciboAction(layout: unknown) {
  const resultado = await salvarLayoutReciboDaEmpresaAtiva({ layout });
  if (resultado.ok) {
    revalidatePath("/configuracoes/impressao/recibo");
    revalidatePath("/pdv");
    revalidatePath("/vendas");
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
    : { ok: true as const, valor: await carregarLayoutReciboDaEmpresaAtiva({
        empresaId: identidade.empresaId,
      }) };
  if (!sanitizado.ok) {
    return sanitizado;
  }

  const empresa = await carregarIdentidadeReciboEmpresaAtiva(
    identidade.empresaId
  );
  const dados = reciboVendaExemplo(empresa);
  const papel = ehPapelImpressao(input.papel) ? input.papel : sanitizado.valor.papel;
  const montado = montarReciboVenda(dados, sanitizado.valor, {
    papel: papel === "58mm" ? "58mm" : "80mm",
  });
  const supabase = await createClient();
  const pdf = await gerarPdfReciboEmpresa({
    supabase,
    empresaId: identidade.empresaId,
    linhas: montado.linhasPdf,
    papel: papel === "a4" ? "a4" : montado.papel,
    mostrarLogo: montado.layout.cabecalho.logo,
    alinhamentoLogo: montado.layout.cabecalho.alinhamento,
  });

  return {
    ok: true as const,
    pdfBase64: Buffer.from(pdf).toString("base64"),
  };
}
