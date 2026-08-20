"use client";

import { useEffect, useRef, useState } from "react";

import {
  intervaloPollingPixGeranet,
  devePararPollingPixGeranet,
  MENSAGEM_PIX_GERANET_AGUARDANDO,
  MENSAGEM_PIX_GERANET_DESCARTAR,
  MENSAGEM_PIX_GERANET_DIVERGENCIA,
  MENSAGEM_PIX_GERANET_INDETERMINADO,
  MENSAGEM_PIX_GERANET_REDE,
  srcQrPix,
} from "@/lib/pagamentos/pix/geranet-regras";
import { formatarValorPixBr } from "@/lib/pagamentos/pix/local-regras";
import {
  MENSAGEM_PIX_ULTRAPASSA_SALDO,
  validarParcelaPixContraSaldo,
} from "@/lib/pdv/pagamentos-teto";

export type PixGeranetCheckoutState = {
  formaPagamentoId: string;
  cobrancaId: string;
  checkoutKey: string;
  txid: string;
  valorCentavos: number;
  payload: string;
  qrCode: string;
  provedorNome: string;
  status:
    | "pendente"
    | "paga"
    | "cancelada"
    | "expirada"
    | "divergencia_valor"
    | "erro"
    | "indeterminado";
  estado: string;
  evidencia: string;
  pagoEm?: string | null;
  expiraEm?: string | null;
  mensagemConsulta?: string | null;
};

type Props = {
  formaPagamentoId: string;
  valorCentavos: number;
  saldoRestanteCentavos: number;
  checkoutKey: string;
  clienteId?: string | null;
  provedorNome?: string | null;
  state: PixGeranetCheckoutState | null;
  ocupado: boolean;
  onState: (state: PixGeranetCheckoutState | null) => void;
  onErro: (mensagem: string | null) => void;
};

function horarioLocal(iso: string) {
  return new Date(iso).toLocaleString("pt-BR");
}

function statusUi(state: PixGeranetCheckoutState) {
  if (state.status === "paga") {
    return "PIX recebido";
  }

  if (state.status === "divergencia_valor") {
    return MENSAGEM_PIX_GERANET_DIVERGENCIA;
  }

  if (state.status === "cancelada") {
    return "Cobrança cancelada no provedor.";
  }

  if (state.status === "expirada") {
    return "Cobrança expirada no provedor.";
  }

  if (state.estado === "indeterminado") {
    return MENSAGEM_PIX_GERANET_INDETERMINADO;
  }

  if (state.mensagemConsulta) {
    return state.mensagemConsulta;
  }

  return "Aguardando pagamento...";
}

async function chamarJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as Record<string, unknown>;
}

function mapearEstado(data: Record<string, unknown>, fallback: PixGeranetCheckoutState) {
  const cobranca =
    data.cobranca && typeof data.cobranca === "object"
      ? (data.cobranca as Record<string, unknown>)
      : {};
  const contrato =
    data.contrato && typeof data.contrato === "object"
      ? (data.contrato as Record<string, unknown>)
      : {};
  const evidencia =
    data.evidencia && typeof data.evidencia === "object"
      ? (data.evidencia as Record<string, unknown>)
      : {};

  const status = String(data.status ?? cobranca.status ?? fallback.status);
  const estado = String(data.estado ?? evidencia.estado ?? fallback.estado);

  return {
    ...fallback,
    cobrancaId: String(data.cobranca_id ?? cobranca.id ?? fallback.cobrancaId),
    txid: String(data.txid ?? cobranca.txid ?? fallback.txid),
    payload: String(
      data.pixCopiaECola ?? contrato.pixCopiaECola ?? fallback.payload
    ),
    qrCode: String(data.qrCode ?? contrato.qrCode ?? fallback.qrCode),
    provedorNome: String(
      data.provedor_nome ?? fallback.provedorNome
    ),
    status: status as PixGeranetCheckoutState["status"],
    estado,
    evidencia: String(evidencia.evidencia ?? fallback.evidencia),
    pagoEm: data.pago_em
      ? String(data.pago_em)
      : cobranca.pago_em
        ? String(cobranca.pago_em)
        : fallback.pagoEm,
    expiraEm: data.expira_em
      ? String(data.expira_em)
      : cobranca.expira_em
        ? String(cobranca.expira_em)
        : fallback.expiraEm,
    mensagemConsulta:
      estado === "indeterminado"
        ? MENSAGEM_PIX_GERANET_INDETERMINADO
        : status === "divergencia_valor"
          ? MENSAGEM_PIX_GERANET_DIVERGENCIA
          : null,
  } satisfies PixGeranetCheckoutState;
}

