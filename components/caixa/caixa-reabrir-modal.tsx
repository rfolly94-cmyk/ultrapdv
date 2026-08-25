"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { reabrirCaixa } from "@/app/caixa/actions";
import { AppModal } from "@/components/ui/app-modal";
import { PageAlert } from "@/components/ui/page-alert";
import { rotuloStatusDiferencaCaixa, statusDiferencaCaixa } from "@/lib/caixa/conferencia";
import { validarMotivoReabertura } from "@/lib/caixa/reabertura";
import type { CaixaCicloFechamento } from "@/lib/caixa/tipos";
import { formatarDataHora, formatarMoeda } from "@/lib/relatorios/formatacao";

export function ModalReabrirCaixa({
  open,
  onClose,
  caixaId,
  numero,
  ciclo,
  ocultarEsperado,
}: {
  open: boolean;
  onClose: () => void;
  caixaId: string;
  numero: number;
  ciclo: CaixaCicloFechamento | null;
  ocultarEsperado?: boolean;
}) {
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmar() {
    const validado = validarMotivoReabertura(motivo);
    if (!validado.ok) {
      setErro(validado.erro);
      return;
    }
    startTransition(async () => {
      const saida = await reabrirCaixa({
        caixaId,
        motivo: validado.motivo,
      });
      if (!saida.ok) {
        setErro(saida.erro);
        return;
      }
      setMotivo("");
      setErro(null);
      onClose();
      router.refresh();
    });
  }

  const diferenca = ciclo?.diferenca ?? 0;
  const status = statusDiferencaCaixa(diferenca);

  return (
    <AppModal
      open={open}
      title="Reabrir Caixa"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="updv-btn updv-btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="updv-btn updv-btn-primary"
            disabled={pending}
            onClick={confirmar}
          >
            {pending ? "Reabrindo..." : "Confirmar reabertura"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {erro ? (
          <PageAlert type="erro" className="mx-0 mt-0">
            {erro}
          </PageAlert>
        ) : null}
        <p className="text-[13px] text-zinc-600">
          Caixa #{numero}
          {ciclo
            ? ` · Fechado em ${formatarDataHora(ciclo.fechado_em)} por ${
                ciclo.fechado_por_nome || "—"
              }`
            : ""}
        </p>
        {ciclo ? (
          <ul className="space-y-1 text-[13px] text-zinc-700">
            {ocultarEsperado ? null : (
              <li>Dinheiro esperado: {formatarMoeda(ciclo.dinheiro_fisico_esperado)}</li>
            )}
            <li>Dinheiro informado: {formatarMoeda(ciclo.dinheiro_contado)}</li>
            {ocultarEsperado ? null : (
              <li>
                Diferença: {formatarMoeda(ciclo.diferenca)} (
                {rotuloStatusDiferencaCaixa(status)})
              </li>
            )}
          </ul>
        ) : null}
        <label className="block text-[13px] font-medium text-zinc-800">
          Motivo da reabertura
          <textarea
            className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
            rows={3}
            value={motivo}
            onChange={(event) => setMotivo(event.target.value)}
            placeholder="Ex.: lançamento esquecido, recebimento não registrado, correção operacional"
          />
        </label>
      </div>
    </AppModal>
  );
}
