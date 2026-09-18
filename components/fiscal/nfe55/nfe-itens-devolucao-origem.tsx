"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { listarNotasEntradaParaDevolucao } from "@/app/fiscal/entradas/devolucao-actions";
import { nfeInput } from "@/components/fiscal/nfe55/nfe-form-primitives";
import {
  hrefDevolverNotaEntrada,
  MENSAGEM_DEVOLUCAO_SELECIONE_ORIGEM,
} from "@/lib/fiscal/nfe55/defaults-natureza";

type EntradaOpcao = {
  id: string;
  numero: string;
  serie: string;
  chave: string;
  emitente: string;
};

export function NfeItensDevolucaoOrigem({
  tipoOperacaoInterno,
  naturezaId,
  bloqueado,
}: {
  tipoOperacaoInterno: string;
  naturezaId: string;
  bloqueado?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [entradas, setEntradas] = useState<EntradaOpcao[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const ehFornecedor = tipoOperacaoInterno === "devolucao_fornecedor";

  function carregar(termo: string) {
    startTransition(async () => {
      const resultado = await listarNotasEntradaParaDevolucao({ busca: termo });
      if (!resultado.ok) {
        setErro(resultado.erro);
        setEntradas([]);
        return;
      }
      setErro(null);
      setEntradas(resultado.entradas);
    });
  }

  useEffect(() => {
    if (!aberto || !ehFornecedor) {
      return;
    }
    if (timer.current) {
      window.clearTimeout(timer.current);
    }
    timer.current = window.setTimeout(() => carregar(busca), busca.trim() ? 250 : 0);
    return () => {
      if (timer.current) {
        window.clearTimeout(timer.current);
      }
    };
  }, [aberto, busca, ehFornecedor]);

  return (
    <div className="space-y-3" data-nfe-itens-devolucao="true">
      <p className="text-[13px] text-zinc-600">
        {MENSAGEM_DEVOLUCAO_SELECIONE_ORIGEM}
      </p>
      {ehFornecedor ? (
        <>
          <button
            type="button"
            className="updv-btn updv-btn-primary"
            disabled={bloqueado || pending}
            onClick={() => setAberto(true)}
          >
            Selecionar nota de entrada
          </button>
          {aberto ? (
            <div className="nfe-busca-item max-w-xl">
              <input
                className={nfeInput}
                placeholder="Pesquisar NF-e de entrada: número, chave ou emitente"
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
                autoComplete="off"
                autoFocus
              />
              {erro ? (
                <p className="mt-2 text-[12px] text-red-700">{erro}</p>
              ) : pending && entradas.length === 0 ? (
                <p className="mt-2 text-[12px] text-zinc-500">Carregando notas da empresa ativa…</p>
              ) : entradas.length === 0 ? (
                <p className="mt-2 text-[12px] text-zinc-500">
                  Nenhuma NF-e de entrada processada encontrada na empresa ativa.
                </p>
              ) : (
                <div className="nfe-sugestoes nfe-sugestoes-produtos" role="listbox">
                  {entradas.map((entrada) => (
                    <button
                      key={entrada.id}
                      type="button"
                      className="nfe-sugestao"
                      disabled={pending || bloqueado}
                      onClick={() =>
                        router.push(hrefDevolverNotaEntrada(entrada.id, naturezaId))
                      }
                    >
                      <span className="nfe-sugestao-titulo">
                        NF-e {entrada.numero}
                        {entrada.serie ? ` / série ${entrada.serie}` : ""} · {entrada.emitente || "Emitente"}
                      </span>
                      <span className="nfe-sugestao-meta font-mono">
                        {entrada.chave}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-[12px] text-zinc-500">
          Esta devolução ainda não possui fluxo de origem neste emissor. Não adicione
          itens avulsos do cadastro.
        </p>
      )}
    </div>
  );
}
