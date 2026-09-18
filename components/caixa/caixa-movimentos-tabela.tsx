"use client";

import { useState } from "react";
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

const TOM_TIPO: Record<string, string> = {
  abertura: "bg-sky-50 text-sky-800",
  suprimento: "bg-emerald-50 text-emerald-800",
  sangria: "bg-rose-50 text-rose-800",
  ajuste: "bg-amber-50 text-amber-800",
  venda: "bg-emerald-50 text-emerald-800",
  recebimento_carteira: "bg-sky-50 text-sky-800",
  estorno_recebimento: "bg-rose-50 text-rose-800",
  cancelamento_venda: "bg-rose-50 text-rose-800",
};

const LIMITE_INICIAL = 12;

function BadgeTipo({ tipo }: { tipo: string }) {
  const rotulo = ROTULO_TIPO[tipo] ?? tipo;
  const tom = TOM_TIPO[tipo] ?? "bg-zinc-100 text-zinc-600";
  return (
    <span
      className={`inline-flex h-[22px] items-center rounded-full px-2 text-[11px] font-medium ${tom}`}
    >
      {rotulo}
    </span>
  );
}

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
  const [expandida, setExpandida] = useState(false);

  if (movimentos.length === 0) {
    return <p className="text-sm text-zinc-500">Nenhuma movimentação.</p>;
  }

  const temMais = movimentos.length > LIMITE_INICIAL;
  const visiveis =
    !temMais || expandida ? movimentos : movimentos.slice(0, LIMITE_INICIAL);

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--line)] bg-white">
        <div className="overflow-x-auto">
          <table
            className="updv-table [&_tbody_td]:h-auto [&_tbody_td]:max-h-none [&_tbody_td]:py-2.5 [&_thead_th]:h-11"
            style={{ minWidth: 1080 }}
          >
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
              {visiveis.map((movimento, indice) => {
                const liquido =
                  movimento.valor_liquido ?? valorLiquidoMovimento(movimento);
                const oculto = movimento.valores_ocultos === true;
                return (
                  <tr
                    key={movimento.id}
                    data-selected={indice === 0 ? "true" : undefined}
                  >
                    <td>{formatarDataHora(movimento.created_at)}</td>
                    <td>
                      <BadgeTipo tipo={movimento.tipo} />
                    </td>
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
      </div>
      {temMais ? (
        <div className="flex justify-center">
          <button
            type="button"
            className="updv-btn updv-btn-ghost"
            onClick={() => setExpandida((atual) => !atual)}
          >
            {expandida
              ? "Ver menos"
              : `Ver mais movimentações (${movimentos.length - LIMITE_INICIAL})`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
