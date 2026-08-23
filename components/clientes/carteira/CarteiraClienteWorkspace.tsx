"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import {
  acaoVendaCarteiraPerigosa,
  acoesPorEstadoVendaCarteira,
  rotuloAcaoVendaCarteira,
  type AcaoVendaCarteira,
} from "@/lib/carteira/acoes";
import {
  dataDaVendaCarteira,
  dataDentroDoPeriodo,
  periodoCarteiraValido,
  resolverPeriodoCarteira,
  ROTULOS_PERIODO_CARTEIRA,
  type PeriodoCarteira,
} from "@/lib/carteira/periodo";
import {
  buscaTituloCarteira,
  dataQuitacaoTitulo,
  normalizarStatusTitulo,
  ordenarTitulosCarteira,
  tituloPassaNaAba,
} from "@/lib/carteira/titulos";
import {
  resumoFiscalVendaCarteira,
  type EmissaoFiscalCarteira,
} from "@/lib/carteira/fiscal-consulta";
import { ActionMenu } from "@/components/ui/action-menu";
import { CancelarVendaComercial } from "@/components/vendas/cancelar-venda-comercial";
import { CancelarItensCarteira } from "@/components/clientes/carteira/CancelarItensCarteira";
import { conferirItensMesmaVenda } from "@/lib/carteira/cancelar-itens";
import { BotaoImprimirConector } from "@/components/impressao/botao-imprimir-conector";
import { ModalReciboRecebimento } from "@/components/clientes/carteira/modal-recibo-recebimento";

type Cliente = {
  id: string;
  nome: string;
  nome_fantasia: string | null;
  cpf_cnpj: string | null;
  telefone: string | null;
  limite_credito: number | string;
  saldo_devedor: number | string;
  bloqueado: boolean;
  dia_vencimento: number | null;
  ativo: boolean;
};

type Titulo = {
  id: string;
  venda_id: string;
  numero_venda: number | string | null;
  valor_original: number | string;
  valor_aberto: number | string;
  vencimento: string | null;
  status: string;
  created_at: string;
  updated_at?: string | null;
};

type Item = {
  id: string;
  titulo_id: string;
  venda_item_id: string;
  produto_id: string | null;
  produto_codigo: string | null;
  produto_nome: string;
  unidade_medida: string;
  quantidade: number | string;
  valor_original: number | string;
  valor_aberto: number | string;
  status: string;
  created_at: string;
};

type Credito = {
  id: string;
  origem: string;
  venda_id: string | null;
  recebimento_id: string | null;
  valor_original: number | string;
  valor_disponivel: number | string;
  status: string;
  observacao: string | null;
  created_at: string;
};

type Recebimento = {
  id: string;
  forma_pagamento_nome: string | null;
  modo: string;
  valor: number | string;
  saldo_anterior: number | string;
  saldo_posterior: number | string;
  observacao: string | null;
  processado_at: string | null;
  created_at: string;
};

type Movimento = {
  id: string;
  tipo: string;
  origem: string;
  valor: number | string;
  venda_id: string | null;
  titulo_id: string | null;
  recebimento_id: string | null;
  descricao: string | null;
  created_at: string;
};

type Forma = {
  id: string;
  codigo: string;
  nome: string;
  permite_fiado: boolean;
  ativo: boolean;
  ordem: number;
};

type Venda = {
  id: string;
  numero: number | string | null;
  status: string;
  valor_total: number | string;
  finalizada_at: string | null;
  cancelada_at: string | null;
  motivo_cancelamento: string | null;
  created_at: string;
};

type Alocacao = {
  id: string;
  recebimento_id: string;
  item_id: string;
  valor: number | string;
  created_at: string;
};

type Estorno = {
  id: string;
  recebimento_id: string | null;
  alocacao_id: string | null;
  venda_id: string | null;
  titulo_id: string | null;
  usuario_id: string | null;
  valor: number | string;
  motivo: string | null;
  status: string;
  created_at: string;
  concluido_at: string | null;
};

type TituloLista = Titulo & {
  quitado_em?: string | null;
  itens: Item[];
  dataVenda: string | null;
  fiscal: EmissaoFiscalCarteira | null;
  recebimentos: Recebimento[];
};

type Aba =
  | "EM_ABERTO"
  | "QUITADAS"
  | "TODAS"
  | "RECEBIMENTOS"
  | "MOVIMENTACOES"
  | "CREDITOS"
  | "COMPRAS";

type Props = {
  abaInicial?: Aba;
  cliente: Cliente;
  titulos: Titulo[];
  itens: Item[];
  creditos: Credito[];
  recebimentos: Recebimento[];
  movimentos: Movimento[];
  formasPagamento: Forma[];
  vendas: Venda[];
  alocacoes: Alocacao[];
  estornos: Estorno[];
  fiscais: EmissaoFiscalCarteira[];
};

