"use client";

import {
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { receberCarteira } from "../../app/clientes/[id]/carteira/actions";

type Cliente = {
  id: string;
  nome: string;
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

type ItemCarteira = {
  id: string;
  titulo_id: string;
  produto_codigo:
    | string
    | null;
  produto_nome: string;
  unidade_medida:
    | string
    | null;
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

type TituloCarteira = {
  id: string;
  venda_id:
    | string
    | null;
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
  itens: ItemCarteira[];
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

type FormaPagamento = {
  id: string;
  codigo: string;
  nome: string;
  permite_fiado: boolean;
  movimenta_caixa: boolean;
  ativo: boolean;
  ordem: number;
};

type Modo =
  | "TOTAL"
  | "PARCIAL"
  | "ITENS";

type Props = {
  empresaNome: string;
  cliente: Cliente;
  titulos: TituloCarteira[];
  movimentos: Movimento[];
  formasPagamento: FormaPagamento[];
};

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
) {
  return numero(valor)
    .toLocaleString(
      "pt-BR",
      {
        style: "currency",
        currency: "BRL",
      }
    );
}

function dataBr(
  valor:
    | string
    | null
) {
  if (!valor) {
    return "Sem vencimento";
  }

  const data =
    new Date(
      `${valor}T12:00:00`
    );

  if (
    Number.isNaN(
      data.getTime()
    )
  ) {
    return valor;
  }

  return data.toLocaleDateString(
    "pt-BR"
  );
}

function dataHoraBr(
  valor: string
) {
  const data =
    new Date(valor);

  if (
    Number.isNaN(
      data.getTime()
    )
  ) {
    return valor;
  }

  return data.toLocaleString(
    "pt-BR"
  );
}

function documento(
  valor:
    | string
    | null
) {
  const digitos =
    String(
      valor ?? ""
    ).replace(
      /\D/g,
      ""
    );

  if (
    digitos.length ===
    11
  ) {
    return digitos.replace(
      /(\d{3})(\d{3})(\d{3})(\d{2})/,
      "$1.$2.$3-$4"
    );
  }

  if (
    digitos.length ===
    14
  ) {
    return digitos.replace(
      /(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/,
      "$1.$2.$3/$4-$5"
    );
  }

  return digitos;
}

export function CarteiraWorkspace({
  empresaNome,
  cliente,
  titulos,
  movimentos,
  formasPagamento,
}: Props) {
  const [
    selecionados,
    setSelecionados,
  ] = useState<string[]>(
    []
  );

  const [
    modal,
    setModal,
  ] =
    useState<Modo | null>(
      null
    );

  const [
    formaPagamentoId,
    setFormaPagamentoId,
  ] = useState(
    formasPagamento[0]?.id ??
      ""
  );

  const [
    valorParcial,
    setValorParcial,
  ] = useState("");

  const [
    observacao,
    setObservacao,
  ] = useState("");

  const [
    erro,
    setErro,
  ] =
    useState<string | null>(
      null
    );

  const [
    sucesso,
    setSucesso,
  ] =
    useState<string | null>(
      null
    );

  const [
    isPending,
    startTransition,
  ] = useTransition();

  const idempotencyRef =
    useRef<string | null>(
      null
    );

  const saldo =
    numero(
      cliente.saldo_devedor
    );

  const limite =
    numero(
      cliente.limite_credito
    );

  const creditoDisponivel =
    Math.max(
      0,
      limite - saldo
    );

  const itensAbertos =
    useMemo(
      () =>
        titulos
          .flatMap(
            (titulo) =>
              titulo.itens
          )
          .filter(
            (item) =>
              numero(
                item.valor_aberto
              ) > 0 &&
              item.status !==
                "CANCELADO"
          ),
      [titulos]
    );

  const valorSelecionado =
    itensAbertos
      .filter(
        (item) =>
          selecionados.includes(
            item.id
          )
      )
      .reduce(
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
    id: string
  ) {
    setSelecionados(
      (atual) =>
        atual.includes(id)
          ? atual.filter(
              (itemId) =>
                itemId !== id
            )
          : [
              ...atual,
              id,
            ]
    );
  }

  function abrir(
    modo: Modo
  ) {
    setErro(null);
    setSucesso(null);
    setValorParcial("");
    setObservacao("");
    idempotencyRef.current =
      null;

    if (
      modo === "ITENS" &&
      selecionados.length ===
        0
    ) {
      setErro(
        "Selecione ao menos um item em aberto."
      );
      return;
    }

    setModal(modo);
  }

  function fechar() {
    if (isPending) {
      return;
    }

    setModal(null);
    setErro(null);
    idempotencyRef.current =
      null;
  }

  function confirmar() {
    if (!modal) {
      return;
    }

    if (!formaPagamentoId) {
      setErro(
        "Selecione uma forma de pagamento."
      );
      return;
    }

    if (
      !idempotencyRef.current
    ) {
      idempotencyRef.current =
        crypto.randomUUID();
    }

    setErro(null);

    startTransition(
      async () => {
        const resultado =
          await receberCarteira(
            {
              clienteId:
                cliente.id,
              formaPagamentoId,
              modo: modal,
              valorTexto:
                modal ===
                "PARCIAL"
                  ? valorParcial
                  : undefined,
              itemIds:
                modal ===
                "ITENS"
                  ? selecionados
                  : [],
              observacao,
              idempotencyKey:
                idempotencyRef.current!,
            }
          );

        if (!resultado.ok) {
          setErro(
            resultado.erro
          );
          return;
        }

        setSucesso(
          `Recebimento de ${dinheiro(
            resultado.valorRecebido
          )} realizado. Saldo atual: ${dinheiro(
            resultado.saldoAtual
          )}.`
        );

        setModal(null);
        setSelecionados([]);
        idempotencyRef.current =
          null;

        window.location.reload();
      }
    );
  }

  return (
    <>
      <header>
        <p className="text-sm font-semibold text-zinc-500">
          {empresaNome}
        </p>

        <div className="mt-1 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-zinc-900">
              Carteira do Cliente
            </h1>

            <p className="mt-2 text-zinc-500">
              {cliente.nome}
              {documento(
                cliente.cpf_cnpj
              )
                ? ` • ${documento(
                    cliente.cpf_cnpj
                  )}`
                : ""}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <StatusBadge
              ativo={
                cliente.ativo
              }
              labelAtivo="Ativo"
              labelInativo="Inativo"
            />

            <span
              className={[
                "rounded-full px-3 py-1.5 text-xs font-semibold",
                cliente.bloqueado
                  ? "bg-red-100 text-red-700"
                  : "bg-green-100 text-green-700",
              ].join(" ")}
            >
              {cliente.bloqueado
                ? "Fiado bloqueado"
                : "Fiado liberado"}
            </span>
          </div>
        </div>
      </header>

      {sucesso && (
        <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-700">
          {sucesso}
        </div>
      )}

      {erro && !modal && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {erro}
        </div>
      )}

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Resumo
          label="Limite de crédito"
          valor={dinheiro(
            limite
          )}
        />

        <Resumo
          label="Saldo devedor"
          valor={dinheiro(
            saldo
          )}
          destaque={
            saldo > 0
          }
        />

        <Resumo
          label="Crédito disponível"
          valor={dinheiro(
            creditoDisponivel
          )}
        />

        <Resumo
          label="Dia de vencimento"
          valor={
            cliente.dia_vencimento
              ? `Dia ${cliente.dia_vencimento}`
              : "Não definido"
          }
        />
      </section>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">
              Receber pagamento
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              Baixe todo o saldo, informe um valor parcial ou selecione itens específicos.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={
                saldo <= 0
              }
              onClick={() =>
                abrir(
                  "TOTAL"
                )
              }
              className={botaoPrimario}
            >
              Baixa total
            </button>

            <button
              type="button"
              disabled={
                saldo <= 0
              }
              onClick={() =>
                abrir(
                  "PARCIAL"
                )
              }
              className={botaoSecundario}
            >
              Baixa parcial
            </button>

            <button
              type="button"
              disabled={
                selecionados.length ===
                0
              }
              onClick={() =>
                abrir(
                  "ITENS"
                )
              }
              className={botaoSecundario}
            >
              Baixar itens ({selecionados.length})
            </button>
          </div>
        </div>

        {selecionados.length >
          0 && (
          <div className="mt-4 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-600">
            Itens selecionados:{" "}
            <strong>
              {selecionados.length}
            </strong>
            {" • "}
            Total em aberto:{" "}
            <strong>
              {dinheiro(
                valorSelecionado
              )}
            </strong>
          </div>
        )}

        <p className="mt-4 text-xs text-amber-700">
          Nesta fase o recebimento é registrado na Carteira, mas ainda não gera movimento no Caixa. A forma de pagamento já fica salva para a próxima integração.
        </p>
      </section>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 p-5">
          <h2 className="text-lg font-semibold">
            Compras fiado
          </h2>

          <p className="mt-1 text-sm text-zinc-500">
            Clique nos itens em aberto para selecionar uma baixa específica.
          </p>
        </div>

        {titulos.length ===
        0 ? (
          <div className="p-10 text-center">
            <p className="font-medium text-zinc-600">
              Nenhuma compra fiado registrada.
            </p>

            <p className="mt-2 text-sm text-zinc-400">
              A Carteira está pronta. As compras aparecerão aqui quando o Fiado for ligado ao PDV na próxima etapa.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {titulos.map(
              (titulo) => (
                <div
                  key={
                    titulo.id
                  }
                  className="p-5"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-zinc-900">
                          Venda{" "}
                          {titulo.numero_venda
                            ? `#${titulo.numero_venda}`
                            : "sem número"}
                        </h3>

                        <StatusTitulo
                          status={
                            titulo.status
                          }
                        />
                      </div>

                      <p className="mt-1 text-xs text-zinc-500">
                        Lançada em{" "}
                        {dataHoraBr(
                          titulo.created_at
                        )}
                        {" • "}
                        Vencimento:{" "}
                        {dataBr(
                          titulo.vencimento
                        )}
                      </p>
                    </div>

                    <div className="text-left md:text-right">
                      <p className="text-xs uppercase tracking-wide text-zinc-400">
                        Em aberto
                      </p>

                      <p className="mt-1 text-xl font-bold text-zinc-900">
                        {dinheiro(
                          titulo.valor_aberto
                        )}
                      </p>

                      <p className="text-xs text-zinc-400">
                        Original{" "}
                        {dinheiro(
                          titulo.valor_original
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200">
                    <div className="divide-y divide-zinc-100">
                      {titulo.itens.map(
                        (item) => {
                          const aberto =
                            numero(
                              item.valor_aberto
                            ) > 0 &&
                            item.status !==
                              "CANCELADO";

                          const marcado =
                            selecionados.includes(
                              item.id
                            );

                          return (
                            <label
                              key={
                                item.id
                              }
                              className={[
                                "flex gap-3 p-4",
                                aberto
                                  ? "cursor-pointer hover:bg-zinc-50"
                                  : "bg-zinc-50 opacity-60",
                              ].join(
                                " "
                              )}
                            >
                              <input
                                type="checkbox"
                                disabled={
                                  !aberto
                                }
                                checked={
                                  marcado
                                }
                                onChange={() =>
                                  alternarItem(
                                    item.id
                                  )
                                }
                                className="mt-1 size-4"
                              />

                              <div className="min-w-0 flex-1">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
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
                                      {numero(
                                        item.quantidade
                                      ).toLocaleString(
                                        "pt-BR",
                                        {
                                          maximumFractionDigits:
                                            4,
                                        }
                                      )}{" "}
                                      {item.unidade_medida ??
                                        ""}
                                    </p>
                                  </div>

                                  <div className="sm:text-right">
                                    <p className="font-semibold">
                                      {dinheiro(
                                        item.valor_aberto
                                      )}
                                    </p>

                                    <p className="text-xs text-zinc-400">
                                      de{" "}
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
                </div>
              )
            )}
          </div>
        )}
      </section>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 p-5">
          <h2 className="text-lg font-semibold">
            Histórico da carteira
          </h2>

          <p className="mt-1 text-sm text-zinc-500">
            Débitos e créditos registrados para este cliente.
          </p>
        </div>

        {movimentos.length ===
        0 ? (
          <div className="p-8 text-center text-sm text-zinc-500">
            Nenhuma movimentação registrada.
          </div>
        ) : (
          <div className="divide-y divide-zinc-100">
            {movimentos.map(
              (
                movimento
              ) => (
                <div
                  key={
                    movimento.id
                  }
                  className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={[
                          "rounded-full px-2.5 py-1 text-xs font-semibold",
                          movimento.tipo ===
                          "DEBITO"
                            ? "bg-red-100 text-red-700"
                            : "bg-green-100 text-green-700",
                        ].join(
                          " "
                        )}
                      >
                        {
                          movimento.tipo
                        }
                      </span>

                      <p className="font-medium text-zinc-900">
                        {movimento.descricao ??
                          movimento.origem}
                      </p>
                    </div>

                    <p className="mt-1 text-xs text-zinc-400">
                      {dataHoraBr(
                        movimento.created_at
                      )}
                    </p>
                  </div>

                  <p
                    className={[
                      "font-bold",
                      movimento.tipo ===
                      "DEBITO"
                        ? "text-red-700"
                        : "text-green-700",
                    ].join(
                      " "
                    )}
                  >
                    {movimento.tipo ===
                    "DEBITO"
                      ? "+"
                      : "-"}{" "}
                    {dinheiro(
                      movimento.valor
                    )}
                  </p>
                </div>
              )
            )}
          </div>
        )}
      </section>

      {modal && (
        <Modal
          titulo={
            modal ===
            "TOTAL"
              ? "Baixa total"
              : modal ===
                  "PARCIAL"
                ? "Baixa parcial"
                : "Baixar itens selecionados"
          }
          onClose={fechar}
        >
          <div className="rounded-xl bg-zinc-50 p-4">
            <p className="text-xs uppercase tracking-wide text-zinc-400">
              Valor
            </p>

            <p className="mt-1 text-2xl font-bold text-zinc-900">
              {modal ===
              "TOTAL"
                ? dinheiro(
                    saldo
                  )
                : modal ===
                    "ITENS"
                  ? dinheiro(
                      valorSelecionado
                    )
                  : "Informe abaixo"}
            </p>
          </div>

          {modal ===
            "PARCIAL" && (
            <div className="mt-4">
              <label className="text-sm font-medium text-zinc-700">
                Valor recebido
              </label>

              <input
                autoFocus
                value={
                  valorParcial
                }
                onChange={(
                  event
                ) =>
                  setValorParcial(
                    event.target.value
                  )
                }
                inputMode="decimal"
                placeholder="0,00"
                className={inputClass}
              />
            </div>
          )}

          <div className="mt-4">
            <label className="text-sm font-medium text-zinc-700">
              Forma de pagamento
            </label>

            <select
              value={
                formaPagamentoId
              }
              onChange={(
                event
              ) =>
                setFormaPagamentoId(
                  event.target.value
                )
              }
              className={inputClass}
            >
              {formasPagamento.length ===
                0 && (
                <option value="">
                  Nenhuma forma disponível
                </option>
              )}

              {formasPagamento.map(
                (forma) => (
                  <option
                    key={
                      forma.id
                    }
                    value={
                      forma.id
                    }
                  >
                    {forma.nome}
                  </option>
                )
              )}
            </select>
          </div>

          <div className="mt-4">
            <label className="text-sm font-medium text-zinc-700">
              Observação
            </label>

            <textarea
              value={
                observacao
              }
              onChange={(
                event
              ) =>
                setObservacao(
                  event.target.value
                )
              }
              rows={3}
              placeholder="Opcional"
              className={inputClass}
            />
          </div>

          {erro && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {erro}
            </div>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              disabled={
                isPending
              }
              onClick={
                fechar
              }
              className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium hover:bg-zinc-50"
            >
              Cancelar
            </button>

            <button
              type="button"
              disabled={
                isPending ||
                !formaPagamentoId
              }
              onClick={
                confirmar
              }
              className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:bg-zinc-300"
            >
              {isPending
                ? "Recebendo..."
                : "Confirmar recebimento"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Resumo({
  label,
  valor,
  destaque,
}: {
  label: string;
  valor: string;
  destaque?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </p>

      <p
        className={[
          "mt-2 text-2xl font-bold",
          destaque
            ? "text-red-700"
            : "text-zinc-900",
        ].join(" ")}
      >
        {valor}
      </p>
    </div>
  );
}

function StatusBadge({
  ativo,
  labelAtivo,
  labelInativo,
}: {
  ativo: boolean;
  labelAtivo: string;
  labelInativo: string;
}) {
  return (
    <span
      className={[
        "rounded-full px-3 py-1.5 text-xs font-semibold",
        ativo
          ? "bg-green-100 text-green-700"
          : "bg-zinc-200 text-zinc-600",
      ].join(" ")}
    >
      {ativo
        ? labelAtivo
        : labelInativo}
    </span>
  );
}

function StatusTitulo({
  status,
}: {
  status: string;
}) {
  const classe =
    status === "QUITADO"
      ? "bg-green-100 text-green-700"
      : status ===
          "PARCIAL"
        ? "bg-amber-100 text-amber-700"
        : status ===
            "CANCELADO"
          ? "bg-zinc-200 text-zinc-600"
          : "bg-red-100 text-red-700";

  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${classe}`}
    >
      {status}
    </span>
  );
}

function Modal({
  titulo,
  children,
  onClose,
}: {
  titulo: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />

      <div className="relative z-10 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-zinc-900">
            {titulo}
          </h2>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50"
          >
            Fechar
          </button>
        </div>

        <div className="mt-5">
          {children}
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-100";

const botaoPrimario =
  "rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500";

const botaoSecundario =
  "rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40";
