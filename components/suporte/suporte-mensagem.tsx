"use client";

import { useEffect, useState } from "react";

import type { MensagemSuporte } from "@/lib/suporte/tipos";
import { formatarDataHora } from "@/lib/relatorios/formatacao";

export function SuporteMensagem({
  mensagem,
  propria,
  obterUrl,
}: {
  mensagem: MensagemSuporte;
  propria: boolean;
  obterUrl: (path: string) => Promise<string | null>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (mensagem.tipo !== "imagem" || !mensagem.arquivo_path) {
      return;
    }
    let ativo = true;
    obterUrl(mensagem.arquivo_path).then((assinada) => {
      if (ativo) {
        setUrl(assinada);
        setErro(!assinada);
      }
    });
    return () => {
      ativo = false;
    };
  }, [mensagem.arquivo_path, mensagem.tipo, obterUrl]);

  return (
    <div className={`flex ${propria ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
          propria
            ? "bg-zinc-900 text-white"
            : "bg-zinc-100 text-zinc-900"
        }`}
      >
        {mensagem.tipo === "imagem" ? (
          <div>
            {url ? (
              <button
                type="button"
                className="block overflow-hidden rounded-lg"
                onClick={() => setPreview(true)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt="Imagem enviada no suporte"
                  className="max-h-40 w-auto"
                />
              </button>
            ) : (
              <p className="text-xs opacity-80">
                {erro ? "Não foi possível abrir a imagem." : "Carregando imagem..."}
              </p>
            )}
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words">{mensagem.texto}</p>
        )}
        <p className={`mt-1 text-[10px] ${propria ? "text-zinc-300" : "text-zinc-500"}`}>
          {formatarDataHora(mensagem.created_at)}
        </p>
      </div>

      {preview && url ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setPreview(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="Pré-visualização da imagem do suporte"
            className="max-h-[90vh] max-w-[90vw] rounded-lg"
          />
        </div>
      ) : null}
    </div>
  );
}
