import "server-only";

import { createClient } from "@/lib/supabase/server";

import { totaisDoLivro } from "./saldo";
import {
  deveOcultarEsperadoCaixaAberto,
  sanitizarSessaoCaixaAbertoCego,
} from "./conferencia";
import type {
  CaixaFechamentoMeio,
  CaixaMovimento,
  CaixaResumoAnterior,
  CaixaSessao,
  PainelCaixa,
  StatusCaixa,
  TipoMovimentoCaixa,
} from "./tipos";

function numero(valor: unknown) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function texto(valor: unknown) {
  const saida = String(valor ?? "").trim();
  return saida || null;
}

function statusCaixa(valor: unknown): StatusCaixa {
  const bruto = String(valor ?? "");
  if (bruto === "aberto" || bruto === "fechado" || bruto === "cancelado") {
    return bruto;
  }
  return "fechado";
}

function tipoMovimento(valor: unknown): TipoMovimentoCaixa {
  const bruto = String(valor ?? "");
  if (
    bruto === "abertura" ||
    bruto === "suprimento" ||
    bruto === "sangria" ||
    bruto === "ajuste" ||
    bruto === "venda" ||
    bruto === "recebimento_carteira" ||
    bruto === "estorno_recebimento"
  ) {
    return bruto;
  }
  return "ajuste";
}

type LinhaCaixa = {
  id: string;
  empresa_id: string;
  filial_id: string | null;
  numero: number;
  usuario_abertura_id: string;
  usuario_fechamento_id: string | null;
  saldo_inicial: number | string;
  dinheiro_contado: number | string | null;
  diferenca: number | string | null;
  aberto_em: string;
  fechado_em: string | null;
  status: string;
  observacao_abertura: string | null;
  observacao_fechamento: string | null;
};

const COLUNAS_MOVIMENTO =
  "id, caixa_id, tipo, origem_tipo, origem_id, forma_pagamento_id, forma_tipo, forma_codigo, forma_nome, permite_troco_snapshot, afeta_caixa_fisico_snapshot, venda_id, venda_numero, cliente_nome, entrada, saida, valor_liquido, descricao, usuario_id, estorno_de_id, created_at";

type LinhaMovimento = {
  id: string;
  caixa_id: string;
  tipo: string;
  origem_tipo: string | null;
  origem_id: string | null;
  forma_pagamento_id: string | null;
  forma_tipo: string | null;
  forma_codigo: string | null;
  forma_nome: string | null;
  permite_troco_snapshot: boolean | null;
  afeta_caixa_fisico_snapshot: boolean | null;
  venda_id: string | null;
  venda_numero: number | string | null;
  cliente_nome: string | null;
  entrada: number | string;
  saida: number | string;
  valor_liquido: number | string | null;
  descricao: string | null;
  usuario_id: string;
  estorno_de_id: string | null;
  created_at: string;
};

function mapearSessao(
  linha: LinhaCaixa,
  nomes: Map<string, string>
): CaixaSessao {
  return {
    id: String(linha.id),
    empresa_id: String(linha.empresa_id),
    filial_id: linha.filial_id ? String(linha.filial_id) : null,
    numero: Number(linha.numero) || 0,
    usuario_abertura_id: String(linha.usuario_abertura_id),
    usuario_abertura_nome: nomes.get(String(linha.usuario_abertura_id)) ?? null,
    usuario_fechamento_id: linha.usuario_fechamento_id
      ? String(linha.usuario_fechamento_id)
      : null,
    usuario_fechamento_nome: linha.usuario_fechamento_id
      ? nomes.get(String(linha.usuario_fechamento_id)) ?? null
      : null,
    saldo_inicial: numero(linha.saldo_inicial),
    dinheiro_contado:
      linha.dinheiro_contado === null || linha.dinheiro_contado === undefined
        ? null
        : numero(linha.dinheiro_contado),
    diferenca:
      linha.diferenca === null || linha.diferenca === undefined
        ? null
        : numero(linha.diferenca),
    aberto_em: String(linha.aberto_em),
    fechado_em: linha.fechado_em ? String(linha.fechado_em) : null,
    status: statusCaixa(linha.status),
    observacao_abertura: texto(linha.observacao_abertura),
    observacao_fechamento: texto(linha.observacao_fechamento),
  };
}

