"use client";

export function RelatorioAcoes({
  exportHref,
}: {
  exportHref: string;
}) {
  return (
    <div className="print-hide flex flex-wrap justify-end gap-2">
      <a href={exportHref} className="updv-btn updv-btn-ghost">
        Exportar
      </a>
      <button
        type="button"
        className="updv-btn updv-btn-ghost"
        onClick={() => window.print()}
      >
        Imprimir
      </button>
    </div>
  );
}
