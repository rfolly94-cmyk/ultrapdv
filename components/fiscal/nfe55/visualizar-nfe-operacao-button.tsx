"use client";

import { useState } from "react";

import {
  NfePreviewDialog,
  type RespostaPreviewNfe,
} from "@/components/fiscal/nfe55/nfe-preview-dialog";

type ResultadoAntes = {
  ok: true;
  operacaoId: string;
} | {
  ok: false;
  erro: string;
  pendencias?: string[];
};

type Props = {
  operacaoId: string;
  disabled?: boolean;
  antesDePreview: () => Promise<ResultadoAntes>;
};

export function VisualizarNfeOperacaoButton({
  operacaoId,
  disabled,
  antesDePreview,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [resposta, setResposta] = useState<RespostaPreviewNfe | null>(null);

  async function visualizar() {
    setAberto(true);
    setCarregando(true);
    setResposta(null);
    try {
      const salvo = await antesDePreview();
      if (!salvo.ok) {
        setResposta({
          ok: false,
          preview: true,
          transmitido: false,
          numeroReservado: false,
          pronta: false,
          mensagem: "NF-e ainda não está pronta para emissão",
          erro: salvo.erro,
          pendencias: salvo.pendencias?.length ? salvo.pendencias : [salvo.erro],
        });
        return;
      }
      const response = await fetch(
        `/api/fiscal/geranet/nfe-preview-operacao?operacaoId=${encodeURIComponent(salvo.operacaoId || operacaoId)}`,
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
        disabled={disabled || carregando}
        className="updv-btn updv-btn-ghost"
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
