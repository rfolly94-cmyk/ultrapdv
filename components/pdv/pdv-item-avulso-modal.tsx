"use client";

import { useEffect, useRef, useState } from "react";

import { CampoValor } from "@/components/ui/campo-valor";
import {
  validarFormularioItemAvulso,
} from "@/lib/pdv/item-avulso";

export function PdvItemAvulsoModal({
  onCancelar,
  onConfirmar,
}: {
  onCancelar: () => void;
  onConfirmar: (item: {
    descricao: string;
    quantidade: number;
    valorUnitarioCentavos: number;
  }) => void;
}) {
  const descricaoRef = useRef<HTMLInputElement>(null);
  const [descricao, setDescricao] = useState("");
  const [quantidadeTexto, setQuantidadeTexto] = useState("1");
  const [valorUnitarioTexto, setValorUnitarioTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    descricaoRef.current?.focus();
  }, []);

  function confirmar() {
    const validado = validarFormularioItemAvulso({
      descricao,
      quantidadeTexto,
      valorUnitarioTexto,
    });
    if (!validado.ok) {
      setErro(validado.erro);
      return;
    }
    onConfirmar({
      descricao: validado.descricao,
      quantidade: validado.quantidade,
      valorUnitarioCentavos: validado.valorUnitarioCentavos,
    });
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Fechar"
        className="absolute inset-0 bg-black/40"
        onClick={onCancelar}
      />
      <form
        className="pdv-modal-box relative z-10 w-full max-w-md rounded-2xl p-5 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          confirmar();
        }}
      >
        <h2 className="text-xl font-bold">Item avulso</h2>
        <p className="pdv-muted mt-1 text-sm">
          Vende sem cadastrar produto e sem movimentar estoque.
        </p>

        <label className="mt-4 block text-sm font-medium">
          Descrição *
          <input
            ref={descricaoRef}
            value={descricao}
            onChange={(event) => setDescricao(event.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--pdv-border)] bg-[var(--pdv-input)] px-3 py-2 text-sm outline-none"
            required
          />
        </label>

        <label className="mt-3 block text-sm font-medium">
          Quantidade *
          <CampoValor
            value={quantidadeTexto}
            onChange={(event) => setQuantidadeTexto(event.target.value)}
            inputMode="decimal"
            className="mt-1 w-full rounded-md border border-[var(--pdv-border)] bg-[var(--pdv-input)] px-3 py-2 text-sm outline-none"
          />
        </label>

        <label className="mt-3 block text-sm font-medium">
          Valor unitário *
          <CampoValor
            value={valorUnitarioTexto}
            onChange={(event) => setValorUnitarioTexto(event.target.value)}
            inputMode="decimal"
            className="mt-1 w-full rounded-md border border-[var(--pdv-border)] bg-[var(--pdv-input)] px-3 py-2 text-sm outline-none"
            placeholder="0,00"
          />
        </label>

        {erro ? <p className="mt-3 text-sm text-red-600">{erro}</p> : null}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            className="rounded-md px-3 py-2 text-sm font-medium hover:bg-[var(--pdv-hover)]"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="pdv-btn-primary rounded-md px-4 py-2 text-sm font-semibold"
          >
            Adicionar
          </button>
        </div>
      </form>
    </div>
  );
}
