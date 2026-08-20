"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  confirmarSaidaDevolucaoFornecedor,
  salvarInformacoesAdicionaisDevolucao,
  salvarNaturezaDevolucaoFornecedor,
  salvarTransporteDevolucaoFornecedor,
  verificarDevolucaoFornecedorAction,
} from "@/app/fiscal/entradas/devolucao-actions";
import { EmissaoFiscalAcoes } from "@/components/fiscal/emissao-fiscal-acoes";
import { EmissaoFiscalHistorico } from "@/components/fiscal/emissao-fiscal-historico";
import { AdicionarItensEntradaDevolucao } from "@/components/fiscal/nfe55/adicionar-itens-entrada";
import { Nfe55Editor } from "@/components/fiscal/nfe55/nfe55-editor";
import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  TransporteVendaForm,
  type DadosTransporteVenda,
  type TransportadoraCadastro,
} from "@/components/vendas/transporte-venda-form";
import { resolverAcoesEmissaoFiscal } from "@/lib/fiscal/acoes-emissao";
import type { EventoEmissaoFiscal } from "@/lib/fiscal/eventos-emissao";
import type { TentativaFiscalResumo } from "@/lib/fiscal/emissao-tentativas";
import {
  devolucaoPodeConfirmarSaida,
  devolucaoPodeEditar,
  devolucaoPodeEmitir,
  rotuloStatusDevolucaoFornecedor,
} from "@/lib/fiscal/entrada/devolucao-status";
import { emissaoBloqueiaRetransmissao } from "@/lib/fiscal/geranet/classificar-emissao";
import {
  montarDocumentosReferenciados,
  textoAutomaticoDocumentosReferenciados,
} from "@/lib/fiscal/nfe55/documentos-referenciados";
import type { PoliticaCancelamentoPublica } from "@/lib/fiscal/politica-cancelamento";

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

type ItemDevolucaoEditor = {
  id: string;
  descricao: string;
  quantidade: number;
  valorTotal: number;
  cfop: string | null;
  cfopOriginal?: string | null;
  ncm: string | null;
  grupoFiscalNome?: string | null;
  documentoEntradaId?: string | null;
  numeroItemOriginal?: number | null;
  quantidadeRecebida?: number;
  cstOriginal?: string;
  csosnDevolucao?: string;
  chaveOrigem?: string;
  numeroOrigem?: string;
};