function mapearMovimento(
  linha: LinhaMovimento,
  nomes: Map<string, string>
): CaixaMovimento {
  const vendaId = linha.venda_id ? String(linha.venda_id) : null;
  const numeroVenda = Number(linha.venda_numero);
  return {
    id: String(linha.id),
    caixa_id: String(linha.caixa_id),
    tipo: tipoMovimento(linha.tipo),
    origem_tipo: texto(linha.origem_tipo),
    origem_id: linha.origem_id ? String(linha.origem_id) : null,
    forma_pagamento_id: linha.forma_pagamento_id
      ? String(linha.forma_pagamento_id)
      : null,
    forma_nome: texto(linha.forma_nome),
    forma_tipo: texto(linha.forma_tipo),
    forma_codigo: texto(linha.forma_codigo),
    permite_troco_snapshot: linha.permite_troco_snapshot === true,
    afeta_caixa_fisico_snapshot: linha.afeta_caixa_fisico_snapshot === true,
    venda_id: vendaId,
    venda_numero: Number.isFinite(numeroVenda) ? numeroVenda : null,
    cliente_nome: texto(linha.cliente_nome),
    entrada: numero(linha.entrada),
    saida: numero(linha.saida),
    valor_liquido: numero(
      linha.valor_liquido ?? Number(linha.entrada ?? 0) - Number(linha.saida ?? 0)
    ),
    descricao: texto(linha.descricao),
    usuario_id: String(linha.usuario_id),
    usuario_nome: nomes.get(String(linha.usuario_id)) ?? null,
    estorno_de_id: linha.estorno_de_id ? String(linha.estorno_de_id) : null,
    created_at: String(linha.created_at),
  };
}

async function nomesUsuarios(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: string[]
) {
  const unicos = [...new Set(ids.filter(Boolean))];
  const mapa = new Map<string, string>();
  if (unicos.length === 0) {
    return mapa;
  }

  const { data } = await supabase
    .from("usuarios")
    .select("id, nome")
    .in("id", unicos);

  for (const usuario of data ?? []) {
    const id = String((usuario as { id?: unknown }).id ?? "");
    const nome = texto((usuario as { nome?: unknown }).nome);
    if (id && nome) {
      mapa.set(id, nome);
    }
  }

  return mapa;
}

function mapearFechamentoMeio(linha: {
  chave?: string | null;
  forma_pagamento_id?: string | null;
  forma_nome_snapshot?: string | null;
  forma_tipo_snapshot?: string | null;
  forma_codigo_snapshot?: string | null;
  afeta_caixa_fisico_snapshot?: boolean | null;
  valor_esperado?: number | string | null;
  valor_informado?: number | string | null;
  diferenca?: number | string | null;
}): CaixaFechamentoMeio {
  const esperado = numero(linha.valor_esperado);
  const informado = numero(linha.valor_informado);
  return {
    chave: String(linha.chave ?? ""),
    forma_pagamento_id: linha.forma_pagamento_id
      ? String(linha.forma_pagamento_id)
      : null,
    forma_nome_snapshot: texto(linha.forma_nome_snapshot) || "Sem forma",
    forma_tipo_snapshot: texto(linha.forma_tipo_snapshot),
    forma_codigo_snapshot: texto(linha.forma_codigo_snapshot),
    afeta_caixa_fisico_snapshot: linha.afeta_caixa_fisico_snapshot === true,
    valor_esperado: esperado,
    valor_informado: informado,
    diferenca: numero(linha.diferenca ?? informado - esperado),
  };
}

