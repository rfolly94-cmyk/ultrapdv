"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Wallet } from "lucide-react";

import { abrirCaixa } from "@/app/caixa/actions";
import { parseValorCaixa } from "@/lib/caixa/valor";
import {
  MENSAGEM_CAIXA_FECHADO_PDV,
  MENSAGEM_CAIXA_FECHADO_SEM_PERMISSAO,
} from "@/lib/caixa/mensagens";
import { PageAlert } from "@/components/ui/page-alert";

export function PdvCaixaFechado({
  podeAbrir,
  onSair,
  variante = "overlay",
  rotuloContexto = "PDV bloqueado",
  mensagem = MENSAGEM_CAIXA_FECHADO_PDV,
  rotuloSair = "Sair do PDV",
}: {
  podeAbrir: boolean;
  onSair: () => void;
  variante?: "overlay" | "painel";
  rotuloContexto?: string;
  mensagem?: string;
  rotuloSair?: string;
}) {
  const router = useRouter();
  const [saldo, setSaldo] = useState("");
  const [observacao, setObservacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const painel = variante === "painel";

  function confirmarAbertura() {
    const valor = parseValorCaixa(saldo);
    if (valor === null) {
      setErro("Informe o saldo inicial em dinheiro.");
      return;
    }
    if (valor < 0) {
      setErro("O saldo inicial não pode ser negativo.");
      return;
    }

    startTransition(async () => {
      const resultado = await abrirCaixa({
        saldoInicial: saldo,
        observacao,
      });
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      router.refresh();
    });
  }

  const corpo = (
    <div className={painel ? "w-full max-w-md" : "w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"}>
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-800">
        <Wallet className="h-7 w-7" aria-hidden />
      </div>

      <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-amber-800">
        {rotuloContexto}
      </p>

      <h2
        id="pdv-caixa-fechado-titulo"
        className="mt-1 text-2xl font-bold text-zinc-950"
      >
        Caixa fechado
      </h2>

      <p className="mt-3 text-sm text-zinc-600">
        {mensagem}
      </p>

      {podeAbrir ? (
        <div className="mt-5 space-y-3">
          {erro ? (
            <PageAlert type="erro" className="mx-0 mt-0">
              {erro}
            </PageAlert>
          ) : null}

          <label className="block text-[13px]">
            <span className="text-xs font-medium text-zinc-600">
              Saldo inicial em dinheiro
            </span>
            <input
              value={saldo}
              onChange={(event) => {
                setSaldo(event.target.value);
                setErro(null);
              }}
              placeholder="0,00"
              inputMode="decimal"
              autoComplete="off"
              className="updv-input mt-1 w-full"
            />
          </label>

          <label className="block text-[13px]">
            <span className="text-xs font-medium text-zinc-600">
              Observação (opcional)
            </span>
            <textarea
              value={observacao}
              onChange={(event) => setObservacao(event.target.value)}
              rows={3}
              className="updv-input mt-1 h-auto w-full py-2"
            />
          </label>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              className="updv-btn updv-btn-primary"
              disabled={pending}
              onClick={confirmarAbertura}
            >
              {pending ? "Abrindo..." : "Abrir Caixa"}
            </button>
            <button
              type="button"
              className="updv-btn updv-btn-ghost"
              onClick={onSair}
            >
              {rotuloSair}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <p className="text-sm font-medium text-zinc-800">
            {MENSAGEM_CAIXA_FECHADO_SEM_PERMISSAO}
          </p>
          <button
            type="button"
            className="updv-btn updv-btn-ghost"
            onClick={onSair}
          >
            {rotuloSair}
          </button>
        </div>
      )}
    </div>
  );

  if (painel) {
    return (
      <div
        className="mb-4 rounded-2xl border border-amber-200 bg-white p-6 shadow-sm"
        role="region"
        aria-labelledby="pdv-caixa-fechado-titulo"
        data-nfe-caixa-fechado="true"
      >
        {corpo}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdv-caixa-fechado-titulo"
      data-pdv-caixa-fechado="true"
    >
      {corpo}
    </div>
  );
}
