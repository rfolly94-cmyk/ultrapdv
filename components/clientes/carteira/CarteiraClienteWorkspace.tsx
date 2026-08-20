"use client";

import {
  useMemo,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

type Cliente = {
  id: string;
  nome: string;
  nome_fantasia:
    | string
    | null;
  cpf_cnpj:
    | string
    | null;
  telefone:
    | string
    | null;
  limite_credito:
    | number
    | string;
  saldo_devedor:
    | number
    | string;
  bloqueado: boolean;
  dia_vencimento:
    | number
    | null;
  ativo: boolean;
};

type Titulo = {
  id: string;
  venda_id: string;
  numero_venda:
    | number
    | string
    | null;
  valor_original:
    | number
    | string;
  valor_aberto:
    | number
    | string;
  vencimento:
    | string
    | null;
  status: string;
  created_at: string;
};

type Item = {
  id: string;
  titulo_id: string;
  venda_item_id: string;
  produto_id:
    | string
    | null;
  produto_codigo:
    | string
    | null;
  produto_nome: string;
  unidade_medida: string;
  quantidade:
    | number
    | string;
  valor_original:
    | number
    | string;
  valor_aberto:
    | number
    | string;
  status: string;
  created_at: string;
};

type Credito = {
  id: string;
  origem: string;
  venda_id:
    | string
    | null;
  recebimento_id:
    | string
    | null;
  valor_original:
    | number
    | string;
  valor_disponivel:
    | number
    | string;
  status: string;
  observacao:
    | string
    | null;
  created_at: string;
};

type Recebimento = {
  id: string;
  forma_pagamento_nome:
    | string
    | null;
  modo: string;
  valor:
    | number
    | string;
  saldo_anterior:
    | number
    | string;
  saldo_posterior:
    | number
    | string;
  observacao:
    | string
    | null;
  processado_at:
    | string
    | null;
  created_at: string;
};

type Movimento = {
  id: string;
  tipo: string;
  origem: string;
  valor:
    | number
    | string;
  venda_id:
    | string
    | null;
  titulo_id:
    | string
    | null;
  recebimento_id:
    | string
    | null;
  descricao:
    | string
    | null;
  created_at: string;
};

type Forma = {
  id: string;
  codigo: string;
  nome: string;
  permite_fiado: boolean;
  ativo: boolean;
  ordem: number;
};

type Venda = {
  id: string;
  numero:
    | number
    | string
    | null;
  status: string;
  valor_total:
    | number
    | string;
  finalizada_at:
    | string
    | null;
  cancelada_at:
    | string
    | null;
  motivo_cancelamento:
    | string
    | null;
  created_at: string;
};

type Props = {
  cliente: Cliente;
  titulos: Titulo[];
  itens: Item[];
  creditos: Credito[];
  recebimentos:
    Recebimento[];
  movimentos: Movimento[];
  formasPagamento: Forma[];
  vendas: Venda[];
};

type Aba =
  | "DEBITOS"
  | "CREDITOS"
  | "RECEBIMENTOS"
  | "MOVIMENTACOES"
  | "COMPRAS";

function numero(
  valor:
    | number
    | string
    | null
    | undefined
) {
  const n =
    Number(valor ?? 0);

  return Number.isFinite(n)
    ? n
    : 0;
}

function dinheiro(
  valor:
    | number
    | string
    | null
    | undefined
) {
  return numero(
    valor
  ).toLocaleString(
    "pt-BR",
    {
      style:
        "currency",
      currency:
        "BRL",
    }
  );
}

function data(
  valor:
    | string
    | null
    | undefined
) {
  if (!valor) {
    return "—";
  }

  return new Date(
    valor
  ).toLocaleDateString(
    "pt-BR"
  );
}

function dataHora(
  valor:
    | string
    | null
    | undefined
) {
  if (!valor) {
    return "—";
  }

  return new Date(
    valor
  ).toLocaleString(
    "pt-BR",
    {
      dateStyle:
        "short",
      timeStyle:
        "short",
    }
  );
}

function classeStatus(
  status: string
) {
  switch (
    status.toUpperCase()
  ) {
    case "ABERTO":
      return "bg-amber-100 text-amber-700";
    case "PARCIAL":
      return "bg-blue-100 text-blue-700";
    case "QUITADO":
    case "UTILIZADO":
      return "bg-zinc-100 text-zinc-600";
    case "DISPONIVEL":
      return "bg-emerald-100 text-emerald-700";
    case "CANCELADO":
    case "CANCELADA":
      return "bg-red-100 text-red-700";
    case "FINALIZADA":
      return "bg-green-100 text-green-700";
    default:
      return "bg-zinc-100 text-zinc-700";
  }
}

export function CarteiraClienteWorkspace({
  cliente,
  titulos,
  itens,
  creditos,
  recebimentos,
  movimentos,
  formasPagamento,
  vendas,
}: Props) {
  const router =
    useRouter();

  const [
    aba,
    setAba,
  ] =
    useState<Aba>(
      "DEBITOS"
    );

  const [
    selecionados,
    setSelecionados,
  ] =
    useState<
      Set<string>
    >(
      new Set()
    );

  const [
    formaPagamentoId,
    setFormaPagamentoId,
  ] =
    useState(
      formasPagamento[0]
        ?.id ??
        ""
    );

  const [
    valorParcial,
    setValorParcial,
  ] =
    useState("");

  const [
    observacao,
    setObservacao,
  ] =
    useState("");

  const [
    enviando,
    setEnviando,
  ] =
    useState(false);

  const [
    mensagem,
    setMensagem,
  ] =
    useState<
      string | null
    >(null);

  const saldoDevedor =
    numero(
      cliente.saldo_devedor
    );

  const creditoDisponivel =
    useMemo(
      () =>
        creditos
          .filter(
            (credito) =>
              [
                "DISPONIVEL",
                "PARCIAL",
              ].includes(
                credito.status
              )
          )
          .reduce(
            (
              total,
              credito
            ) =>
              total +
              numero(
                credito
                  .valor_disponivel
              ),
            0
          ),
      [creditos]
    );

  const saldoLiquido =
    creditoDisponivel -
    saldoDevedor;

  const itensPorTitulo =
    useMemo(
      () => {
        const mapa =
          new Map<
            string,
            Item[]
          >();

        for (
          const item of
          itens
        ) {
          const lista =
            mapa.get(
              item.titulo_id
            ) ?? [];

          lista.push(item);

          mapa.set(
            item.titulo_id,
            lista
          );
        }

        return mapa;
      },
      [itens]
    );

  const itensSelecionados =
    itens.filter(
      (item) =>
        selecionados.has(
          item.id
        )
    );

  const valorSelecionado =
    itensSelecionados.reduce(
      (
        total,
        item
      ) =>
        total +
        numero(
          item.valor_aberto
        ),
      0
    );

  function alternarItem(
    itemId: string
  ) {
    setSelecionados(
      (atual) => {
        const proximo =
          new Set(
            atual
          );

        if (
          proximo.has(
            itemId
          )
        ) {
          proximo.delete(
            itemId
          );
        } else {
          proximo.add(
            itemId
          );
        }

        return proximo;
      }
    );
  }

  async function receber(
    modo:
      | "TOTAL"
      | "PARCIAL"
      | "ITENS"
  ) {
    if (
      !formaPagamentoId
    ) {
      setMensagem(
        "Selecione a forma de pagamento."
      );
      return;
    }

    let valor:
      | number
      | null =
      null;

    if (
      modo ===
      "PARCIAL"
    ) {
      valor =
        Number(
          valorParcial
            .replace(
              /\./g,
              ""
            )
            .replace(
              ",",
              "."
            )
        );

      if (
        !Number.isFinite(
          valor
        ) ||
        valor <= 0
      ) {
        setMensagem(
          "Informe um valor parcial maior que zero."
        );
        return;
      }
    }

    if (
      modo ===
        "ITENS" &&
      selecionados.size ===
        0
    ) {
      setMensagem(
        "Selecione ao menos um item."
      );
      return;
    }

    const descricao =
      modo ===
      "TOTAL"
        ? `Quitar todo o saldo de ${dinheiro(
            saldoDevedor
          )}?`
        : modo ===
          "PARCIAL"
          ? `Registrar baixa parcial de ${dinheiro(
              valor
            )}?`
          : `Dar baixa em ${selecionados.size} item(ns), totalizando ${dinheiro(
              valorSelecionado
            )}?`;

    if (
      !window.confirm(
        descricao
      )
    ) {
      return;
    }

    setEnviando(true);
    setMensagem(null);

    try {
      const response =
        await fetch(
          `/api/clientes/${cliente.id}/carteira/receber`,
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                forma_pagamento_id:
                  formaPagamentoId,
                modo,
                valor,
                item_ids:
                  modo ===
                  "ITENS"
                    ? Array.from(
                        selecionados
                      )
                    : [],
                observacao:
                  observacao.trim() ||
                  null,
                idempotency_key:
                  crypto.randomUUID(),
              }),
          }
        );

      const payload =
        await response.json();

      if (
        !response.ok ||
        !payload.ok
      ) {
        setMensagem(
          payload.erro ??
          "Não foi possível registrar o recebimento."
        );
        return;
      }

      const resultado =
        payload.resultado;

      setMensagem(
        `Recebimento realizado com sucesso. Valor: ${dinheiro(
          resultado
            ?.valor_recebido
        )}. Saldo atual: ${dinheiro(
          resultado
            ?.saldo_atual
        )}.`
      );

      setSelecionados(
        new Set()
      );
      setValorParcial("");
      setObservacao("");

      router.refresh();
    } catch (
      error
    ) {
      setMensagem(
        error instanceof Error
          ? error.message
          : "Falha inesperada."
      );
    } finally {
      setEnviando(false);
    }
  }

  const abas: Array<{
    id: Aba;
    label: string;
  }> = [
    {
      id:
        "DEBITOS",
      label:
        "Débitos",
    },
    {
      id:
        "CREDITOS",
      label:
        "Créditos",
    },
    {
      id:
        "RECEBIMENTOS",
      label:
        "Recebimentos",
    },
    {
      id:
        "MOVIMENTACOES",
      label:
        "Movimentações",
    },
    {
      id:
        "COMPRAS",
      label:
        "Compras",
    },
  ];

  return (
    <div className="bg-white">
      <div className="grid grid-cols-3 border-b border-zinc-200 text-center">
        <div className="px-3 py-3">
          <p
            className={`text-xl font-bold ${
              saldoDevedor > 0 ? "text-red-600" : "text-zinc-950"
            }`}
          >
            {dinheiro(saldoDevedor)}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            Saldo devedor
          </p>
        </div>
        <div className="border-x border-zinc-200 px-3 py-3">
          <p className="text-xl font-bold text-zinc-950">
            {dinheiro(creditoDisponivel)}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            Crédito disponível
          </p>
        </div>
        <div className="px-3 py-3">
          <p
            className={`text-xl font-bold ${
              saldoLiquido < 0
                ? "text-red-600"
                : saldoLiquido > 0
                  ? "text-emerald-600"
                  : "text-zinc-950"
            }`}
          >
            {dinheiro(Math.abs(saldoLiquido))}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            {saldoLiquido > 0
              ? "Crédito líquido"
              : saldoLiquido < 0
                ? "Débito líquido"
                : "Conta zerada"}
          </p>
        </div>
      </div>

      <nav className="flex h-9 items-center gap-1 overflow-x-auto border-b border-zinc-200 px-3 text-[13px] font-medium">
        {abas.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setAba(item.id)}
            className={[
              "relative whitespace-nowrap px-2.5 py-1.5",
              aba === item.id
                ? "text-zinc-950"
                : "text-zinc-500 hover:text-zinc-800",
            ].join(" ")}
          >
            {item.label}
            {aba === item.id && (
              <span className="absolute inset-x-2 bottom-0 h-0.5 bg-zinc-950" />
            )}
          </button>
        ))}
      </nav>

      <section>

          {aba ===
            "DEBITOS" && (
            <div className="p-4">
              <div className="grid gap-3 border border-zinc-200 bg-zinc-50 p-3 lg:grid-cols-[1fr_200px]">
                <div>
                  <p className="text-sm font-semibold text-zinc-900">
                    Receber pagamento
                  </p>

                  <p className="mt-1 text-xs text-zinc-500">
                    Você pode quitar tudo, informar um valor parcial ou marcar apenas os itens desejados.
                  </p>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label>
                      <span className="text-xs font-medium text-zinc-600">
                        Forma de pagamento
                      </span>

                      <select
                        value={
                          formaPagamentoId
                        }
                        onChange={(
                          event
                        ) =>
                          setFormaPagamentoId(
                            event
                              .target
                              .value
                          )
                        }
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
                      >
                        {formasPagamento.map(
                          (
                            forma
                          ) => (
                            <option
                              key={
                                forma.id
                              }
                              value={
                                forma.id
                              }
                            >
                              {
                                forma.nome
                              }
                            </option>
                          )
                        )}
                      </select>
                    </label>

                    <label>
                      <span className="text-xs font-medium text-zinc-600">
                        Valor parcial
                      </span>

                      <input
                        value={
                          valorParcial
                        }
                        onChange={(
                          event
                        ) =>
                          setValorParcial(
                            event
                              .target
                              .value
                          )
                        }
                        placeholder="0,00"
                        inputMode="decimal"
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
                      />
                    </label>
                  </div>

                  <label className="mt-3 block">
                    <span className="text-xs font-medium text-zinc-600">
                      Observação
                    </span>

                    <input
                      value={
                        observacao
                      }
                      onChange={(
                        event
                      ) =>
                        setObservacao(
                          event
                            .target
                            .value
                        )
                      }
                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
                    />
                  </label>
                </div>

                <div className="flex flex-col justify-end gap-2">
                  <button
                    type="button"
                    disabled={
                      enviando ||
                      saldoDevedor <=
                        0
                    }
                    onClick={() =>
                      receber(
                        "TOTAL"
                      )
                    }
                    className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Quitar tudo
                  </button>

                  <button
                    type="button"
                    disabled={
                      enviando ||
                      saldoDevedor <=
                        0
                    }
                    onClick={() =>
                      receber(
                        "PARCIAL"
                      )
                    }
                    className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 disabled:opacity-50"
                  >
                    Baixa parcial
                  </button>

                  <button
                    type="button"
                    disabled={
                      enviando ||
                      selecionados
                        .size ===
                        0
                    }
                    onClick={() =>
                      receber(
                        "ITENS"
                      )
                    }
                    className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 disabled:opacity-50"
                  >
                    Baixar itens selecionados
                    {selecionados.size
                      ? ` (${selecionados.size})`
                      : ""}
                  </button>
                </div>
              </div>

              {mensagem && (
                <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
                  {
                    mensagem
                  }
                </div>
              )}

              <div className="mt-6 space-y-4">
                {!titulos.length ? (
                  <Vazio texto="Nenhum débito encontrado." />
                ) : (
                  titulos.map(
                    (
                      titulo
                    ) => {
                      const lista =
                        itensPorTitulo.get(
                          titulo.id
                        ) ?? [];

                      return (
                        <div
                          key={
                            titulo.id
                          }
                          className="overflow-hidden rounded-xl border border-zinc-200"
                        >
                          <div className="flex flex-col gap-3 bg-zinc-50 p-4 md:flex-row md:items-center md:justify-between">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <a
                                  href={`/vendas/${titulo.venda_id}`}
                                  className="font-semibold text-zinc-900 hover:underline"
                                >
                                  Venda #{titulo.numero_venda ?? "—"}
                                </a>

                                <Status
                                  valor={
                                    titulo.status
                                  }
                                />
                              </div>

                              <p className="mt-1 text-xs text-zinc-500">
                                Vencimento:{" "}
                                {data(
                                  titulo.vencimento
                                )}
                              </p>
                            </div>

                            <div className="grid grid-cols-2 gap-5 text-sm">
                              <div>
                                <p className="text-xs text-zinc-500">
                                  Original
                                </p>
                                <p className="font-semibold">
                                  {dinheiro(
                                    titulo.valor_original
                                  )}
                                </p>
                              </div>

                              <div>
                                <p className="text-xs text-zinc-500">
                                  Em aberto
                                </p>
                                <p className="font-semibold text-red-700">
                                  {dinheiro(
                                    titulo.valor_aberto
                                  )}
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="divide-y divide-zinc-100">
                            {lista.map(
                              (
                                item
                              ) => {
                                const disponivel =
                                  numero(
                                    item.valor_aberto
                                  ) >
                                    0 &&
                                  item.status !==
                                    "CANCELADO";

                                return (
                                  <label
                                    key={
                                      item.id
                                    }
                                    className={[
                                      "flex gap-3 p-4",
                                      disponivel
                                        ? "cursor-pointer hover:bg-zinc-50"
                                        : "opacity-60",
                                    ].join(
                                      " "
                                    )}
                                  >
                                    <input
                                      type="checkbox"
                                      disabled={
                                        !disponivel
                                      }
                                      checked={
                                        selecionados.has(
                                          item.id
                                        )
                                      }
                                      onChange={() =>
                                        alternarItem(
                                          item.id
                                        )
                                      }
                                      className="mt-1 size-4"
                                    />

                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                                        <div>
                                          <p className="font-medium text-zinc-900">
                                            {
                                              item.produto_nome
                                            }
                                          </p>

                                          <p className="mt-1 text-xs text-zinc-500">
                                            {item.produto_codigo
                                              ? `Cód. ${item.produto_codigo} • `
                                              : ""}
                                            Qtd.{" "}
                                            {numero(
                                              item.quantidade
                                            )}{" "}
                                            {
                                              item.unidade_medida
                                            }
                                          </p>
                                        </div>

                                        <div className="text-left md:text-right">
                                          <Status
                                            valor={
                                              item.status
                                            }
                                          />

                                          <p className="mt-2 text-sm">
                                            Aberto:{" "}
                                            <strong>
                                              {dinheiro(
                                                item.valor_aberto
                                              )}
                                            </strong>
                                          </p>

                                          <p className="text-xs text-zinc-400">
                                            Original:{" "}
                                            {dinheiro(
                                              item.valor_original
                                            )}
                                          </p>
                                        </div>
                                      </div>
                                    </div>
                                  </label>
                                );
                              }
                            )}
                          </div>
                        </div>
                      );
                    }
                  )
                )}
              </div>
            </div>
          )}

          {aba ===
            "CREDITOS" && (
            <div className="p-4">
              {!creditos.length ? (
                <Vazio texto="Nenhum crédito para este cliente." />
              ) : (
                <table className="updv-table">
                  <thead>
                    <tr>
                      <th>Origem</th>
                      <th>Data</th>
                      <th>Status</th>
                      <th className="num">Original</th>
                      <th className="num">Disponível</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditos.map((credito) => (
                      <tr key={credito.id}>
                        <td>
                          <p className="font-semibold">{credito.origem}</p>
                          {credito.observacao && (
                            <p className="text-xs text-zinc-400">
                              {credito.observacao}
                            </p>
                          )}
                        </td>
                        <td>{dataHora(credito.created_at)}</td>
                        <td>
                          <Status valor={credito.status} />
                        </td>
                        <td className="num">
                          {dinheiro(credito.valor_original)}
                        </td>
                        <td className="num font-semibold text-emerald-700">
                          {dinheiro(credito.valor_disponivel)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {aba ===
            "RECEBIMENTOS" && (
            <div className="p-4">
              {!recebimentos.length ? (
                <Vazio texto="Nenhum recebimento registrado." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="updv-table min-w-[760px]">
                    <thead>
                      <tr>
                        <th className="px-3 py-3">
                          Data
                        </th>
                        <th className="px-3 py-3">
                          Forma
                        </th>
                        <th className="px-3 py-3">
                          Modo
                        </th>
                        <th className="px-3 py-3 text-right">
                          Valor
                        </th>
                        <th className="px-3 py-3 text-right">
                          Antes
                        </th>
                        <th className="px-3 py-3 text-right">
                          Depois
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {recebimentos.map(
                        (
                          recebimento
                        ) => (
                          <tr
                            key={
                              recebimento.id
                            }
                            className="border-b border-zinc-100"
                          >
                            <td className="px-3 py-3">
                              {dataHora(
                                recebimento.processado_at ??
                                recebimento.created_at
                              )}
                            </td>
                            <td className="px-3 py-3">
                              {recebimento.forma_pagamento_nome ??
                                "—"}
                            </td>
                            <td className="px-3 py-3">
                              {
                                recebimento.modo
                              }
                            </td>
                            <td className="px-3 py-3 text-right font-semibold">
                              {dinheiro(
                                recebimento.valor
                              )}
                            </td>
                            <td className="px-3 py-3 text-right">
                              {dinheiro(
                                recebimento.saldo_anterior
                              )}
                            </td>
                            <td className="px-3 py-3 text-right">
                              {dinheiro(
                                recebimento.saldo_posterior
                              )}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {aba ===
            "MOVIMENTACOES" && (
            <div className="p-4">
              {!movimentos.length ? (
                <Vazio texto="Nenhuma movimentação." />
              ) : (
                <ol>
                  {movimentos.map((movimento, index) => {
                    const debito = movimento.tipo === "DEBITO";

                    return (
                      <li
                        key={movimento.id}
                        className="relative flex gap-3 py-3"
                      >
                        <div
                          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                            debito
                              ? "bg-red-50 text-red-600"
                              : "bg-emerald-50 text-emerald-600"
                          }`}
                        >
                          {debito ? "−" : "+"}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-zinc-950">
                            {movimento.descricao ??
                              (debito
                                ? "Débito na carteira"
                                : "Crédito na carteira")}
                          </p>
                          <p className="mt-0.5 text-xs text-zinc-400">
                            {dataHora(movimento.created_at)}
                            {movimento.origem
                              ? ` · ${movimento.origem}`
                              : ""}
                          </p>
                        </div>
                        <div className="relative w-28 shrink-0 text-right">
                          {index < movimentos.length - 1 && (
                            <span className="absolute right-2 top-6 h-[calc(100%+6px)] w-px bg-zinc-200" />
                          )}
                          <p
                            className={`text-sm font-bold ${
                              debito
                                ? "text-red-600"
                                : "text-emerald-600"
                            }`}
                          >
                            {debito ? "+" : "−"}
                            {dinheiro(movimento.valor)}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          )}

          {aba ===
            "COMPRAS" && (
            <div className="p-4">
              {!vendas.length ? (
                <Vazio texto="Este cliente ainda não possui compras." />
              ) : (
                <table className="updv-table">
                  <thead>
                    <tr>
                      <th>Venda</th>
                      <th>Data</th>
                      <th>Status</th>
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendas.map((venda) => (
                      <tr key={venda.id}>
                        <td>
                          <a
                            href={`/vendas/${venda.id}`}
                            className="font-semibold hover:underline"
                          >
                            Venda #{venda.numero ?? "—"}
                          </a>
                        </td>
                        <td>
                          {dataHora(
                            venda.finalizada_at ?? venda.created_at
                          )}
                        </td>
                        <td>
                          <Status valor={venda.status} />
                          {venda.status === "cancelada" &&
                            venda.motivo_cancelamento && (
                              <p className="text-xs text-red-600">
                                {venda.motivo_cancelamento}
                              </p>
                            )}
                        </td>
                        <td className="num font-semibold">
                          {dinheiro(venda.valor_total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
      </section>
    </div>
  );
}

function Status({
  valor,
}: {
  valor: string;
}) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${classeStatus(
        valor
      )}`}
    >
      {valor}
    </span>
  );
}

function Vazio({
  texto,
}: {
  texto: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
      {texto}
    </div>
  );
}
