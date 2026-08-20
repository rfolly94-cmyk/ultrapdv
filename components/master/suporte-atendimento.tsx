"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { SuporteChat } from "@/components/suporte/suporte-chat";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  carregarAtendimentoMaster,
  masterAssumirSuporte,
  masterEncerrarSuporte,
  masterEnviarImagemSuporte,
  masterReabrirSuporte,
  masterResponderSuporte,
  masterUrlAssinadaImagem,
} from "@/app/master/suporte/actions";
import { formatarDataHora } from "@/lib/relatorios/formatacao";
import type { ConversaSuporte, MensagemSuporte } from "@/lib/suporte/tipos";

export function MasterSuporteAtendimento({ conversaId }: { conversaId: string }) {
  const router = useRouter();
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [conversa, setConversa] = useState<ConversaSuporte | null>(null);
  const [atendenteNome, setAtendenteNome] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<MensagemSuporte[]>([]);
  const [usuarioId, setUsuarioId] = useState("");

  const recarregar = useCallback(async () => {
    const resultado = await carregarAtendimentoMaster(conversaId);
    if (!resultado.ok) {
      setErro(resultado.erro);
      setCarregando(false);
      return;
    }
    setErro("");
    setConversa(resultado.conversa);
    setAtendenteNome(resultado.atendenteNome);
    setMensagens(resultado.mensagens);
    setUsuarioId(resultado.masterUsuarioId);
    setCarregando(false);
  }, [conversaId]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const obterUrl = useCallback(async (path: string) => {
    const resultado = await masterUrlAssinadaImagem(path, conversaId);
    return resultado.ok ? resultado.url : null;
  }, [conversaId]);

  async function agir(
    acao: (id: string) => Promise<{ ok: boolean; erro?: string }>
  ) {
    const resultado = await acao(conversaId);
    if (!resultado.ok) {
      setErro(resultado.erro || "Não foi possível atualizar.");
      return;
    }
    await recarregar();
    router.refresh();
  }

  if (carregando) {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500">
        Carregando atendimento...
      </section>
    );
  }

  if (!conversa) {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-red-600">
        {erro || "Atendimento não encontrado."}
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">{conversa.empresa_nome}</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {conversa.usuario_nome} · aberto em {formatarDataHora(conversa.created_at)}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            Atendente: {atendenteNome || "Não assumido"}
          </p>
        </div>
        <StatusBadge status={String(conversa.status)} />
      </div>
      {erro ? <p className="px-5 pt-3 text-sm text-red-600">{erro}</p> : null}
      <div className="flex flex-wrap gap-2 px-5 py-3">
        <button
          type="button"
          className="updv-btn updv-btn-primary"
          onClick={() => void agir(masterAssumirSuporte)}
        >
          Assumir atendimento
        </button>
        {conversa.status === "encerrada" ? (
          <button
            type="button"
            className="updv-btn updv-btn-ghost"
            onClick={() => void agir(masterReabrirSuporte)}
          >
            Reabrir
          </button>
        ) : (
          <button
            type="button"
            className="updv-btn updv-btn-ghost"
            onClick={() => void agir(masterEncerrarSuporte)}
          >
            Encerrar
          </button>
        )}
      </div>
      <div className="h-[480px] border-t border-zinc-100">
        <SuporteChat
          conversaId={conversa.id}
          mensagensIniciais={mensagens}
          usuarioId={usuarioId}
          emptyTitle="Nenhuma mensagem ainda."
          emptyText="Responda o cliente para iniciar o atendimento."
          obterUrl={obterUrl}
          onEnviarTexto={async (texto) => masterResponderSuporte(conversa.id, texto)}
          onEnviarImagem={async (arquivo) => {
            const data = new FormData();
            data.set("conversa_id", conversa.id);
            data.set("arquivo", arquivo);
            return masterEnviarImagemSuporte(data);
          }}
        />
      </div>
    </section>
  );
}
