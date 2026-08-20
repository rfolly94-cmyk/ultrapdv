"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  confirmarEntradaEstoque,
  criarProdutoEVincularItem,
  salvarConferenciaEntrada,
  salvarFatorConversaoEntrada,
  vincularItemEntrada,
} from "@/app/fiscal/entradas/actions";
import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  documentoEntradaPodeConfirmar,
  documentoEntradaPodeEditar,
  ncmDivergente,
  rotuloStatusEntrada,
  saldoDevolvivel,
} from "@/lib/fiscal/entrada/status";
import { rotuloStatusDevolucaoFornecedor } from "@/lib/fiscal/entrada/devolucao-status";
import type { ProdutoCandidatoEntrada } from "@/lib/fiscal/entrada/sugerir-produto";
import {
  fatorConversaoPodeConfirmar,
  quantidadeEfetivaEstoque,
  unidadesEntradaDiferentes,
  type OrigemReconhecimentoEntrada,
} from "@/lib/fiscal/entrada/vinculo-fornecedor";

type ItemDetalhe = {
  id: string;
  numeroItem: number;
  descricaoOriginal: string;
  codigoFornecedor: string | null;
  ean: string | null;
  ncm: string | null;
  cest: string | null;
  cfop: string | null;
  unidade: string | null;
  quantidadeXml: number;
  quantidadeRecebida: number;
  quantidadeEntradaEfetivada: number | null;
  valorUnitario: number;
  valorTotal: number;
  produtoId: string | null;
  ncmCadastro: string | null;
  fatorConversao: number;
  fatorConversaoConfirmado: boolean;
  origem: OrigemReconhecimentoEntrada;
  rotuloOrigem: string;
  sugestao: {
    produtoId: string;
    nome: string;
    confianca: "alta" | "media" | "baixa";
    motivo: string;
  } | null;
};

type ConflitoVinculoUi = {
  itemId: string;
  produtoIdNovo: string;
  produtoNomeAtual: string;
  codigoFornecedor: string;
};

type ResultadoAcao =
  | { ok: true; mensagem?: string }
  | {
      ok: false;
      erro: string;
      conflito?: {
        produtoId: string;
        produtoNome: string;
        codigoFornecedor: string;
      };
    };

type Movimento = {
  id: string;
  createdAt: string;
  tipo: string;
  origem: string;
  quantidade: number;
  saldoAnterior: number;
  saldoPosterior: number;
  observacao: string | null;
};

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatarData(valor: string | null) {
  if (!valor) {
    return "—";
  }
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) {
    return "—";
  }
  return data.toLocaleString("pt-BR");
}

function badgeOrigem(origem: OrigemReconhecimentoEntrada, vinculado: boolean) {
  if (vinculado && origem === "vinculo_salvo") {
    return {
      classe: "border-emerald-200 bg-emerald-50 text-emerald-800",
      texto: "✓ Vínculo salvo",
    };
  }
  if (origem === "ean" || origem === "ean_vinculo") {
    return {
      classe: "border-emerald-200 bg-emerald-50 text-emerald-800",
      texto: origem === "ean_vinculo" ? "✓ Mesmo EAN deste fornecedor" : "✓ Encontrado por EAN",
    };
  }
  if (origem === "codigo") {
    return {
      classe: "border-amber-200 bg-amber-50 text-amber-800",
      texto: "⚠ Sugestão por código",
    };
  }
  if (origem === "descricao") {
    return {
      classe: "border-amber-200 bg-amber-50 text-amber-800",
      texto: "⚠ Sugestão por descrição",
    };
  }
  if (vinculado) {
    return {
      classe: "border-emerald-200 bg-emerald-50 text-emerald-800",
      texto: "✓ Vinculado",
    };
  }
  return {
    classe: "border-amber-200 bg-amber-50 text-amber-800",
    texto: "⚠ Novo produto",
  };
}