function numero(valor: number | string | null | undefined) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function dinheiro(valor: number | string | null | undefined) {
  return numero(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function dataHora(valor: string | null | undefined) {
  if (!valor) {
    return "—";
  }
  return new Date(valor).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function dataCurta(valor: string | null | undefined) {
  if (!valor) {
    return "—";
  }
  return new Date(valor).toLocaleDateString("pt-BR");
}

function classeStatus(status: string) {
  switch (status.toUpperCase()) {
    case "ABERTO":
      return "bg-amber-100 text-amber-700";
    case "PARCIAL":
      return "bg-blue-100 text-blue-700";
    case "QUITADO":
    case "UTILIZADO":
      return "bg-zinc-100 text-zinc-600";
    case "DISPONIVEL":
      return "bg-emerald-100 text-emerald-700";
    case "CANCELADO":
    case "CANCELADA":
    case "ESTORNADO":
      return "bg-red-100 text-red-700";
    case "FINALIZADA":
      return "bg-green-100 text-green-700";
    default:
      return "bg-zinc-100 text-zinc-700";
  }
}

export function CarteiraClienteWorkspace({
  abaInicial = "EM_ABERTO",
  cliente,
  titulos,
  itens,
  creditos,
  recebimentos,
  movimentos,
  formasPagamento,
  vendas,
  alocacoes,
  estornos,
  fiscais,
}: Props) {
  const router = useRouter();
  const [aba, setAba] = useState<Aba>(abaInicial);
  const [periodo, setPeriodo] = useState<PeriodoCarteira>("todos");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [busca, setBusca] = useState("");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [formaPagamentoId, setFormaPagamentoId] = useState(
    formasPagamento[0]?.id ?? ""
  );
  const [valorParcial, setValorParcial] = useState("");
  const [observacao, setObservacao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [vendaCancelarId, setVendaCancelarId] = useState<string | null>(null);
  const [cancelarItemIds, setCancelarItemIds] = useState<string[] | null>(null);
  const [recebimentosTituloId, setRecebimentosTituloId] = useState<string | null>(
    null
  );
  const [estorno, setEstorno] = useState<{
    recebimentoId: string;
    numeroVenda: string;
    possuiFiscal: boolean;
  } | null>(null);
  const [reciboImprimir, setReciboImprimir] = useState<Recebimento | null>(null);
  const [avisoFiscalEstornoOk, setAvisoFiscalEstornoOk] = useState(false);
  const [motivoEstorno, setMotivoEstorno] = useState("");

  const saldoDevedor = numero(cliente.saldo_devedor);
  const creditoDisponivel = useMemo(
    () =>
      creditos
        .filter((credito) =>
          ["DISPONIVEL", "PARCIAL"].includes(credito.status)
        )
        .reduce((total, credito) => total + numero(credito.valor_disponivel), 0),
    [creditos]
  );
  const saldoLiquido = creditoDisponivel - saldoDevedor;

  const itensPorTitulo = useMemo(() => {
    const mapa = new Map<string, Item[]>();
    for (const item of itens) {
      const lista = mapa.get(item.titulo_id) ?? [];
      lista.push(item);
      mapa.set(item.titulo_id, lista);
    }
    return mapa;
  }, [itens]);

  const tituloPorItem = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const item of itens) {
      mapa.set(item.id, item.titulo_id);
    }
    return mapa;
  }, [itens]);

  const vendaPorId = useMemo(() => {
    const mapa = new Map<string, Venda>();
    for (const venda of vendas) {
      mapa.set(venda.id, venda);
    }
    return mapa;
  }, [vendas]);

  const fiscalPorVenda = useMemo(() => {
    const mapa = new Map<string, EmissaoFiscalCarteira>();
    for (const fiscal of fiscais) {
      if (!mapa.has(fiscal.origem_id)) {
        mapa.set(fiscal.origem_id, fiscal);
      }
    }
    return mapa;
  }, [fiscais]);

  const estornosPorRecebimento = useMemo(() => {
    const mapa = new Map<string, Estorno[]>();
    for (const item of estornos) {
      if (!item.recebimento_id) {
        continue;
      }
      const lista = mapa.get(item.recebimento_id) ?? [];
      lista.push(item);
      mapa.set(item.recebimento_id, lista);
    }
    return mapa;
  }, [estornos]);

  const alocacoesPorRecebimento = useMemo(() => {
    const mapa = new Map<string, Alocacao[]>();
    for (const alocacao of alocacoes) {
      const lista = mapa.get(alocacao.recebimento_id) ?? [];
      lista.push(alocacao);
      mapa.set(alocacao.recebimento_id, lista);
    }
    return mapa;
  }, [alocacoes]);

  const recebimentosPorTitulo = useMemo(() => {
    const mapa = new Map<string, Recebimento[]>();
    for (const recebimento of recebimentos) {
      const titulosDoRecebimento = new Set<string>();
      for (const alocacao of alocacoesPorRecebimento.get(recebimento.id) ?? []) {
        const tituloId = tituloPorItem.get(alocacao.item_id);
        if (tituloId) {
          titulosDoRecebimento.add(tituloId);
        }
      }
      for (const tituloId of titulosDoRecebimento) {
        const lista = mapa.get(tituloId) ?? [];
        lista.push(recebimento);
        mapa.set(tituloId, lista);
      }
    }
    return mapa;
  }, [recebimentos, alocacoesPorRecebimento, tituloPorItem]);

  const janela = useMemo(
    () => resolverPeriodoCarteira(periodo, inicio, fim),
    [periodo, inicio, fim]
  );

  const titulosPreparados = useMemo(() => {
    return titulos.map((titulo) => {
      const listaItens = itensPorTitulo.get(titulo.id) ?? [];
      const venda = vendaPorId.get(titulo.venda_id);
      const recebimentosTitulo = recebimentosPorTitulo.get(titulo.id) ?? [];
      const quitadoEm = dataQuitacaoTitulo({
        status: titulo.status,
        updated_at: titulo.updated_at,
        recebimentosProcessadosEm: recebimentosTitulo.map(
          (item) => item.processado_at ?? item.created_at
        ),
      });
      const dataVenda = dataDaVendaCarteira({
        finalizada_at: venda?.finalizada_at,
        created_at: venda?.created_at,
        titulo_created_at: titulo.created_at,
      });
      return {
        ...titulo,
        quitado_em: quitadoEm,
        itens: listaItens,
        dataVenda,
        fiscal: fiscalPorVenda.get(titulo.venda_id) ?? null,
        recebimentos: recebimentosTitulo,
      };
    });
  }, [
    titulos,
    itensPorTitulo,
    vendaPorId,
    recebimentosPorTitulo,
    fiscalPorVenda,
  ]);

  const titulosFiltrados = useMemo(() => {
    const abaVendas =
      aba === "EM_ABERTO" || aba === "QUITADAS" || aba === "TODAS"
        ? aba
        : "TODAS";
    return ordenarTitulosCarteira(
      titulosPreparados.filter((titulo) => {
        if (
          !tituloPassaNaAba(
            titulo.status,
            abaVendas,
            numero(titulo.valor_aberto)
          )
        ) {
          return false;
        }
        if (!dataDentroDoPeriodo(titulo.dataVenda, janela)) {
          return false;
        }
        return buscaTituloCarteira(busca, {
          numero_venda: titulo.numero_venda,
          itens: titulo.itens,
        });
      })
    );
  }, [titulosPreparados, aba, janela, busca]);

  const itensSelecionados = itens.filter((item) => selecionados.has(item.id));
  const valorSelecionado = itensSelecionados.reduce(
    (total, item) => total + numero(item.valor_aberto),
    0
  );

  function alternarItem(itemId: string) {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(itemId)) {
        proximo.delete(itemId);
      } else {
        proximo.add(itemId);
      }
      return proximo;
    });
  }

  function recebimentoEstornavel(recebimento: Recebimento) {
    const alocs = alocacoesPorRecebimento.get(recebimento.id) ?? [];
    if (!alocs.length) {
      return false;
    }
    const estornados = new Set(
      (estornosPorRecebimento.get(recebimento.id) ?? [])
        .map((item) => item.alocacao_id)
        .filter(Boolean)
    );
    return alocs.some((alocacao) => !estornados.has(alocacao.id));
  }

  async function receber(modo: "TOTAL" | "PARCIAL" | "ITENS") {
    if (!formaPagamentoId) {
      setMensagem("Selecione a forma de pagamento.");
      return;
    }

    let valor: number | null = null;
    if (modo === "PARCIAL") {
      valor = Number(valorParcial.replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(valor) || valor <= 0) {
        setMensagem("Informe um valor parcial maior que zero.");
        return;
      }
    }
    if (modo === "ITENS" && selecionados.size === 0) {
      setMensagem("Selecione ao menos um item.");
      return;
    }

    const descricao =
      modo === "TOTAL"
        ? `Quitar todo o saldo de ${dinheiro(saldoDevedor)}?`
        : modo === "PARCIAL"
          ? `Registrar baixa parcial de ${dinheiro(valor)}?`
          : `Dar baixa em ${selecionados.size} item(ns), totalizando ${dinheiro(valorSelecionado)}?`;

    if (!window.confirm(descricao)) {
      return;
    }

    setEnviando(true);
    setMensagem(null);
    try {
      const response = await fetch(
        `/api/clientes/${cliente.id}/carteira/receber`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            forma_pagamento_id: formaPagamentoId,
            modo,
            valor,
            item_ids: modo === "ITENS" ? Array.from(selecionados) : [],
            observacao: observacao.trim() || null,
            idempotency_key: crypto.randomUUID(),
          }),
        }
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setMensagem(payload.erro ?? "Não foi possível registrar o recebimento.");
        return;
      }
      setMensagem(
        `Recebimento de ${dinheiro(
          payload.resultado?.valor_recebido ?? valorSelecionado
        )} registrado.`
      );
      setSelecionados(new Set());
      setValorParcial("");
      setObservacao("");
      router.refresh();
    } catch (error) {
      setMensagem(
        error instanceof Error ? error.message : "Falha inesperada."
      );
    } finally {
      setEnviando(false);
    }
  }

  async function confirmarEstorno() {
    if (!estorno) {
      return;
    }
    if (motivoEstorno.trim().length < 5) {
      setMensagem("Informe o motivo com pelo menos 5 caracteres.");
      return;
    }
    setEnviando(true);
    setMensagem(null);
    try {
      const response = await fetch(
        `/api/clientes/${cliente.id}/carteira/estornar-recebimento`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recebimento_id: estorno.recebimentoId,
            motivo: motivoEstorno.trim(),
            confirmar_fiscal_comercial: estorno.possuiFiscal,
          }),
        }
      );
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        setMensagem(payload.erro ?? "Não foi possível estornar o recebimento.");
        return;
      }
      setEstorno(null);
      setAvisoFiscalEstornoOk(false);
      setMotivoEstorno("");
      setRecebimentosTituloId(null);
      setMensagem("Recebimento estornado. A Carteira foi recalculada.");
      router.refresh();
    } catch (error) {
      setMensagem(
        error instanceof Error ? error.message : "Falha inesperada."
      );
    } finally {
      setEnviando(false);
    }
  }

  function executarAcao(acao: AcaoVendaCarteira, titulo: TituloLista) {
    if (acao === "ver_venda") {
      router.push(`/vendas/${titulo.venda_id}`);
      return;
    }
    if (acao === "receber") {
      setAba("EM_ABERTO");
      setSelecionados(
        new Set(
          (titulo.itens ?? [])
            .filter((item) => numero(item.valor_aberto) > 0)
            .map((item) => item.id)
        )
      );
      return;
    }
    if (acao === "ver_recebimentos") {
      setRecebimentosTituloId(titulo.id);
      return;
    }
    if (acao === "cancelar_recebimento") {
      const ativos = (titulo.recebimentos ?? []).filter(recebimentoEstornavel);
      if (ativos.length === 1) {
        setEstorno({
          recebimentoId: ativos[0].id,
          numeroVenda: String(titulo.numero_venda ?? "—"),
          possuiFiscal: Boolean(titulo.fiscal),
        });
        setAvisoFiscalEstornoOk(false);
        setMotivoEstorno("");
        return;
      }
      setRecebimentosTituloId(titulo.id);
      return;
    }
    if (acao === "cancelar_venda") {
      const selecionadosDaVenda = (titulo.itens ?? [])
        .filter(
          (item) =>
            selecionados.has(item.id) &&
            normalizarStatusTitulo(item.status) !== "CANCELADO"
        )
        .map((item) => item.id);
      if (selecionadosDaVenda.length > 0) {
        setCancelarItemIds(selecionadosDaVenda);
        return;
      }
      const restantes = (titulo.itens ?? []).filter(
        (item) => normalizarStatusTitulo(item.status) !== "CANCELADO"
      );
      const jaParcial = (titulo.itens ?? []).some(
        (item) => normalizarStatusTitulo(item.status) === "CANCELADO"
      );
      if (jaParcial) {
        setCancelarItemIds(restantes.map((item) => item.id));
        return;
      }
      setVendaCancelarId(titulo.venda_id);
      return;
    }
    if (acao === "ver_historico") {
      setAba("MOVIMENTACOES");
    }
  }

  const abas: Array<{ id: Aba; label: string }> = [
    { id: "EM_ABERTO", label: "Em aberto" },
    { id: "QUITADAS", label: "Quitadas" },
    { id: "TODAS", label: "Todas" },
    { id: "RECEBIMENTOS", label: "Recebimentos" },
    { id: "MOVIMENTACOES", label: "Movimentações" },
    { id: "CREDITOS", label: "Créditos" },
    { id: "COMPRAS", label: "Compras" },
  ];

  function abrirCancelamentoItensSelecionados() {
    if (selecionados.size === 0) {
      setMensagem("Selecione ao menos um item.");
      return;
    }
    const escolhidos = itens.filter((item) => selecionados.has(item.id));
    const mesmaVenda = conferirItensMesmaVenda(
      escolhidos.map((item) => {
        const titulo = titulosPreparados.find((t) => t.id === item.titulo_id);
        return { venda_id: titulo?.venda_id };
      })
    );
    if (!mesmaVenda.ok) {
      setMensagem(mesmaVenda.erro);
      return;
    }
    setCancelarItemIds(Array.from(selecionados));
  }

  const abaVendas =
    aba === "EM_ABERTO" || aba === "QUITADAS" || aba === "TODAS";
  const vendaCancelar = titulosPreparados.find(
    (titulo) => titulo.venda_id === vendaCancelarId
  );

  return (
    <div className="bg-white">
      <div className="grid gap-3 border-b border-zinc-200 p-4 sm:grid-cols-3">
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-red-700/80">
            Saldo devedor
          </p>
          <p className="mt-1 text-xl font-bold text-red-800">
            {dinheiro(saldoDevedor)}
          </p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700/80">
            Crédito disponível
          </p>
          <p className="mt-1 text-xl font-bold text-emerald-800">
            {dinheiro(creditoDisponivel)}
          </p>
        </div>
        <div className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-sky-700/80">
            {saldoLiquido > 0
              ? "Crédito líquido"
              : saldoLiquido < 0
                ? "Débito líquido"
                : "Conta zerada"}
          </p>
          <p className="mt-1 text-xl font-bold text-sky-800">
            {dinheiro(Math.abs(saldoLiquido))}
          </p>
        </div>
      </div>

      <nav className="flex h-9 items-center gap-1 overflow-x-auto border-b border-zinc-200 px-3 text-[13px] font-medium">
        {abas.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setAba(item.id)}
            className={[
              "relative whitespace-nowrap px-2.5 py-1.5",
              aba === item.id ? "text-zinc-950" : "text-zinc-500 hover:text-zinc-800",
            ].join(" ")}
          >
            {item.label}
            {aba === item.id && (
              <span className="absolute inset-x-2 bottom-0 h-0.5 bg-zinc-950" />
            )}
          </button>
        ))}
      </nav>

      {abaVendas && (
        <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
          <label className="text-sm">
            <span className="text-xs font-medium text-zinc-600">Período</span>
            <select
              value={periodo}
              onChange={(event) =>
                setPeriodo(periodoCarteiraValido(event.target.value))
              }
              className="mt-1 block rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
            >
              {Object.entries(ROTULOS_PERIODO_CARTEIRA).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {periodo === "personalizado" && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-sm">
                <span className="text-xs font-medium text-zinc-600">
                  Data inicial
                </span>
                <input
                  type="date"
                  value={inicio}
                  onChange={(event) => setInicio(event.target.value)}
                  className="mt-1 block rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="text-sm">
                <span className="text-xs font-medium text-zinc-600">
                  Data final
                </span>
                <input
                  type="date"
                  value={fim}
                  onChange={(event) => setFim(event.target.value)}
                  className="mt-1 block rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                />
              </label>
            </div>
          )}
          <label className="text-sm sm:min-w-[220px]">
            <span className="text-xs font-medium text-zinc-600">Buscar</span>
            <input
              value={busca}
              onChange={(event) => setBusca(event.target.value)}
              placeholder="número da venda ou produto..."
              className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <BotaoImprimirConector
              pdfUrl={`/api/impressao/carteira-abertos/${cliente.id}?papel=80mm`}
              tipoDocumento="recibo"
              papel="80mm"
              label="Imprimir itens em aberto"
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700"
            />
            <a
              href={`/clientes/${cliente.id}/carteira/imprimir-abertos`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700"
            >
              Visualizar itens em aberto
            </a>
          </div>
        </div>
      )}

      <section>
        {aba === "EM_ABERTO" && (
          <div className="p-4">
            <div className="grid gap-3 border border-zinc-200 bg-zinc-50 p-3 lg:grid-cols-[1fr_200px]">
              <div>
                <p className="text-sm font-semibold text-zinc-900">
                  Receber pagamento
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Você pode quitar tudo, informar um valor parcial ou marcar
                  apenas os itens desejados.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label>
                    <span className="text-xs font-medium text-zinc-600">
                      Forma de pagamento
                    </span>
                    <select
                      value={formaPagamentoId}
                      onChange={(event) =>
                        setFormaPagamentoId(event.target.value)
                      }
                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
                    >
                      {formasPagamento.map((forma) => (
                        <option key={forma.id} value={forma.id}>
                          {forma.nome}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="text-xs font-medium text-zinc-600">
                      Valor parcial
                    </span>
                    <input
                      value={valorParcial}
                      onChange={(event) => setValorParcial(event.target.value)}
                      placeholder="0,00"
                      inputMode="decimal"
                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
                    />
                  </label>
                </div>
                <label className="mt-3 block">
                  <span className="text-xs font-medium text-zinc-600">
                    Observação
                  </span>
                  <input
                    value={observacao}
                    onChange={(event) => setObservacao(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <div className="flex flex-col justify-end gap-2">
                <button
                  type="button"
                  disabled={enviando || saldoDevedor <= 0}
                  onClick={() => receber("TOTAL")}
                  className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Quitar tudo
                </button>
                <button
                  type="button"
                  disabled={enviando || saldoDevedor <= 0}
                  onClick={() => receber("PARCIAL")}
                  className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 disabled:opacity-50"
                >
                  Baixa parcial
                </button>
                <button
                  type="button"
                  disabled={enviando || selecionados.size === 0}
                  onClick={() => receber("ITENS")}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 disabled:opacity-50"
                >
                  Baixar itens selecionados
                  {selecionados.size ? ` (${selecionados.size})` : ""}
                </button>
                <button
                  type="button"
                  disabled={enviando || selecionados.size === 0}
                  onClick={abrirCancelamentoItensSelecionados}
                  className="rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 disabled:opacity-50"
                >
                  Cancelar itens selecionados
                  {selecionados.size ? ` (${selecionados.size})` : ""}
                </button>
              </div>
            </div>
            {mensagem && (
              <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
                {mensagem}
              </div>
            )}
            <ListaVendas
              titulos={titulosFiltrados}
              aba={aba}
              selecionados={selecionados}
              onAlternarItem={alternarItem}
              onAcao={executarAcao}
              recebimentoEstornavel={recebimentoEstornavel}
            />
          </div>
        )}

        {(aba === "QUITADAS" || aba === "TODAS") && (
          <div className="p-4">
            {mensagem && (
              <div className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
                {mensagem}
              </div>
            )}
            <ListaVendas
              titulos={titulosFiltrados}
              aba={aba}
              selecionados={selecionados}
              onAlternarItem={alternarItem}
              onAcao={executarAcao}
              recebimentoEstornavel={recebimentoEstornavel}
            />
          </div>
        )}

        {aba === "RECEBIMENTOS" && (
          <div className="p-4">
            {!recebimentos.length ? (
              <Vazio texto="Nenhum recebimento registrado." />
            ) : (
              <HistoricoRecebimentos
                recebimentos={recebimentos}
                estornosPorRecebimento={estornosPorRecebimento}
                alocacoesPorRecebimento={alocacoesPorRecebimento}
                onImprimir={setReciboImprimir}
                onCancelar={(recebimento) => {
                  const aloc = alocacoesPorRecebimento.get(recebimento.id)?.[0];
                  const tituloId = aloc
                    ? tituloPorItem.get(aloc.item_id)
                    : null;
                  const titulo = titulosPreparados.find(
                    (item) => item.id === tituloId
                  );
                  setEstorno({
                    recebimentoId: recebimento.id,
                    numeroVenda: String(titulo?.numero_venda ?? "—"),
                    possuiFiscal: Boolean(titulo?.fiscal),
                  });
                  setAvisoFiscalEstornoOk(false);
                  setMotivoEstorno("");
                }}
                podeCancelar={recebimentoEstornavel}
              />
            )}
          </div>
        )}

        {aba === "MOVIMENTACOES" && (
          <div className="p-4">
            {!movimentos.length ? (
              <Vazio texto="Nenhuma movimentação." />
            ) : (
              <ol>
                {movimentos.map((movimento) => {
                  const debito = movimento.tipo === "DEBITO";
                  const recebimentoVinculado =
                    movimento.origem === "RECEBIMENTO" && movimento.recebimento_id
                      ? recebimentos.find(
                          (item) => item.id === movimento.recebimento_id
                        )
                      : undefined;
                  return (
                    <li
                      key={movimento.id}
                      className="relative flex gap-3 py-3"
                    >
                      <div
                        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          debito
                            ? "bg-red-50 text-red-600"
                            : "bg-emerald-50 text-emerald-600"
                        }`}
                      >
                        {debito ? "−" : "+"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-zinc-900">
                          {movimento.origem}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {dataHora(movimento.created_at)}
                          {movimento.descricao ? ` · ${movimento.descricao}` : ""}
                        </p>
                        {recebimentoVinculado ? (
                          <button
                            type="button"
                            className="mt-1 text-xs font-semibold text-zinc-700 underline"
                            onClick={() => setReciboImprimir(recebimentoVinculado)}
                          >
                            Imprimir
                          </button>
                        ) : null}
                      </div>
                      <p
                        className={`text-sm font-semibold ${
                          debito ? "text-red-700" : "text-emerald-700"
                        }`}
                      >
                        {dinheiro(movimento.valor)}
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        )}

        {aba === "CREDITOS" && (
          <div className="p-4">
            {!creditos.length ? (
              <Vazio texto="Nenhum crédito para este cliente." />
            ) : (
              <table className="updv-table">
                <thead>
                  <tr>
                    <th>Origem</th>
                    <th>Data</th>
                    <th>Status</th>
                    <th className="num">Original</th>
                    <th className="num">Disponível</th>
                  </tr>
                </thead>
                <tbody>
                  {creditos.map((credito) => (
                    <tr key={credito.id}>
                      <td>
                        <p className="font-semibold">{credito.origem}</p>
                        {credito.observacao && (
                          <p className="text-xs text-zinc-400">
                            {credito.observacao}
                          </p>
                        )}
                      </td>
                      <td>{dataHora(credito.created_at)}</td>
                      <td>
                        <Status valor={credito.status} />
                      </td>
                      <td className="num">{dinheiro(credito.valor_original)}</td>
                      <td className="num font-semibold text-emerald-700">
                        {dinheiro(credito.valor_disponivel)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {aba === "COMPRAS" && (
          <div className="p-4">
            {!vendas.length ? (
              <Vazio texto="Este cliente ainda não possui compras." />
            ) : (
              <table className="updv-table">
                <thead>
                  <tr>
                    <th>Venda</th>
                    <th>Data</th>
                    <th>Status</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {vendas.map((venda) => (
                    <tr key={venda.id}>
                      <td>
                        <a
                          href={`/vendas/${venda.id}`}
                          className="font-semibold hover:underline"
                        >
                          Venda #{venda.numero ?? "—"}
                        </a>
                      </td>
                      <td>{dataHora(venda.finalizada_at ?? venda.created_at)}</td>
                      <td>
                        <Status valor={venda.status} />
                        {venda.status === "cancelada" &&
                          venda.motivo_cancelamento && (
                            <p className="text-xs text-red-600">
                              {venda.motivo_cancelamento}
                            </p>
                          )}
                      </td>
                      <td className="num font-semibold">
                        {dinheiro(venda.valor_total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      {cancelarItemIds && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4">
          <div className="w-full max-w-2xl">
            <CancelarItensCarteira
              clienteId={cliente.id}
              itemIds={cancelarItemIds}
              onFechar={() => {
                setCancelarItemIds(null);
                setSelecionados(new Set());
                router.refresh();
              }}
            />
          </div>
        </div>
      )}

      {vendaCancelarId && vendaCancelar && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4">
          <div className="w-full max-w-2xl">
            <CancelarVendaComercial
              vendaId={vendaCancelarId}
              numero={vendaCancelar.numero_venda}
              iniciarAberto
              onFechar={() => {
                setVendaCancelarId(null);
                router.refresh();
              }}
            />
          </div>
        </div>
      )}

      {recebimentosTituloId && (
        <Modal
          titulo="Recebimentos da venda"
          onFechar={() => setRecebimentosTituloId(null)}
        >
          <HistoricoRecebimentos
            recebimentos={
              recebimentosPorTitulo.get(recebimentosTituloId) ?? []
            }
            estornosPorRecebimento={estornosPorRecebimento}
            alocacoesPorRecebimento={alocacoesPorRecebimento}
            onImprimir={setReciboImprimir}
            onCancelar={(recebimento) => {
              const titulo = titulosPreparados.find(
                (item) => item.id === recebimentosTituloId
              );
              setEstorno({
                recebimentoId: recebimento.id,
                numeroVenda: String(titulo?.numero_venda ?? "—"),
                possuiFiscal: Boolean(titulo?.fiscal),
              });
              setAvisoFiscalEstornoOk(false);
              setMotivoEstorno("");
            }}
            podeCancelar={recebimentoEstornavel}
          />
        </Modal>
      )}

      <ModalReciboRecebimento
        open={Boolean(reciboImprimir)}
        clienteId={cliente.id}
        clienteNome={cliente.nome_fantasia || cliente.nome}
        recebimento={
          reciboImprimir
            ? {
                id: reciboImprimir.id,
                valor: reciboImprimir.valor,
                formaPagamento: reciboImprimir.forma_pagamento_nome,
                dataIso: reciboImprimir.processado_at ?? reciboImprimir.created_at,
              }
            : null
        }
        onClose={() => setReciboImprimir(null)}
      />

      {estorno && (
        <Modal
          titulo={`Cancelar recebimento da Venda #${estorno.numeroVenda}?`}
          onFechar={() => {
            setEstorno(null);
            setAvisoFiscalEstornoOk(false);
            setMotivoEstorno("");
          }}
        >
          {estorno.possuiFiscal && !avisoFiscalEstornoOk ? (
            <div className="space-y-3 text-sm text-zinc-700">
              <p className="font-semibold">Esta venda possui documento fiscal.</p>
              <p>
                A operação irá alterar somente as movimentações comerciais
                relacionadas à venda.
              </p>
              <p>O documento fiscal permanecerá com a situação fiscal atual.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold"
                  onClick={() => setEstorno(null)}
                >
                  Voltar
                </button>
                <button
                  type="button"
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white"
                  onClick={() => setAvisoFiscalEstornoOk(true)}
                >
                  Continuar
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-sm text-zinc-700">
              <p>
                Essa operação irá estornar as movimentações relacionadas
                utilizando a rotina existente do UltraPDV.
              </p>
              <p>
                Carteira, crédito e demais movimentos vinculados serão atualizados
                conforme a regra atual do sistema. O histórico será preservado.
                O documento fiscal não será alterado.
              </p>
              <label className="block">
                <span className="text-xs font-medium text-zinc-600">Motivo</span>
                <textarea
                  value={motivoEstorno}
                  onChange={(event) => setMotivoEstorno(event.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold"
                  onClick={() => setEstorno(null)}
                >
                  Voltar
                </button>
                <button
                  type="button"
                  disabled={enviando || motivoEstorno.trim().length < 5}
                  className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  onClick={() => void confirmarEstorno()}
                >
                  Confirmar cancelamento
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function ListaVendas({
  titulos,
  aba,
  selecionados,
  onAlternarItem,
  onAcao,
  recebimentoEstornavel,
}: {
  titulos: TituloLista[];
  aba: Aba;
  selecionados: Set<string>;
  onAlternarItem: (id: string) => void;
  onAcao: (acao: AcaoVendaCarteira, titulo: TituloLista) => void;
  recebimentoEstornavel: (recebimento: Recebimento) => boolean;
}) {
  if (!titulos.length) {
    return <Vazio texto="Nenhuma venda neste filtro." />;
  }

  const indicePrimeiraQuitada = titulos.findIndex(
    (titulo) => normalizarStatusTitulo(titulo.status) === "QUITADO"
  );

  return (
    <div className="mt-6 space-y-4">
      {titulos.map((titulo, index) => {
        const status = normalizarStatusTitulo(titulo.status);
        const mostrarCabecalhoQuitadas =
          aba === "TODAS" &&
          index === indicePrimeiraQuitada &&
          indicePrimeiraQuitada >= 0;
        const pago = Math.max(
          0,
          numero(titulo.valor_original) -
            numero(titulo.valor_aberto) -
            titulo.itens.reduce(
              (total, item) =>
                normalizarStatusTitulo(item.status) === "CANCELADO"
                  ? total + numero(item.valor_original)
                  : total,
              0
            )
        );
        const cancelado = titulo.itens.reduce(
          (total, item) =>
            normalizarStatusTitulo(item.status) === "CANCELADO"
              ? total + numero(item.valor_original)
              : total,
          0
        );
        const fiscal = resumoFiscalVendaCarteira(titulo.fiscal);
        const acoes = acoesPorEstadoVendaCarteira({
          statusTitulo: titulo.status,
          valorAberto: numero(titulo.valor_aberto),
          possuiRecebimentoEstornavel: (titulo.recebimentos ?? []).some(
            recebimentoEstornavel
          ),
        });

        return (
          <div key={titulo.id}>
            {mostrarCabecalhoQuitadas && (
              <p className="mb-2 text-xs font-semibold tracking-wide text-zinc-400">
                QUITADAS
              </p>
            )}
            <div className="overflow-hidden rounded-xl border border-zinc-200">
              <div className="flex flex-col gap-3 bg-zinc-50 p-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={`/vendas/${titulo.venda_id}`}
                      className="font-semibold text-zinc-900 hover:underline"
                    >
                      Venda #{titulo.numero_venda ?? "—"}
                    </a>
                    <Status valor={status} />
                    <ActionMenu
                      items={acoes.map((acao) => ({
                        label: rotuloAcaoVendaCarteira(acao),
                        danger: acaoVendaCarteiraPerigosa(acao),
                        onClick: () => onAcao(acao, titulo),
                      }))}
                    />
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {dataCurta(titulo.dataVenda)}
                    {status === "QUITADO" && titulo.quitado_em
                      ? ` · Quitada em ${dataHora(titulo.quitado_em)}`
                      : ""}
                  </p>
                  {fiscal && (
                    <p className="mt-1 text-xs text-zinc-500">{fiscal.linha}</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-zinc-500">Original</p>
                    <p className="font-semibold">
                      {dinheiro(titulo.valor_original)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Pago</p>
                    <p className="font-semibold">{dinheiro(pago)}</p>
                  </div>
                  {cancelado > 0 && (
                    <div>
                      <p className="text-xs text-zinc-500">Cancelado</p>
                      <p className="font-semibold text-red-700">
                        {dinheiro(cancelado)}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-zinc-500">Saldo</p>
                    <p
                      className={`font-semibold ${
                        numero(titulo.valor_aberto) > 0
                          ? "text-red-700"
                          : "text-zinc-700"
                      }`}
                    >
                      {dinheiro(titulo.valor_aberto)}
                    </p>
                  </div>
                </div>
              </div>
              {status !== "CANCELADO" && (
                <div className="divide-y divide-zinc-100">
                  {titulo.itens.map((item) => {
                    const itemCancelado =
                      normalizarStatusTitulo(item.status) === "CANCELADO";
                    const podeMarcar =
                      !itemCancelado &&
                      numero(item.valor_aberto) > 0 &&
                      aba === "EM_ABERTO";
                    return (
                    <label
                      key={item.id}
                      className={`flex items-start gap-3 p-4 ${
                        podeMarcar ? "cursor-pointer" : ""
                      } ${itemCancelado ? "bg-red-50/60" : ""}`}
                    >
                      {podeMarcar ? (
                        <input
                          type="checkbox"
                          checked={selecionados.has(item.id)}
                          onChange={() => onAlternarItem(item.id)}
                          className="mt-1"
                        />
                      ) : (
                        <span className="mt-1 inline-block h-4 w-4" />
                      )}
                      <div className="flex flex-1 flex-col gap-1 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p
                            className={`font-medium ${
                              itemCancelado
                                ? "text-zinc-500 line-through"
                                : "text-zinc-900"
                            }`}
                          >
                            {item.produto_nome}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {item.produto_codigo
                              ? `Cód. ${item.produto_codigo} • `
                              : ""}
                            Qtd. {numero(item.quantidade)} {item.unidade_medida}
                          </p>
                        </div>
                        <div className="text-left md:text-right">
                          <Status valor={item.status} />
                          <p className="mt-2 text-sm">
                            {itemCancelado ? "Cancelado: " : "Aberto: "}
                            <strong>
                              {dinheiro(
                                itemCancelado
                                  ? item.valor_original
                                  : item.valor_aberto
                              )}
                            </strong>
                          </p>
                          <p className="text-xs text-zinc-400">
                            Original: {dinheiro(item.valor_original)}
                          </p>
                        </div>
                      </div>
                    </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HistoricoRecebimentos({
  recebimentos,
  estornosPorRecebimento,
  onImprimir,
  onCancelar,
  podeCancelar,
}: {
  recebimentos: Recebimento[];
  estornosPorRecebimento: Map<string, Estorno[]>;
  alocacoesPorRecebimento?: Map<string, Alocacao[]>;
  onImprimir: (recebimento: Recebimento) => void;
  onCancelar: (recebimento: Recebimento) => void;
  podeCancelar: (recebimento: Recebimento) => boolean;
}) {
  if (!recebimentos.length) {
    return <Vazio texto="Nenhum recebimento nesta venda." />;
  }

  return (
    <div className="space-y-3">
      {recebimentos.map((recebimento) => {
        const listaEstornos = estornosPorRecebimento.get(recebimento.id) ?? [];
        return (
          <div
            key={recebimento.id}
            className="rounded-xl border border-zinc-200 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{dinheiro(recebimento.valor)}</p>
                <p className="text-xs text-zinc-500">
                  {dataHora(recebimento.processado_at ?? recebimento.created_at)}
                  {" · "}
                  {recebimento.forma_pagamento_nome ?? "—"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700"
                  onClick={() => onImprimir(recebimento)}
                >
                  Imprimir
                </button>
                {podeCancelar(recebimento) && (
                  <button
                    type="button"
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700"
                    onClick={() => onCancelar(recebimento)}
                  >
                    Cancelar recebimento
                  </button>
                )}
              </div>
            </div>
            {listaEstornos.map((item) => (
              <div
                key={item.id}
                className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800"
              >
                <p className="font-semibold">ESTORNADO</p>
                <p>{dataHora(item.concluido_at ?? item.created_at)}</p>
                {item.motivo && <p>Motivo: {item.motivo}</p>}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Modal({
  titulo,
  onFechar,
  children,
}: {
  titulo: string;
  onFechar: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold text-zinc-950">{titulo}</h3>
          <button
            type="button"
            onClick={onFechar}
            className="text-sm text-zinc-500"
          >
            Fechar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Status({ valor }: { valor: string }) {
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${classeStatus(
        valor
      )}`}
    >
      {valor}
    </span>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">
      {texto}
    </div>
  );
}
