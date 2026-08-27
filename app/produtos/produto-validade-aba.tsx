"use client";

import { useEffect, useState, useTransition } from "react";

import {
  excluirLoteProduto,
  listarLotesProduto,
  salvarControleValidadeProduto,
  salvarLoteProduto,
} from "./actions";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  formatarDataBr,
  formatarQuantidadeLote,
  resumoDistribuicaoLotes,
  rotuloStatusValidade,
  statusValidadeLote,
  validarQuantidadeContraEstoque,
  type LoteEstoque,
} from "@/lib/produtos/lotes";

type Props = {
  produtoId?: string;
  controlarValidade?: boolean;
};

const LOTE_VAZIO = {
  codigo_lote: "",
  data_fabricacao: "",
  data_validade: "",
  quantidade: "0",
  observacao: "",
};

export function ProdutoValidadeAba({
  produtoId,
  controlarValidade = false,
}: Props) {
  const [ativo, setAtivo] = useState(controlarValidade);
  const [lotes, setLotes] = useState<LoteEstoque[]>([]);
  const [estoqueAtual, setEstoqueAtual] = useState(0);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [formulario, setFormulario] = useState(LOTE_VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setAtivo(controlarValidade);
  }, [controlarValidade]);

  useEffect(() => {
    if (!produtoId) {
      return;
    }

    startTransition(async () => {
      const resultado = await listarLotesProduto(produtoId);
      if (resultado.ok) {
        setLotes(resultado.lotes);
        setEstoqueAtual(resultado.estoqueAtual);
      }
    });
  }, [produtoId]);

  function preencher(lote: LoteEstoque) {
    setEditandoId(lote.id);
    setFormulario({
      codigo_lote: lote.codigo_lote,
      data_fabricacao: lote.data_fabricacao?.slice(0, 10) ?? "",
      data_validade: lote.data_validade.slice(0, 10),
      quantidade: String(lote.quantidade ?? 0),
      observacao: lote.observacao ?? "",
    });
    setErro(null);
  }

  function limparFormulario() {
    setEditandoId(null);
    setFormulario(LOTE_VAZIO);
    setErro(null);
  }

  function alternarControle(marcado: boolean) {
    setAtivo(marcado);
    if (!produtoId) {
      return;
    }

    startTransition(async () => {
      const resultado = await salvarControleValidadeProduto(
        produtoId,
        marcado
      );
      if (!resultado.ok) {
        setAtivo(!marcado);
        setErro(resultado.erro);
      }
    });
  }

  function salvarLote() {
    if (!produtoId) {
      return;
    }

    const quantidade = Number(
      String(formulario.quantidade).replace(",", ".")
    );
    const erroEstoque = validarQuantidadeContraEstoque({
      estoqueAtual,
      lotes,
      quantidadeNova: Number.isFinite(quantidade) ? quantidade : Number.NaN,
      loteId: editandoId,
    });
    if (erroEstoque) {
      setErro(erroEstoque);
      return;
    }

    startTransition(async () => {
      const resultado = await salvarLoteProduto({
        produtoId,
        loteId: editandoId,
        codigoLote: formulario.codigo_lote,
        dataFabricacao: formulario.data_fabricacao,
        dataValidade: formulario.data_validade,
        quantidade: formulario.quantidade,
        observacao: formulario.observacao,
      });

      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }

      const lista = await listarLotesProduto(produtoId);
      if (lista.ok) {
        setLotes(lista.lotes);
        setEstoqueAtual(lista.estoqueAtual);
      }
      limparFormulario();
    });
  }

  function removerLote(loteId: string) {
    if (!produtoId) {
      return;
    }

    startTransition(async () => {
      const resultado = await excluirLoteProduto(produtoId, loteId);
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      setLotes((atuais) => atuais.filter((lote) => lote.id !== loteId));
      if (editandoId === loteId) {
        limparFormulario();
      }
    });
  }

  const resumo = resumoDistribuicaoLotes({
    estoqueAtual,
    lotes,
  });

  return (
    <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <h3 className="text-sm font-semibold text-zinc-950">
        Controle de validade
      </h3>
      <p className="mt-1 text-xs text-zinc-500">
        A validade fica nos lotes, não no produto. Os lotes distribuem o
        estoque já existente e não alteram o saldo geral. Entrada de
        mercadoria continua no fluxo de estoque.
      </p>

      <label className="mt-4 flex items-center gap-2 text-sm font-medium text-zinc-800">
        <input
          type="checkbox"
          name="controlar_validade"
          value="1"
          checked={ativo}
          onChange={(event) => alternarControle(event.target.checked)}
          className="size-4 rounded border-zinc-300"
        />
        Controlar validade por lotes
      </label>

      {!produtoId && (
        <p className="mt-3 text-sm text-zinc-600">
          Salve o produto para cadastrar lotes. Nada é gravado até você
          confirmar o cadastro.
        </p>
      )}

      {erro && (
        <p className="mt-3 text-sm text-red-600">{erro}</p>
      )}

      {produtoId && ativo && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-3 md:grid-cols-3">
            <ResumoEstoque
              rotulo="Estoque atual"
              valor={resumo.estoqueAtual}
            />
            <ResumoEstoque
              rotulo="Quantidade vinculada a lotes"
              valor={resumo.vinculado}
            />
            <ResumoEstoque
              rotulo="Saldo sem lote"
              valor={resumo.saldoSemLote}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-5">
            <CampoLote
              label="Lote"
              value={formulario.codigo_lote}
              onChange={(valor) =>
                setFormulario((atual) => ({ ...atual, codigo_lote: valor }))
              }
            />
            <CampoLote
              label="Fabricação"
              type="date"
              value={formulario.data_fabricacao}
              onChange={(valor) =>
                setFormulario((atual) => ({
                  ...atual,
                  data_fabricacao: valor,
                }))
              }
            />
            <CampoLote
              label="Validade"
              type="date"
              value={formulario.data_validade}
              onChange={(valor) =>
                setFormulario((atual) => ({
                  ...atual,
                  data_validade: valor,
                }))
              }
            />
            <CampoLote
              label="Quantidade"
              value={formulario.quantidade}
              onChange={(valor) =>
                setFormulario((atual) => ({ ...atual, quantidade: valor }))
              }
            />
            <CampoLote
              label="Observação"
              value={formulario.observacao}
              onChange={(valor) =>
                setFormulario((atual) => ({ ...atual, observacao: valor }))
              }
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={salvarLote}
              className="updv-btn updv-btn-primary"
            >
              {isPending
                ? "Salvando..."
                : editandoId
                  ? "Salvar lote"
                  : "Adicionar lote"}
            </button>
            {editandoId && (
              <button
                type="button"
                onClick={limparFormulario}
                className="updv-btn updv-btn-ghost"
              >
                Cancelar edição
              </button>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-zinc-50 text-xs font-semibold uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Lote</th>
                  <th className="px-3 py-2">Fabricação</th>
                  <th className="px-3 py-2">Validade</th>
                  <th className="px-3 py-2 text-right">Quantidade</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {lotes.map((lote) => {
                  const status = statusValidadeLote(lote.data_validade);
                  return (
                    <tr key={lote.id} className="border-t border-zinc-100">
                      <td className="px-3 py-2 font-medium">
                        {lote.codigo_lote}
                      </td>
                      <td className="px-3 py-2">
                        {formatarDataBr(lote.data_fabricacao)}
                      </td>
                      <td className="px-3 py-2">
                        {formatarDataBr(lote.data_validade)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatarQuantidadeLote(Number(lote.quantidade))}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={status}>
                          {rotuloStatusValidade(status)}
                        </StatusBadge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="updv-btn updv-btn-ghost mr-1"
                          onClick={() => preencher(lote)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="updv-btn updv-btn-ghost text-red-600"
                          onClick={() => removerLote(lote.id)}
                        >
                          Excluir
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {lotes.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-6 text-center text-sm text-zinc-500"
                    >
                      Nenhum lote cadastrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function ResumoEstoque({
  rotulo,
  valor,
}: {
  rotulo: string;
  valor: number;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-zinc-500">{rotulo}</p>
      <p className="mt-1 text-sm font-semibold text-zinc-950">
        {formatarQuantidadeLote(valor)}
      </p>
    </div>
  );
}

function CampoLote({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (valor: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-600">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900"
      />
    </div>
  );
}
