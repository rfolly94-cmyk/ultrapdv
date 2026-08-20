"use client";

import {
  useMemo,
  useState,
} from "react";

import type {
  OpcaoFiscal,
} from "@/lib/fiscal/tabelas-fiscais";

type Props = {
  label: string;
  name: string;
  opcoes: OpcaoFiscal[];
  defaultValue?: string | null;
  required?: boolean;
  placeholder?: string;
  ajuda?: string;
};

function normalizar(valor: string) {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function FiscalCodeSelect({
  label,
  name,
  opcoes,
  defaultValue,
  required = false,
  placeholder = "Digite código ou descrição",
  ajuda,
}: Props) {
  const inicial =
    opcoes.find(
      (opcao) =>
        opcao.codigo === defaultValue
    ) ?? null;

  const [selecionado, setSelecionado] =
    useState<OpcaoFiscal | null>(inicial);

  const [texto, setTexto] = useState(
    inicial
      ? `${inicial.codigo} - ${inicial.descricao}`
      : ""
  );

  const [aberto, setAberto] =
    useState(false);

  const filtradas = useMemo(() => {
    const busca = normalizar(
      texto.trim()
    );

    if (!busca) {
      return opcoes.slice(0, 30);
    }

    return opcoes
      .filter((opcao) => {
        const alvo = normalizar(
          `${opcao.codigo} ${opcao.descricao}`
        );

        return alvo.includes(busca);
      })
      .slice(0, 60);
  }, [opcoes, texto]);

  function selecionar(
    opcao: OpcaoFiscal
  ) {
    setSelecionado(opcao);
    setTexto(
      `${opcao.codigo} - ${opcao.descricao}`
    );
    setAberto(false);
  }

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-zinc-700">
        {label}
      </label>

      <input
        type="hidden"
        name={name}
        value={selecionado?.codigo ?? ""}
      />

      <input
        value={texto}
        required={required}
        autoComplete="off"
        placeholder={placeholder}
        onFocus={() => setAberto(true)}
        onChange={(event) => {
          setTexto(event.target.value);
          setSelecionado(null);
          setAberto(true);
        }}
        onBlur={() => {
          window.setTimeout(
            () => setAberto(false),
            150
          );
        }}
        className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none transition focus:border-zinc-900"
      />

      {ajuda && (
        <p className="mt-1 text-xs text-zinc-500">
          {ajuda}
        </p>
      )}

      {aberto && (
        <div className="absolute z-40 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-zinc-200 bg-white shadow-xl">
          {!filtradas.length ? (
            <div className="p-3 text-sm text-zinc-500">
              Nenhum código encontrado.
            </div>
          ) : (
            filtradas.map((opcao) => (
              <button
                key={opcao.codigo}
                type="button"
                onMouseDown={(event) =>
                  event.preventDefault()
                }
                onClick={() =>
                  selecionar(opcao)
                }
                className="block w-full border-b border-zinc-100 px-3 py-2.5 text-left last:border-b-0 hover:bg-zinc-50"
              >
                <span className="font-semibold text-zinc-900">
                  {opcao.codigo}
                </span>

                <span className="ml-2 text-sm text-zinc-600">
                  {opcao.descricao}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
