"use client";

import { BotaoImprimirConector } from "@/components/impressao/botao-imprimir-conector";

export function RelatorioAcoes({
  exportHref,
  printHref,
}: {
  exportHref: string;
  printHref: string;
}) {
  return (
    <div className="print-hide flex flex-wrap justify-end gap-2">
      <a href={exportHref} className="updv-btn updv-btn-ghost">
        Exportar
      </a>
      <BotaoImprimirConector
        pdfUrl={printHref}
        tipoDocumento="danfe_nfe"
        papel="a4"
        label="Imprimir"
        className="updv-btn updv-btn-ghost"
      />
    </div>
  );
}
