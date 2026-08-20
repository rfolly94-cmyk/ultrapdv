"use client";

import {
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

type Props = {
  vendaId: string;
  serie?: number;
  ambiente?: 1 | 2;
  rotulo?: string;
  confirmacao?: string;
};

type Resposta = {
  ok?: boolean;
  autorizada?: boolean;
  erro?: string;
  mensagem?: string;
  numero?: string;
  serie?: number;
  cstat?: string | null;
};

export function EmitirNfeVendaButton({
  vendaId,
  serie,
  ambiente = 2,
  rotulo = "Emitir NF-e",
  confirmacao,
}: Props) {
  const router =
    useRouter();

  const [
    enviando,
    setEnviando,
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

  async function emitir() {
    const confirmou =
      window.confirm(
        confirmacao ??
          (ambiente === 1
            ? "ATENÇÃO: emitir esta NF-e em PRODUÇÃO?\\n\\nEste documento terá validade fiscal real e consumirá numeração de produção."
            : "Emitir a NF-e modelo 55 desta venda em HOMOLOGAÇÃO?\\n\\nUm número fiscal será reservado e a venda será transmitida à Geranet.")
      );

    if (
      !confirmou
    ) {
      return;
    }

    setEnviando(true);
    setMensagem(null);
    setSucesso(false);

    try {
      const response =
        await fetch(
          "/api/fiscal/geranet/nfe-emitir-venda",
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json",
              "Idempotency-Key":
                vendaId,
            },
            body:
              JSON.stringify({
                confirmar:
                  ambiente === 1
                    ? "EMITIR_NFE55_VENDA_PRODUCAO"
                    : "EMITIR_NFE55_VENDA_HOMOLOGACAO",
                venda_id:
                  vendaId,
                ...(serie
                  ? {
                      serie,
                    }
                  : {}),
              }),
          }
        );

      const data =
        (
          await response.json()
        ) as Resposta;

      if (
        !response.ok ||
        !data.ok
      ) {
        setMensagem(
          data.erro ??
          "Não foi possível emitir a NF-e."
        );

        router.refresh();
        return;
      }

      setSucesso(
        Boolean(
          data.autorizada
        )
      );

      setMensagem(
        data.autorizada
          ? `NF-e autorizada. Série ${data.serie ?? "—"}, número ${data.numero ?? "—"}${data.cstat ? `, cStat ${data.cstat}` : ""}.`
          : data.mensagem ??
            "Emissão processada."
      );

      router.refresh();
    } catch (
      error
    ) {
      setMensagem(
        error instanceof Error
          ? error.message
          : "Falha inesperada ao emitir NF-e."
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={emitir}
        disabled={
          enviando
        }
        className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {
          enviando
            ? "Emitindo NF-e..."
            : rotulo
        }
      </button>

      {
        mensagem && (
          <p
            className={[
              "max-w-xl text-sm",
              sucesso
                ? "text-emerald-700"
                : "text-red-700",
            ].join(
              " "
            )}
          >
            {mensagem}
          </p>
        )
      }
    </div>
  );
}
