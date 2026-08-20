"use client";

import {
  useMemo,
  useState,
} from "react";

type ProdutoOption = {
  id: string;
  codigo: string;
  nome: string;
  precoVenda: number;
};

type Props = {
  produtoIdInicial: string;
  idempotencyKeyInicial?: string;
  produtos: ProdutoOption[];
};

export function EmissaoTesteClient({
  produtoIdInicial,
  idempotencyKeyInicial = "",
  produtos,
}: Props) {
  const [
    produtoId,
    setProdutoId,
  ] = useState(
    produtoIdInicial
  );

  const [
    carregando,
    setCarregando,
  ] = useState(false);

  const [
    resultado,
    setResultado,
  ] = useState<
    unknown | null
  >(null);

  const [
    idempotencia,
    setIdempotencia,
  ] = useState(
    idempotencyKeyInicial
  );

  const produtoSelecionado =
    useMemo(
      () =>
        produtos.find(
          (produto) =>
            produto.id ===
            produtoId
        ) ?? null,
      [
        produtos,
        produtoId,
      ]
    );

  function selecionarProduto(
    novoProdutoId: string
  ) {
    setProdutoId(
      novoProdutoId
    );

    // Produto diferente =
    // nova tentativa.
    setIdempotencia("");
    setResultado(null);

    const url =
      new URL(
        window.location.href
      );

    if (novoProdutoId) {
      url.searchParams.set(
        "produto_id",
        novoProdutoId
      );
    } else {
      url.searchParams.delete(
        "produto_id"
      );
    }

    url.searchParams.delete(
      "idempotency_key"
    );

    window.history.replaceState(
      {},
      "",
      url.toString()
    );
  }

  async function emitir() {
    if (!produtoId) {
      setResultado({
        ok: false,
        erro:
          "Selecione um produto antes de emitir.",
      });
      return;
    }

    const confirmou =
      window.confirm(
        "CONFIRMAR EMISSÃO REAL EM HOMOLOGAÇÃO?\n\nA NFC-e será transmitida à Geranet/SEFAZ em ambiente 2 e um número fiscal será reservado."
      );

    if (!confirmou) {
      return;
    }

    setCarregando(true);
    setResultado(null);

    // Mantém a mesma chave
    // durante a tentativa.
    const chave =
      idempotencia ||
      crypto.randomUUID();

    if (!idempotencia) {
      setIdempotencia(
        chave
      );
    }

    try {
      const resposta =
        await fetch(
          "/api/fiscal/geranet/nfce-emitir",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              "Idempotency-Key":
                chave,
            },

            body:
              JSON.stringify({
                confirmar:
                  "EMITIR_NFCE_HOMOLOGACAO",

                produto_id:
                  produtoId,

                quantidade: 1,

                desconto: 0,

                tipo_pagamento:
                  "01",

                indicador_pagamento:
                  "0",

                troco: 0,
              }),
          }
        );

      const dados =
        await resposta.json();

      setResultado(
        dados
      );
    } catch {
      setResultado({
        ok: false,

        erro:
          "Falha ao receber a resposta. NÃO tente emitir novamente com outra chave até verificar fiscal_emissoes.",

        idempotency_key:
          chave,
      });
    } finally {
      setCarregando(
        false
      );
    }
  }

  return (
    <div
      className="space-y-6"
    >
      <div
        className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
      >
        <strong>
          Homologação somente.
        </strong>{" "}
        Este botão transmite uma
        NFC-e modelo 65 de teste.
        A rota bloqueia ambiente de
        produção.
      </div>

      <div
        className="space-y-2"
      >
        <label
          htmlFor="produto"
          className="text-sm font-medium"
        >
          Produto para emissão
        </label>

        <select
          id="produto"
          value={produtoId}
          disabled={carregando}
          onChange={(event) =>
            selecionarProduto(
              event.target.value
            )
          }
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 text-sm"
        >
          <option value="">
            Selecione um produto
          </option>

          {produtos.map(
            (produto) => (
              <option
                key={
                  produto.id
                }
                value={
                  produto.id
                }
              >
                {produto.codigo
                  ? `${produto.codigo} - `
                  : ""}
                {produto.nome}
              </option>
            )
          )}
        </select>
      </div>

      <div
        className="rounded-xl border p-4 text-sm"
      >
        <div>
          <strong>
            Produto:
          </strong>{" "}

          {produtoSelecionado
            ? `${
                produtoSelecionado.codigo
              } - ${
                produtoSelecionado.nome
              }`
            : "não informado"}
        </div>

        {produtoSelecionado ? (
          <div
            className="mt-1 text-zinc-500"
          >
            ID:{" "}
            <code
              className="break-all"
            >
              {
                produtoSelecionado.id
              }
            </code>
          </div>
        ) : null}

        <div
          className="mt-3"
        >
          Quantidade: 1
        </div>

        <div>
          Pagamento: dinheiro
          (01), à vista
        </div>
      </div>

      <button
        type="button"
        disabled={
          carregando ||
          !produtoId
        }
        onClick={emitir}
        className="rounded-lg bg-black px-5 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {carregando
          ? "Transmitindo..."
          : "Emitir NFC-e em homologação"}
      </button>

      {idempotencia ? (
        <div
          className="text-xs text-zinc-500"
        >
          Idempotência desta
          tentativa:{" "}

          <code>
            {idempotencia}
          </code>
        </div>
      ) : null}

      {resultado !== null ? (
        <pre
          className="max-h-[600px] overflow-auto rounded-xl bg-zinc-950 p-4 text-xs text-zinc-100"
        >
          {JSON.stringify(
            resultado,
            null,
            2
          )}
        </pre>
      ) : null}
    </div>
  );
}