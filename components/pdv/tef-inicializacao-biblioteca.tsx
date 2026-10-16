"use client";

import { useState } from "react";

import { PageAlert } from "@/components/ui/page-alert";
import { descobrirUltraPdvConector } from "@/lib/impressao/descobrir";
import {
  corpoInicializacaoExplicita,
  mensagemInicializacaoBiblioteca,
} from "@/lib/pdv/tef/inicializacao-biblioteca";

export function TefInicializacaoBiblioteca() {
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState(false);

  async function inicializar() {
    setOcupado(true);
    setMensagem("");
    setErro(false);
    try {
      const descoberta = await descobrirUltraPdvConector();
      if (!descoberta.ok) {
        throw new Error("UltraPDV Connector não encontrado neste computador.");
      }
      let dispositivoId = descoberta.saude.dispositivoId ?? "";
      if (!dispositivoId) {
        const identidade = await fetch(`${descoberta.origem}/tef/identidade`, {
          cache: "no-store",
        });
        const corpo = (await identidade.json()) as { dispositivoId?: string };
        dispositivoId = corpo.dispositivoId ?? "";
      }
      if (!dispositivoId) {
        throw new Error("Não foi possível identificar este computador.");
      }
      const autorizacao = await fetch("/api/pdv/tef/biblioteca/inicializar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dispositivoId }),
      });
      const acesso = (await autorizacao.json()) as { ok?: boolean; erro?: string };
      if (!autorizacao.ok || acesso.ok !== true) {
        throw new Error(acesso.erro || "A inicialização da PGWebLib foi recusada.");
      }
      const resposta = await fetch(`${descoberta.origem}/tef/inicializar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpoInicializacaoExplicita()),
      });
      const corpo = (await resposta.json()) as {
        ok?: boolean;
        erro?: string;
        tef?: {
          inicializado?: boolean;
          erroInicializacao?: string;
          agente?: { diretorioSelecionado?: string };
        };
      };
      const texto = mensagemInicializacaoBiblioteca({
        ok: corpo.ok,
        erro: corpo.erro || corpo.tef?.erroInicializacao,
        inicializado: corpo.tef?.inicializado,
        diretorioSelecionado: corpo.tef?.agente?.diretorioSelecionado,
      });
      setErro(corpo.ok !== true || corpo.tef?.inicializado !== true);
      setMensagem(texto);
    } catch (error) {
      setErro(true);
      setMensagem(
        error instanceof Error ? error.message : "A PGWebLib não confirmou a inicialização."
      );
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 p-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-900">Inicializar PGWebLib</h2>
        <p className="mt-1 text-sm text-zinc-600">
          O processo do agente pode estar em execução sem a biblioteca inicializada. Este comando
          só envia a inicialização da pasta de produção já instalada. Não inicia pagamento,
          instalação nem manutenção.
        </p>
      </div>
      <button
        type="button"
        className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        disabled={ocupado}
        onClick={() => void inicializar()}
      >
        Inicializar PGWebLib
      </button>
      {mensagem ? (
        <PageAlert type={erro ? "erro" : "sucesso"} className="mx-0 mt-0">
          {mensagem}
        </PageAlert>
      ) : null}
    </section>
  );
}
