"use client";

import { useMemo, useState } from "react";

import { CampoValor } from "@/components/ui/campo-valor";
import { formatarMoeda } from "@/lib/relatorios/formatacao";
import {
  CEDULAS_REAIS,
  MOEDAS_REAIS,
  chaveDenominacao,
  totalContadoDinheiro,
  type QuantidadesDinheiro,
} from "@/lib/caixa/contador-dinheiro";

function formatarDenominacao(valor: number) {
  return formatarMoeda(valor);
}

function CampoQuantidade({
  valor,
  quantidade,
  onChange,
}: {
  valor: number;
  quantidade: number;
  onChange: (qtd: number) => void;
}) {
  const subtotal = Math.round(quantidade * valor * 100) / 100;
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 py-2">
      <span className="text-[13px] font-medium text-zinc-800">
        {formatarDenominacao(valor)}
      </span>
      <span className="flex items-center gap-2">
        <CampoValor
          type="number"
          min={0}
          step={1}
          value={quantidade || ""}
          onChange={(event) => {
            const n = Number(event.target.value);
            onChange(Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
          }}
          className="updv-input w-20 text-right"
        />
        <span className="w-24 text-right text-[13px] text-zinc-600">
          {formatarMoeda(subtotal)}
        </span>
      </span>
    </label>
  );
}

export function CaixaContadorDinheiro({
  open,
  onClose,
  onUsar,
}: {
  open: boolean;
  onClose: () => void;
  onUsar: (total: number) => void;
}) {
  const [quantidades, setQuantidades] = useState<QuantidadesDinheiro>({});
  const total = useMemo(
    () => totalContadoDinheiro(quantidades),
    [quantidades]
  );

  if (!open) {
    return null;
  }

  function atualizar(valor: number, qtd: number) {
    setQuantidades((atual) => ({
      ...atual,
      [chaveDenominacao(valor)]: qtd,
    }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-md border border-zinc-200 bg-white shadow-xl">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-200 px-4">
          <h2 className="text-[15px] font-semibold text-zinc-950">
            Contar dinheiro
          </h2>
          <button
            type="button"
            className="updv-btn updv-btn-ghost"
            onClick={onClose}
          >
            Fechar
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          <section className="space-y-2">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-zinc-500">
              Notas
            </h3>
            {CEDULAS_REAIS.map((valor) => (
              <CampoQuantidade
                key={valor}
                valor={valor}
                quantidade={Number(quantidades[chaveDenominacao(valor)] ?? 0)}
                onChange={(qtd) => atualizar(valor, qtd)}
              />
            ))}
          </section>
          <section className="space-y-2">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-zinc-500">
              Moedas
            </h3>
            {MOEDAS_REAIS.map((valor) => (
              <CampoQuantidade
                key={valor}
                valor={valor}
                quantidade={Number(quantidades[chaveDenominacao(valor)] ?? 0)}
                onChange={(qtd) => atualizar(valor, qtd)}
              />
            ))}
          </section>
          <p className="text-[15px] font-semibold text-zinc-950">
            Total contado: {formatarMoeda(total)}
          </p>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-zinc-200 px-4 py-2.5">
          <button type="button" className="updv-btn updv-btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="updv-btn updv-btn-primary"
            onClick={() => {
              onUsar(total);
              setQuantidades({});
              onClose();
            }}
          >
            Usar no fechamento
          </button>
        </div>
      </div>
    </div>
  );
}