async function carregarConferencias(
  supabase: Awaited<ReturnType<typeof createClient>>,
  empresaId: string,
  idsCaixa: string[]
) {
  const porCaixa = new Map<string, CaixaFechamentoMeio[]>();
  if (idsCaixa.length === 0) {
    return porCaixa;
  }

  const { data } = await supabase
    .from("caixa_fechamentos_meios")
    .select(
      "caixa_id, chave, forma_pagamento_id, forma_nome_snapshot, forma_tipo_snapshot, forma_codigo_snapshot, afeta_caixa_fisico_snapshot, valor_esperado, valor_informado, diferenca"
    )
    .eq("empresa_id", empresaId)
    .in("caixa_id", idsCaixa)
    .order("created_at", { ascending: true });

  const permitidos = new Set(idsCaixa);
  for (const bruto of data ?? []) {
    const caixaId = String((bruto as { caixa_id?: unknown }).caixa_id ?? "");
    if (!permitidos.has(caixaId)) {
      continue;
    }
    const lista = porCaixa.get(caixaId) ?? [];
    lista.push(mapearFechamentoMeio(bruto as Parameters<typeof mapearFechamentoMeio>[0]));
    porCaixa.set(caixaId, lista);
  }

  return porCaixa;
}

export async function carregarFechamentoCego(
  supabase: Awaited<ReturnType<typeof createClient>>,
  empresaId: string
) {
  const { data } = await supabase
    .from("caixa_configuracoes")
    .select("empresa_id, fechamento_caixa_cego")
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (!data || String((data as { empresa_id?: unknown }).empresa_id) !== empresaId) {
    return false;
  }

  return (data as { fechamento_caixa_cego?: unknown }).fechamento_caixa_cego === true;
}

async function mapearLivro(
  supabase: Awaited<ReturnType<typeof createClient>>,
  movimentos: LinhaMovimento[],
  idsUsuarios: string[]
) {
  const nomes = await nomesUsuarios(supabase, idsUsuarios);
  return {
    nomes,
    livro: movimentos.map((item) => mapearMovimento(item, nomes)),
  };
}

export async function carregarPainelCaixa(
  empresaId: string,
  opcoes?: { podeRevelarEsperadoCego?: boolean }
): Promise<PainelCaixa> {
  const supabase = await createClient();
  const id = String(empresaId ?? "").trim();

  const { data: caixasBrutas } = await supabase
    .from("caixas")
    .select(
      "id, empresa_id, filial_id, numero, usuario_abertura_id, usuario_fechamento_id, saldo_inicial, dinheiro_contado, diferenca, aberto_em, fechado_em, status, observacao_abertura, observacao_fechamento"
    )
    .eq("empresa_id", id)
    .order("aberto_em", { ascending: false })
    .limit(120);

  const caixas = ((caixasBrutas ?? []) as LinhaCaixa[]).filter(
    (linha) => String(linha.empresa_id) === id
  );
  const idsCaixa = caixas.map((caixa) => caixa.id);
  let movimentos: LinhaMovimento[] = [];

  if (idsCaixa.length > 0) {
    const { data: movimentosBrutos } = await supabase
      .from("caixa_movimentacoes")
      .select(COLUNAS_MOVIMENTO)
      .eq("empresa_id", id)
      .in("caixa_id", idsCaixa)
      .order("created_at", { ascending: true });

    const permitidos = new Set(idsCaixa);
    movimentos = ((movimentosBrutos ?? []) as LinhaMovimento[]).filter((linha) =>
      permitidos.has(String(linha.caixa_id))
    );
  }

  const { nomes, livro } = await mapearLivro(supabase, movimentos, [
    ...caixas.map((caixa) => caixa.usuario_abertura_id),
    ...caixas.map((caixa) => caixa.usuario_fechamento_id ?? ""),
    ...movimentos.map((movimento) => movimento.usuario_id),
  ]);
  const conferencias = await carregarConferencias(supabase, id, idsCaixa);
  const fechamentoCego = await carregarFechamentoCego(supabase, id);

  const porCaixa = new Map<string, CaixaMovimento[]>();
  for (const mapeado of livro) {
    const lista = porCaixa.get(mapeado.caixa_id) ?? [];
    lista.push(mapeado);
    porCaixa.set(mapeado.caixa_id, lista);
  }

  const aberto = caixas.find((caixa) => caixa.status === "aberto") ?? null;
  const atuaisMovimentos = aberto ? porCaixa.get(aberto.id) ?? [] : [];
  const totaisAtual = totaisDoLivro(atuaisMovimentos);
  const atualBruto = aberto
    ? {
        ...mapearSessao(aberto, nomes),
        ...totaisAtual,
        movimentos: atuaisMovimentos,
      }
    : null;
  const ocultarAberto = deveOcultarEsperadoCaixaAberto({
    fechamentoCego,
    caixaAberto: Boolean(aberto),
    podeRevelarEsperado: opcoes?.podeRevelarEsperadoCego === true,
  });

  const anteriores: CaixaResumoAnterior[] = caixas
    .filter((caixa) => caixa.status !== "aberto")
    .map((linha) => {
      const sessao = mapearSessao(linha, nomes);
      const movimentosCaixa = porCaixa.get(sessao.id) ?? [];
      return {
        ...sessao,
        ...totaisDoLivro(movimentosCaixa),
        movimentos: movimentosCaixa,
        conferencia: conferencias.get(sessao.id) ?? [],
      };
    });

  return {
    atual:
      atualBruto && ocultarAberto
        ? sanitizarSessaoCaixaAbertoCego(atualBruto)
        : atualBruto,
    anteriores,
    fechamentoCego,
  };
}

