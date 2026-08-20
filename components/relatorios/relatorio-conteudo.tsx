import { RelatorioTabela } from "./relatorio-tabela";
import type { RelatorioMontado } from "@/lib/relatorios/tipos";

export function RelatorioConteudo({
  relatorio,
}: {
  relatorio: RelatorioMontado;
}) {
  return (
    <div className="space-y-6">
      <RelatorioTabela
        titulo={relatorio.titulo}
        colunas={relatorio.colunas}
        linhas={relatorio.linhas}
        vazio={relatorio.vazio}
      />
      {relatorio.extra ? (
        <RelatorioTabela
          titulo={relatorio.extra.titulo}
          colunas={relatorio.extra.colunas}
          linhas={relatorio.extra.linhas}
          vazio="Nenhum registro adicional."
        />
      ) : null}
    </div>
  );
}
