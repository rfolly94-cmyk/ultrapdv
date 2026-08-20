"use client";

import Link from "next/link";

import {
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

type Props = {
  vendaId: string;
  numero:
    | string
    | number
    | null;
  habilitada: boolean;
  bloqueada: boolean;
  justificativaPadrao: string;
};

export function EmitirNfceContingenciaButton({
  vendaId,
  numero,
  habilitada,
  bloqueada,
  justificativaPadrao,
}: Props) {
  const router =
    useRouter();

  const [
    aberto,
    setAberto,
  ] =
    useState(false);

  const [
    justificativa,
    setJustificativa,
  ] =
    useState(
      justificativaPadrao
    );

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

  const [
    danfeUrl,
    setDanfeUrl,
  ] =
    useState<
      string | null
    >(null);

  if (!habilitada) {
    return (
      <Link
        href="/configuracoes/fiscal/contingencia"
        title="Habilite a contingência NFC-e nas Configurações Fiscais."
        className="updv-btn updv-btn-ghost text-amber-800"
      >
        Configurar contingência
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={
          bloqueada
        }
        title={
          bloqueada
            ? "Existe documento fiscal que precisa ser resolvido antes de gerar contingência."
            : "Gerar NFC-e modelo 65 em contingência offline."
        }
        onClick={() => {
          setMensagem(null);
          setSucesso(false);
          setDanfeUrl(null);
          setAberto(true);
        }}
        className="updv-btn updv-btn-ghost disabled:opacity-50"
      >
        NFC-e contingência
      </button>

      {aberto && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/45 p-4 md:p-8">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-zinc-200 p-5">
              <h2 className="text-lg font-semibold text-zinc-950">
                Emitir NFC-e em contingência
              </h2>

              <p className="mt-1 text-sm text-zinc-500">
                Venda #{numero ?? "—"}
              </p>
            </div>

            <div className="space-y-4 p-5">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
                Use este modo somente quando a autorização normal estiver indisponível por falha de comunicação/SEFAZ. Uma rejeição de cadastro, tributação ou regra fiscal deve ser corrigida, não contornada por contingência.
              </div>

              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900">
                A NFC-e pode ser gerada para operação em contingência sem estar autorizada naquele momento. O UltraPDV guardará o XML original e deverá transmiti-lo posteriormente.
              </div>

              <label className="block">
                <span className="text-sm font-semibold text-zinc-800">
                  Justificativa
                </span>

                <textarea
                  value={
                    justificativa
                  }
                  maxLength={256}
                  rows={4}
                  disabled={
                    processando
                  }
                  onChange={(event) =>
                    setJustificativa(
                      event.target.value
                    )
                  }
                  className="mt-2 w-full rounded-xl border border-zinc-300 p-3 text-sm outline-none focus:border-zinc-500 disabled:bg-zinc-100"
                />

                <span className="mt-1 block text-xs text-zinc-500">
                  {justificativa.length}/256 caracteres
                </span>
              </label>

              {mensagem && (
                <div
                  className={[
                    "rounded-xl border p-4 text-sm",
                    sucesso
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-red-200 bg-red-50 text-red-800",
                  ].join(" ")}
                >
                  {mensagem}
                </div>
              )}

              {danfeUrl && (
                <a
                  href={
                    danfeUrl
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-100"
                >
                  Abrir DANFE de contingência
                </a>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 p-5">
              <button
                type="button"
                disabled={
                  processando
                }
                onClick={() =>
                  setAberto(false)
                }
                className="h-10 rounded-xl border border-zinc-300 px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              >
                Fechar
              </button>

              <button
                type="button"
                disabled={
                  processando ||
                  justificativa.trim().length <
                    15
                }
                onClick={
                  async () => {
                    setProcessando(
                      true
                    );
                    setMensagem(
                      null
                    );
                    setSucesso(
                      false
                    );
                    setDanfeUrl(
                      null
                    );

                    try {
                      const response =
                        await fetch(
                          "/api/fiscal/geranet/nfce-contingencia-venda",
                          {
                            method:
                              "POST",
                            headers: {
                              "Content-Type":
                                "application/json",
                            },
                            body:
                              JSON.stringify({
                                confirmar:
                                  "EMITIR_NFCE_CONTINGENCIA_OFFLINE",
                                venda_id:
                                  vendaId,
                                justificativa:
                                  justificativa.trim(),
                              }),
                          }
                        );

                      const payload =
                        (await response.json()) as {
                          ok?: boolean;
                          erro?: string;
                          mensagem?: string;
                          contingencia?: boolean;
                          autorizada?: boolean;
                          danfe_url?: string | null;
                        };

                      if (
                        !response.ok ||
                        !payload.ok
                      ) {
                        setMensagem(
                          payload.erro ??
                            payload.mensagem ??
                            "Não foi possível gerar a NFC-e em contingência."
                        );
                        return;
                      }

                      setSucesso(
                        true
                      );

                      setMensagem(
                        payload.mensagem ??
                          (
                            payload.autorizada
                              ? "NFC-e autorizada."
                              : "NFC-e gerada em contingência."
                          )
                      );

                      setDanfeUrl(
                        payload.danfe_url ??
                          null
                      );

                      router.refresh();
                    } catch (
                      error
                    ) {
                      setMensagem(
                        error instanceof Error
                          ? error.message
                          : "Falha ao gerar a NFC-e em contingência."
                      );
                    } finally {
                      setProcessando(
                        false
                      );
                    }
                  }
                }
                className="h-10 rounded-xl bg-amber-700 px-4 text-sm font-semibold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {processando
                  ? "Gerando..."
                  : "Confirmar contingência"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
