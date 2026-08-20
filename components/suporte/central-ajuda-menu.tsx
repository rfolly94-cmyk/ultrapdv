"use client";

import { Sparkles, MessageCircle } from "lucide-react";

export function CentralAjudaMenu({
  onSuporte,
}: {
  onSuporte: () => void;
}) {
  return (
    <div className="w-72 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl">
      <div className="border-b border-zinc-100 px-4 py-3">
        <p className="text-sm font-semibold text-zinc-950">Central de Ajuda</p>
      </div>
      <div className="p-2">
        <div
          className="flex cursor-not-allowed items-start gap-3 rounded-xl px-3 py-2.5 opacity-60"
          aria-disabled="true"
        >
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
          <div>
            <p className="text-sm font-medium text-zinc-700">Assistente IA</p>
            <p className="text-xs text-zinc-500">Em breve</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onSuporte}
          className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-zinc-50"
        >
          <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-700" />
          <div>
            <p className="text-sm font-medium text-zinc-900">Falar com o Suporte</p>
            <p className="text-xs text-zinc-500">Chat com a equipe UltraPDV</p>
          </div>
        </button>
      </div>
    </div>
  );
}
