"use client";

import {
  useMemo,
  useState,
  useTransition,
} from "react";

import {
  atualizarLimitesEstoque,
  movimentarEstoque,
} from "../../app/estoque/actions";

type ProdutoEstoque = {
  id: string;
  codigo: string;
  codigo_barras:
    | string
    | null;
  nome: string;
  unidade_medida: string;
  ativo: boolean;
  quantidade:
    | number
    | string;
  estoque_minimo:
    | number
    | string;
  estoque_maximo:
    | number
    | string
    | null;
};

type Operacao =
  | "ENTRADA"
  | "SAIDA"
  | "AJUSTE";

type Props = {
  empresaNome: string;
  perfil: string;
  produtos: ProdutoEstoque[];
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

function quantidadeTexto(
  valor:
    | number
    | string
) {
  return numero(valor)
    .toLocaleString(
      "pt-BR",
      {
        minimumFractionDigits: 0,
        maximumFractionDigits: 4,
      }
    );
}

function normalizar(
  valor: string
) {
  return valor
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim();
}

export function EstoqueWorkspace({
  empresaNome,
  perfil,
  produtos,
}: Props) {
  const [
    busca,
    setBusca,
  ] = useState("");

  const [
    somenteBaixo,
    setSomenteBaixo,
  ] = useState(false);

  const [
    produtoMovimento,
    setProdutoMovimento,
  ] =
    useState<ProdutoEstoque | null>(
      null
    );

  const [
    produtoLimites,
    setProdutoLimites,
  ] =
    useState<ProdutoEstoque | null>(
      null
    );

  const [
    operacao,
    setOperacao,
  ] =
    useState<Operacao>(
      "ENTRADA"
    );

  const [
    quantidade,
    setQuantidade,
  ] = useState("");

  const [
    observacao,
    setObservacao,
  ] = useState("");

  const [
    minimo,
    setMinimo,
  ] = useState("");

  const [
    maximo,
    setMaximo,
  ] = useState("");

  const [
    erro,
    setErro,
  ] =
    useState<string | null>(
      null
    );

  const [
    isPending,
    startTransition,
  ] = useTransition();

  const filtrados =
    useMemo(() => {
      const termo =
        normalizar(busca);

      return produtos.filter(
        (produto) => {
          const qtd =
            numero(
              produto.quantidade
            );

          const min =
            numero(
              produto.estoque_minimo
            );

          if (
            somenteBaixo &&
            qtd > min
          ) {
            return false;
          }

          if (!termo) {
            return true;
          }

          return (
            normalizar(
              produto.nome
            ).includes(
              termo
            ) ||
            normalizar(
              produto.codigo
            ).includes(
              termo
            ) ||
            normalizar(
              produto.codigo_barras ??
                ""
            ).includes(
              termo
            )
          );
        }
      );
    }, [
      busca,
      produtos,
      somenteBaixo,
    ]);

  const totalProdutos =
    produtos.length;

  const zerados =
    produtos.filter(
      (produto) =>
        numero(
          produto.quantidade
        ) === 0
    ).length;

  const abaixoMinimo =
    produtos.filter(
      (produto) =>
        numero(
          produto.quantidade
        ) <=
        numero(
          produto.estoque_minimo
        )
    ).length;

  function abrirMovimento(
    produto: ProdutoEstoque
  ) {
    setProdutoMovimento(
      produto
    );
    setOperacao(
      "ENTRADA"
    );
    setQuantidade("");
    setObservacao("");
    setErro(null);
  }

  function abrirLimites(
    produto: ProdutoEstoque
  ) {
    setProdutoLimites(
      produto
    );
    setMinimo(
      String(
        produto.estoque_minimo ??
          0
      ).replace(
        ".",
        ","
      )
    );
    setMaximo(
      produto.estoque_maximo ===
        null
        ? ""
        : String(
            produto.estoque_maximo
          ).replace(
            ".",
            ","
          )
    );
    setErro(null);
  }

  function salvarMovimento() {
    if (
      !produtoMovimento
    ) {
      return;
    }

    setErro(null);

    startTransition(
      async () => {
        const resultado =
          await movimentarEstoque(
            {
              produtoId:
                produtoMovimento.id,
              operacao,
              quantidade,
              observacao,
            }
          );

        if (!resultado.ok) {
          setErro(
            resultado.erro
          );
          return;
        }

        setProdutoMovimento(
          null
        );
        window.location.reload();
      }
    );
  }

  function salvarLimites() {
    if (
      !produtoLimites
    ) {
      return;
    }

    setErro(null);

    startTransition(
      async () => {
        const resultado =
          await atualizarLimitesEstoque(
            {
              produtoId:
                produtoLimites.id,
              estoqueMinimo:
                minimo,
              estoqueMaximo:
                maximo,
            }
          );

        if (!resultado.ok) {
          setErro(
            resultado.erro
          );
          return;
        }

        setProdutoLimites(
          null
        );
        window.location.reload();
      }
    );
  }

  return (
    <main className="min-h-screen bg-zinc-100 p-4 md:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold text-zinc-500">
              {empresaNome}
            </p>

            <h1 className="mt-1 text-3xl font-bold text-zinc-900">
              Estoque
            </h1>

            <p className="mt-1 text-sm text-zinc-500">
              Saldo atual, limites e ajustes manuais.
            </p>
          </div>

          <p className="text-xs text-zinc-400">
            Ajustes manuais: administrador
          </p>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <CardResumo
            label="Produtos"
            valor={
              totalProdutos
            }
          />

          <CardResumo
            label="Estoque zerado"
            valor={zerados}
          />

          <CardResumo
            label="No mínimo ou abaixo"
            valor={
              abaixoMinimo
            }
          />
        </div>

        <div className="mt-6 rounded-2xl bg-white p-4 shadow-sm md:p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <input
              value={busca}
              onChange={(
                event
              ) =>
                setBusca(
                  event.target.value
                )
              }
              placeholder="Buscar por produto, código ou código de barras"
              className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-100"
            />

            <label className="flex shrink-0 items-center gap-2 rounded-xl border border-zinc-200 px-4 py-3 text-sm text-zinc-600">
              <input
                type="checkbox"
                checked={
                  somenteBaixo
                }
                onChange={(
                  event
                ) =>
                  setSomenteBaixo(
                    event.target.checked
                  )
                }
              />

              Somente baixo
            </label>
          </div>

          <div className="mt-5 overflow-x-auto rounded-xl border border-zinc-200">
            <table className="w-full min-w-[880px] border-collapse text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-4 py-3">
                    Produto
                  </th>
                  <th className="px-4 py-3">
                    Código
                  </th>
                  <th className="px-4 py-3 text-right">
                    Saldo
                  </th>
                  <th className="px-4 py-3 text-right">
                    Mínimo
                  </th>
                  <th className="px-4 py-3 text-right">
                    Máximo
                  </th>
                  <th className="px-4 py-3">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right">
                    Ações
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-zinc-100">
                {filtrados.map(
                  (produto) => {
                    const qtd =
                      numero(
                        produto.quantidade
                      );

                    const min =
                      numero(
                        produto.estoque_minimo
                      );

                    const baixo =
                      qtd <= min;

                    return (
                      <tr
                        key={
                          produto.id
                        }
                        className="hover:bg-zinc-50"
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-zinc-900">
                            {
                              produto.nome
                            }
                          </p>

                          {!produto.ativo && (
                            <p className="mt-0.5 text-xs text-zinc-400">
                              Produto inativo
                            </p>
                          )}
                        </td>

                        <td className="px-4 py-3 text-zinc-500">
                          {
                            produto.codigo
                          }
                        </td>

                        <td className="px-4 py-3 text-right text-base font-bold">
                          {quantidadeTexto(
                            produto.quantidade
                          )}{" "}
                          <span className="text-xs font-normal text-zinc-400">
                            {
                              produto.unidade_medida
                            }
                          </span>
                        </td>

                        <td className="px-4 py-3 text-right text-zinc-600">
                          {quantidadeTexto(
                            produto.estoque_minimo
                          )}
                        </td>

                        <td className="px-4 py-3 text-right text-zinc-600">
                          {produto.estoque_maximo ===
                          null
                            ? "—"
                            : quantidadeTexto(
                                produto.estoque_maximo
                              )}
                        </td>

                        <td className="px-4 py-3">
                          <span
                            className={[
                              "rounded-full px-2.5 py-1 text-xs font-semibold",
                              baixo
                                ? "bg-amber-100 text-amber-700"
                                : "bg-green-100 text-green-700",
                            ].join(
                              " "
                            )}
                          >
                            {baixo
                              ? "Baixo"
                              : "Normal"}
                          </span>
                        </td>

                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                abrirMovimento(
                                  produto
                                )
                              }
                              className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium hover:bg-zinc-50"
                            >
                              Movimentar
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                abrirLimites(
                                  produto
                                )
                              }
                              className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium hover:bg-zinc-50"
                            >
                              Limites
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                )}

                {filtrados.length ===
                  0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-12 text-center text-zinc-500"
                    >
                      Nenhum produto encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {produtoMovimento && (
        <Modal
          titulo="Movimentar estoque"
          onClose={() =>
            !isPending &&
            setProdutoMovimento(
              null
            )
          }
        >
          <p className="font-medium text-zinc-900">
            {
              produtoMovimento.nome
            }
          </p>

          <p className="mt-1 text-sm text-zinc-500">
            Saldo atual:{" "}
            <strong>
              {quantidadeTexto(
                produtoMovimento.quantidade
              )}{" "}
              {
                produtoMovimento.unidade_medida
              }
            </strong>
          </p>

          <div className="mt-5">
            <label className="text-sm font-medium text-zinc-700">
              Operação
            </label>

            <select
              value={
                operacao
              }
              onChange={(
                event
              ) =>
                setOperacao(
                  event.target.value as Operacao
                )
              }
              className={inputClass}
            >
              <option value="ENTRADA">
                Entrada
              </option>
              <option value="SAIDA">
                Saída
              </option>
              <option value="AJUSTE">
                Definir saldo
              </option>
            </select>
          </div>

          <div className="mt-4">
            <label className="text-sm font-medium text-zinc-700">
              {operacao ===
              "AJUSTE"
                ? "Novo saldo"
                : "Quantidade"}
            </label>

            <input
              autoFocus
              value={
                quantidade
              }
              onChange={(
                event
              ) =>
                setQuantidade(
                  event.target.value
                )
              }
              inputMode="decimal"
              placeholder="0"
              className={inputClass}
            />
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
              placeholder="Motivo do ajuste"
              className={inputClass}
            />
          </div>

          {erro && (
            <Erro>
              {erro}
            </Erro>
          )}

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              disabled={
                isPending
              }
              onClick={
                salvarMovimento
              }
              className="rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:bg-zinc-300"
            >
              {isPending
                ? "Salvando..."
                : "Salvar movimentação"}
            </button>
          </div>
        </Modal>
      )}

      {produtoLimites && (
        <Modal
          titulo="Limites de estoque"
          onClose={() =>
            !isPending &&
            setProdutoLimites(
              null
            )
          }
        >
          <p className="font-medium text-zinc-900">
            {
              produtoLimites.nome
            }
          </p>

          <div className="mt-5">
            <label className="text-sm font-medium text-zinc-700">
              Estoque mínimo
            </label>

            <input
              autoFocus
              value={minimo}
              onChange={(
                event
              ) =>
                setMinimo(
                  event.target.value
                )
              }
              inputMode="decimal"
              className={inputClass}
            />
          </div>

          <div className="mt-4">
            <label className="text-sm font-medium text-zinc-700">
              Estoque máximo
            </label>

            <input
              value={maximo}
              onChange={(
                event
              ) =>
                setMaximo(
                  event.target.value
                )
              }
              inputMode="decimal"
              placeholder="Opcional"
              className={inputClass}
            />

            <p className="mt-1 text-xs text-zinc-400">
              Deixe vazio para não definir máximo.
            </p>
          </div>

          {erro && (
            <Erro>
              {erro}
            </Erro>
          )}

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              disabled={
                isPending
              }
              onClick={
                salvarLimites
              }
              className="rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:bg-zinc-300"
            >
              {isPending
                ? "Salvando..."
                : "Salvar limites"}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}

function CardResumo({
  label,
  valor,
}: {
  label: string;
  valor: number;
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </p>

      <p className="mt-2 text-3xl font-bold text-zinc-900">
        {valor}
      </p>
    </div>
  );
}

function Erro({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      {children}
    </div>
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
