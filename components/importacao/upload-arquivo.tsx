"use client";

import { useMemo } from "react";

import { LIMITES_IMPORTACAO, colunasDoCabecalho, previaMatriz } from "@/lib/importacao/parser";

export function UploadArquivo({
  nome,
  tamanho,
  abas,
  aba,
  matriz,
  linhaCabecalho,
  erro,
  onArquivo,
  onAba,
  onCabecalho,
}: {
  nome: string;
  tamanho: number;
  abas: string[];
  aba: string;
  matriz: string[][];
  linhaCabecalho: number;
  erro: string | null;
  onArquivo: (arquivo: File) => void;
  onAba: (aba: string) => void;
  onCabecalho: (linha: number) => void;
}) {
  const preview = useMemo(
    () => previaMatriz(matriz, linhaCabecalho),
    [matriz, linhaCabecalho]
  );
  const colunas = useMemo(
    () => colunasDoCabecalho(matriz, linhaCabecalho),
    [matriz, linhaCabecalho]
  );

  return (
    <div className="space-y-4">
      <label className="block rounded-xl border border-dashed border-zinc-300 bg-white px-4 py-8 text-center">
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(event) => {
            const arquivo = event.target.files?.[0];
            if (arquivo) {
              onArquivo(arquivo);
            }
            event.currentTarget.value = "";
          }}
        />
        <p className="text-[15px] font-semibold text-zinc-950">
          Selecione um arquivo .xlsx, .xls ou .csv
        </p>
        <p className="mt-1 text-[13px] text-zinc-500">
          A importação só grava depois da revisão e confirmação.
        </p>
      </label>

      {erro ? (
        <p className="text-[13px] text-red-700">{erro}</p>
      ) : null}

      {nome ? (
        <div className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-[13px] sm:grid-cols-3">
          <div>
            <p className="text-[11px] text-zinc-400">Arquivo</p>
            <p className="mt-1 font-medium text-zinc-950">{nome}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-400">Tamanho</p>
            <p className="mt-1 font-medium text-zinc-950">
              {(tamanho / 1024).toFixed(1)} KB
            </p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-400">Linhas na aba</p>
            <p className="mt-1 font-medium text-zinc-950">
              {Math.max(0, matriz.length - linhaCabecalho).toLocaleString("pt-BR")}
              {matriz.length > LIMITES_IMPORTACAO.maxLinhas
                ? ` (limite ${LIMITES_IMPORTACAO.maxLinhas.toLocaleString("pt-BR")})`
                : ""}
            </p>
          </div>
        </div>
      ) : null}

      {abas.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[13px]">
            <span className="text-zinc-500">Planilha / aba</span>
            <select
              className="updv-input mt-1"
              value={aba}
              onChange={(event) => onAba(event.target.value)}
            >
              {abas.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[13px]">
            <span className="text-zinc-500">Linha do cabeçalho</span>
            <input
              type="number"
              min={1}
              max={Math.max(1, matriz.length)}
              className="updv-input mt-1"
              value={linhaCabecalho}
              onChange={(event) => onCabecalho(Number(event.target.value) || 1)}
            />
          </label>
        </div>
      ) : null}

      {preview.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          <div className="border-b border-zinc-200 px-3 py-2 text-[13px] font-semibold">
            Prévia
          </div>
          <div className="overflow-x-auto">
            <table className="updv-table min-w-[640px]">
              <thead>
                <tr>
                  {colunas.map((coluna) => (
                    <th key={coluna}>{coluna}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.slice(1).map((linha, indice) => (
                  <tr key={indice}>
                    {colunas.map((_, col) => (
                      <td key={col}>{linha[col] || "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
