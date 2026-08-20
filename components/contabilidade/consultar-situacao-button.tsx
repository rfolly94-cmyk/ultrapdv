"use client";

import { useState } from "react";

export function ConsultarSituacaoButton({
  emissaoId,
}: {
  emissaoId: string;
}) {
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function consultar() {
    setEnviando(true);
    setMensagem(null);

    try {
      const resposta = await fetch(
        `/api/fiscal/emissoes/${emissaoId}/reconciliar`,
        { method: "POST" }
      );
      const json = (await resposta.json()) as {
        ok?: boolean;
        erro?: string;
        status?: string;
      };

      setMensagem(
        json.ok
          ? `Situação: ${json.status ?? "atualizada"}`
          : json.erro ?? "Não foi possível consultar."
      );
    } catch {
      setMensagem("Falha ao consultar a situação fiscal.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={consultar}
        disabled={enviando}
        className="updv-btn-row"
      >
        {enviando ? "Consultando…" : "Consultar"}
      </button>
      {mensagem && (
        <span className="max-w-[220px] truncate text-[11px] text-zinc-500">
          {mensagem}
        </span>
      )}
    </span>
  );
}
