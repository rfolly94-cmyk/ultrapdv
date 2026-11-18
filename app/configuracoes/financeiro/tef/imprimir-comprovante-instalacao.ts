"use server";

import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import { gerarPdfSimples } from "@/lib/impressao/pdf-simples";
import { imprimirPdfNoUltraPdvConector } from "@/lib/impressao/imprimir-pdf";

export async function imprimirComprovanteInstalacao(texto: string) {
  const sessao = await obterPermissoesSessao();
  if (!sessao) {
    return { ok: false as const, erro: "A empresa ativa não foi resolvida. O comprovante não foi impresso." };
  }

  const limpo = String(texto ?? "").replace(/\0/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!limpo || limpo.length > 4096) {
    return { ok: false as const, erro: "A biblioteca não disponibilizou o comprovante da instalação." };
  }

  const pdf = gerarPdfSimples({ papel: "80mm", linhas: limpo.split("\n") });
  return imprimirPdfNoUltraPdvConector({
    pdfBase64: Buffer.from(pdf).toString("base64"),
    tipoDocumento: "recibo",
    papel: "80mm",
  });
}
