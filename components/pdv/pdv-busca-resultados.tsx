"use client";

import { useEffect, useRef } from "react";

import {
  estoqueDisponivelDoRegistro,
  formatarQuantidadeEstoquePdv,
} from "@/lib/pdv/venda-sem-estoque";

export type ProdutoBuscaPdv = {
  id: string;
  codigo: string;
  nome: string;
  preco_venda: number | string;
  estoqueDisponivel?: number;
};

function precoBuscaPdv(valor: number | string) {
  const numero = Number(valor);
  const centavos = Number.isFinite(numero) ? Math.round(numero * 100) : 0;
  return (centavos / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function PdvBuscaResultados<T extends ProdutoBuscaPdv>({
  produtos,
  produtoSelecionadoId,
  onEscolher,
}: {
  produtos: T[];
  produtoSelecionadoId?: string | null;
  onEscolher: (produto: T) => void;
}) {
  const tabelaRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    if (!produtoSelecionadoId) {
      return;
    }
    const linha = tabelaRef.current?.querySelector(
      `tr[data-produto-id="${CSS.escape(produtoSelecionadoId)}"]`
    );
    if (linha instanceof HTMLElement) {
      linha.scrollIntoView({ block: "nearest" });
    }
  }, [produtoSelecionadoId]);

  if (produtos.length === 0) {
    return (
      <p className="px-4 py-3 text-sm text-zinc-500">
        Nenhum produto encontrado.
      </p>
    );
  }

  return (
    <table ref={tabelaRef} className="pdv-busca-tabela">
      <thead>
        <tr>
          <th scope="col">Código</th>
          <th scope="col">Descrição</th>
          <th scope="col" className="num">Preço</th>
          <th scope="col" className="num">Estoque</th>
        </tr>
      </thead>
      <tbody>
        {produtos.map((produto) => {
          const selecionado = produto.id === produtoSelecionadoId;
          return (
            <tr
              key={produto.id}
              data-produto-id={produto.id}
              data-clickable="true"
              aria-selected={selecionado}
              className={selecionado ? "pdv-busca-selecionada" : undefined}
              onClick={() => onEscolher(produto)}
            >
              <td>{produto.codigo}</td>
              <td>{produto.nome}</td>
              <td className="num">{precoBuscaPdv(produto.preco_venda)}</td>
              <td className="num">
                {formatarQuantidadeEstoquePdv(
                  estoqueDisponivelDoRegistro(produto.estoqueDisponivel)
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
