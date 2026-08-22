"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useRecursoLiberado } from "@/lib/plataforma/entitlements/contexto-ui";

type Props = {
  emissaoId: string;
  modelo: string;
  serie: number | string;
  numero: number | string;
  ambiente: number | string;
  status: string;
  motivo?: string | null;
  cstat?: string | null;
  protocolo?: string | null;
  inutilizadaEm?: string | null;
  xmlEventoId?: string | null;
  eventoPendente?: boolean;
};

function nomeDocumento(modelo: string) {
  return modelo === "65" ? "NFC-e" : "NF-e";
}

function rotuloAmbiente(ambiente: number | string) {
  return Number(ambiente) === 1 ? "produção" : "homologação";
}

export function InutilizarNumeracaoFiscal({
  emissaoId,
  modelo,
  serie,
  numero,
  ambiente,
  status,
  motivo,
  cstat,
  protocolo,
  inutilizadaEm,
  xmlEventoId,
  eventoPendente = false,
}: Props) {
  const router = useRouter();
  const inutilizacaoLiberada = useRecursoLiberado("inutilizacao_fiscal");
  const [aberto, setAberto] = useState(false);
  const [justificativa, setJustificativa] = useState(
    "Numeração descartada antes da autorização fiscal."
  );
  const [enviando, setEnviando] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  const nome = nomeDocumento(modelo);
  const inutilizada = status === "inutilizada";

  async function confirmar() {
    setEnviando(true);
    setToast(null);
    setSucesso(false);

    try {
      const response = await fetch(
        `/api/fiscal/emissoes/${emissaoId}/inutilizar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ justificativa }),
        }
      );

      const data = (await response.json()) as {
        ok?: boolean;
        erro?: string;
        mensagem?: string;
      };

      const mensagem =
        data.mensagem ??
        data.erro ??
        "Não foi possível inutilizar a numeração.";

      setSucesso(Boolean(data.ok));
      setToast(mensagem);
      setAberto(false);
      router.refresh();
    } catch (error) {
      setSucesso(false);
      setToast(
        error instanceof Error
          ? error.message
          : "Falha ao inutilizar a numeração."
      );
    } finally {
      setEnviando(false);
    }
  }

  async function consultar() {
    setEnviando(true);
    setToast(null);

    try {
      const response = await fetch(
        `/api/fiscal/emissoes/${emissaoId}/reconciliar`,
        { method: "POST" }
      );
      const data = (await response.json()) as {
        ok?: boolean;
        erro?: string;
        mensagem?: string;
      };
      setSucesso(Boolean(data.ok));
      setToast(
        data.mensagem ??
          data.erro ??
          "Não foi possível consultar a inutilização."
      );
      router.refresh();
    } catch (error) {
      setSucesso(false);
      setToast(
        error instanceof Error
          ? error.message
          : "Falha ao consultar a inutilização."
      );
    } finally {
      setEnviando(false);
    }
  }

  if (inutilizada) {
    return (
      <div className="rounded-2xl border border-zinc-300 bg-zinc-50 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Numeração inutilizada
        </p>
        <h2 className="mt-1 text-lg font-semibold text-zinc-950">
          {nome} nº {numero} — Inutilizada
        </h2>
        <p className="mt-2 text-sm text-zinc-600">
          Modelo {modelo} · série {serie}
          {cstat ? ` · cStat ${cstat}` : ""}
          {protocolo ? ` · protocolo ${protocolo}` : ""}
        </p>
        {inutilizadaEm && (
          <p className="mt-1 text-xs text-zinc-500">{inutilizadaEm}</p>
        )}
        {motivo && (
          <p className="mt-2 text-sm text-zinc-700">{motivo}</p>
        )}
        {xmlEventoId && (
          <a
            href={`/api/fiscal/eventos/${xmlEventoId}/arquivo?tipo=xml&download=1`}
            className="mt-3 inline-flex text-sm font-semibold text-zinc-800 underline"
          >
            XML da inutilização
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-violet-300 bg-violet-50 p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">
            Numeração aguardando inutilização
          </p>
          <h2 className="mt-1 text-lg font-semibold text-violet-950">
            {nome} nº {numero} · série {serie}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-violet-900">
            Este número foi descartado e não pode ser reutilizado. A
            inutilização precisa ser homologada pela SEFAZ antes de uma nova
            emissão desta venda.
          </p>
          {motivo && (
            <p className="mt-2 text-xs text-violet-800">{motivo}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {eventoPendente && (
            <button
              type="button"
              disabled={enviando}
              onClick={consultar}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-violet-400 bg-white px-4 text-sm font-semibold text-violet-900 hover:bg-violet-100 disabled:opacity-50"
            >
              {enviando ? "Consultando..." : "Consultar inutilização"}
            </button>
          )}
          {inutilizacaoLiberada ? (
            <button
              type="button"
              disabled={enviando || eventoPendente}
              onClick={() => {
                setAberto(true);
                setToast(null);
              }}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-violet-800 px-4 text-sm font-semibold text-white hover:bg-violet-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Inutilizar numeração
            </button>
          ) : null}
        </div>
      </div>

      {eventoPendente && (
        <p className="mt-3 text-sm text-violet-900">
          Já existe uma inutilização enviada com resultado pendente. Consulte
          a situação fiscal; não reenvie automaticamente.
        </p>
      )}

      {toast && (
        <div
          className={[
            "mt-4 rounded-xl border p-3 text-sm",
            sucesso
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-violet-200 bg-white text-violet-950",
          ].join(" ")}
        >
          {toast}
        </div>
      )}

      {aberto && inutilizacaoLiberada && (
        <div className="mt-4 rounded-xl border border-violet-300 bg-white p-4">
          <p className="font-semibold text-zinc-950">
            Inutilizar {nome} nº {numero}, série {serie}?
          </p>
          <p className="mt-2 text-sm text-zinc-600">
            Modelo {modelo} · ambiente {rotuloAmbiente(ambiente)}. Após
            homologada pela SEFAZ, esta numeração não poderá ser utilizada
            para outra nota.
          </p>

          <label className="mt-4 block text-sm font-medium text-zinc-800">
            Motivo da inutilização
            <textarea
              value={justificativa}
              onChange={(event) => setJustificativa(event.target.value)}
              rows={3}
              className="mt-1 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
            />
          </label>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={enviando}
              onClick={confirmar}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-violet-800 px-4 text-sm font-semibold text-white hover:bg-violet-900 disabled:opacity-50"
            >
              {enviando ? "Enviando..." : "Confirmar inutilização"}
            </button>
            <button
              type="button"
              disabled={enviando}
              onClick={() => setAberto(false)}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
