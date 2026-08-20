"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  ROTULOS_FIN_NFE,
  ROTULOS_TP_NF,
  ehFinNfeSuportada,
  ehTpNf,
  type NaturezaOperacaoFiscal,
} from "@/lib/fiscal/operacoes/catalogo";

export function NaturezaOperacaoVendaForm({
  vendaId,
  naturezas,
  naturezaIdAtual,
  bloqueado,
  motivoBloqueio,
}: {
  vendaId: string;
  naturezas: NaturezaOperacaoFiscal[];
  naturezaIdAtual: string | null;
  bloqueado?: boolean;
  motivoBloqueio?: string;
}) {
  const router = useRouter();
  const [naturezaId, setNaturezaId] = useState(naturezaIdAtual ?? "");
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const selecionada =
    naturezas.find((item) => item.id === naturezaId) ?? null;

  async function salvar() {
    if (bloqueado) {
      return;
    }

    setSalvando(true);
    setMensagem(null);
    setOk(false);

    try {
      const resposta = await fetch(`/api/vendas/${vendaId}/natureza`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ natureza_id: naturezaId }),
      });
      const data = (await resposta.json()) as {
        ok?: boolean;
        erro?: string;
        mensagem?: string;
      };

      if (!resposta.ok || !data.ok) {
        setMensagem(data.erro ?? "Não foi possível salvar a natureza.");
        return;
      }

      setOk(true);
      setMensagem(data.mensagem ?? "Natureza de operação salva.");
      router.refresh();
    } catch (error) {
      setMensagem(
        error instanceof Error
          ? error.message
          : "Falha inesperada ao salvar a natureza."
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="font-semibold text-zinc-950">
            Natureza de operação
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Somente naturezas ativas do tipo Venda da empresa ativa.
            O CFOP sai da matriz desta natureza; a padrão de venda ainda
            pode usar o CFOP do grupo fiscal se a regra não existir.
          </p>
        </div>
        <Link
          href="/configuracoes/fiscal/naturezas"
          className="text-sm font-medium text-zinc-600 underline"
        >
          Cadastrar naturezas
        </Link>
      </div>

      {bloqueado && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          {motivoBloqueio ??
            "A natureza está bloqueada porque a venda já possui documento fiscal em estado sensível."}
        </div>
      )}

      {naturezas.length === 0 ? (
        <p className="mt-4 text-sm text-red-700">
          Nenhuma natureza de venda cadastrada para esta empresa.
        </p>
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-zinc-700">
              Natureza desta NF-e
            </label>
            <select
              value={naturezaId}
              disabled={bloqueado || salvando}
              onChange={(event) => {
                setNaturezaId(event.target.value);
                setMensagem(null);
                setOk(false);
              }}
              className="mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 outline-none focus:border-zinc-900 disabled:bg-zinc-50"
            >
              <option value="">Selecione</option>
              {naturezas.map((natureza) => (
                <option key={natureza.id} value={natureza.id}>
                  {natureza.descricao}
                  {natureza.padrao ? " (padrão)" : ""}
                </option>
              ))}
            </select>
          </div>

          <p className="text-sm text-zinc-600">
            <span className="text-zinc-500">tpNF:</span>{" "}
            <strong>
              {selecionada && ehTpNf(selecionada.tp_nf)
                ? ROTULOS_TP_NF[selecionada.tp_nf]
                : "—"}
            </strong>
          </p>
          <p className="text-sm text-zinc-600">
            <span className="text-zinc-500">finNFe:</span>{" "}
            <strong>
              {selecionada && ehFinNfeSuportada(selecionada.fin_nfe)
                ? ROTULOS_FIN_NFE[selecionada.fin_nfe]
                : "—"}
            </strong>
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={salvar}
          disabled={bloqueado || salvando || !naturezaId}
          className="updv-btn updv-btn-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {salvando ? "Salvando..." : "Salvar natureza"}
        </button>
        {mensagem && (
          <p className={`text-sm ${ok ? "text-emerald-700" : "text-red-700"}`}>
            {mensagem}
          </p>
        )}
      </div>
    </div>
  );
}