export function PixGeranetCheckout({
  formaPagamentoId,
  valorCentavos,
  saldoRestanteCentavos,
  checkoutKey,
  clienteId,
  provedorNome,
  state,
  ocupado,
  onState,
  onErro,
}: Props) {
  const [gerando, setGerando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [dialogAberto, setDialogAberto] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
  const pollingRef = useRef<number | null>(null);
  const inicioPollingRef = useRef<number>(0);
  const gerandoRef = useRef(false);

  const valor = valorCentavos / 100;
  const qrCompativel =
    state != null && state.valorCentavos === valorCentavos;
  const qrSrc = srcQrPix(state?.qrCode);
  const prazoEncerrado =
    Boolean(state?.expiraEm) &&
    new Date(String(state?.expiraEm)).getTime() <= agora;

  const pixAcimaDoSaldo = valorCentavos > saldoRestanteCentavos;

  async function gerar() {
    if (gerandoRef.current) {
      return;
    }

    try {
      validarParcelaPixContraSaldo({
        valorPixCentavos: valorCentavos,
        saldoRestanteCentavos,
      });
    } catch (error) {
      onErro(
        error instanceof Error ? error.message : MENSAGEM_PIX_ULTRAPASSA_SALDO
      );
      return;
    }

    gerandoRef.current = true;
    setGerando(true);
    onErro(null);
    try {
      const data = await chamarJson("/api/pagamentos/pix/geranet/pdv/emitir", {
        valor,
        checkout_key: checkoutKey,
        saldo_restante_centavos: saldoRestanteCentavos,
        ...(clienteId ? { cliente_id: clienteId } : {}),
      });

      if (!data.ok || !data.cobranca_id) {
        onErro(
          String(data.erro ?? "Não foi possível gerar o PIX integrado.")
        );
        return;
      }

      onState({
        formaPagamentoId,
        cobrancaId: String(data.cobranca_id),
        checkoutKey,
        txid: String(data.txid ?? ""),
        valorCentavos,
        payload: String(data.pixCopiaECola ?? ""),
        qrCode: String(data.qrCode ?? ""),
        provedorNome: String(data.provedor_nome ?? ""),
        status: String(data.status ?? "pendente") as PixGeranetCheckoutState["status"],
        estado: String(data.estado ?? "pendente"),
        evidencia: String(data.evidencia ?? "emissao_pendente"),
        pagoEm: data.pago_em ? String(data.pago_em) : null,
        expiraEm: data.expira_em ? String(data.expira_em) : null,
      });
    } catch (error) {
      onErro(
        error instanceof Error
          ? error.message
          : "Falha ao gerar o PIX integrado."
      );
    } finally {
      gerandoRef.current = false;
      setGerando(false);
    }
  }

  async function consultar(atual: PixGeranetCheckoutState) {
    try {
      const data = await chamarJson("/api/pagamentos/pix/geranet/consultar", {
        cobranca_id: atual.cobrancaId,
      });

      if (!data.ok) {
        onState({
          ...atual,
          mensagemConsulta: MENSAGEM_PIX_GERANET_REDE,
        });
        return;
      }

      onState(mapearEstado(data, atual));
    } catch {
      onState({
        ...atual,
        mensagemConsulta: MENSAGEM_PIX_GERANET_REDE,
      });
    }
  }

  async function cancelarPendente() {
    if (!state) {
      return;
    }

    setCancelando(true);
    onErro(null);
    try {
      const data = await chamarJson("/api/pagamentos/pix/geranet/cancelar", {
        cobranca_id: state.cobrancaId,
      });

      if (!data.ok) {
        onErro(
          String(
            data.erro ??
              "Não foi possível confirmar o cancelamento desta cobrança."
          )
        );
        setDialogAberto(false);
        return;
      }

      const status = String(
        (data.cobranca as { status?: string } | undefined)?.status ?? ""
      );
      if (status === "paga") {
        onState(mapearEstado(data, state));
        onErro("Este PIX já foi pago e não pode ser cancelado.");
        setDialogAberto(false);
        return;
      }

      if (status === "cancelada") {
        onState(null);
        setDialogAberto(false);
        return;
      }

      onErro("Não foi possível confirmar o cancelamento desta cobrança.");
      setDialogAberto(false);
    } catch (error) {
      onErro(
        error instanceof Error
          ? error.message
          : "Não foi possível confirmar o cancelamento desta cobrança."
      );
      setDialogAberto(false);
    } finally {
      setCancelando(false);
    }
  }

  useEffect(() => {
    if (!qrCompativel || !state || devePararPollingPixGeranet(state.status)) {
      if (pollingRef.current != null) {
        window.clearTimeout(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    if (pollingRef.current != null) {
      return;
    }

    let cancelado = false;
    inicioPollingRef.current = Date.now();

    const agendar = () => {
      if (cancelado || pollingRef.current != null) {
        return;
      }

      pollingRef.current = window.setTimeout(() => {
        pollingRef.current = null;
        void (async () => {
          await consultar(state);
          if (!cancelado && !devePararPollingPixGeranet(state.status)) {
            agendar();
          }
        })();
      }, intervaloPollingPixGeranet(Date.now() - inicioPollingRef.current));
    };

    agendar();

    return () => {
      cancelado = true;
      if (pollingRef.current != null) {
        window.clearTimeout(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [qrCompativel, state?.cobrancaId, state?.status]);

  useEffect(() => {
    if (!state?.expiraEm || devePararPollingPixGeranet(state.status)) {
      return;
    }

    const timer = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state?.expiraEm, state?.status]);

  return (
    <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <p className="text-sm font-semibold text-zinc-950">
        PIX Integrado / Geranet
      </p>
      {(provedorNome || state?.provedorNome) && (
        <p className="text-xs text-zinc-500">
          Provedor: {provedorNome || state?.provedorNome}
        </p>
      )}
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
          {gerando ? "Gerando..." : "Gerar PIX"}
        </button>
      )}

      {qrCompativel && state.status === "paga" && (
        <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p className="font-semibold">✓ PIX recebido</p>
          <p className="mt-1">{formatarValorPixBr(valor)}</p>
          {state.provedorNome && (
            <p className="mt-2 text-xs">Banco: {state.provedorNome}</p>
          )}
          {state.txid && (
            <p className="text-xs">TXID: {state.txid}</p>
          )}
          {state.pagoEm && (
            <p className="text-xs">Pago em: {horarioLocal(state.pagoEm)}</p>
          )}
          <p className="mt-2 text-xs">Pagamento confirmado automaticamente.</p>
        </div>
      )}

      {qrCompativel && state.status !== "paga" && (
        <div className="mt-3 space-y-2">
          {qrSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrSrc}
              alt="QR Code PIX"
              className="mx-auto h-44 w-44 bg-white"
            />
          )}
          <p className="text-center text-lg font-bold text-zinc-950">
            {formatarValorPixBr(valor)}
          </p>
          {state.payload && (
            <>
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
                {copiado ? "Código copiado" : "Copiar"}
              </button>
            </>
          )}
          {state.expiraEm && (
            <p className="text-center text-[11px] text-zinc-500">
              {prazoEncerrado
                ? "Prazo da cobrança encerrado — consultando situação"
                : `Expira em ${new Date(state.expiraEm).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`}
            </p>
          )}
          <p
            className={`text-center text-xs font-medium ${
              state.status === "divergencia_valor"
                ? "text-amber-800"
                : "text-amber-700"
            }`}
          >
            {statusUi(state)}
          </p>
          {state.status === "pendente" && (
            <button
              type="button"
              disabled={ocupado || cancelando}
              onClick={() => setDialogAberto(true)}
              className="h-9 w-full rounded-md border border-zinc-300 text-xs font-semibold uppercase tracking-wide text-zinc-600 hover:bg-zinc-100"
            >
              Descartar cobrança
            </button>
          )}
        </div>
      )}

      {dialogAberto && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Fechar"
            className="absolute inset-0 bg-black/40"
            onClick={() => !cancelando && setDialogAberto(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-zinc-950">
              {MENSAGEM_PIX_GERANET_DESCARTAR}
            </h3>
            <p className="mt-2 text-sm text-zinc-600">
              {MENSAGEM_PIX_GERANET_AGUARDANDO} A cobrança pendente será
              cancelada no banco, se ainda estiver aberta.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={cancelando}
                onClick={() => setDialogAberto(false)}
                className="rounded-md px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100"
              >
                Manter
              </button>
              <button
                type="button"
                disabled={cancelando}
                onClick={() => void cancelarPendente()}
                className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
              >
                {cancelando ? "Cancelando..." : "Descartar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