export async function carregarDetalheCaixa(input: {
  empresaId: string;
  caixaId: string;
  podeRevelarEsperadoCego?: boolean;
}) {
  const supabase = await createClient();
  const empresaId = String(input.empresaId ?? "").trim();
  const caixaId = String(input.caixaId ?? "").trim();

  const { data: linha, error } = await supabase
    .from("caixas")
    .select(
      "id, empresa_id, filial_id, numero, usuario_abertura_id, usuario_fechamento_id, saldo_inicial, dinheiro_contado, diferenca, aberto_em, fechado_em, status, observacao_abertura, observacao_fechamento"
    )
    .eq("empresa_id", empresaId)
    .eq("id", caixaId)
    .maybeSingle();

  if (error || !linha || String((linha as LinhaCaixa).empresa_id) !== empresaId) {
    return null;
  }

  const { data: movimentos } = await supabase
    .from("caixa_movimentacoes")
    .select(COLUNAS_MOVIMENTO)
    .eq("empresa_id", empresaId)
    .eq("caixa_id", caixaId)
    .order("created_at", { ascending: true });

  const linhas = ((movimentos ?? []) as LinhaMovimento[]).filter(
    (item) => String(item.caixa_id) === caixaId
  );
  const { nomes, livro } = await mapearLivro(supabase, linhas, [
    (linha as LinhaCaixa).usuario_abertura_id,
    (linha as LinhaCaixa).usuario_fechamento_id ?? "",
    ...linhas.map((item) => item.usuario_id),
  ]);
  const conferencias = await carregarConferencias(supabase, empresaId, [caixaId]);
  const fechamentoCego = await carregarFechamentoCego(supabase, empresaId);
  const detalhe = {
    ...mapearSessao(linha as LinhaCaixa, nomes),
    ...totaisDoLivro(livro),
    movimentos: livro,
    conferencia: conferencias.get(caixaId) ?? [],
  };
  const ocultar = deveOcultarEsperadoCaixaAberto({
    fechamentoCego,
    caixaAberto: detalhe.status === "aberto",
    podeRevelarEsperado: input.podeRevelarEsperadoCego === true,
  });

  return ocultar ? sanitizarSessaoCaixaAbertoCego(detalhe) : detalhe;
}
