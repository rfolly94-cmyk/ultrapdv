"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  adicionarItemOperacaoFiscal,
  confirmarRecebimentoTransferencia,
  confirmarSaidaOperacaoFiscal,
  removerItemOperacaoFiscal,
  salvarDestinatarioBonificacao,
  salvarDestinoTransferencia,
  salvarInformacoesAdicionaisOperacao,
  salvarNaturezaOperacaoFiscal,
  salvarTransporteOperacaoFiscal,
  verificarOperacaoFiscalAction,
  vincularEstabelecimentoTransferencia,
  buscarProdutosOperacaoFiscal,
} from "@/app/fiscal/nfe/operacoes-actions";
import { EmissaoFiscalAcoes } from "@/components/fiscal/emissao-fiscal-acoes";
import { EmissaoFiscalHistorico } from "@/components/fiscal/emissao-fiscal-historico";
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
import { emissaoBloqueiaRetransmissao } from "@/lib/fiscal/geranet/classificar-emissao";
import { ROTULOS_TIPO_OPERACAO } from "@/lib/fiscal/operacoes/catalogo";
import {
  operacaoPodeConfirmarRecebimento,
  operacaoPodeConfirmarSaida,
  operacaoPodeEditar,
  operacaoPodeEmitir,
  rotuloStatusOperacaoFiscal,
} from "@/lib/fiscal/operacoes/status-operacao";
import type { PoliticaCancelamentoPublica } from "@/lib/fiscal/politica-cancelamento";

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function OperacaoFiscalEditor({
  operacao,
  origemNome,
  destinos,
  estabelecimentosParaVincular,
  clientes,
  naturezas,
  itens,
  transportadoras,
  emissao,
  eventos,
  tentativas = [],
  tentativasCabecalho = 0,
  politicaCancelamento,
  bloqueioCancelamentoOperacional,
}: {
  operacao: {
    id: string;
    tipo: "bonificacao" | "transferencia";
    status: string;
    naturezaId: string | null;
    naturezaDescricao: string | null;
    tpNf: string | null;
    finNfe: string | null;
    destinatarioId: string | null;
    destinoEmpresaId: string | null;
    vinculoId: string | null;
    destinoGerenciado: boolean;
    saidaProcessadaEm: string | null;
    recebimentoProcessadoEm: string | null;
    dadosTransporte: DadosTransporteVenda | null;
    informacaoComplementarUsuario: string | null;
    informacaoAdicionalFisco: string | null;
    serieEmissao: string | null;
    numeroEmissao: string | null;
  };
  origemNome: string;
  destinos: Array<{ id: string; empresaDestinoId: string; nome: string; cnpj: string }>;
  estabelecimentosParaVincular: Array<{ id: string; nome: string; cnpj: string }>;
  clientes: Array<{ id: string; nome: string }>;
  naturezas: Array<{ id: string; descricao: string; tpNf: string; finNfe: string }>;
  itens: Array<{
    id: string;
    descricao: string;
    quantidade: number;
    valorUnitario: number;
    valorTotal: number;
    estoque: number;
    cfop: string | null;
    ncm: string | null;
  }>;
  transportadoras: TransportadoraCadastro[];
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
  } | null;
  eventos: EventoEmissaoFiscal[];
  tentativas?: TentativaFiscalResumo[];
  tentativasCabecalho?: number;
  politicaCancelamento: PoliticaCancelamentoPublica | null;
  bloqueioCancelamentoOperacional?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [pendencias, setPendencias] = useState<string[]>([]);
  const [naturezaId, setNaturezaId] = useState(operacao.naturezaId ?? "");
  const [destinatarioId, setDestinatarioId] = useState(operacao.destinatarioId ?? "");
  const [vinculoId, setVinculoId] = useState(operacao.vinculoId ?? "");
  const [empresaVincular, setEmpresaVincular] = useState("");
  const [infoUsuario, setInfoUsuario] = useState(
    operacao.informacaoComplementarUsuario ?? ""
  );
  const [infoFisco, setInfoFisco] = useState(operacao.informacaoAdicionalFisco ?? "");
  const [busca, setBusca] = useState("");
  const [produtos, setProdutos] = useState<
    Array<{ id: string; nome: string; codigo: string; estoque: number; preco: number }>
  >([]);
  const [qtdNovo, setQtdNovo] = useState("1");
  const [valorNovo, setValorNovo] = useState("");
  const [produtoNovo, setProdutoNovo] = useState("");
  const emitindo = useRef(false);
  const saindo = useRef(false);
  const recebendo = useRef(false);

  const nfeAutorizada = emissao?.status === "autorizada";
  const podeEditar = operacaoPodeEditar(operacao.status) && !nfeAutorizada;
  const rotuloTipo = ROTULOS_TIPO_OPERACAO[operacao.tipo];
  const evidencias = emissao
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
        emissao,
        bloqueioCancelamentoOperacional,
      })
    : null;
  const bloqueiaRetransmissao = evidencias
    ? emissaoBloqueiaRetransmissao(evidencias)
    : false;
  const podeEmitir =
    !bloqueiaRetransmissao &&
    (operacaoPodeEmitir(operacao.status) || acoesFiscais?.podeRetransmitir === true);
  const fiscalValidado = operacao.status === "pronta_para_emissao";
  const destNome = useMemo(() => {
    if (operacao.tipo === "bonificacao") {
      return clientes.find((item) => item.id === (operacao.destinatarioId ?? ""))?.nome ?? "—";
    }
    return destinos.find((item) => item.id === (operacao.vinculoId ?? ""))?.nome ?? "—";
  }, [operacao, clientes, destinos]);

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
        recebendo.current = false;
        return;
      }
      setSucesso(resultado.mensagem ?? "Atualizado.");
      emitindo.current = false;
      saindo.current = false;
      recebendo.current = false;
      router.refresh();
    });
  }

  function emitir() {
    if (emitindo.current || pending) return;
    emitindo.current = true;
    startTransition(async () => {
      const resposta = await fetch("/api/fiscal/geranet/nfe-emitir-operacao", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": operacao.id,
        },
        body: JSON.stringify({ operacao_id: operacao.id }),
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok || dados.ok === false) {
        setErro(String(dados.erro ?? "Falha ao emitir a NF-e."));
        setPendencias(Array.isArray(dados.pendencias) ? dados.pendencias : []);
        emitindo.current = false;
        router.refresh();
        return;
      }
      setSucesso(
        String(dados.mensagem ?? "NF-e autorizada. O estoque ainda não foi movimentado.")
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
                titulo={`NF-e de ${rotuloTipo.toLowerCase()}`}
                emissao={emissao}
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
                <p className="text-[15px] font-semibold">{rotuloTipo}</p>
                <p className="mt-1 text-[12px] text-zinc-500">
                  O tipo interno não pode ser alterado para venda.
                </p>
              </div>
              <StatusBadge status={operacao.status}>
                {rotuloStatusOperacaoFiscal(operacao.status)}
              </StatusBadge>
            </div>
            <dl className="grid gap-2 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-zinc-500">Origem</dt>
                <dd>{origemNome}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">
                  {operacao.tipo === "bonificacao" ? "Destinatário" : "Destino"}
                </dt>
                <dd>{destNome}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Natureza</dt>
                <dd>{operacao.naturezaDescricao || "Não selecionada"}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Modelo / série</dt>
                <dd>
                  55
                  {operacao.serieEmissao || emissao?.serie
                    ? ` · ${operacao.serieEmissao || emissao?.serie}/${operacao.numeroEmissao || emissao?.numero || ""}`
                    : " · número ainda não reservado"}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">tpNF / finNFe</dt>
                <dd>
                  {operacao.tpNf || "—"} · {operacao.finNfe || "—"}
                </dd>
              </div>
            </dl>

            {podeEditar && operacao.tipo === "bonificacao" ? (
              <div className="flex flex-wrap gap-2">
                <select
                  className="updv-input max-w-xl flex-1"
                  value={destinatarioId}
                  onChange={(event) => setDestinatarioId(event.target.value)}
                >
                  <option value="">Selecione o destinatário</option>
                  {clientes.map((cliente) => (
                    <option key={cliente.id} value={cliente.id}>
                      {cliente.nome}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="updv-btn updv-btn-ghost"
                  disabled={pending || !destinatarioId}
                  onClick={() =>
                    executar(() =>
                      salvarDestinatarioBonificacao({
                        operacaoId: operacao.id,
                        clienteId: destinatarioId,
                      })
                    )
                  }
                >
                  Salvar destinatário
                </button>
              </div>
            ) : null}

            {podeEditar && operacao.tipo === "transferencia" ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <select
                    className="updv-input max-w-xl flex-1"
                    value={vinculoId}
                    onChange={(event) => setVinculoId(event.target.value)}
                  >
                    <option value="">Selecione o estabelecimento destino</option>
                    {destinos.map((destino) => (
                      <option key={destino.id} value={destino.id}>
                        {destino.nome} · {destino.cnpj}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="updv-btn updv-btn-ghost"
                    disabled={pending || !vinculoId}
                    onClick={() =>
                      executar(() =>
                        salvarDestinoTransferencia({
                          operacaoId: operacao.id,
                          vinculoId,
                        })
                      )
                    }
                  >
                    Salvar destino
                  </button>
                </div>
                {destinos.length === 0 ? (
                  <p className="text-[13px] text-amber-800">
                    Não foi possível confirmar que o estabelecimento de destino
                    é elegível para transferência.
                  </p>
                ) : null}
                {estabelecimentosParaVincular.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    <select
                      className="updv-input max-w-xl flex-1"
                      value={empresaVincular}
                      onChange={(event) => setEmpresaVincular(event.target.value)}
                    >
                      <option value="">Vincular outro estabelecimento que você acessa</option>
                      {estabelecimentosParaVincular.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.nome} · {item.cnpj}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="updv-btn updv-btn-ghost"
                      disabled={pending || !empresaVincular}
                      onClick={() =>
                        executar(() =>
                          vincularEstabelecimentoTransferencia({
                            empresaDestinoId: empresaVincular,
                          })
                        )
                      }
                    >
                      Vincular destino
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {podeEditar ? (
              <div className="flex flex-wrap gap-2">
                <select
                  className="updv-input max-w-xl flex-1"
                  value={naturezaId}
                  onChange={(event) => setNaturezaId(event.target.value)}
                >
                  <option value="">Selecione a natureza</option>
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
                      salvarNaturezaOperacaoFiscal({
                        operacaoId: operacao.id,
                        naturezaId,
                      })
                    )
                  }
                >
                  Salvar natureza
                </button>
              </div>
            ) : null}
          </div>
        }
        itens={
          <div className="space-y-3">
            <DataTable minWidth={820}>
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="num">Estoque</th>
                  <th className="num">Qtd</th>
                  <th className="num">Valor un.</th>
                  <th>CFOP</th>
                  <th className="num">Total</th>
                  {podeEditar ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {itens.length === 0 ? (
                  <DataTableEmpty colSpan={podeEditar ? 7 : 6}>
                    Sem itens.
                  </DataTableEmpty>
                ) : (
                  itens.map((item) => (
                    <tr key={item.id}>
                      <td>{item.descricao}</td>
                      <td className="num">{item.estoque}</td>
                      <td className="num">{item.quantidade}</td>
                      <td className="num">{moeda.format(item.valorUnitario)}</td>
                      <td>{item.cfop || "A resolver"}</td>
                      <td className="num">{moeda.format(item.valorTotal)}</td>
                      {podeEditar ? (
                        <td>
                          <button
                            type="button"
                            className="updv-btn updv-btn-ghost"
                            onClick={() =>
                              executar(() =>
                                removerItemOperacaoFiscal({
                                  operacaoId: operacao.id,
                                  itemId: item.id,
                                })
                              )
                            }
                          >
                            Remover
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </DataTable>
            {podeEditar ? (
              <div className="space-y-2 rounded border border-zinc-200 p-3">
                <p className="text-[13px] font-medium">+ Adicionar produto</p>
                <div className="flex flex-wrap gap-2">
                  <input
                    className="updv-input max-w-sm flex-1"
                    placeholder="Buscar produto da empresa ativa"
                    value={busca}
                    onChange={(event) => setBusca(event.target.value)}
                  />
                  <button
                    type="button"
                    className="updv-btn updv-btn-ghost"
                    disabled={pending || busca.trim().length < 2}
                    onClick={() =>
                      startTransition(async () => {
                        const resultado = await buscarProdutosOperacaoFiscal({
                          busca,
                        });
                        if (!resultado.ok) {
                          setErro(resultado.erro);
                          return;
                        }
                        setProdutos(resultado.produtos);
                      })
                    }
                  >
                    Buscar
                  </button>
                </div>
                {produtos.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    <select
                      className="updv-input max-w-xl flex-1"
                      value={produtoNovo}
                      onChange={(event) => {
                        setProdutoNovo(event.target.value);
                        const escolhido = produtos.find(
                          (item) => item.id === event.target.value
                        );
                        if (escolhido) {
                          setValorNovo(String(escolhido.preco).replace(".", ","));
                        }
                      }}
                    >
                      <option value="">Selecione</option>
                      {produtos.map((produto) => (
                        <option key={produto.id} value={produto.id}>
                          {produto.nome} · estoque {produto.estoque}
                        </option>
                      ))}
                    </select>
                    <input
                      className="updv-input w-24"
                      value={qtdNovo}
                      onChange={(event) => setQtdNovo(event.target.value)}
                      placeholder="Qtd"
                    />
                    <input
                      className="updv-input w-28"
                      value={valorNovo}
                      onChange={(event) => setValorNovo(event.target.value)}
                      placeholder="Valor"
                    />
                    <button
                      type="button"
                      className="updv-btn updv-btn-primary"
                      disabled={pending || !produtoNovo}
                      onClick={() =>
                        executar(() =>
                          adicionarItemOperacaoFiscal({
                            operacaoId: operacao.id,
                            produtoId: produtoNovo,
                            quantidade: Number(String(qtdNovo).replace(",", ".")),
                            valorUnitario: Number(String(valorNovo).replace(",", ".")),
                          })
                        )
                      }
                    >
                      Adicionar
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        }
        documentos={
          <p className="text-[13px] text-zinc-500">
            Esta operação não exige documento fiscal referenciado.
          </p>
        }
        fiscal={
          <p className="text-[13px] text-zinc-600">
            CFOP pela natureza + grupo fiscal + destino. Tributos pelo grupo
            fiscal do produto. Sem regra, a verificação bloqueia a emissão.
          </p>
        }
        transporte={
          <TransporteVendaForm
            numero={operacao.numeroEmissao || rotuloTipo}
            dadosTransporte={operacao.dadosTransporte}
            bloqueado={!podeEditar}
            transportadoras={transportadoras}
            onSalvar={async (dados) => {
              if (!podeEditar) {
                return { ok: false, erro: "Esta NF-e não pode mais alterar transporte." };
              }
              const resultado = await salvarTransporteOperacaoFiscal({
                operacaoId: operacao.id,
                dadosTransporte: dados,
              });
              if (!resultado.ok) {
                return { ok: false, erro: resultado.erro };
              }
              router.refresh();
              return { ok: true, mensagem: resultado.mensagem };
            }}
          />
        }
        informacoes={
          <div className="space-y-3">
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
                className="updv-btn updv-btn-ghost"
                disabled={pending}
                onClick={() =>
                  executar(() =>
                    salvarInformacoesAdicionaisOperacao({
                      operacaoId: operacao.id,
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
            {fiscalValidado ? (
              <p className="text-[13px] text-emerald-800">
                ✓ Fiscal validado. O estoque não foi movimentado.
              </p>
            ) : (
              <p className="text-[13px] text-zinc-600">
                A verificação congela o snapshot. Não movimenta estoque.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {podeEditar ? (
                <button
                  type="button"
                  className="updv-btn updv-btn-ghost"
                  disabled={pending}
                  onClick={() =>
                    executar(() =>
                      verificarOperacaoFiscalAction({ operacaoId: operacao.id })
                    )
                  }
                >
                  Verificar NF-e
                </button>
              ) : null}
              {podeEmitir ? (
                <button
                  type="button"
                  className="updv-btn updv-btn-primary"
                  disabled={pending}
                  onClick={emitir}
                >
                  {pending ? "Emitindo..." : "Emitir NF-e"}
                </button>
              ) : null}
            </div>
          </div>
        }
        origem={
          <div className="space-y-3">
            <h4 className="text-[14px] font-semibold">{rotuloTipo}</h4>
            <p className="text-[13px]">
              Status fiscal: {emissao?.status || "sem emissão"}
            </p>
            <p className="text-[13px]">
              Estoque:{" "}
              {operacao.saidaProcessadaEm
                ? operacao.tipo === "transferencia" &&
                  !operacao.recebimentoProcessadoEm &&
                  operacao.destinoGerenciado
                  ? "Em trânsito"
                  : "Saída processada ✓"
                : nfeAutorizada
                  ? "Saída não processada"
                  : "Ainda não movimentado"}
            </p>
            {nfeAutorizada &&
            !operacao.saidaProcessadaEm &&
            operacaoPodeConfirmarSaida(operacao.status) ? (
              <button
                type="button"
                className="updv-btn updv-btn-primary"
                disabled={pending}
                onClick={() => {
                  if (saindo.current) return;
                  saindo.current = true;
                  executar(() =>
                    confirmarSaidaOperacaoFiscal({ operacaoId: operacao.id })
                  );
                }}
              >
                Confirmar saída da mercadoria
              </button>
            ) : null}
            {operacao.tipo === "transferencia" &&
            operacao.destinoGerenciado &&
            operacaoPodeConfirmarRecebimento(operacao.status) ? (
              <button
                type="button"
                className="updv-btn updv-btn-primary"
                disabled={pending}
                onClick={() => {
                  if (recebendo.current) return;
                  recebendo.current = true;
                  executar(() =>
                    confirmarRecebimentoTransferencia({
                      operacaoId: operacao.id,
                    })
                  );
                }}
              >
                Confirmar recebimento
              </button>
            ) : null}
          </div>
        }
      />
    </div>
  );
}