export function DevolucaoFornecedorDetalhe({
  devolucao,
  entrada,
  contexto,
  naturezas,
  itens,
  emissao,
  eventos,
  tentativas = [],
  tentativasCabecalho = 0,
  politicaCancelamento,
  bloqueioCancelamentoOperacional,
  transportadoras = [],
  movimentacoes,
}: {
  devolucao: {
    id: string;
    status: string;
    chaveOrigem: string;
    naturezaDescricao: string | null;
    naturezaId: string | null;
    tpNf: string | null;
    finNfe: string | null;
    tipoDestino: string | null;
    saidaProcessadaEm: string | null;
    dadosTransporte?: DadosTransporteVenda | null;
    informacaoComplementarUsuario?: string | null;
    informacaoAdicionalFisco?: string | null;
    serieEmissao?: string | null;
    numeroEmissao?: string | null;
  };
  entrada: {
    id: string;
    numero: string;
    fornecedor: string;
    ufFornecedor?: string | null;
    ufEmpresa?: string | null;
  };
  contexto?: {
    destino: string | null;
    regraCfopConfigurada: boolean;
  };
  naturezas: Array<{ id: string; descricao: string; tpNf: string; finNfe: string }>;
  itens: ItemDevolucaoEditor[];
  emissao: {
    id: string;
    status: string;
    modelo: string;
    serie: string;
    numero: string;
    chaveAcesso: string | null;
    protocolo: string | null;
    cstat: string | null;
    motivo: string | null;
    geranetHttpStatus: number | null;
    geranetSituacao: string | null;
    erroComunicacao: string | null;
    classificacao?: string | null;
    origemTipo: string | null;
    autorizadaAt?: string | null;
  } | null;
  eventos: EventoEmissaoFiscal[];
  tentativas?: TentativaFiscalResumo[];
  tentativasCabecalho?: number;
  politicaCancelamento: PoliticaCancelamentoPublica | null;
  bloqueioCancelamentoOperacional?: string | null;
  transportadoras?: TransportadoraCadastro[];
  movimentacoes: Array<{
    id: string;
    createdAt: string;
    tipo: string;
    origem: string;
    quantidade: number;
    saldoAnterior: number;
    saldoPosterior: number;
  }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [pendencias, setPendencias] = useState<string[]>([]);
  const [naturezaId, setNaturezaId] = useState(devolucao.naturezaId ?? "");
  const [infoUsuario, setInfoUsuario] = useState(
    devolucao.informacaoComplementarUsuario ?? ""
  );
  const [infoFisco, setInfoFisco] = useState(
    devolucao.informacaoAdicionalFisco ?? ""
  );
  const [previewAberto, setPreviewAberto] = useState(false);
  const [itemAbertoId, setItemAbertoId] = useState<string | null>(null);
  const emitindo = useRef(false);
  const saindo = useRef(false);

  const nfeAutorizada = emissao?.status === "autorizada";
  const podeEditar = devolucaoPodeEditar(devolucao.status) && !nfeAutorizada;
  const evidenciasEmissao = emissao
    ? {
        status: emissao.status,
        classificacao: emissao.classificacao,
        cstat: emissao.cstat,
        motivo: emissao.motivo,
        protocolo: emissao.protocolo,
        chave_acesso: emissao.chaveAcesso,
        geranet_http_status: emissao.geranetHttpStatus,
        geranet_situacao: emissao.geranetSituacao,
        erro_comunicacao: emissao.erroComunicacao,
      }
    : null;
  const acoesFiscais = emissao
    ? resolverAcoesEmissaoFiscal({
        emissao: {
          modelo: emissao.modelo,
          status: emissao.status,
          cstat: emissao.cstat,
          motivo: emissao.motivo,
          protocolo: emissao.protocolo,
          chaveAcesso: emissao.chaveAcesso,
          geranetHttpStatus: emissao.geranetHttpStatus,
          geranetSituacao: emissao.geranetSituacao,
          erroComunicacao: emissao.erroComunicacao,
        },
        bloqueioCancelamentoOperacional,
      })
    : null;
  const bloqueiaRetransmissao = evidenciasEmissao
    ? emissaoBloqueiaRetransmissao(evidenciasEmissao)
    : false;
  const podeEmitir =
    !bloqueiaRetransmissao &&
    (devolucaoPodeEmitir(devolucao.status) ||
      acoesFiscais?.podeRetransmitir === true);
  const rotuloEstoque = devolucao.saidaProcessadaEm
    ? "Saída processada"
    : nfeAutorizada
      ? "Aguardando saída"
      : "Ainda não movimentado";
  const fiscalValidado = devolucao.status === "pronta_para_emissao";

  const documentosReferenciados = useMemo(
    () =>
      montarDocumentosReferenciados(
        itens.map((item) => ({
          chave: item.chaveOrigem || devolucao.chaveOrigem,
          numero: item.numeroOrigem || entrada.numero,
          documentoEntradaId: item.documentoEntradaId,
          numeroItem: item.numeroItemOriginal,
        }))
      ),
    [itens, devolucao.chaveOrigem, entrada.numero]
  );
  const textoAutomaticoRefs = textoAutomaticoDocumentosReferenciados(
    documentosReferenciados
  );

  function executar(
    acao: () => Promise<{ ok: true; mensagem?: string } | { ok: false; erro: string; pendencias?: string[] }>
  ) {
    setErro(null);
    setSucesso(null);
    setPendencias([]);
    startTransition(async () => {
      const resultado = await acao();
      if (!resultado.ok) {
        setErro(resultado.erro);
        setPendencias(resultado.pendencias ?? []);
        emitindo.current = false;
        saindo.current = false;
        return;
      }
      setSucesso(resultado.mensagem ?? "Atualizado.");
      emitindo.current = false;
      saindo.current = false;
      router.refresh();
    });
  }

  function emitir() {
    if (emitindo.current || pending) {
      return;
    }
    emitindo.current = true;
    setErro(null);
    setSucesso(null);
    startTransition(async () => {
      const resposta = await fetch(
        "/api/fiscal/geranet/nfe-emitir-devolucao-fornecedor",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": devolucao.id,
          },
          body: JSON.stringify({ devolucao_id: devolucao.id }),
        }
      );
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok || dados.ok === false) {
        setErro(String(dados.erro ?? "Falha ao emitir a NF-e de devolução."));
        setPendencias(Array.isArray(dados.pendencias) ? dados.pendencias : []);
        emitindo.current = false;
        router.refresh();
        return;
      }
      setSucesso(
        String(
          dados.mensagem ??
            "NF-e de devolução autorizada. O estoque ainda não foi movimentado."
        )
      );
      emitindo.current = false;
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 px-4 py-4">
      {erro ? (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          {erro}
          {pendencias.length > 0 ? (
            <ul className="mt-2 list-disc pl-4">
              {pendencias.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {sucesso ? (
        <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
          {sucesso}
        </div>
      ) : null}

      <Nfe55Editor
        titulo="NF-e 55"
        emissao={
          emissao && politicaCancelamento ? (
            <>
              <EmissaoFiscalAcoes
                titulo="NF-e de devolução"
                emissao={{
                  id: emissao.id,
                  modelo: emissao.modelo,
                  serie: emissao.serie,
                  numero: emissao.numero,
                  status: emissao.status,
                  chaveAcesso: emissao.chaveAcesso,
                  protocolo: emissao.protocolo,
                  cstat: emissao.cstat,
                  motivo: emissao.motivo,
                  geranetHttpStatus: emissao.geranetHttpStatus,
                  geranetSituacao: emissao.geranetSituacao,
                  erroComunicacao: emissao.erroComunicacao,
                  classificacao: emissao.classificacao,
                }}
                eventos={eventos}
                politicaCancelamento={politicaCancelamento}
                bloqueioCancelamentoOperacional={bloqueioCancelamentoOperacional}
              />
              <EmissaoFiscalHistorico
                emissoes={[
                  {
                    id: emissao.id,
                    modelo: emissao.modelo,
                    serie: emissao.serie,
                    numero: emissao.numero,
                    status: emissao.status,
                    cstat: emissao.cstat,
                    motivo: emissao.motivo,
                  },
                ]}
                eventos={eventos}
                tentativas={tentativas}
                tentativasCabecalho={tentativasCabecalho}
              />
            </>
          ) : null
        }
        geral={
          <div className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[13px] text-zinc-500">Operação</p>
                <p className="text-[15px] font-semibold">
                  Devolução ao fornecedor
                </p>
                <p className="mt-1 text-[12px] text-zinc-500">
                  O tipo interno da operação não pode ser alterado para venda.
                </p>
              </div>
              <StatusBadge status={devolucao.status}>
                {rotuloStatusDevolucaoFornecedor(devolucao.status)}
              </StatusBadge>
            </div>
            <dl className="grid gap-2 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-zinc-500">Fornecedor / destinatário</dt>
                <dd>{entrada.fornecedor}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Natureza</dt>
                <dd>{devolucao.naturezaDescricao || "Não selecionada"}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Modelo</dt>
                <dd>55</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Série / número</dt>
                <dd>
                  {devolucao.serieEmissao || emissao?.serie || "—"}
                  {devolucao.numeroEmissao || emissao?.numero
                    ? ` / ${devolucao.numeroEmissao || emissao?.numero}`
                    : " · ainda não reservado"}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">tpNF / finNFe</dt>
                <dd>
                  {devolucao.tpNf ? `Saída (${devolucao.tpNf})` : "Saída"}
                  {" · "}
                  {devolucao.finNfe
                    ? `Devolução (${devolucao.finNfe})`
                    : "Devolução"}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Destino</dt>
                <dd>{devolucao.tipoDestino || contexto?.destino || "—"}</dd>
              </div>
            </dl>
            {podeEditar ? (
              <div>
                <label className="block text-[13px] font-medium">
                  Natureza da operação
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  <select
                    className="updv-input max-w-xl flex-1"
                    value={naturezaId}
                    onChange={(event) => setNaturezaId(event.target.value)}
                  >
                    <option value="">Selecione</option>
                    {naturezas.map((natureza) => (
                      <option key={natureza.id} value={natureza.id}>
                        {natureza.descricao} · tpNF {natureza.tpNf} · finNFe{" "}
                        {natureza.finNfe}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="updv-btn updv-btn-ghost"
                    disabled={pending || !naturezaId}
                    onClick={() =>
                      executar(() =>
                        salvarNaturezaDevolucaoFornecedor({
                          devolucaoId: devolucao.id,
                          naturezaId,
                        })
                      )
                    }
                  >
                    Salvar natureza
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        }
        itens={
          <div className="space-y-3">
            <DataTable minWidth={860}>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Origem</th>
                  <th className="num">Recebido</th>
                  <th className="num">Devolver</th>
                  <th>CFOP</th>
                  <th className="num">Valor</th>
                </tr>
              </thead>
              <tbody>
                {itens.length === 0 ? (
                  <DataTableEmpty colSpan={6}>Sem itens.</DataTableEmpty>
                ) : (
                  itens.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div>{item.descricao}</div>
                        {item.grupoFiscalNome ? (
                          <div className="text-[12px] text-zinc-500">
                            Grupo fiscal: {item.grupoFiscalNome}
                          </div>
                        ) : null}
                        <button
                          type="button"
                          className="mt-1 text-[12px] text-blue-700 underline"
                          onClick={() =>
                            setItemAbertoId(
                              itemAbertoId === item.id ? null : item.id
                            )
                          }
                        >
                          {itemAbertoId === item.id
                            ? "Ocultar origem fiscal"
                            : "Ver origem fiscal"}
                        </button>
                        {itemAbertoId === item.id ? (
                          <dl className="mt-2 grid gap-1 rounded border border-zinc-200 bg-zinc-50 p-2 text-[12px] text-zinc-700">
                            <div>
                              Documento original: NF-e {item.numeroOrigem || "—"}
                            </div>
                            <div>
                              Item original: {item.numeroItemOriginal ?? "—"}
                            </div>
                            <div>
                              CFOP original: {item.cfopOriginal || "—"}
                            </div>
                            <div>
                              CST/CSOSN original: {item.cstOriginal || "—"}
                            </div>
                            <div>
                              Quantidade recebida: {item.quantidadeRecebida ?? "—"}
                            </div>
                            <div>
                              Quantidade desta devolução: {item.quantidade}
                            </div>
                            <div>CFOP da devolução: {item.cfop || "—"}</div>
                            <div>
                              CSOSN da devolução: {item.csosnDevolucao || "—"}
                            </div>
                          </dl>
                        ) : null}
                      </td>
                      <td>
                        NF-e {item.numeroOrigem || entrada.numero}
                        {item.numeroItemOriginal ? (
                          <div className="text-[12px] text-zinc-500">
                            item {item.numeroItemOriginal}
                          </div>
                        ) : null}
                      </td>
                      <td className="num">{item.quantidadeRecebida ?? "—"}</td>
                      <td className="num">{item.quantidade}</td>
                      <td>
                        {item.cfop || "A resolver"}
                        {item.cfopOriginal ? (
                          <div className="text-[12px] text-zinc-500">
                            Original: {item.cfopOriginal}
                          </div>
                        ) : null}
                      </td>
                      <td className="num">{moeda.format(item.valorTotal)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </DataTable>
            {podeEditar ? (
              <AdicionarItensEntradaDevolucao
                devolucaoId={devolucao.id}
                bloqueado={pending}
                onConcluido={(mensagem) => {
                  setSucesso(mensagem);
                  setErro(null);
                  router.refresh();
                }}
                onErro={(mensagem) => {
                  setErro(mensagem);
                  setSucesso(null);
                }}
              />
            ) : null}
            <p className="text-[12px] text-zinc-500">
              Itens de devolução ao fornecedor nascem da NF-e de entrada
              original. Não é permitido incluir produto solto do cadastro.
            </p>
          </div>
        }
        documentos={
          documentosReferenciados.length === 0 ? (
            <p className="text-[13px] text-zinc-500">
              Nenhum documento referenciado.
            </p>
          ) : (
            <ul className="space-y-2 text-[13px]">
              {documentosReferenciados.map((documento) => (
                <li key={documento.chave}>
                  <div className="font-medium">
                    NF-e {documento.numero || "—"}
                  </div>
                  <div className="font-mono text-[12px] text-zinc-600">
                    Chave: {documento.chave}
                  </div>
                </li>
              ))}
            </ul>
          )
        }
        fiscal={
          <div className="space-y-2 text-[13px]">
            <p>
              CFOP pela natureza + grupo fiscal + destino. ICMS/IPI/PIS/COFINS
              seguem o resolver já usado na devolução.
            </p>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="text-zinc-500">Regra CFOP</dt>
                <dd>
                  {contexto?.regraCfopConfigurada
                    ? "configurada"
                    : "NÃO CONFIGURADA"}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">UF</dt>
                <dd>
                  Empresa {entrada.ufEmpresa || "—"} · Fornecedor{" "}
                  {entrada.ufFornecedor || "—"}
                </dd>
              </div>
            </dl>
          </div>
        }
        transporte={
          <TransporteVendaForm
            numero={devolucao.numeroEmissao || entrada.numero}
            dadosTransporte={devolucao.dadosTransporte ?? null}
            bloqueado={!podeEditar}
            transportadoras={transportadoras}
            onSalvar={async (dados) => {
              if (!podeEditar) {
                return {
                  ok: false,
                  erro: "Esta NF-e não pode mais alterar transporte.",
                };
              }
              const resultado = await salvarTransporteDevolucaoFornecedor({
                devolucaoId: devolucao.id,
                dadosTransporte: dados,
              });
              if (!resultado.ok) {
                return { ok: false, erro: resultado.erro };
              }
              router.refresh();
              return {
                ok: true,
                mensagem: resultado.mensagem,
              };
            }}
          />
        }
        informacoes={
          <div className="space-y-3">
            {textoAutomaticoRefs ? (
              <div>
                <p className="text-[12px] font-medium text-zinc-500">
                  Texto automático do sistema
                </p>
                <p className="mt-1 text-[13px] text-zinc-700">
                  {textoAutomaticoRefs}
                </p>
              </div>
            ) : null}
            <label className="block text-[13px] font-medium">
              Informações complementares (usuário)
              <textarea
                className="updv-input mt-1 min-h-24 w-full"
                value={infoUsuario}
                disabled={!podeEditar}
                onChange={(event) => setInfoUsuario(event.target.value)}
              />
            </label>
            <label className="block text-[13px] font-medium">
              Informações de interesse do fisco
              <textarea
                className="updv-input mt-1 min-h-20 w-full"
                value={infoFisco}
                disabled={!podeEditar}
                onChange={(event) => setInfoFisco(event.target.value)}
              />
            </label>
            {podeEditar ? (
              <button
                type="button"
                className="updv-btn updv-btn-ghost disabled:opacity-60"
                disabled={pending}
                onClick={() =>
                  executar(() =>
                    salvarInformacoesAdicionaisDevolucao({
                      devolucaoId: devolucao.id,
                      informacaoComplementarUsuario: infoUsuario,
                      informacaoAdicionalFisco: infoFisco,
                    })
                  )
                }
              >
                Salvar informações adicionais
              </button>
            ) : null}
          </div>
        }
        verificacao={
          <div className="space-y-3">
            <dl className="grid gap-2 text-[13px] sm:grid-cols-2">
              <div>
                <dt className="text-zinc-500">Empresa / destinatário</dt>
                <dd>{entrada.fornecedor}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Natureza / tpNF / finNFe</dt>
                <dd>
                  {devolucao.naturezaDescricao || "—"} · {devolucao.tpNf || "—"}{" "}
                  · {devolucao.finNfe || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Itens / documentos</dt>
                <dd>
                  {itens.length} item(ns) · {documentosReferenciados.length}{" "}
                  chave(s)
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Total</dt>
                <dd>
                  {moeda.format(
                    itens.reduce((soma, item) => soma + item.valorTotal, 0)
                  )}
                </dd>
              </div>
            </dl>
            {fiscalValidado ? (
              <p className="text-[13px] text-emerald-800">
                ✓ Fiscal validado. O estoque não foi movimentado.
              </p>
            ) : (
              <p className="text-[13px] text-zinc-600">
                A verificação congela o snapshot fiscal. Não movimenta estoque.
              </p>
            )}
            {pendencias.length > 0 ? (
              <div>
                <p className="text-[13px] font-medium text-red-700">Erros</p>
                <ul className="mt-1 list-disc pl-4 text-[13px] text-red-700">
                  {pendencias.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {podeEditar ? (
                <button
                  type="button"
                  className="updv-btn updv-btn-ghost disabled:opacity-60"
                  disabled={pending}
                  onClick={() =>
                    executar(() =>
                      verificarDevolucaoFornecedorAction({
                        devolucaoId: devolucao.id,
                      })
                    )
                  }
                >
                  Verificar NF-e
                </button>
              ) : null}
              <button
                type="button"
                className="updv-btn updv-btn-ghost"
                onClick={() => setPreviewAberto((atual) => !atual)}
              >
                Pré-visualizar
              </button>
              {podeEmitir ? (
                <button
                  type="button"
                  className="updv-btn updv-btn-primary disabled:opacity-60"
                  disabled={pending}
                  onClick={emitir}
                >
                  {pending ? "Emitindo..." : "Emitir NF-e"}
                </button>
              ) : null}
            </div>
            {previewAberto ? (
              <div className="rounded border border-amber-200 bg-amber-50 p-3 text-[13px]">
                <p className="font-medium text-amber-900">
                  Prévia interna do editor — não é DANFE autorizado.
                </p>
                <p className="mt-1 text-amber-800">
                  A Geranet não oferece prévia fiscal segura antes da
                  autorização. Este resumo serve só para conferência.
                </p>
                <div className="mt-3 space-y-1 text-zinc-800">
                  <p>Destinatário: {entrada.fornecedor}</p>
                  <p>Natureza: {devolucao.naturezaDescricao || "—"}</p>
                  {documentosReferenciados.map((documento) => (
                    <p key={documento.chave}>
                      Ref. NF-e {documento.numero}: {documento.chave}
                    </p>
                  ))}
                  {itens.map((item) => (
                    <p key={item.id}>
                      {item.descricao} · qtd {item.quantidade} · CFOP{" "}
                      {item.cfop || "—"} · {moeda.format(item.valorTotal)}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        }
        origem={
          <div className="space-y-3">
            <h4 className="text-[14px] font-semibold">
              Devolução ao fornecedor
            </h4>
            <dl className="grid gap-2 text-[13px] sm:grid-cols-2">
              <div>
                <dt className="text-zinc-500">Fornecedor</dt>
                <dd>{entrada.fornecedor}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Documentos de origem</dt>
                <dd>
                  {documentosReferenciados
                    .map((documento) => `NF-e ${documento.numero || "—"}`)
                    .join(", ") || `NF-e ${entrada.numero}`}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Estoque</dt>
                <dd>{rotuloEstoque}</dd>
              </div>
            </dl>
            <p className="text-[12px] text-zinc-500">
              Adicionar itens, salvar rascunho, verificar e transmitir não
              movimentam estoque. Somente a confirmação da saída o faz.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/fiscal/entradas/${entrada.id}`}
                className="updv-btn updv-btn-ghost"
              >
                Ver nota de entrada original
              </Link>
              {nfeAutorizada &&
              !devolucao.saidaProcessadaEm &&
              devolucaoPodeConfirmarSaida(devolucao.status) ? (
                <button
                  type="button"
                  className="updv-btn updv-btn-primary disabled:opacity-60"
                  disabled={pending}
                  onClick={() => {
                    if (saindo.current) return;
                    saindo.current = true;
                    executar(() =>
                      confirmarSaidaDevolucaoFornecedor({
                        devolucaoId: devolucao.id,
                      })
                    );
                  }}
                >
                  Confirmar saída da mercadoria
                </button>
              ) : null}
            </div>
            {movimentacoes.length > 0 ? (
              <DataTable minWidth={720}>
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th>Origem</th>
                    <th className="num">Qtd</th>
                    <th className="num">Saldo post.</th>
                  </tr>
                </thead>
                <tbody>
                  {movimentacoes.map((mov) => (
                    <tr key={mov.id}>
                      <td>{new Date(mov.createdAt).toLocaleString("pt-BR")}</td>
                      <td>{mov.tipo}</td>
                      <td>{mov.origem}</td>
                      <td className="num">{mov.quantidade}</td>
                      <td className="num">{mov.saldoPosterior}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            ) : null}
          </div>
        }
      />
    </div>
  );
}
