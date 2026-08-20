"use client";

import {
  useEffect,
} from "react";

type Props = {
  autoPrint?: boolean;
  voltarHref?: string;
};

export function ControlesImpressao({
  autoPrint = false,
  voltarHref,
}: Props) {
  useEffect(() => {
    if (!autoPrint) {
      return;
    }

    const timer =
      window.setTimeout(
        () => {
          window.print();
        },
        350
      );

    return () =>
      window.clearTimeout(
        timer
      );
  }, [autoPrint]);

  return (
    <div className="print:hidden mb-5 flex flex-wrap justify-center gap-2">
      <button
        type="button"
        onClick={() =>
          window.print()
        }
        className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
      >
        Imprimir
      </button>

      {voltarHref ? (
        <a
          href={voltarHref}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-100"
        >
          Voltar
        </a>
      ) : (
        <button
          type="button"
          onClick={() =>
            window.close()
          }
          className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-100"
        >
          Fechar
        </button>
      )}
    </div>
  );
}
