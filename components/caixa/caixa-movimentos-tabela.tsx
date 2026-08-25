import Link from "next/link";

import { formatarDataHora, formatarMoeda } from "@/lib/relatorios/formatacao";
import { valorLiquidoMovimento } from "@/lib/caixa/formas";
import type { CaixaMovimento } from "@/lib/caixa/tipos";

const ROTULO_TIPO: Record<string, string> = {
  abertura: "Abertura",
  suprimento: "Suprimento",
  sangria: "Sangria",
  ajuste: "Ajuste",
  venda: "Venda",
  recebimento_carteira: "Recebimento Carteira",
  estorno_recebimento: "Estorno de recebimento",
  cancelamento_venda: "Cancelamento de venda",
};

function referenciaMovimento(movimento: CaixaMovimento) {
  if (movimento.venda_id) {
    const rotulo =
      movimento.venda_numero != null
        ? `Venda #${movimento.venda_numero}`
        : "Ver venda";
    return (
      <Link
        href={`/vendas/${movimento.venda_id}`}
        className="font-semibold text-zinc-900 hover:underline"
      >
        {rotulo}
      </Link>
    );
  }

  if (movimento.tipo === "recebimento_carteira") {
    return movimento.descricao || "Recebimento Carteira";
  }

  if (movimento.tipo === "estorno_recebimento") {
    return movimento.estorno_de_id
      ? "Reverte recebimento anterior"
      : movimento.descricao || "Estorno de recebimento";
  }

  return movimento.descricao || "—";
}

function moedaOuTraco(valor: number) {
  return valor > 0 ? formatarMoeda(valor) : "—";
}

function mostraTroco(movimento: CaixaMovimento) {
  return (
    movimento.tipo === "venda" || movimento.tipo === "recebimento_carteira"
  );
}

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
      <table className="updv-table" style={{ minWidth: 1080 }}>
        <thead>
          <tr>
            <th>Hora</th>
            <th>Tipo</th>
            <th>Referência</th>
            <th>Cliente</th>
            <th>Forma</th>
            <th className="num">Recebido</th>
            <th className="num">Troco</th>
            <th className="num">Líquido</th>
            <th>Operador</th>
          </tr>
        </thead>
        <tbody>
          {movimentos.map((movimento) => {
            const liquido =
              movimento.valor_liquido ?? valorLiquidoMovimento(movimento);
            const oculto = movimento.valores_ocultos === true;
            return (
              <tr key={movimento.id}>
                <td>{formatarDataHora(movimento.created_at)}</td>
                <td>{ROTULO_TIPO[movimento.tipo] ?? movimento.tipo}</td>
                <td>{referenciaMovimento(movimento)}</td>
                <td>{movimento.cliente_nome || "—"}</td>
                <td>{movimento.forma_nome || "—"}</td>
                <td className="num">
                  {oculto ? "—" : moedaOuTraco(movimento.entrada)}
                </td>
                <td className="num">
                  {oculto
                    ? "—"
                    : mostraTroco(movimento)
                      ? moedaOuTraco(movimento.saida)
                      : "—"}
                </td>
                <td className="num">
                  {oculto
                    ? "—"
                    : liquido !== 0 || movimento.tipo === "venda"
                      ? formatarMoeda(liquido)
                      : "—"}
                </td>
                <td>{movimento.usuario_nome || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
