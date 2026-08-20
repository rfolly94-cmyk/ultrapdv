"use client";

import {
  useMemo,
  useState,
} from "react";

type CstIbscbs = {
  codigo: string;
  descricao: string;
  permite_nfe: boolean;
  permite_nfce: boolean;
};

type ClassTrib = {
  codigo: string;
  cst_codigo: string;
  descricao: string;
  percentual_reducao_ibs:
    | number
    | string
    | null;
  percentual_reducao_cbs:
    | number
    | string
    | null;
  permite_nfe: boolean;
  permite_nfce: boolean;
};

type Props = {
  csts: CstIbscbs[];
  classificacoes: ClassTrib[];
  defaultCst?: string | null;
  defaultClassTrib?: string | null;
};

function percentual(
  valor: number | string | null
) {
  const numero = Number(valor ?? 0);

  return Number.isFinite(numero)
    ? numero.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : "0,00";
}

function documentos(
  permiteNfe: boolean,
  permiteNfce: boolean
) {
  const itens = [];

  if (permiteNfe) {
    itens.push("NF-e");
  }

  if (permiteNfce) {
    itens.push("NFC-e");
  }

  return itens.length
    ? itens.join(" / ")
    : "Não aplicável a NF-e/NFC-e";
}

export function IbsCbsSelect({
  csts,
  classificacoes,
  defaultCst,
  defaultClassTrib,
}: Props) {
  const [cst, setCst] = useState(
    defaultCst ?? ""
  );

  const [classTrib, setClassTrib] =
    useState(defaultClassTrib ?? "");

  const classificacoesDoCst =
    useMemo(
      () =>
        classificacoes.filter(
          (item) =>
            item.cst_codigo === cst
        ),
      [classificacoes, cst]
    );

  const cstSelecionado = csts.find(
    (item) => item.codigo === cst
  );

  const classificacaoSelecionada =
    classificacoes.find(
      (item) =>
        item.codigo === classTrib &&
        item.cst_codigo === cst
    );

  return (
    <>
      <div>
        <label className="block text-sm font-medium text-zinc-700">
          CST IBS/CBS
        </label>

        <select
          name="cst_ibscbs"
          value={cst}
          required
          onChange={(event) => {
            const novoCst =
              event.target.value;

            setCst(novoCst);
            setClassTrib("");
          }}
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none focus:border-zinc-900"
        >
          <option value="">
            — Selecionar —
          </option>

          {csts.map((item) => (
            <option
              key={item.codigo}
              value={item.codigo}
            >
              {item.codigo} - {item.descricao}
            </option>
          ))}
        </select>

        {cstSelecionado && (
          <p className="mt-1 text-xs text-zinc-500">
            Aplicável a:{" "}
            {documentos(
              cstSelecionado.permite_nfe,
              cstSelecionado.permite_nfce
            )}
          </p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700">
          cClassTrib
        </label>

        <select
          name="classificacao_ibscbs"
          value={classTrib}
          required
          disabled={!cst}
          onChange={(event) =>
            setClassTrib(
              event.target.value
            )
          }
          className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none disabled:cursor-not-allowed disabled:bg-zinc-100 focus:border-zinc-900"
        >
          <option value="">
            {cst
              ? "— Selecionar —"
              : "Selecione primeiro o CST"}
          </option>

          {classificacoesDoCst.map(
            (item) => (
              <option
                key={item.codigo}
                value={item.codigo}
              >
                {item.codigo} -{" "}
                {item.descricao}
              </option>
            )
          )}
        </select>

        {classificacaoSelecionada && (
          <p className="mt-1 text-xs text-zinc-500">
            Aplicável a:{" "}
            {documentos(
              classificacaoSelecionada.permite_nfe,
              classificacaoSelecionada.permite_nfce
            )}
          </p>
        )}
      </div>

      {classificacaoSelecionada && (
        <div className="md:col-span-2 grid gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Redução IBS
            </p>

            <p className="mt-1 text-lg font-semibold text-zinc-900">
              {percentual(
                classificacaoSelecionada.percentual_reducao_ibs
              )}
              %
            </p>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Redução CBS
            </p>

            <p className="mt-1 text-lg font-semibold text-zinc-900">
              {percentual(
                classificacaoSelecionada.percentual_reducao_cbs
              )}
              %
            </p>
          </div>

          <p className="sm:col-span-2 text-xs text-zinc-500">
            Esses percentuais vêm do catálogo
            oficial carregado no UltraPDV. Eles
            não são digitados manualmente e serão
            validados novamente no servidor ao
            salvar.
          </p>
        </div>
      )}
    </>
  );
}
