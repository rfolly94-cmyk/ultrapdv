import { formatarDataHora, formatarMoeda } from "@/lib/relatorios/formatacao";
import type { CaixaMovimento } from "@/lib/caixa/tipos";

const ROTULO_TIPO: Record<string, string> = {
  abertura: "Abertura",
  suprimento: "Suprimento",
  sangria: "Sangria",
  ajuste: "Ajuste",
};

export function CaixaMovimentosTabela({
  movimentos,
}: {
  movimentos: CaixaMovimento[];
}) {
  if (movimentos.length === 0) {
    return <p className="text-sm text-zinc-500">Nenhuma movimentação.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="updv-table" style={{ minWidth: 640 }}>
        <thead>
          <tr>
            <th>Data</th>
            <th>Tipo</th>
            <th>Descrição</th>
            <th>Operador</th>
            <th className="num">Entrada</th>
            <th className="num">Saída</th>
          </tr>
        </thead>
        <tbody>
          {movimentos.map((movimento) => (
            <tr key={movimento.id}>
              <td>{formatarDataHora(movimento.created_at)}</td>
              <td>{ROTULO_TIPO[movimento.tipo] ?? movimento.tipo}</td>
              <td>{movimento.descricao || "—"}</td>
              <td>{movimento.usuario_nome || "—"}</td>
              <td className="num">
                {movimento.entrada > 0 ? formatarMoeda(movimento.entrada) : "—"}
              </td>
              <td className="num">
                {movimento.saida > 0 ? formatarMoeda(movimento.saida) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
