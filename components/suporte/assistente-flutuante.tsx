"use client";

import { MessageCircle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AssistenteIaPainel } from "@/components/ia/assistente-ia-painel";
import { CentralAjudaMenu } from "@/components/suporte/central-ajuda-menu";
import { SuporteChat } from "@/components/suporte/suporte-chat";
import {
  carregarMensagensAnteriores,
  carregarPainelSuporte,
  enviarImagemSuporte,
  enviarMensagemSuporte,
  marcarLeituraSuporte,
  salvarPosicaoAssistente,
  urlAssinadaImagemSuporte,
} from "@/app/suporte/actions";
import {
  MEDIDAS_ASSISTENTE,
  pixelsDaPosicaoAssistente,
  posicaoAssistenteDePixels,
} from "@/lib/suporte/posicao";
import { POSICAO_ASSISTENTE_PADRAO, type MensagemSuporte, type PosicaoAssistente } from "@/lib/suporte/tipos";
import { nomeCanalConversa } from "@/lib/suporte/regras";
import { createClient } from "@/lib/supabase/client";

const LIMIAR_ARRASTE = 6;

export function AssistenteFlutuante() {
  const [aberto, setAberto] = useState<"menu" | "chat" | "ia" | null>(null);
  const [perguntaIa, setPerguntaIa] = useState<string | null>(null);
  const [posicao, setPosicao] = useState<PosicaoAssistente>(POSICAO_ASSISTENTE_PADRAO);
  const [xy, setXy] = useState({ x: 0, y: 0 });
  const [naoLidas, setNaoLidas] = useState(0);
  const [toast, setToast] = useState("");
  const [usuarioId, setUsuarioId] = useState("");
  const [pronto, setPronto] = useState(false);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<MensagemSuporte[]>([]);
  const arraste = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moveu: boolean;
  } | null>(null);

  const aplicarPosicao = useCallback((proxima: PosicaoAssistente) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    setPosicao(proxima);
    setXy(pixelsDaPosicaoAssistente(proxima, viewport));
  }, []);

  useEffect(() => {
    let ativo = true;
    void carregarPainelSuporte().then((painel) => {
      if (!ativo) {
        return;
      }
      if (painel.ok) {
        setUsuarioId(painel.usuarioId ?? "");
        setConversaId(painel.conversa?.id ?? null);
        setMensagens(painel.mensagens);
        setNaoLidas(painel.naoLidas);
        aplicarPosicao(painel.posicao);
      } else {
        aplicarPosicao(POSICAO_ASSISTENTE_PADRAO);
      }
      setPronto(true);
    });
    return () => {
      ativo = false;
    };
  }, [aplicarPosicao]);

  useEffect(() => {
    function ajustar() {
      aplicarPosicao(posicao);
    }
    window.addEventListener("resize", ajustar);
    return () => window.removeEventListener("resize", ajustar);
  }, [aplicarPosicao, posicao]);

  useEffect(() => {
    function abrirIa(evento: Event) {
      const detalhe = (evento as CustomEvent<{ pergunta?: string }>).detail;
      setPerguntaIa(detalhe?.pergunta ?? "Analise este produto.");
      setAberto("ia");
    }
    window.addEventListener("ultrapdv:abrir-assistente-ia", abrirIa);
    return () => {
      window.removeEventListener("ultrapdv:abrir-assistente-ia", abrirIa);
    };
  }, []);

  useEffect(() => {
    if (!conversaId || aberto === "chat") {
      return;
    }
    const supabase = createClient();
    const canal = supabase
      .channel(`${nomeCanalConversa(conversaId)}-badge`)
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
          if (nova.remetente_tipo !== "master") {
            return;
          }
          setNaoLidas((atual) => atual + 1);
          setToast("Nova mensagem do Suporte");
          window.setTimeout(() => setToast(""), 4000);
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [conversaId, aberto]);

  const obterUrl = useCallback(async (path: string) => {
    if (!conversaId) {
      return null;
    }
    const resultado = await urlAssinadaImagemSuporte(path, conversaId);
    return resultado.ok ? resultado.url : null;
  }, [conversaId]);

  async function abrirChat() {
    const painel = await carregarPainelSuporte();
    if (painel.ok) {
      setUsuarioId(painel.usuarioId ?? "");
      setConversaId(painel.conversa?.id ?? null);
      setMensagens(painel.mensagens);
      setNaoLidas(0);
      if (painel.conversa?.id) {
        await marcarLeituraSuporte(painel.conversa.id);
      }
    }
    setAberto("chat");
  }

  if (!pronto) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-50 print:hidden">
      {toast ? (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-md bg-zinc-900 px-3 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      ) : null}

      {aberto === "menu" ? (
        <div
          className="pointer-events-auto absolute"
          style={{
            left: Math.min(xy.x, window.innerWidth - 300),
            top: Math.max(12, xy.y - 220),
          }}
        >
          <CentralAjudaMenu
            onSuporte={() => void abrirChat()}
            onAssistente={() => {
              setPerguntaIa(null);
              setAberto("ia");
            }}
          />
        </div>
      ) : null}

      {aberto === "ia" ? (
        <div className="pointer-events-auto absolute inset-x-3 bottom-3 top-auto h-[min(72vh,560px)] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl sm:inset-auto sm:bottom-auto sm:right-4 sm:top-4 sm:h-[min(80vh,640px)] sm:w-[380px]">
          <AssistenteIaPainel
            onFechar={() => {
              setAberto(null);
              setPerguntaIa(null);
            }}
            perguntaInicial={perguntaIa}
          />
        </div>
      ) : null}

      {aberto === "chat" ? (
        <div className="pointer-events-auto absolute inset-x-3 bottom-3 top-auto h-[min(72vh,560px)] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl sm:inset-auto sm:bottom-auto sm:right-4 sm:top-4 sm:h-[min(80vh,640px)] sm:w-[380px]">
          <div className="flex h-12 items-center justify-between border-b border-zinc-200 px-4">
            <div>
              <p className="text-sm font-semibold">Suporte UltraPDV</p>
              <p className="text-[11px] text-zinc-500">Fale com nossa equipe de suporte</p>
            </div>
            <button
              type="button"
              className="updv-btn updv-btn-icon updv-btn-ghost"
              aria-label="Fechar suporte"
              onClick={() => setAberto(null)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="h-[calc(100%-48px)]">
            <SuporteChat
              conversaId={conversaId}
              mensagensIniciais={mensagens}
              usuarioId={usuarioId}
              emptyTitle="Precisa de ajuda?"
              emptyText="Envie uma mensagem para nossa equipe."
              obterUrl={obterUrl}
              onCarregarAnteriores={async (antesDe) => {
                if (!conversaId) {
                  return [];
                }
                const resultado = await carregarMensagensAnteriores(conversaId, antesDe);
                return resultado.ok ? resultado.mensagens : [];
              }}
              onEnviarTexto={async (texto) => {
                const resultado = await enviarMensagemSuporte(texto);
                if (resultado.ok) {
                  setConversaId(resultado.conversa.id);
                }
                return resultado;
              }}
              onEnviarImagem={async (arquivo) => {
                const data = new FormData();
                data.set("arquivo", arquivo);
                const resultado = await enviarImagemSuporte(data);
                if (resultado.ok) {
                  setConversaId(resultado.conversa.id);
                }
                return resultado;
              }}
              onMensagemRemota={(mensagem) => {
                if (mensagem.remetente_tipo === "master") {
                  setToast("Nova mensagem do Suporte");
                  window.setTimeout(() => setToast(""), 4000);
                  if (conversaId) {
                    void marcarLeituraSuporte(conversaId);
                  }
                }
              }}
            />
          </div>
        </div>
      ) : null}

      <button
        type="button"
        aria-label="Abrir Central de Ajuda"
        className="pointer-events-auto absolute flex h-14 w-14 items-center justify-center rounded-full bg-zinc-900 text-white shadow-lg hover:bg-zinc-800"
        style={{ left: xy.x, top: xy.y, touchAction: "none" }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          arraste.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            origX: xy.x,
            origY: xy.y,
            moveu: false,
          };
        }}
        onPointerMove={(event) => {
          const estado = arraste.current;
          if (!estado || estado.pointerId !== event.pointerId) {
            return;
          }
          const dx = event.clientX - estado.startX;
          const dy = event.clientY - estado.startY;
          if (Math.hypot(dx, dy) > LIMIAR_ARRASTE) {
            estado.moveu = true;
          }
          if (!estado.moveu) {
            return;
          }
          const maxX = window.innerWidth - MEDIDAS_ASSISTENTE.tamanhoBotao - MEDIDAS_ASSISTENTE.margem;
          const maxY = window.innerHeight - MEDIDAS_ASSISTENTE.tamanhoBotao - MEDIDAS_ASSISTENTE.margem;
          setXy({
            x: Math.min(maxX, Math.max(MEDIDAS_ASSISTENTE.margem, estado.origX + dx)),
            y: Math.min(maxY, Math.max(MEDIDAS_ASSISTENTE.margem, estado.origY + dy)),
          });
        }}
        onPointerUp={(event) => {
          const estado = arraste.current;
          arraste.current = null;
          if (!estado || estado.pointerId !== event.pointerId) {
            return;
          }
          if (!estado.moveu) {
            setAberto((atual) => (atual ? null : "menu"));
            return;
          }
          const proxima = posicaoAssistenteDePixels(xy.x, xy.y, {
            width: window.innerWidth,
            height: window.innerHeight,
          });
          aplicarPosicao(proxima);
          void salvarPosicaoAssistente(proxima);
        }}
      >
        <MessageCircle className="h-6 w-6" />
        {naoLidas > 0 && aberto !== "chat" ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-semibold">
            {naoLidas}
          </span>
        ) : null}
      </button>
    </div>
  );
}
