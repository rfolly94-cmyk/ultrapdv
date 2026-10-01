"use client";

import { useState } from "react";

import {
  NfePreviewDialog,
  type RespostaPreviewNfe,
} from "@/components/fiscal/nfe55/nfe-preview-dialog";

type Props = {
  vendaId: string;
  serie?: number;
};

export function VisualizarNfeVendaButton({ vendaId, serie }: Props) {
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [resposta, setResposta] = useState<RespostaPreviewNfe | null>(null);

  async function visualizar() {
    setAberto(true);
    setCarregando(true);
    setResposta(null);
    try {
      const params = new URLSearchParams({ vendaId });
      if (serie != null) {
        params.set("serie", String(serie));
      }
      const response = await fetch(
        `/api/fiscal/geranet/nfe-preview-venda?${params.toString()}`,
        { method: "GET" }
      );
      const data = (await response.json()) as RespostaPreviewNfe;
      setResposta(data);
    } catch (error) {
      setResposta({
        ok: false,
        preview: true,
        transmitido: false,
        numeroReservado: false,
        mensagem: "NF-e ainda não está pronta para emissão",
        erro:
          error instanceof Error
            ? error.message
            : "Não foi possível montar a pré-visualização.",
        pendencias: ["Não foi possível montar a pré-visualização."],
      });
    } finally {
      setCarregando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void visualizar()}
        disabled={carregando}
        className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 disabled:opacity-60"
      >
        {carregando ? "Montando prévia..." : "Visualizar NF-e"}
      </button>
      <NfePreviewDialog
        aberto={aberto}
        carregando={carregando}
        resposta={resposta}
        onFechar={() => setAberto(false)}
      />
    </>
  );
}
