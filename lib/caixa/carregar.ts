import "server-only";

import { createClient } from "@/lib/supabase/server";

import { totaisDoLivro } from "./saldo";
import type {
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
    bruto === "ajuste"
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

type LinhaMovimento = {
  id: string;
  caixa_id: string;
  tipo: string;
  origem_tipo: string | null;
  origem_id: string | null;
  forma_pagamento_id: string | null;
  entrada: number | string;
  saida: number | string;
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
  return {
    id: String(linha.id),
    caixa_id: String(linha.caixa_id),
    tipo: tipoMovimento(linha.tipo),
    origem_tipo: texto(linha.origem_tipo),
    origem_id: linha.origem_id ? String(linha.origem_id) : null,
    forma_pagamento_id: linha.forma_pagamento_id
      ? String(linha.forma_pagamento_id)
      : null,
    entrada: numero(linha.entrada),
    saida: numero(linha.saida),
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

export async function carregarPainelCaixa(empresaId: string): Promise<PainelCaixa> {
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
      .select(
        "id, caixa_id, tipo, origem_tipo, origem_id, forma_pagamento_id, entrada, saida, descricao, usuario_id, estorno_de_id, created_at"
      )
      .eq("empresa_id", id)
      .in("caixa_id", idsCaixa)
      .order("created_at", { ascending: true });

    const permitidos = new Set(idsCaixa);
    movimentos = ((movimentosBrutos ?? []) as LinhaMovimento[]).filter((linha) =>
      permitidos.has(String(linha.caixa_id))
    );
  }

  const nomes = await nomesUsuarios(supabase, [
    ...caixas.map((caixa) => caixa.usuario_abertura_id),
    ...caixas.map((caixa) => caixa.usuario_fechamento_id ?? ""),
    ...movimentos.map((movimento) => movimento.usuario_id),
  ]);

  const porCaixa = new Map<string, CaixaMovimento[]>();
  for (const movimento of movimentos) {
    const mapeado = mapearMovimento(movimento, nomes);
    const lista = porCaixa.get(mapeado.caixa_id) ?? [];
    lista.push(mapeado);
    porCaixa.set(mapeado.caixa_id, lista);
  }

  const aberto = caixas.find((caixa) => caixa.status === "aberto") ?? null;
  const atuaisMovimentos = aberto ? porCaixa.get(aberto.id) ?? [] : [];
  const totaisAtual = totaisDoLivro(atuaisMovimentos);

  const anteriores: CaixaResumoAnterior[] = caixas
    .filter((caixa) => caixa.status !== "aberto")
    .map((linha) => {
      const sessao = mapearSessao(linha, nomes);
      const livro = porCaixa.get(sessao.id) ?? [];
      return {
        ...sessao,
        ...totaisDoLivro(livro),
        movimentos: livro,
      };
    });

  return {
    atual: aberto
      ? {
          ...mapearSessao(aberto, nomes),
          ...totaisAtual,
          movimentos: atuaisMovimentos,
        }
      : null,
    anteriores,
  };
}

export async function carregarDetalheCaixa(input: {
  empresaId: string;
  caixaId: string;
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
    .select(
      "id, caixa_id, tipo, origem_tipo, origem_id, forma_pagamento_id, entrada, saida, descricao, usuario_id, estorno_de_id, created_at"
    )
    .eq("empresa_id", empresaId)
    .eq("caixa_id", caixaId)
    .order("created_at", { ascending: true });

  const linhas = ((movimentos ?? []) as LinhaMovimento[]).filter(
    (item) => String(item.caixa_id) === caixaId
  );
  const nomes = await nomesUsuarios(supabase, [
    (linha as LinhaCaixa).usuario_abertura_id,
    (linha as LinhaCaixa).usuario_fechamento_id ?? "",
    ...linhas.map((item) => item.usuario_id),
  ]);
  const livro = linhas.map((item) => mapearMovimento(item, nomes));

  return {
    ...mapearSessao(linha as LinhaCaixa, nomes),
    ...totaisDoLivro(livro),
    movimentos: livro,
  };
}
