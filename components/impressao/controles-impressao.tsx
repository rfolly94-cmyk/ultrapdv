"use client";

import { useEffect, useState } from "react";

import { imprimirUrlPdfNoUltraPdvConector } from "@/lib/impressao/imprimir-pdf";
import { MENSAGEM_CONECTOR_AUSENTE } from "@/lib/impressao/mensagens";

type Props = {
  autoPrint?: boolean;
  voltarHref?: string;
  pdfUrl: string;
  tipoDocumento?: string;
  papel?: string;
};

export function ControlesImpressao({
  autoPrint = false,
  voltarHref,
  pdfUrl,
  tipoDocumento = "recibo",
  papel = "80mm",
}: Props) {
  const [status, setStatus] = useState<"idle" | "imprimindo" | "ok" | "falha">(
    "idle"
  );
  const [mensagem, setMensagem] = useState<string | null>(null);

  async function imprimir() {
    setStatus("imprimindo");
    setMensagem(null);
    const resultado = await imprimirUrlPdfNoUltraPdvConector({
      url: pdfUrl,
      tipoDocumento,
      papel,
    });
    if (resultado.ok) {
      setStatus("ok");
      setMensagem(resultado.mensagem);
      return;
    }
    setStatus("falha");
    setMensagem(resultado.erro || MENSAGEM_CONECTOR_AUSENTE);
  }

  useEffect(() => {
    if (!autoPrint) {
      return;
    }
    const timer = window.setTimeout(() => {
      void imprimir();
    }, 350);
    return () => window.clearTimeout(timer);
    // autoPrint dispara uma vez ao montar a pré-visualização.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrint]);

  return (
    <div className="print:hidden mb-5 flex flex-col items-center gap-2">
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          disabled={status === "imprimindo"}
          onClick={() => void imprimir()}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "imprimindo" ? "Enviando..." : "Imprimir"}
        </button>

        <a
          href={pdfUrl}
          download
          className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-100"
        >
          Baixar PDF
        </a>

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
            onClick={() => window.close()}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-100"
          >
            Fechar
          </button>
        )}
      </div>
      {mensagem ? (
        <p
          className={`max-w-lg whitespace-pre-line text-center text-xs ${
            status === "falha" ? "text-amber-800" : "text-emerald-700"
          }`}
        >
          {mensagem}
        </p>
      ) : null}
      {status === "falha" ? (
        <button
          type="button"
          className="text-xs font-semibold text-zinc-700 underline"
          onClick={() => void imprimir()}
        >
          Tentar novamente
        </button>
      ) : null}
    </div>
  );
}
