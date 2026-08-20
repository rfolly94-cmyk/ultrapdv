"use client";

import { useEffect, useRef, useState } from "react";

import { SuporteMensagem } from "@/components/suporte/suporte-mensagem";
import { SuporteUploadImagem } from "@/components/suporte/suporte-upload-imagem";
import { mesclarMensagemSuporte, nomeCanalConversa } from "@/lib/suporte/regras";
import type { MensagemSuporte } from "@/lib/suporte/tipos";
import { createClient } from "@/lib/supabase/client";

export function SuporteChat({
  conversaId,
  mensagensIniciais,
  usuarioId,
  emptyTitle,
  emptyText,
  onEnviarTexto,
  onEnviarImagem,
  onCarregarAnteriores,
  obterUrl,
  onMensagemRemota,
}: {
  conversaId: string | null;
  mensagensIniciais: MensagemSuporte[];
  usuarioId: string;
  emptyTitle: string;
  emptyText: string;
  onEnviarTexto: (texto: string) => Promise<{ ok: boolean; mensagem?: MensagemSuporte; erro?: string }>;
  onEnviarImagem: (arquivo: File) => Promise<{ ok: boolean; mensagem?: MensagemSuporte; erro?: string }>;
  onCarregarAnteriores?: (antesDe: string) => Promise<MensagemSuporte[]>;
  obterUrl: (path: string) => Promise<string | null>;
  onMensagemRemota?: (mensagem: MensagemSuporte) => void;
}) {
  const [mensagens, setMensagens] = useState(mensagensIniciais);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const listaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMensagens(mensagensIniciais);
  }, [conversaId, mensagensIniciais]);

  useEffect(() => {
    const el = listaRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [mensagens.length, conversaId]);

  useEffect(() => {
    if (!conversaId) {
      return;
    }
    const supabase = createClient();
    const canal = supabase
      .channel(nomeCanalConversa(conversaId))
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "suporte_mensagens",
          filter: `conversa_id=eq.${conversaId}`,
        },
        (payload) => {
          const nova = payload.new as MensagemSuporte;
          setMensagens((atuais) => mesclarMensagemSuporte(atuais, nova));
          onMensagemRemota?.(nova);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(canal);
    };
  }, [conversaId, onMensagemRemota]);

  async function enviarTexto() {
    const valor = texto.trim();
    if (!valor || enviando) {
      return;
    }
    setEnviando(true);
    setErro("");
    const resultado = await onEnviarTexto(valor);
    setEnviando(false);
    if (!resultado.ok) {
      setErro(resultado.erro || "Não foi possível enviar.");
      return;
    }
    setTexto("");
    if (resultado.mensagem) {
      setMensagens((atuais) => mesclarMensagemSuporte(atuais, resultado.mensagem!));
    }
    inputRef.current?.focus();
  }

  async function enviarImagem(arquivo: File) {
    if (enviando) {
      return;
    }
    setEnviando(true);
    setErro("");
    const resultado = await onEnviarImagem(arquivo);
    setEnviando(false);
    if (!resultado.ok) {
      setErro(resultado.erro || "Não foi possível enviar a imagem.");
      return;
    }
    if (resultado.mensagem) {
      setMensagens((atuais) => mesclarMensagemSuporte(atuais, resultado.mensagem!));
    }
    inputRef.current?.focus();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={listaRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {onCarregarAnteriores && mensagens[0] ? (
          <button
            type="button"
            className="mx-auto block text-xs text-zinc-500 hover:underline"
            onClick={async () => {
              const anteriores = await onCarregarAnteriores(mensagens[0].created_at);
              setMensagens((atuais) => {
                const ids = new Set(atuais.map((item) => item.id));
                return [...anteriores.filter((item) => !ids.has(item.id)), ...atuais];
              });
            }}
          >
            Carregar mensagens anteriores
          </button>
        ) : null}
        {mensagens.length === 0 ? (
          <div className="px-2 py-8 text-center">
            <p className="font-medium text-zinc-900">{emptyTitle}</p>
            <p className="mt-1 text-sm text-zinc-500">{emptyText}</p>
          </div>
        ) : (
          mensagens.map((mensagem) => (
            <SuporteMensagem
              key={mensagem.id}
              mensagem={mensagem}
              propria={mensagem.remetente_usuario_id === usuarioId}
              obterUrl={obterUrl}
            />
          ))
        )}
      </div>

      <div className="border-t border-zinc-200 p-3">
        {erro ? <p className="mb-2 text-xs text-red-600">{erro}</p> : null}
        {enviando ? (
          <p className="mb-2 text-xs text-zinc-500">Enviando...</p>
        ) : null}
        <div className="flex items-end gap-2">
          <SuporteUploadImagem disabled={enviando} onArquivo={enviarImagem} />
          <textarea
            ref={inputRef}
            value={texto}
            rows={1}
            disabled={enviando}
            placeholder="Digite sua mensagem..."
            className="updv-input min-h-10 flex-1 resize-none py-2"
            onChange={(event) => setTexto(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void enviarTexto();
              }
            }}
          />
          <button
            type="button"
            disabled={enviando || !texto.trim()}
            className="updv-btn updv-btn-primary"
            onClick={() => void enviarTexto()}
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
