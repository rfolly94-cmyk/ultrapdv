"use client";

import { useEffect, useRef, useState } from "react";

import { descobrirUltraPdvConector } from "@/lib/impressao/descobrir";
import { aplicarRespostaMenu } from "@/lib/pdv/tef/regras";

type MenuTef = {
  id: string;
  solicitacaoId: string;
  titulo: string;
  opcoes: string[];
};

type RespostaMenu = { ok?: boolean; erro?: string; menu?: MenuTef | null };

/**
 * Apenas a interface dos menus interativos. Não inicia, confirma ou desfaz
 * transações. A autorização e a terceira perna exigem fluxo de venda próprio.
 */
export function TefMenuPdv({ origem = null }: { origem?: string | null }) {
  const [base, setBase] = useState<string | null>(origem);
  const [menu, setMenu] = useState<MenuTef | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const ultimaSolicitacao = useRef<string | null>(null);

  useEffect(() => {
    setBase(origem);
  }, [origem]);

  useEffect(() => {
    if (base) {
      return;
    }
    let ativo = true;
    void descobrirUltraPdvConector().then((descoberta) => {
      if (ativo && descoberta.ok) {
        setBase(descoberta.origem);
      }
    });
    return () => {
      ativo = false;
    };
  }, [base]);

  useEffect(() => {
    if (!base) {
      return;
    }
    let ativo = true;
    let requisicaoEmAndamento = false;
    const consultar = async () => {
      if (requisicaoEmAndamento) return;
      requisicaoEmAndamento = true;
      try {
        const resposta = await fetch(`${base}/tef/menu`, {
          cache: "no-store",
          signal: AbortSignal.timeout(2500),
        });
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
        const dados = (await resposta.json()) as RespostaMenu;
        if (!ativo) return;
        const proximo = dados.menu ?? null;
        setMenu(proximo);
        if (proximo && proximo.solicitacaoId !== ultimaSolicitacao.current) {
          ultimaSolicitacao.current = proximo.solicitacaoId;
          setErro(null);
        }
      } catch {
        if (ativo) setMenu(null);
      } finally {
        requisicaoEmAndamento = false;
      }
    };
    void consultar();
    const timer = setInterval(() => void consultar(), 700);
    return () => {
      ativo = false;
      clearInterval(timer);
    };
  }, [base]);

  async function responder(indice: number) {
    if (!menu || !base || ocupado) return;
    const menuAtual = menu;
    if (
      !aplicarRespostaMenu(menuAtual, {
        solicitacaoId: menuAtual.solicitacaoId,
        indice,
      }).aplicar
    ) {
      return;
    }
    setOcupado(true);
    setErro(null);
    try {
      const resposta = await fetch(`${base}/tef/menu/responder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: menuAtual.id,
          solicitacaoId: menuAtual.solicitacaoId,
          indice,
        }),
        signal: AbortSignal.timeout(5000),
      });
      const dados = (await resposta.json()) as RespostaMenu;
      if (!resposta.ok || !dados.ok) {
        throw new Error(dados.erro || "Resposta recusada pelo Connector.");
      }
      setMenu((atual) =>
        atual?.solicitacaoId === menuAtual.solicitacaoId ? null : atual
      );
    } catch (e) {
      setErro(
        e instanceof Error ? e.message : "Não foi possível responder ao menu TEF."
      );
    } finally {
      setOcupado(false);
    }
  }

  if (!menu) return null;

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-label="Escolha solicitada pelo TEF"
      onKeyDown={(e) => e.stopPropagation()}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">
          PayGoWeb · TEF
        </p>
        <h2 className="mt-2 text-xl font-bold text-zinc-900">
          {menu.titulo?.trim() || "Escolha uma opção"}
        </h2>
        <p className="mt-2 text-sm text-zinc-600">
          Selecione a opção solicitada pelo terminal. Não feche esta janela durante a operação.
        </p>
        <div className="mt-5 space-y-2">
          {menu.opcoes.map((opcao, indice) => (
            <button
              key={`${menu.solicitacaoId}-${indice}`}
              type="button"
              autoFocus={indice === 0}
              disabled={ocupado}
              onClick={() => void responder(indice)}
              className="w-full rounded-lg border border-zinc-300 px-4 py-3 text-left font-semibold text-zinc-900 hover:border-blue-600 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {opcao}
            </button>
          ))}
        </div>
        {erro && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {erro}
          </p>
        )}
        <p className="mt-4 text-xs text-zinc-500">
          Este menu não confirma pagamentos. A confirmação financeira depende do fechamento seguro da venda.
        </p>
      </div>
    </section>
  );
}
