"use client";

import {
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

type Props = {
  emissaoId: string;
  modelo: string;
  serie: number;
  numero:
    | number
    | string;
  reservadaEm:
    | string
    | null;
};

function rotuloModelo(
  modelo: string
) {
  return modelo === "55"
    ? "NF-e"
    : modelo === "65"
      ? "NFC-e"
      : `Documento ${modelo}`;
}

function dataHora(
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
      dateStyle: "short",
      timeStyle: "short",
      timeZone:
        "America/Cuiaba",
    }
  ).format(data);
}

export function ReservaFiscalPendente({
  emissaoId,
  modelo,
  serie,
  numero,
  reservadaEm,
}: Props) {
  const router =
    useRouter();

  const [
    confirmando,
    setConfirmando,
  ] =
    useState(false);

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

  const [
    sucesso,
    setSucesso,
  ] =
    useState(false);

  async function descartar() {
    setProcessando(true);

    try {
      const response =
        await fetch(
          `/api/fiscal/emissoes/${emissaoId}/descartar-reserva`,
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                motivo:
                  "Reserva descartada pelo usuário antes da transmissão para permitir correção da venda.",
              }),
          }
        );

      const payload =
        (await response.json()) as {
          ok?: boolean;
          erro?: string;
          mensagem?: string;
        };

      if (
        !response.ok ||
        !payload.ok
      ) {
        setSucesso(false);
        setMensagem(
          payload.erro ??
            "Não foi possível descartar a reserva fiscal."
        );
        return;
      }

      setSucesso(true);
      setMensagem(
        payload.mensagem ??
          "Reserva descartada com sucesso."
      );

      setConfirmando(false);
      router.refresh();
    } catch (error) {
      setSucesso(false);
      setMensagem(
        error instanceof Error
          ? error.message
          : "Falha ao descartar a reserva fiscal."
      );
    } finally {
      setProcessando(false);
    }
  }

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            Reserva fiscal pendente
          </p>

          <h2 className="mt-1 text-lg font-semibold text-amber-950">
            {rotuloModelo(
              modelo
            )}{" "}
            série {serie} · nº{" "}
            {numero}
          </h2>

          <p className="mt-2 max-w-3xl text-sm leading-6 text-amber-900">
            Este número foi reservado, mas a transmissão ainda não começou. Enquanto a reserva existir, os dados fiscais sensíveis da venda permanecem bloqueados.
          </p>

          <p className="mt-2 text-xs text-amber-700">
            Reservada em{" "}
            {dataHora(
              reservadaEm
            )}
          </p>
        </div>

        {!confirmando && (
          <button
            type="button"
            onClick={() => {
              setMensagem(null);
              setSucesso(false);
              setConfirmando(
                true
              );
            }}
            className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-amber-400 bg-white px-4 text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
          >
            Descartar reserva
          </button>
        )}
      </div>

      {mensagem && (
        <div
          className={[
            "mt-4 rounded-xl border p-3 text-sm",
            sucesso
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800",
          ].join(" ")}
        >
          {mensagem}
        </div>
      )}

      {confirmando && (
        <div className="mt-4 rounded-xl border border-amber-300 bg-white p-4">
          <p className="font-semibold text-zinc-950">
            Confirmar descarte da reserva?
          </p>

          <p className="mt-2 text-sm leading-6 text-zinc-600">
            O número{" "}
            <strong>
              {serie}/{numero}
            </strong>{" "}
            não será devolvido para a sequência e não poderá ser reutilizado. Ele ficará registrado como{" "}
            <strong>
              aguardando inutilização
            </strong>
            . Depois disso você poderá corrigir Transportador/Volumes e fazer uma nova emissão.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={
                processando
              }
              onClick={
                descartar
              }
              className="inline-flex h-10 items-center justify-center rounded-xl bg-amber-700 px-4 text-sm font-semibold text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {processando
                ? "Descartando..."
                : "Sim, descartar reserva"}
            </button>

            <button
              type="button"
              disabled={
                processando
              }
              onClick={() =>
                setConfirmando(
                  false
                )
              }
              className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50"
            >
              Voltar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
