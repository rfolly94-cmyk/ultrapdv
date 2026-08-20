"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { criarDevolucaoFornecedor } from "@/app/fiscal/entradas/devolucao-actions";
import { DataTable, DataTableEmpty } from "@/components/ui/data-table";

export function DevolverItensForm({
  documentoId,
  numero,
  chave,
  fornecedor,
  itens,
  naturezas,
  naturezaIdInicial,
}: {
  documentoId: string;
  numero: string;
  chave: string;
  fornecedor: string;
  naturezaIdInicial: string;
  naturezas: Array<{
    id: string;
    descricao: string;
    tpNf: string;
    finNfe: string;
  }>;
  itens: Array<{
    id: string;
    descricao: string;
    produto: string;
    recebido: number;
    jaDevolvido: number;
    disponivel: number;
  }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [naturezaId, setNaturezaId] = useState(naturezaIdInicial);
  const [quantidades, setQuantidades] = useState<Record<string, string>>(() =>
    Object.fromEntries(itens.map((item) => [item.id, "0"]))
  );

  function enviar() {
    setErro(null);
    startTransition(async () => {
      const resultado = await criarDevolucaoFornecedor({
        documentoEntradaId: documentoId,
        naturezaId: naturezaId || null,
        itens: itens.map((item) => ({
          itemEntradaId: item.id,
          quantidade: Number(String(quantidades[item.id] ?? "0").replace(",", ".")),
        })),
      });
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      router.push(`/fiscal/entradas/devolucoes/${resultado.devolucaoId}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 px-4 py-4">
      {erro ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          {erro}
        </div>
      ) : null}

      <section className="rounded border border-zinc-200 bg-white p-4 text-[13px]">
        <h2 className="text-[15px] font-semibold">Documento original</h2>
        <p className="mt-2">NF-e {numero} · {fornecedor}</p>
        <p className="mt-1 font-mono text-[12px] text-zinc-600">{chave}</p>
        <p className="mt-2 text-zinc-500">
          Criar a devolução não reduz estoque. A saída só ocorre depois da NF-e
          autorizada e da confirmação física.
        </p>
      </section>

      <section className="rounded border border-zinc-200 bg-white p-4">
        <label className="block text-[13px] font-medium">
          Natureza da operação
        </label>
        <select
          className="updv-input mt-2 w-full max-w-xl"
          value={naturezaId}
          onChange={(event) => setNaturezaId(event.target.value)}
        >
          <option value="">Selecione</option>
          {naturezas.map((natureza) => (
            <option key={natureza.id} value={natureza.id}>
              {natureza.descricao} · tpNF {natureza.tpNf} · finNFe {natureza.finNfe}
            </option>
          ))}
        </select>
        {naturezas.length === 0 ? (
          <p className="mt-2 text-[13px] text-amber-800">
            Cadastre uma natureza do tipo Devolução para fornecedor em
            Configurações → Fiscal → Naturezas.
          </p>
        ) : null}
      </section>

      <section className="rounded border border-zinc-200 bg-white">
        <DataTable minWidth={900}>
          <thead>
            <tr>
              <th>Produto</th>
              <th className="num">Recebido</th>
              <th className="num">Já devolvido</th>
              <th className="num">Disponível</th>
              <th className="num">Devolver</th>
            </tr>
          </thead>
          <tbody>
            {itens.length === 0 ? (
              <DataTableEmpty colSpan={5}>
                Nenhum item efetivado nesta entrada.
              </DataTableEmpty>
            ) : (
              itens.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="font-medium">{item.descricao}</div>
                    <div className="text-[12px] text-zinc-500">{item.produto}</div>
                  </td>
                  <td className="num">{item.recebido}</td>
                  <td className="num">{item.jaDevolvido}</td>
                  <td className="num">{item.disponivel}</td>
                  <td className="num">
                    <input
                      className="updv-input w-24 text-right"
                      value={quantidades[item.id] ?? "0"}
                      disabled={item.disponivel <= 0 || pending}
                      onChange={(event) =>
                        setQuantidades((atual) => ({
                          ...atual,
                          [item.id]: event.target.value,
                        }))
                      }
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
      </section>

      <button
        type="button"
        className="updv-btn updv-btn-primary disabled:opacity-60"
        disabled={pending}
        onClick={enviar}
      >
        {pending ? "Criando..." : "Continuar para verificação fiscal"}
      </button>
    </div>
  );
}
