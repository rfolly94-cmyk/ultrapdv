"use client";

import Link from "next/link";

import {
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

type Props = {
  emissaoId: string;
  serie: number;
  numero:
    | string
    | number;
  status: string;
  geradaEm:
    | string
    | null;
  justificativa:
    | string
    | null;
  temPdf: boolean;
  temXml: boolean;
  erro:
    | string
    | null;
};

function formatarData(
  valor:
    | string
    | null
) {
  if (!valor) {
    return "—";
  }

  const data =
    new Date(valor);

  if (
    Number.isNaN(
      data.getTime()
    )
  ) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "pt-BR",
    {
      dateStyle:
        "short",
      timeStyle:
        "short",
      timeZone:
        "America/Cuiaba",
    }
  ).format(data);
}

export function NfceContingenciaCard({
  emissaoId,
  serie,
  numero,
  status,
  geradaEm,
  justificativa,
  temPdf,
  temXml,
  erro,
}: Props) {
  const router =
    useRouter();

  const [
    processando,
    setProcessando,
  ] =
    useState(false);

  const [
    mensagem,
    setMensagem,
  ] =
    useState<
      string | null
    >(null);

  const pendente =
    status ===
    "aguardando_transmissao_contingencia";

  const ambigua =
    status ===
      "aguardando_reconciliacao" ||
    status ===
      "transmitindo_contingencia";

  const autorizada =
    status ===
    "autorizada";

  const rejeitada =
    status ===
    "rejeitada";

  return (
    <div
      className={[
        "rounded-2xl border p-5 shadow-sm",
        autorizada
          ? "border-emerald-200 bg-emerald-50"
          : ambigua
            ? "border-orange-300 bg-orange-50"
            : rejeitada
              ? "border-red-300 bg-red-50"
              : "border-amber-300 bg-amber-50",
      ].join(" ")}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-zinc-600">
            NFC-e em contingência
          </p>

          <h2 className="mt-1 text-lg font-semibold text-zinc-950">
            Série {serie} · nº {numero}
          </h2>

          <p className="mt-2 text-sm leading-6 text-zinc-700">
            {pendente
              ? "Documento gerado em contingência. Ainda NÃO autorizado pela SEFAZ; o XML original está aguardando transmissão."
              : ambigua
                ? "A transmissão está em situação fiscal ambígua. NÃO retransmita manualmente até reconciliar."
                : autorizada
                  ? "Documento de contingência posteriormente autorizado pela SEFAZ."
                  : rejeitada
                    ? "O documento foi rejeitado ao tentar regularizar a contingência. Analise o motivo antes de qualquer nova ação."
                    : `Status: ${status}.`}
          </p>

          <p className="mt-2 text-xs text-zinc-600">
            Gerada em {formatarData(geradaEm)}
          </p>

          {justificativa && (
            <p className="mt-2 max-w-3xl text-xs leading-5 text-zinc-600">
              Justificativa: {justificativa}
            </p>
          )}

          {erro && (
            <p className="mt-3 max-w-3xl rounded-lg border border-red-200 bg-white/70 p-3 text-xs leading-5 text-red-800">
              {erro}
            </p>
          )}

          {mensagem && (
            <p className="mt-3 rounded-lg border border-zinc-200 bg-white/80 p-3 text-sm text-zinc-800">
              {mensagem}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {temPdf && (
            <a
              href={`/api/fiscal/contingencia/${emissaoId}/arquivo?tipo=pdf`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-100"
            >
              DANFE
            </a>
          )}

          {temXml && (
            <a
              href={`/api/fiscal/contingencia/${emissaoId}/arquivo?tipo=xml&download=1`}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-100"
            >
              XML
            </a>
          )}

          {pendente && (
            <button
              type="button"
              disabled={
                processando
              }
              onClick={
                async () => {
                  setProcessando(
                    true
                  );
                  setMensagem(
                    null
                  );

                  try {
                    const response =
                      await fetch(
                        `/api/fiscal/contingencia/${emissaoId}/transmitir`,
                        {
                          method:
                            "POST",
                        }
                      );

                    const payload =
                      (await response.json()) as {
                        ok?: boolean;
                        erro?: string;
                        mensagem?: string;
                      };

                    setMensagem(
                      payload.mensagem ??
                        payload.erro ??
                        (
                          response.ok
                            ? "Transmissão concluída."
                            : "Não foi possível transmitir."
                        )
                    );

                    router.refresh();
                  } catch (
                    error
                  ) {
                    setMensagem(
                      error instanceof Error
                        ? error.message
                        : "Falha ao transmitir a contingência."
                    );
                  } finally {
                    setProcessando(
                      false
                    );
                  }
                }
              }
              className="inline-flex h-10 items-center justify-center rounded-xl bg-blue-700 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {processando
                ? "Transmitindo..."
                : "Transmitir agora"}
            </button>
          )}

          <Link
            href="/configuracoes/fiscal/contingencia"
            className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-100"
          >
            Central
          </Link>
        </div>
      </div>
    </div>
  );
}
