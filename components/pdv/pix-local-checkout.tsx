"use client";

import { useState } from "react";

import { formatarValorPixBr } from "@/lib/pagamentos/pix/local-regras";
import {
  MENSAGEM_PIX_ULTRAPASSA_SALDO,
  validarParcelaPixContraSaldo,
} from "@/lib/pdv/pagamentos-teto";

export type PixLocalCheckoutState = {
  formaPagamentoId: string;
  recebimentoId: string;
  txid: string;
  valorCentavos: number;
  payload: string;
  qrCode: string;
  recebedor: string;
  status: "aguardando_confirmacao" | "confirmado_manual";
  confirmadoPorNome?: string | null;
  confirmadoEm?: string | null;
};

type Props = {
  formaPagamentoId: string;
  valorCentavos: number;
  saldoRestanteCentavos: number;
  state: PixLocalCheckoutState | null;
  ocupado: boolean;
  onState: (state: PixLocalCheckoutState | null) => void;
  onErro: (mensagem: string | null) => void;
};

type RespostaGerar = {
  ok?: boolean;
  erro?: string;
  recebimento_id?: string;
  txid?: string;
  valor?: number;
  payload?: string;
  qrCode?: string;
  recebedor?: string;
  status?: string;
};

type RespostaConfirmar = {
  ok?: boolean;
  erro?: string;
  status?: string;
  confirmado_em?: string;
  confirmado_por_nome?: string | null;
};

function horarioLocal(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR");
}

async function chamarPixLocal(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as Record<string, unknown>;
}

