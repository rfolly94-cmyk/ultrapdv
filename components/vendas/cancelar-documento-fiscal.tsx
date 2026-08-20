"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ReconciliarEmissaoFiscal } from "@/components/vendas/reconciliar-emissao-fiscal";
import {
  formatarRestanteCancelamento,
  type PoliticaCancelamentoPublica,
} from "@/lib/fiscal/politica-cancelamento";

type Props = {
  emissaoId: string;
  modelo: string | null;
  serie: number | string;
  numero: number | string;
  politica: PoliticaCancelamentoPublica;
  statusEventoCancelamento?: string | null;
};

type Resposta = {
  ok?: boolean;
  cancelada?: boolean;
  erro?: string;
  mensagem?: string;
  cstat?: string | null;
  protocolo?: string | null;
};

function nomeDocumento(modelo: string | null) {
  return modelo === "65" ? "NFC-e" : "NF-e";
}

function situacaoClasse(codigo: string) {
  if (codigo === "prazo_encerrado" || codigo === "ja_cancelada") {
    return "border-red-200 bg-red-50 text-red-800";
  }

  if (codigo === "proximo_do_fim" || codigo === "data_autorizacao_ausente") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  if (codigo === "politica_nao_configurada") {
    return "border-zinc-200 bg-zinc-50 text-zinc-700";
  }

  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

export function CancelarDocumentoFiscal({
  emissaoId,
  modelo,
  serie,
  numero,
  politica,
  statusEventoCancelamento = null,
}: Props) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [justificativa, setJustificativa] = useState("");
  const [confirmouCirculacao, setConfirmouCirculacao] = useState(false);
  const [confirmouDuplicata, setConfirmouDuplicata] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const [agoraMs, setAgoraMs] = useState(() => Date.now());

  const documento = nomeDocumento(modelo);
  const pendente = ["processando", "aguardando_reconciliacao"].includes(
    statusEventoCancelamento ?? ""
  );

  useEffect(() => {
    if (!aberto || !politica.limiteEmIso) {
      return;
    }

    const timer = window.setInterval(() => {
      setAgoraMs(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [aberto, politica.limiteEmIso]);

  const restanteVisual = useMemo(() => {
    if (!politica.limiteEmIso) {
      return politica.restanteTexto;
    }

    return formatarRestanteCancelamento(
      new Date(politica.limiteEmIso).getTime() - agoraMs
    );
  }, [agoraMs, politica.limiteEmIso, politica.restanteTexto]);

  async function cancelar() {
    const justificativaLimpa = justificativa.trim();

    if (justificativaLimpa.length < 15) {
      setSucesso(false);
      setMensagem(
        "Informe uma justificativa com pelo menos 15 caracteres."
      );
      return;
    }

    if (!confirmouCirculacao) {
      setSucesso(false);
      setMensagem(
        "Confirme que não houve circulação/saída ou prestação que impeça o cancelamento."
      );
      return;
    }

    if (politica.exigeConfirmacaoDuplicata && !confirmouDuplicata) {
      setSucesso(false);
      setMensagem(
        "Confirme que esta NF-e não possui vinculação à Duplicata Escritural que impeça seu cancelamento."
      );
      return;
    }

    setEnviando(true);
    setMensagem(null);
    setSucesso(false);

    try {
      const response = await fetch(
        `/api/fiscal/emissoes/${emissaoId}/cancelar`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            confirmar: "CANCELAR_DOCUMENTO_FISCAL",
            justificativa: justificativaLimpa,
            confirmouNaoCirculacao: confirmouCirculacao,
            confirmouSemDuplicataEscritural: confirmouDuplicata,
          }),
        }
      );

      const data = (await response.json()) as Resposta;

      if (!response.ok || !data.ok) {
        setMensagem(
          data.erro ?? "Não foi possível cancelar o documento fiscal."
        );
        router.refresh();
        return;
      }

      setSucesso(Boolean(data.cancelada));
      setMensagem(
        data.cancelada
          ? `${documento} cancelada${data.cstat ? ` · cStat ${data.cstat}` : ""}${data.protocolo ? ` · protocolo ${data.protocolo}` : ""}.`
          : data.mensagem ?? "Cancelamento processado."
      );
      setAberto(false);
      setJustificativa("");
      setConfirmouCirculacao(false);
      setConfirmouDuplicata(false);
      router.refresh();
    } catch (error) {
      setMensagem(
        error instanceof Error
          ? error.message
          : "Falha inesperada no cancelamento."
      );
    } finally {
      setEnviando(false);
    }
  }

  const formularioLiberado =
    politica.permitido && !pendente && !enviando;

  if (!aberto) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => {
            setAberto(true);
            setMensagem(null);
          }}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-red-300 bg-white px-4 text-sm font-semibold text-red-700 transition hover:bg-red-50"
        >
          Cancelar {documento}
        </button>

        {mensagem && (
          <p
            className={[
              "max-w-xl text-sm",
              sucesso ? "text-emerald-700" : "text-red-700",
            ].join(" ")}
          >
            {mensagem}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="w-full max-w-xl rounded-xl border border-red-200 bg-red-50 p-4">
      <h3 className="font-semibold text-red-900">
        Cancelar {documento}
      </h3>

      <p className="mt-1 text-sm text-red-900">
        {documento} nº {numero} — Série {serie}
      </p>

      <dl className="mt-4 grid gap-2 text-sm text-red-950">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-red-700">
            Autorizada em
          </dt>
          <dd>{politica.autorizadoEmTexto ?? "Data de autorização não armazenada"}</dd>
        </div>

        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-red-700">
            Prazo normal
          </dt>
          <dd>{politica.prazoRotulo ?? "Não configurado para esta UF"}</dd>
        </div>

        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-red-700">
            Limite
          </dt>
          <dd>{politica.limiteEmTexto ?? "—"}</dd>
        </div>
      </dl>

      <p
        className={`mt-3 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${situacaoClasse(
          politica.codigo
        )}`}
      >
        {politica.situacaoTexto}
      </p>

      {restanteVisual && politica.permitido && (
        <p
          className={[
            "mt-2 text-sm font-medium",
            politica.alertaProximoFim ? "text-amber-800" : "text-red-800",
          ].join(" ")}
        >
          {restanteVisual}
        </p>
      )}

      {politica.mensagemInformativa && (
        <div className="mt-3 rounded-lg border border-red-200 bg-white/80 p-3 text-sm text-red-900">
          <p className="font-semibold">
            {politica.codigo === "prazo_encerrado"
              ? "Cancelamento normal indisponível"
              : "Atenção"}
          </p>
          <p className="mt-1">{politica.mensagemInformativa}</p>
        </div>
      )}

      {pendente && (
        <div className="mt-3 space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <p>
            Existe uma tentativa de cancelamento com resultado pendente.
            Consulte a situação antes de reenviar.
          </p>
          <ReconciliarEmissaoFiscal
            emissaoId={emissaoId}
            modelo={modelo ?? ""}
            serie={serie}
            numero={numero}
            status="aguardando_reconciliacao"
          />
        </div>
      )}

      {politica.codigo === "data_autorizacao_ausente" && !pendente && (
        <div className="mt-3">
          <ReconciliarEmissaoFiscal
            emissaoId={emissaoId}
            modelo={modelo ?? ""}
            serie={serie}
            numero={numero}
            status="autorizada"
          />
        </div>
      )}

      <p className="mt-3 text-xs text-red-700">
        O cancelamento fiscal não estorna automaticamente estoque, caixa ou carteira.
      </p>

      {formularioLiberado && (
        <>
          <label className="mt-4 block">
            <span className="text-sm font-medium text-red-900">
              Justificativa do cancelamento
            </span>

            <textarea
              value={justificativa}
              onChange={(event) => setJustificativa(event.target.value)}
              rows={4}
              maxLength={255}
              placeholder="Ex.: Nota fiscal emitida com dados incorretos."
              className="mt-2 w-full rounded-xl border border-red-200 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-red-400"
            />

            <span className="mt-1 block text-xs text-red-700">
              {justificativa.trim().length}/15 caracteres mínimos
            </span>
          </label>

          <label className="mt-3 flex items-start gap-2 text-sm text-red-950">
            <input
              type="checkbox"
              checked={confirmouCirculacao}
              onChange={(event) =>
                setConfirmouCirculacao(event.target.checked)
              }
              className="mt-1"
            />
            <span>
              {modelo === "65"
                ? "Confirmo que não houve circulação/saída definitiva da mercadoria que impeça o cancelamento."
                : "Confirmo que não houve circulação da mercadoria ou prestação já realizada que impeça o cancelamento."}
            </span>
          </label>

          {politica.exigeConfirmacaoDuplicata && (
            <label className="mt-2 flex items-start gap-2 text-sm text-red-950">
              <input
                type="checkbox"
                checked={confirmouDuplicata}
                onChange={(event) =>
                  setConfirmouDuplicata(event.target.checked)
                }
                className="mt-1"
              />
              <span>
                Confirmo que esta NF-e não possui vinculação à Duplicata
                Escritural que impeça seu cancelamento.
              </span>
            </label>
          )}
        </>
      )}

      {mensagem && (
        <p className="mt-3 text-sm text-red-700">{mensagem}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {formularioLiberado && (
          <button
            type="button"
            onClick={cancelar}
            disabled={
              enviando ||
              justificativa.trim().length < 15 ||
              !confirmouCirculacao ||
              (politica.exigeConfirmacaoDuplicata && !confirmouDuplicata)
            }
            className="inline-flex h-10 items-center justify-center rounded-xl bg-red-700 px-4 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {enviando ? "Cancelando..." : "Confirmar cancelamento"}
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setAberto(false);
            setMensagem(null);
          }}
          disabled={enviando}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-60"
        >
          Voltar
        </button>
      </div>
    </div>
  );
}
