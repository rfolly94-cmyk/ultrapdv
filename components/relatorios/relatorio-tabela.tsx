import Link from "next/link";

import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import type { LinhaRelatorio } from "@/lib/relatorios/tipos";

export function RelatorioTabela({
  titulo,
  colunas,
  linhas,
  vazio,
}: {
  titulo: string;
  colunas: string[];
  linhas: LinhaRelatorio[];
  vazio: string;
}) {
  return (
    <section>
      <h2 className="mb-3 px-1 text-[15px] font-semibold text-zinc-950">
        {titulo}
      </h2>
      <DataTable minWidth={Math.max(720, colunas.length * 120)}>
        <thead>
          <tr>
            {colunas.map((coluna) => (
              <th key={coluna}>{coluna}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.length === 0 ? (
            <DataTableEmpty colSpan={colunas.length}>{vazio}</DataTableEmpty>
          ) : (
            linhas.map((linha) => {
              const celulas = linha.celulas.map((celula, index) => {
                const texto = String(celula);
                const badge =
                  colunas[index] === "Status" || colunas[index] === "Situação";
                const conteudo = badge ? (
                  <StatusBadge status={texto} />
                ) : (
                  texto
                );

                return (
                  <td key={`${linha.id}-${index}`}>
                    {index === 0 && linha.href ? (
                      <Link href={linha.href} className="font-medium text-zinc-950 hover:underline">
                        {conteudo}
                      </Link>
                    ) : (
                      conteudo
                    )}
                  </td>
                );
              });

              return <tr key={linha.id}>{celulas}</tr>;
            })
          )}
        </tbody>
      </DataTable>
    </section>
  );
}
