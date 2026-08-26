"use client";

import { useState, useTransition } from "react";

import { CampoValor } from "@/components/ui/campo-valor";
import {
  adicionarItensDevolucaoFornecedor,
  listarEntradasElegiveisDevolucao,
} from "@/app/fiscal/entradas/devolucao-actions";

type EntradaElegivel = {
  id: string;
  numero: string;
  serie: string;
  chave: string;
  itens: Array<{
    id: string;
    descricao: string;
    numeroItem: number;
    quantidadeRecebida: number;
    saldo: number;
  }>;
};

export function AdicionarItensEntradaDevolucao({
  devolucaoId,
  bloqueado,
  onConcluido,
  onErro,
}: {
  devolucaoId: string;
  bloqueado?: boolean;
  onConcluido: (mensagem: string) => void;
  onErro: (erro: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [pending, startTransition] = useTransition();
  const [entradas, setEntradas] = useState<EntradaElegivel[]>([]);
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);

  function abrir() {
    setErro(null);
    setAberto(true);
    startTransition(async () => {
      const resultado = await listarEntradasElegiveisDevolucao({
        devolucaoId,
      });
      if (!resultado.ok) {
        setErro(resultado.erro);
        onErro(resultado.erro);
        return;
      }
      setEntradas(resultado.entradas);
    });
  }

  function confirmar() {
    const itens = Object.entries(quantidades)
      .map(([itemEntradaId, valor]) => ({
        itemEntradaId,
        quantidade: Number(String(valor).replace(",", ".")),
      }))
      .filter((item) => item.quantidade > 0);

    startTransition(async () => {
      const resultado = await adicionarItensDevolucaoFornecedor({
        devolucaoId,
        itens,
      });
      if (!resultado.ok) {
        setErro(resultado.erro);
        onErro(resultado.erro);
        return;
      }
      setAberto(false);
      setQuantidades({});
      onConcluido(resultado.mensagem ?? "Itens adicionados.");
    });
  }

  return (
    <>
      <button
        type="button"
        className="updv-btn updv-btn-ghost disabled:opacity-60"
        disabled={bloqueado || pending}
        onClick={abrir}
      >
        + Adicionar itens de outras entradas
      </button>

      {aberto ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="mt-10 w-full max-w-2xl rounded border border-zinc-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-semibold">
                  Itens de outras NF-e de entrada
                </h3>
                <p className="mt-1 text-[12px] text-zinc-500">
                  Somente a mesma empresa, o mesmo fornecedor e saldo devolvível.
                </p>
              </div>
              <button
                type="button"
                className="updv-btn updv-btn-ghost"
                onClick={() => setAberto(false)}
              >
                Fechar
              </button>
            </div>

            {erro ? (
              <p className="mt-3 text-[13px] text-red-700">{erro}</p>
            ) : null}

            <div className="mt-4 max-h-[60vh] space-y-4 overflow-y-auto">
              {pending && entradas.length === 0 ? (
                <p className="text-[13px] text-zinc-500">Carregando...</p>
              ) : null}
              {entradas.map((entrada) => (
                <div key={entrada.id} className="rounded border border-zinc-200 p-3">
                  <p className="font-medium">
                    NF-e {entrada.numero}
                    {entrada.serie ? ` · série ${entrada.serie}` : ""}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-zinc-500">
                    {entrada.chave}
                  </p>
                  <div className="mt-2 space-y-2">
                    {entrada.itens.map((item) => (
                      <label
                        key={item.id}
                        className="flex flex-wrap items-center justify-between gap-2 text-[13px]"
                      >
                        <span>
                          {item.descricao}
                          <span className="ml-2 text-zinc-500">
                            item {item.numeroItem} · saldo {item.saldo}
                          </span>
                        </span>
                        <CampoValor
                          className="updv-input w-24"
                          inputMode="decimal"
                          placeholder="Qtd"
                          value={quantidades[item.id] ?? ""}
                          onChange={(event) =>
                            setQuantidades((atual) => ({
                              ...atual,
                              [item.id]: event.target.value,
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              {!pending && entradas.length === 0 ? (
                <p className="text-[13px] text-zinc-500">
                  Não há outras entradas deste fornecedor com saldo devolvível.
                </p>
              ) : null}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="updv-btn updv-btn-primary disabled:opacity-60"
                disabled={pending}
                onClick={confirmar}
              >
                {pending ? "Adicionando..." : "Adicionar selecionados"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
