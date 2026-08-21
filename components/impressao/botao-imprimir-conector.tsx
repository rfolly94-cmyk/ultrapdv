"use client";

import { useState } from "react";

import { imprimirUrlPdfNoUltraPdvConector } from "@/lib/impressao/imprimir-pdf";
import { MENSAGEM_CONECTOR_AUSENTE } from "@/lib/impressao/mensagens";

type Props = {
  pdfUrl: string;
  tipoDocumento?: string;
  papel?: string;
  copias?: number;
  impressora?: string | null;
  label?: string;
  className?: string;
  onResultado?: (ok: boolean, mensagem: string) => void;
};

export function BotaoImprimirConector({
  pdfUrl,
  tipoDocumento = "recibo",
  papel = "80mm",
  copias = 1,
  impressora,
  label = "Imprimir",
  className,
  onResultado,
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
      copias,
      impressora,
    });
    if (resultado.ok) {
      setStatus("ok");
      setMensagem(resultado.mensagem);
      onResultado?.(true, resultado.mensagem);
      return;
    }
    setStatus("falha");
    setMensagem(resultado.erro || MENSAGEM_CONECTOR_AUSENTE);
    onResultado?.(false, resultado.erro);
  }

  return (
    <div className="flex flex-col items-stretch gap-1">
      <button
        type="button"
        disabled={status === "imprimindo"}
        onClick={() => void imprimir()}
        className={
          className ??
          "inline-flex h-10 items-center justify-center rounded-xl bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {status === "imprimindo" ? "Enviando..." : label}
      </button>
      {mensagem ? (
        <p
          className={`max-w-xs whitespace-pre-line text-xs ${
            status === "falha" ? "text-amber-800" : "text-emerald-700"
          }`}
        >
          {mensagem}
        </p>
      ) : null}
      {status === "falha" ? (
        <button
          type="button"
          className="text-left text-xs font-semibold text-zinc-700 underline"
          onClick={() => void imprimir()}
        >
          Tentar novamente
        </button>
      ) : null}
    </div>
  );
}
