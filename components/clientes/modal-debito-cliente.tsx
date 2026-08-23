"use client";

import { useEffect, useMemo, useState } from "react";

import { AppModal } from "@/components/ui/app-modal";
import type {
  FormaRecebimentoListagem,
  ItemAbertoListagem,
} from "@/lib/clientes/carregar-resumo-carteira";
import {
  estadoBotoesBaixaModal,
  resolverModoRecebimentoListagem,
} from "@/lib/clientes/listagem";
import { formatarMoeda } from "@/lib/relatorios/formatacao";

function dataCurta(valor: string | null) {
  if (!valor) {
    return "—";
  }
  return new Date(valor).toLocaleDateString("pt-BR");
}

function parseValor(texto: string) {
  const limpo = texto.trim();
  if (!limpo) {
    return null;
  }
  let normalizado = limpo;
  if (normalizado.includes(".") && normalizado.includes(",")) {
    normalizado = normalizado.replace(/\./g, "").replace(",", ".");
  } else if (normalizado.includes(",")) {
    normalizado = normalizado.replace(",", ".");
  }
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? Math.round(numero * 100) / 100 : null;
}

export function ModalDebitoCliente({
  open,
  clienteNome,
  itens,
  formas,
  podeReceber,
  enviando,
  mensagem,
  onClose,
  onReceber,
}: {
  open: boolean;
  clienteNome: string;
  itens: ItemAbertoListagem[];
  formas: FormaRecebimentoListagem[];
  podeReceber: boolean;
  enviando: boolean;
  mensagem: string | null;
  onClose: () => void;
  onReceber: (input: {
    modo: "ITENS" | "PARCIAL";
    itemIds: string[];
    valor: number | null;
    formaPagamentoId: string;
  }) => Promise<void>;
}) {
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [formaPagamentoId, setFormaPagamentoId] = useState(formas[0]?.id ?? "");
  const [valorTexto, setValorTexto] = useState("");
  const [valorFocado, setValorFocado] = useState(false);
  const [erroLocal, setErroLocal] = useState<string | null>(null);

  useEffect(() => {
    setSelecionados((atual) => {
      const ids = new Set(itens.map((item) => item.id));
      return new Set([...atual].filter((id) => ids.has(id)));
    });
    if (!formaPagamentoId && formas[0]?.id) {
      setFormaPagamentoId(formas[0].id);
    }
  }, [itens, formas, formaPagamentoId]);

  useEffect(() => {
    if (!open) {
      setValorFocado(false);
      setErroLocal(null);
    }
  }, [open]);

  const totalSelecionado = useMemo(
    () =>
      itens
        .filter((item) => selecionados.has(item.id))
        .reduce((total, item) => total + item.valor_aberto, 0),
    [itens, selecionados]
  );

  const valorInformado = parseValor(valorTexto);
  const botoes = estadoBotoesBaixaModal({
    valorTexto,
    valorFocado,
    temItensSelecionados: selecionados.size > 0,
    valorInformado,
    totalSelecionado,
    enviando,
  });
  const erroValorMaior =
    selecionados.size > 0 &&
    valorInformado != null &&
    valorInformado > totalSelecionado
      ? "Valor a receber não pode ser maior que o total aberto selecionado."
      : null;
  const erroAlerta = erroValorMaior ?? erroLocal;
  const todosSelecionados =
    itens.length > 0 && itens.every((item) => selecionados.has(item.id));

  function alternar(id: string) {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) {
        proximo.delete(id);
      } else {
        proximo.add(id);
      }
      return proximo;
    });
  }

  function alternarTodos() {
    if (todosSelecionados) {
      setSelecionados(new Set());
      return;
    }
    setSelecionados(new Set(itens.map((item) => item.id)));
  }

  async function receber(tipo: "total" | "parcial") {
    if (!formaPagamentoId) {
      setErroLocal("Selecione a forma de pagamento.");
      return;
    }
    const resolvido = resolverModoRecebimentoListagem({
      tipo,
      itemIds: Array.from(selecionados),
      totalSelecionado,
      valorInformado,
    });
    if (!resolvido.ok) {
      setErroLocal(resolvido.erro);
      return;
    }
    setErroLocal(null);
    await onReceber({
      modo: resolvido.modo,
      itemIds: resolvido.itemIds,
      valor: resolvido.valor,
      formaPagamentoId,
    });
    setSelecionados((atual) => {
      const restantes = new Set(
        itens.filter((item) => atual.has(item.id)).map((item) => item.id)
      );
      return restantes;
    });
    setValorTexto("");
    setValorFocado(false);
  }

  return (
    <AppModal
      open={open}
      title={`Débitos em aberto · ${clienteNome}`}
      onClose={onClose}
      size="xl"
      footer={
        podeReceber ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-semibold text-zinc-900">
              Total selecionado: {formatarMoeda(totalSelecionado)}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={botoes.baixaTotalDesabilitada}
                onClick={() => receber("total")}
                className="updv-btn updv-btn-primary"
              >
                Baixa total
              </button>
              <button
                type="button"
                disabled={botoes.baixaParcialDesabilitada}
                onClick={() => receber("parcial")}
                className="updv-btn updv-btn-ghost"
              >
                Baixa parcial
              </button>
            </div>
          </div>
        ) : undefined
      }
    >
      {itens.length === 0 ? (
        <p className="text-sm text-zinc-500">Nenhum débito em aberto.</p>
      ) : (
        <div className="space-y-3">
          {podeReceber ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-[13px]">
                <span className="text-xs font-medium text-zinc-600">
                  Forma de pagamento
                </span>
                <select
                  value={formaPagamentoId}
                  onChange={(event) => setFormaPagamentoId(event.target.value)}
                  className="updv-select mt-1 w-full"
                >
                  {formas.map((forma) => (
                    <option key={forma.id} value={forma.id}>
                      {forma.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[13px]">
                <span className="text-xs font-medium text-zinc-600">
                  Valor a receber
                </span>
                <input
                  value={valorTexto}
                  onChange={(event) => {
                    setValorTexto(event.target.value);
                    setErroLocal(null);
                  }}
                  onFocus={() => setValorFocado(true)}
                  onBlur={() => setValorFocado(false)}
                  placeholder="0,00"
                  inputMode="decimal"
                  className="updv-input mt-1 w-full"
                />
              </label>
            </div>
          ) : null}

          {erroAlerta ? (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800"
            >
              {erroAlerta}
            </div>
          ) : mensagem ? (
            <p className="text-[13px] text-zinc-600">{mensagem}</p>
          ) : null}

          <div className="overflow-x-auto">
            <table className="updv-table" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th>
                    {podeReceber ? (
                      <input
                        type="checkbox"
                        checked={todosSelecionados}
                        onChange={alternarTodos}
                        aria-label="Selecionar todos"
                      />
                    ) : null}
                  </th>
                  <th>Data</th>
                  <th>Venda</th>
                  <th>Produto</th>
                  <th className="num">Original</th>
                  <th className="num">Recebido</th>
                  <th className="num">Aberto</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {podeReceber ? (
                        <input
                          type="checkbox"
                          checked={selecionados.has(item.id)}
                          onChange={() => alternar(item.id)}
                          aria-label={`Selecionar ${item.produto_nome}`}
                        />
                      ) : null}
                    </td>
                    <td>{dataCurta(item.data)}</td>
                    <td>
                      {item.numero_venda != null
                        ? `#${item.numero_venda}`
                        : "—"}
                    </td>
                    <td>{item.produto_nome}</td>
                    <td className="num">{formatarMoeda(item.valor_original)}</td>
                    <td className="num">{formatarMoeda(item.valor_recebido)}</td>
                    <td className="num font-medium text-red-600">
                      {formatarMoeda(item.valor_aberto)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppModal>
  );
}