export function PixLocalCheckout({
  formaPagamentoId,
  valorCentavos,
  saldoRestanteCentavos,
  state,
  ocupado,
  onState,
  onErro,
}: Props) {
  const [gerando, setGerando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [dialogAberto, setDialogAberto] = useState(false);
  const [verificado, setVerificado] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const valor = valorCentavos / 100;
  const qrCompativel =
    state != null && state.valorCentavos === valorCentavos;

  const pixAcimaDoSaldo = valorCentavos > saldoRestanteCentavos;

  async function gerar() {
    setGerando(true);
    onErro(null);
    try {
      validarParcelaPixContraSaldo({
        valorPixCentavos: valorCentavos,
        saldoRestanteCentavos,
      });
      const data = (await chamarPixLocal("/api/pagamentos/pix/local/gerar", {
        valor,
        saldo_restante_centavos: saldoRestanteCentavos,
      })) as RespostaGerar;

      if (!data.ok || !data.recebimento_id || !data.payload || !data.qrCode) {
        onErro(data.erro ?? "Não foi possível gerar o QR Code PIX.");
        return;
      }

      onState({
        formaPagamentoId,
        recebimentoId: data.recebimento_id,
        txid: data.txid ?? "",
        valorCentavos,
        payload: data.payload,
        qrCode: data.qrCode,
        recebedor: data.recebedor ?? "",
        status: "aguardando_confirmacao",
      });
    } catch (error) {
      onErro(
        error instanceof Error ? error.message : "Falha ao gerar o QR PIX."
      );
    } finally {
      setGerando(false);
    }
  }

  async function confirmar() {
    if (!state || !verificado) {
      return;
    }

    setConfirmando(true);
    onErro(null);
    try {
      const data = (await chamarPixLocal(
        "/api/pagamentos/pix/local/confirmar",
        { recebimento_id: state.recebimentoId }
      )) as RespostaConfirmar;

      if (!data.ok) {
        onErro(data.erro ?? "Não foi possível confirmar o PIX.");
        return;
      }

      onState({
        ...state,
        status: "confirmado_manual",
        confirmadoPorNome: data.confirmado_por_nome,
        confirmadoEm: data.confirmado_em,
      });
      setDialogAberto(false);
      setVerificado(false);
    } catch (error) {
      onErro(
        error instanceof Error ? error.message : "Falha ao confirmar o PIX."
      );
    } finally {
      setConfirmando(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <p className="text-sm font-semibold text-zinc-950">PIX Local / Manual</p>
      <p className="mt-1 text-sm text-zinc-700">
        Valor PIX: {formatarValorPixBr(valor)}
      </p>

      {pixAcimaDoSaldo && (
        <p className="mt-2 text-sm font-semibold text-red-700">
          {MENSAGEM_PIX_ULTRAPASSA_SALDO}
        </p>
      )}

      {!qrCompativel && (
        <button
          type="button"
          disabled={ocupado || gerando || valorCentavos <= 0 || pixAcimaDoSaldo}
          onClick={() => void gerar()}
          className="mt-3 h-10 w-full rounded-md bg-zinc-900 text-sm font-semibold uppercase tracking-wide text-white hover:bg-zinc-800 disabled:bg-zinc-300"
        >
          {gerando ? "Gerando..." : "Gerar QR Code"}
        </button>
      )}

      {qrCompativel && state.status === "aguardando_confirmacao" && (
        <div className="mt-3 space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={state.qrCode}
            alt="QR Code PIX"
            className="mx-auto h-44 w-44 bg-white"
          />
          <p className="text-center text-lg font-bold text-zinc-950">
            {formatarValorPixBr(valor)}
          </p>
          {state.recebedor && (
            <p className="text-center text-xs text-zinc-500">
              Recebedor: {state.recebedor}
            </p>
          )}
          <p className="text-[11px] font-medium text-zinc-600">
            PIX Copia e Cola
          </p>
          <p className="break-all rounded border border-zinc-200 bg-white px-2 py-1 font-mono text-[10px] text-zinc-700">
            {state.payload}
          </p>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(state.payload);
              setCopiado(true);
            }}
            className="text-xs font-semibold text-blue-700"
          >
            {copiado ? "Código copiado" : "Copiar código"}
          </button>
          <p className="text-center text-xs font-medium text-amber-700">
            Status: Aguardando confirmação
          </p>
          <button
            type="button"
            disabled={ocupado}
            onClick={() => {
              setVerificado(false);
              setDialogAberto(true);
            }}
            className="h-10 w-full rounded-md bg-emerald-600 text-sm font-semibold uppercase tracking-wide text-white hover:bg-emerald-700"
          >
            Confirmar recebimento
          </button>
        </div>
      )}

      {qrCompativel && state.status === "confirmado_manual" && (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p className="font-semibold">✓ PIX confirmado manualmente</p>
          <p className="mt-1">{formatarValorPixBr(valor)}</p>
          <p className="mt-2 text-xs">
            Confirmado por: {state.confirmadoPorNome ?? "Operador"}
          </p>
          {state.confirmadoEm && (
            <p className="text-xs">
              Horário: {horarioLocal(state.confirmadoEm)}
            </p>
          )}
        </div>
      )}

      {dialogAberto && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Fechar"
            className="absolute inset-0 bg-black/40"
            onClick={() => !confirmando && setDialogAberto(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-zinc-950">
              Confirmar recebimento PIX?
            </h3>
            <p className="mt-2 text-sm text-zinc-600">
              Confirme somente depois de verificar no aplicativo ou Internet
              Banking que o valor de {formatarValorPixBr(valor)} foi realmente
              creditado.
            </p>
            <label className="mt-4 flex items-start gap-2 text-sm text-zinc-800">
              <input
                type="checkbox"
                checked={verificado}
                onChange={(event) => setVerificado(event.target.checked)}
                className="mt-1"
              />
              Eu verifiquei o recebimento na conta bancária.
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={confirmando}
                onClick={() => setDialogAberto(false)}
                className="rounded-md px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!verificado || confirmando}
                onClick={() => void confirmar()}
                className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-zinc-300"
              >
                {confirmando ? "Confirmando..." : "Confirmar pagamento"}
              </button>
            </div>
            {!verificado && (
              <p className="mt-2 text-[11px] text-zinc-400">
                Marque a verificação para continuar.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