function formatarCnpj(valor: string) {
  const digitos = valor.replace(/\D/g, "");
  if (digitos.length !== 14) {
    return valor;
  }
  return digitos.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    "$1.$2.$3/$4-$5"
  );
}

export function EntradaDetalhe({
  documento,
  itens,
  produtos,
  movimentacoes,
  devolucoes = [],
}: {
  documento: {
    id: string;
    numero: string;
    serie: string;
    chaveAcesso: string;
    modelo: string;
    status: string;
    fornecedor: string;
    cnpjEmitente: string;
    ieEmitente: string | null;
    valorProdutos: number;
    valorTotal: number;
    protocolo: string | null;
    dataEmissao: string | null;
    importadaEm: string;
    importadaPor: string | null;
    entradaProcessadaEm: string | null;
    entradaProcessadaPor: string | null;
    xmlPreservado: boolean;
  };
  itens: ItemDetalhe[];
  produtos: ProdutoCandidatoEntrada[];
  movimentacoes: Movimento[];
  devolucoes?: Array<{
    id: string;
    status: string;
    createdAt: string;
  }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [quantidades, setQuantidades] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      itens.map((item) => [item.id, String(item.quantidadeRecebida)])
    )
  );
  const [fatores, setFatores] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      itens.map((item) => [item.id, String(item.fatorConversao ?? 1)])
    )
  );
  const [conflito, setConflito] = useState<ConflitoVinculoUi | null>(null);
  const confirmando = useRef(false);
  const editavel = documentoEntradaPodeEditar(documento.status);
  const concluida = documento.status === "entrada_concluida";

  const produtosPorId = useMemo(
    () => new Map(produtos.map((produto) => [produto.id, produto])),
    [produtos]
  );

  function quantidadeRecebida(itemId: string, fallback: number) {
    const bruto = quantidades[itemId];
    if (bruto === undefined) {
      return fallback;
    }
    const n = Number(String(bruto).replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }

  const todosVinculados = itens.every((item) => {
    const qtd = quantidadeRecebida(item.id, item.quantidadeRecebida);
    return Boolean(item.produtoId) || qtd <= 0;
  });

  const fatorPendente = itens.some((item) => {
    if (!item.produtoId || quantidadeRecebida(item.id, item.quantidadeRecebida) <= 0) {
      return false;
    }
    const produto = produtosPorId.get(item.produtoId);
    return !fatorConversaoPodeConfirmar({
      unidadeXml: item.unidade,
      unidadeProduto: produto?.unidade_medida,
      fatorConversao: Number(fatores[item.id] ?? item.fatorConversao ?? 1),
      confirmado: item.fatorConversaoConfirmado,
    });
  });

  function itensConferencia() {
    return itens.map((item) => ({
      id: item.id,
      quantidadeRecebida: quantidadeRecebida(item.id, item.quantidadeRecebida),
    }));
  }

  function executar(
    acao: () => Promise<ResultadoAcao>,
    contexto?: { itemId: string; produtoIdNovo: string }
  ) {
    setErro(null);
    setSucesso(null);
    startTransition(async () => {
      const resultado = await acao();
      if (!resultado.ok) {
        if (resultado.conflito && contexto) {
          setConflito({
            itemId: contexto.itemId,
            produtoIdNovo: contexto.produtoIdNovo,
            produtoNomeAtual: resultado.conflito.produtoNome,
            codigoFornecedor: resultado.conflito.codigoFornecedor,
          });
        }
        setErro(resultado.erro);
        confirmando.current = false;
        return;
      }
      setConflito(null);
      setSucesso(resultado.mensagem ?? "Atualizado.");
      confirmando.current = false;
      router.refresh();
    });
  }

  function vincular(
    itemId: string,
    produtoId: string | null,
    confirmarTrocaVinculo = false
  ) {
    executar(
      () =>
        vincularItemEntrada({
          documentoId: documento.id,
          itemId,
          produtoId,
          confirmarTrocaVinculo,
        }),
      produtoId
        ? { itemId, produtoIdNovo: produtoId }
        : undefined
    );
  }

  function confirmar() {
    if (confirmando.current || pending) {
      return;
    }
    confirmando.current = true;
    executar(() =>
      confirmarEntradaEstoque({
        documentoId: documento.id,
        itens: itensConferencia(),
      })
    );
  }

  return (
    <div className="space-y-4 px-4 py-4">
      {erro ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          {erro}
        </div>
      ) : null}
      {sucesso ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
          {sucesso}
        </div>
      ) : null}

      {concluida ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
          Entrada concluída ✓ O estoque desta NF-e já foi movimentado.
        </div>
      ) : documento.status === "pronta_para_entrada" ? (
        <div className="rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-[13px] text-indigo-900">
          Pronta para entrada: os produtos já estão vinculados. O estoque
          ainda <strong>não</strong> entrou. Clique em{" "}
          <strong>Confirmar entrada no estoque</strong>.
        </div>
      ) : null}

      <section className="rounded border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-zinc-950">
              Fornecedor {documento.fornecedor}
            </h2>
            <p className="mt-1 text-[13px] text-zinc-600">
              CNPJ {formatarCnpj(documento.cnpjEmitente)}
              {documento.ieEmitente ? ` · IE ${documento.ieEmitente}` : ""}
            </p>
          </div>
          <StatusBadge status={documento.status}>
            {rotuloStatusEntrada(documento.status)}
          </StatusBadge>
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-zinc-500">Chave</dt>
            <dd className="font-mono text-[12px] text-zinc-900">
              {documento.chaveAcesso}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Número / série</dt>
            <dd>
              {documento.numero} / {documento.serie} · modelo {documento.modelo}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Emissão</dt>
            <dd>{formatarData(documento.dataEmissao)}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Valor</dt>
            <dd>
              Produtos {moeda.format(documento.valorProdutos)} · Total{" "}
              {moeda.format(documento.valorTotal)}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Importada em</dt>
            <dd>
              {formatarData(documento.importadaEm)}
              {documento.importadaPor ? ` · ${documento.importadaPor}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Entrada processada em</dt>
            <dd>
              {formatarData(documento.entradaProcessadaEm)}
              {documento.entradaProcessadaPor
                ? ` · ${documento.entradaProcessadaPor}`
                : ""}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Estoque de destino</dt>
            <dd>Empresa ativa (saldo por produto, sem filial neste schema)</dd>
          </div>
          <div>
            <dt className="text-zinc-500">XML original</dt>
            <dd>
              {documento.xmlPreservado
                ? "Preservado e isolado por empresa"
                : "—"}
            </dd>
          </div>
          {documento.protocolo ? (
            <div>
              <dt className="text-zinc-500">Protocolo</dt>
              <dd>{documento.protocolo}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {editavel && todosVinculados && itens.length > 0 ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
          ✓ Todos os produtos vinculados
        </div>
      ) : null}

      {conflito ? (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-3 text-[13px] text-amber-900">
          <p className="font-medium">
            Este código do fornecedor já está vinculado ao produto:
          </p>
          <p className="mt-1">
            {conflito.produtoNomeAtual}
            {conflito.codigoFornecedor
              ? ` · cProd ${conflito.codigoFornecedor}`
              : ""}
          </p>
          <p className="mt-2">Deseja alterar o vínculo?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="updv-btn updv-btn-primary disabled:opacity-60"
              disabled={pending}
              onClick={() =>
                vincular(conflito.itemId, conflito.produtoIdNovo, true)
              }
            >
              Alterar vínculo
            </button>
            <button
              type="button"
              className="updv-btn updv-btn-ghost"
              disabled={pending}
              onClick={() => {
                setConflito(null);
                setErro(null);
              }}
            >
              Manter o atual
            </button>
          </div>
        </div>
      ) : null}

      <section className="rounded border border-zinc-200 bg-white">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <h3 className="text-[14px] font-semibold">Conferir entrada</h3>
          {editavel ? (
            <button
              type="button"
              className="updv-btn updv-btn-ghost disabled:opacity-60"
              disabled={pending}
              onClick={() =>
                executar(() =>
                  salvarConferenciaEntrada({
                    documentoId: documento.id,
                    itens: itensConferencia(),
                  })
                )
              }
            >
              Salvar conferência
            </button>
          ) : null}
        </div>

        <DataTable minWidth={1280}>
          <thead>
            <tr>
              <th>Item XML</th>
              <th>Produto Ultra</th>
              <th>Situação</th>
              <th className="num">NF-e</th>
              <th className="num">Recebido</th>
              <th>Fiscal</th>
            </tr>
          </thead>
          <tbody>
            {itens.length === 0 ? (
              <DataTableEmpty colSpan={6}>
                Esta NF-e não possui itens.
              </DataTableEmpty>
            ) : (
              itens.map((item) => {
                const qtd = quantidadeRecebida(
                  item.id,
                  item.quantidadeRecebida
                );
                const divergenteQtd = qtd !== item.quantidadeXml;
                const produto = item.produtoId
                  ? produtosPorId.get(item.produtoId)
                  : null;
                const ncmNota = item.ncm;
                const ncmCadastro = item.ncmCadastro;
                const divergenteNcm = ncmDivergente(ncmNota, ncmCadastro);
                const unidadesDiferentes = unidadesEntradaDiferentes(
                  item.unidade,
                  produto?.unidade_medida
                );
                const fatorOk = fatorConversaoPodeConfirmar({
                  unidadeXml: item.unidade,
                  unidadeProduto: produto?.unidade_medida,
                  fatorConversao: Number(
                    fatores[item.id] ?? item.fatorConversao ?? 1
                  ),
                  confirmado: item.fatorConversaoConfirmado,
                });
                const qtdEfetiva = quantidadeEfetivaEstoque(
                  qtd,
                  Number(fatores[item.id] ?? item.fatorConversao ?? 1)
                );
                const situacao = badgeOrigem(item.origem, Boolean(item.produtoId));

                return (
                  <tr key={item.id}>
                    <td>
                      <div className="font-medium text-zinc-900">
                        {item.descricaoOriginal}
                      </div>
                      <div className="text-[12px] text-zinc-500">
                        {item.codigoFornecedor
                          ? `cProd ${item.codigoFornecedor}`
                          : null}
                        {item.ean ? ` · EAN ${item.ean}` : ""}
                        {item.unidade ? ` · ${item.unidade}` : ""}
                      </div>
                    </td>
                    <td>
                      {editavel ? (
                        <div className="space-y-1.5">
                          <select
                            className="updv-input w-full min-w-[220px] text-[13px]"
                            value={item.produtoId ?? ""}
                            disabled={pending}
                            onChange={(event) => {
                              const valor = event.target.value || null;
                              vincular(item.id, valor);
                            }}
                          >
                            <option value="">Pendente</option>
                            {produtos.map((produtoOption) => (
                              <option
                                key={produtoOption.id}
                                value={produtoOption.id}
                              >
                                {produtoOption.codigo
                                  ? `${produtoOption.codigo} — `
                                  : ""}
                                {produtoOption.nome}
                              </option>
                            ))}
                          </select>
                          <div className="flex flex-wrap gap-1.5">
                            {item.sugestao &&
                            item.sugestao.produtoId !== item.produtoId ? (
                              <button
                                type="button"
                                className="updv-btn-row"
                                disabled={pending}
                                onClick={() =>
                                  vincular(item.id, item.sugestao!.produtoId)
                                }
                              >
                                {item.origem === "ean" ||
                                item.origem === "ean_vinculo"
                                  ? "Confirmar vínculo"
                                  : "Vincular existente"}
                                : {item.sugestao.nome}
                              </button>
                            ) : null}
                            {!item.produtoId ? (
                              <button
                                type="button"
                                className="updv-btn-row"
                                disabled={pending}
                                onClick={() =>
                                  executar(() =>
                                    criarProdutoEVincularItem({
                                      documentoId: documento.id,
                                      itemId: item.id,
                                    })
                                  )
                                }
                              >
                                Cadastrar novo produto
                              </button>
                            ) : null}
                          </div>
                          {unidadesDiferentes ? (
                            <div
                              className={`rounded border px-2 py-1.5 text-[12px] ${
                                fatorOk
                                  ? "border-zinc-200 bg-zinc-50 text-zinc-700"
                                  : "border-amber-200 bg-amber-50 text-amber-900"
                              }`}
                            >
                              <div>
                                Unidade da NF-e: {item.unidade} · Ultra:{" "}
                                {produto?.unidade_medida}
                              </div>
                              <label className="mt-1 flex items-center gap-2">
                                <span>1 {item.unidade} =</span>
                                <input
                                  className="updv-input w-20 text-right"
                                  value={fatores[item.id] ?? ""}
                                  disabled={pending}
                                  onChange={(event) =>
                                    setFatores((atual) => ({
                                      ...atual,
                                      [item.id]: event.target.value,
                                    }))
                                  }
                                />
                                <span>{produto?.unidade_medida}</span>
                                <button
                                  type="button"
                                  className="updv-btn-row"
                                  disabled={pending}
                                  onClick={() =>
                                    executar(() =>
                                      salvarFatorConversaoEntrada({
                                        documentoId: documento.id,
                                        itemId: item.id,
                                        fatorConversao: Number(
                                          String(fatores[item.id] ?? "").replace(
                                            ",",
                                            "."
                                          )
                                        ),
                                      })
                                    )
                                  }
                                >
                                  Salvar fator
                                </button>
                              </label>
                              <div className="mt-1">
                                Estoque previsto: {qtdEfetiva}{" "}
                                {produto?.unidade_medida}
                              </div>
                              {!fatorOk ? (
                                <div className="mt-1 font-medium">
                                  Configure o fator antes de confirmar a entrada.
                                </div>
                              ) : null}
                            </div>
                          ) : item.produtoId ? (
                            <div className="text-[11px] text-zinc-500">
                              Estoque previsto: {qtdEfetiva}{" "}
                              {produto?.unidade_medida ?? item.unidade ?? "UN"}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div>
                          {produto?.nome ?? "—"}
                          {produto?.codigo ? (
                            <div className="text-[12px] text-zinc-500">
                              {produto.codigo}
                            </div>
                          ) : null}
                          {item.quantidadeEntradaEfetivada != null ? (
                            <div className="text-[11px] text-zinc-500">
                              Entrada efetiva: {item.quantidadeEntradaEfetivada}
                              {item.fatorConversao !== 1
                                ? ` · fator ${item.fatorConversao}`
                                : ""}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td>
                      <span
                        className={`inline-flex rounded border px-2 py-0.5 text-[11px] ${situacao.classe}`}
                      >
                        {situacao.texto}
                      </span>
                      <div className="mt-1 text-[11px] text-zinc-500">
                        {item.rotuloOrigem}
                      </div>
                    </td>
                    <td className="num">{item.quantidadeXml}</td>
                    <td className="num">
                      {editavel ? (
                        <input
                          className={`updv-input w-24 text-right ${
                            divergenteQtd ? "border-amber-400" : ""
                          }`}
                          value={quantidades[item.id] ?? ""}
                          onChange={(event) =>
                            setQuantidades((atual) => ({
                              ...atual,
                              [item.id]: event.target.value,
                            }))
                          }
                        />
                      ) : (
                        item.quantidadeRecebida
                      )}
                      {divergenteQtd ? (
                        <div className="text-[11px] text-amber-700">
                          Divergente da NF-e
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <div className="text-[12px] text-zinc-600">
                        NCM nota: {ncmNota || "—"}
                        {item.cfop ? ` · CFOP ${item.cfop}` : ""}
                      </div>
                      {produto ? (
                        <div className="text-[12px] text-zinc-600">
                          NCM cadastro: {ncmCadastro || "—"}
                        </div>
                      ) : null}
                      {divergenteNcm ? (
                        <div className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                          NCM da nota: {ncmNota}
                          <br />
                          NCM cadastrado: {ncmCadastro}
                          <div className="mt-1">
                            Cadastro fiscal de saída não foi alterado.
                          </div>
                        </div>
                      ) : null}
                      {concluida ? (
                        <div className="mt-1 text-[11px] text-zinc-500">
                          Saldo devolvível:{" "}
                          {saldoDevolvivel({
                            quantidadeEntradaEfetivada:
                              item.quantidadeEntradaEfetivada,
                            quantidadeJaDevolvida: 0,
                          })}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </DataTable>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {editavel && documentoEntradaPodeConfirmar(documento.status) ? (
          <button
            type="button"
            className="updv-btn updv-btn-primary disabled:opacity-60"
            disabled={pending || !todosVinculados || fatorPendente}
            onClick={confirmar}
            title={
              !todosVinculados
                ? "Vincule todos os produtos antes de confirmar."
                : fatorPendente
                  ? "Configure o fator de conversão dos itens com unidade diferente."
                  : undefined
            }
          >
            {pending ? "Processando..." : "Confirmar entrada no estoque"}
          </button>
        ) : null}

        {concluida ? (
          <a href="#movimentacoes" className="updv-btn updv-btn-ghost">
            Ver movimentações
          </a>
        ) : null}

        {concluida ? (
          <a
            href={`/fiscal/entradas/${documento.id}/devolver`}
            className="updv-btn updv-btn-primary"
          >
            Devolver itens
          </a>
        ) : (
          <button
            type="button"
            className="updv-btn updv-btn-ghost"
            disabled
            title="A devolução só pode nascer de uma NF-e de entrada já processada."
          >
            Devolver itens
          </button>
        )}
      </div>

      {devolucoes.length > 0 ? (
        <section className="rounded border border-zinc-200 bg-white">
          <div className="border-b border-zinc-200 px-4 py-3">
            <h3 className="text-[14px] font-semibold">
              Devoluções ao fornecedor
            </h3>
          </div>
          <ul className="divide-y divide-zinc-100">
            {devolucoes.map((devolucao) => (
              <li key={devolucao.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-2">
                  <StatusBadge status={devolucao.status}>
                    {rotuloStatusDevolucaoFornecedor(devolucao.status)}
                  </StatusBadge>
                  <span className="text-[12px] text-zinc-500">
                    {new Date(devolucao.createdAt).toLocaleString("pt-BR")}
                  </span>
                </div>
                <a
                  href={`/fiscal/entradas/devolucoes/${devolucao.id}`}
                  className="updv-btn updv-btn-ghost"
                >
                  Abrir
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {concluida ? (
        <section
          id="movimentacoes"
          className="rounded border border-zinc-200 bg-white"
        >
          <div className="border-b border-zinc-200 px-4 py-3">
            <h3 className="text-[14px] font-semibold">
              Movimentações de estoque
            </h3>
          </div>
          <DataTable minWidth={720}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Origem</th>
                <th className="num">Qtd</th>
                <th className="num">Saldo ant.</th>
                <th className="num">Saldo post.</th>
              </tr>
            </thead>
            <tbody>
              {movimentacoes.length === 0 ? (
                <DataTableEmpty colSpan={6}>
                  Nenhuma movimentação encontrada.
                </DataTableEmpty>
              ) : (
                movimentacoes.map((mov) => (
                  <tr key={mov.id}>
                    <td>{formatarData(mov.createdAt)}</td>
                    <td>{mov.tipo}</td>
                    <td>{mov.origem}</td>
                    <td className="num">{mov.quantidade}</td>
                    <td className="num">{mov.saldoAnterior}</td>
                    <td className="num">{mov.saldoPosterior}</td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </section>
      ) : null}
    </div>
  );
}
