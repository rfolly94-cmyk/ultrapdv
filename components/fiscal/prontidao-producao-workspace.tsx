"use client";

import Link from "next/link";

import {
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

type Check = {
  codigo: string;
  titulo: string;
  ok: boolean;
  detalhe: string;
  obrigatorio: boolean;
};

type Props = {
  empresaNome: string;
  ambienteAtual:
    | 1
    | 2;
  checks: Check[];
  bloqueadores: number;
  perfil: string;
};

export function ProntidaoProducaoWorkspace({
  empresaNome,
  ambienteAtual,
  checks,
  bloqueadores,
  perfil,
}: Props) {
  const router =
    useRouter();

  const [
    confirmacao,
    setConfirmacao,
  ] =
    useState("");

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

  const podeAlterar =
    [
      "administrador",
      "admin",
    ].includes(
      perfil
        .trim()
        .toLowerCase()
    );

  const pronta =
    bloqueadores ===
    0;

  async function mudarParaProducao() {
    setProcessando(
      true
    );
    setMensagem(
      null
    );
    setSucesso(
      false
    );

    try {
      const response =
        await fetch(
          "/api/fiscal/configuracao/ambiente",
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body:
              JSON.stringify({
                ambiente:
                  1,
                confirmar:
                  confirmacao,
                motivo:
                  "Virada controlada para produção após checklist de prontidão.",
              }),
          }
        );

      const payload =
        (await response
          .json()) as {
          ok?: boolean;
          erro?: string;
          mensagem?: string;
        };

      if (
        !response.ok ||
        !payload.ok
      ) {
        setMensagem(
          payload.erro ??
            "Não foi possível mudar para produção."
        );
        return;
      }

      setSucesso(
        true
      );
      setMensagem(
        payload.mensagem ??
          "Ambiente alterado para produção."
      );

      router.refresh();
    } catch (
      error
    ) {
      setMensagem(
        error instanceof
          Error
          ? error.message
          : "Falha inesperada."
      );
    } finally {
      setProcessando(
        false
      );
    }
  }

  return (
    <div className="updv-config space-y-4">
      <div className="flex justify-end">
        <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13px]">
          <p className="font-semibold text-zinc-950">
            {empresaNome}
          </p>
          <p className="mt-0.5 text-[12px] text-zinc-500">
            Ambiente atual:{" "}
            {ambienteAtual ===
            1
              ? "PRODUÇÃO"
              : "HOMOLOGAÇÃO"}
          </p>
        </div>
      </div>

      <div
        className={[
          "rounded-2xl border p-5",
          pronta
            ? "border-emerald-200 bg-emerald-50"
            : "border-amber-200 bg-amber-50",
        ].join(" ")}
      >
        <p className="text-sm font-semibold">
          {pronta
            ? "Checklist obrigatório concluído."
            : `${bloqueadores} bloqueador(es) impedem a virada para produção.`}
        </p>

        <p className="mt-2 text-sm leading-6">
          {pronta
            ? "Revise os dados abaixo antes de confirmar. Produção gera documentos fiscais com validade real."
            : "Corrija os itens vermelhos antes de tentar alterar o ambiente."}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {checks.map(
          (check) => (
            <div
              key={
                check.codigo
              }
              className={[
                "rounded-2xl border bg-white p-5 shadow-sm",
                check.ok
                  ? "border-emerald-200"
                  : check.obrigatorio
                    ? "border-red-200"
                    : "border-amber-200",
              ].join(" ")}
            >
              <div className="flex items-start gap-3">
                <span
                  className={[
                    "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                    check.ok
                      ? "bg-emerald-100 text-emerald-800"
                      : check.obrigatorio
                        ? "bg-red-100 text-red-800"
                        : "bg-amber-100 text-amber-800",
                  ].join(" ")}
                >
                  {check.ok
                    ? "✓"
                    : "!"}
                </span>

                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold text-zinc-950">
                      {check.titulo}
                    </h2>

                    {!check.obrigatorio && (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500">
                        recomendado
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-sm leading-6 text-zinc-600">
                    {check.detalhe}
                  </p>
                </div>
              </div>
            </div>
          )
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/configuracoes/fiscal/numeracao"
          className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
        >
          Configurar numeração
        </Link>

        <Link
          href="/configuracoes/fiscal/integracao"
          className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
        >
          Revisar Geranet
        </Link>

        <Link
          href="/configuracoes/fiscal/contingencia"
          className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
        >
          Revisar contingência
        </Link>
      </div>

      {ambienteAtual ===
      2 ? (
        <section className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-950">
            Virada para Produção
          </h2>

          <p className="mt-2 text-sm leading-6 text-zinc-600">
            Esta ação altera o ambiente fiscal da empresa. Depois disso, NF-e e NFC-e usarão as sequências configuradas para ambiente 1.
          </p>

          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900">
            Digite exatamente <strong>PRODUCAO</strong> para liberar o botão.
          </div>

          <input
            value={
              confirmacao
            }
            onChange={(
              event
            ) =>
              setConfirmacao(
                event.target.value
                  .toUpperCase()
              )
            }
            placeholder="PRODUCAO"
            className="mt-4 h-11 w-full max-w-sm rounded-xl border border-zinc-300 px-3 text-sm font-semibold outline-none focus:border-red-500"
          />

          {mensagem && (
            <div
              className={[
                "mt-4 rounded-xl border p-4 text-sm",
                sucesso
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-red-200 bg-red-50 text-red-800",
              ].join(" ")}
            >
              {mensagem}
            </div>
          )}

          <button
            type="button"
            disabled={
              !podeAlterar ||
              !pronta ||
              confirmacao !==
                "PRODUCAO" ||
              processando
            }
            onClick={
              mudarParaProducao
            }
            className="mt-4 h-11 rounded-xl bg-red-700 px-5 text-sm font-bold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {processando
              ? "Alterando..."
              : "MUDAR PARA PRODUÇÃO"}
          </button>

          {!podeAlterar && (
            <p className="mt-2 text-xs text-zinc-500">
              Somente administrador pode executar a virada de ambiente.
            </p>
          )}
        </section>
      ) : (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="font-semibold text-emerald-950">
            Empresa em PRODUÇÃO
          </h2>
          <p className="mt-2 text-sm text-emerald-900">
            As emissões normais passam a usar ambiente 1 e as respectivas numerações de produção.
          </p>
        </section>
      )}
    </div>
  );
}
