"use client";

import { BotaoImprimirConector } from "@/components/impressao/botao-imprimir-conector";
import { useTemPermissao } from "@/lib/permissoes/contexto-ui";

export function RelatorioAcoes({
  exportHref,
  printHref,
}: {
  exportHref: string;
  printHref: string;
}) {
  const podeExportar = useTemPermissao("relatorios", "exportar");

  return (
    <div className="print-hide flex flex-wrap justify-end gap-2">
      {podeExportar ? (
        <a href={exportHref} className="updv-btn updv-btn-ghost">
          Exportar
        </a>
      ) : null}
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
