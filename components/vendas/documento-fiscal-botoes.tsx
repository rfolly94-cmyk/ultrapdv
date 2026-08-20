"use client";

import { useState } from "react";

type Props = {
  emissaoId: string;
  modelo: string;
  compacto?: boolean;
  empilhado?: boolean;
  somente?: "pdf" | "xml" | "ambos";
};

function rotuloDanfe(modelo: string) {
  return modelo === "65" ? "Abrir DANFC-e" : "Abrir DANFE";
}

async function baixarDocumento(
  emissaoId: string,
  tipo: "xml" | "pdf"
) {
  const download = tipo === "xml" ? "&download=1" : "";
  const response = await fetch(
    `/api/fiscal/emissoes/${emissaoId}/arquivo?tipo=${tipo}${download}`
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      erro?: string;
    } | null;
    throw new Error(
      payload?.erro ??
        (tipo === "pdf"
          ? "Não foi possível recuperar o DANFE. O XML autorizado também não está disponível."
          : "Não foi possível recuperar o XML autorizado.")
    );
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  if (tipo === "pdf") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  const ancora = document.createElement("a");
  ancora.href = url;
  ancora.download =
    response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ??
    `documento.${tipo}`;
  ancora.click();
}

export function DocumentoFiscalBotoes({
  emissaoId,
  modelo,
  compacto = false,
  empilhado = false,
  somente = "ambos",
}: Props) {
  const [carregando, setCarregando] = useState<"pdf" | "xml" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function abrir(tipo: "xml" | "pdf") {
    setCarregando(tipo);
    setErro(null);

    try {
      await baixarDocumento(emissaoId, tipo);
    } catch (error) {
      setErro(
        error instanceof Error
          ? error.message
          : "Não foi possível obter o documento fiscal."
      );
    } finally {
      setCarregando(null);
    }
  }

  const classe = compacto
    ? "updv-btn-row"
    : "inline-flex h-10 items-center justify-center rounded-xl px-4 text-sm font-semibold";

  return (
    <div className="flex w-full flex-col items-start gap-2">
      <div className={`flex w-full gap-2 ${empilhado ? "flex-col" : "flex-wrap"}`}>
        {somente !== "xml" && (
          <button
            type="button"
            disabled={carregando !== null}
            onClick={() => abrir("pdf")}
            className={`${classe} bg-zinc-950 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {carregando === "pdf"
              ? compacto
                ? "Gerando..."
                : "Gerando documento fiscal..."
              : rotuloDanfe(modelo)}
          </button>
        )}

        {somente !== "pdf" && (
          <button
            type="button"
            disabled={carregando !== null}
            onClick={() => abrir("xml")}
            className={`${classe} border border-zinc-300 bg-white text-zinc-800 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {carregando === "xml" ? "Recuperando XML..." : "Baixar XML"}
          </button>
        )}
      </div>

      {erro && (
        <p className="max-w-sm text-xs text-red-700">{erro}</p>
      )}
    </div>
  );
}
