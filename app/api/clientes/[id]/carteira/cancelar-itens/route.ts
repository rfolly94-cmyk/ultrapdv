import { NextRequest, NextResponse } from "next/server";

import { aplicarCors, respostaOptions } from "@/lib/api/cors-mobile";
import {
  exigirCancelamentoItensCarteira,
  respostaNegacaoCarteira,
} from "@/lib/carteira/acesso-operacao";
import { createAdminClient } from "@/lib/supabase/admin";
import { obterClaimsSessao } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";
import {
  conferirItensMesmaVenda,
  pagoAlocadoDoItem,
  resumoValoresCancelamentoItens,
  todosItensAtivosSelecionados,
  vendaJaTeveCancelamentoParcial,
} from "@/lib/carteira/cancelar-itens";

type Context = {
  params: Promise<{
    id: string;
  }>;
};

type DestinoRecebido = "DEVOLUCAO" | "CREDITO";

function resposta(body: unknown, status = 200) {
  return aplicarCors(NextResponse.json(body, { status }), "GET, POST, OPTIONS");
}

export async function OPTIONS() {
  return respostaOptions("GET, POST, OPTIONS");
}

function uuidValido(valor: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    valor
  );
}

function idsDaQuery(request: NextRequest) {
  const bruto = request.nextUrl.searchParams.get("item_ids") ?? "";
  return bruto
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function contexto(clienteId: string) {
  const supabase = await createClient();
  const { data: claimsData, error: authError } =
    await obterClaimsSessao(supabase);

  if (authError || !claimsData?.claims?.sub) {
    return { erro: resposta({ ok: false, erro: "Não autenticado." }, 401) };
  }

  const { data: vinculo, error: vinculoError } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id, usuario_id")
    .eq("usuario_id", String(claimsData.claims.sub))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (vinculoError || !vinculo) {
    return {
      erro: resposta(
        { ok: false, erro: "Empresa ativa não encontrada." },
        403
      ),
    };
  }

  try {
    await exigirCancelamentoItensCarteira({
      empresaId: String(vinculo.empresa_id),
      origem: "API /api/clientes/[id]/carteira/cancelar-itens",
    });
  } catch (error) {
    const negacao = respostaNegacaoCarteira(error);
    if (negacao) {
      return { erro: negacao };
    }
    throw error;
  }

  const { data: cliente, error: clienteError } = await supabase
    .from("clientes")
    .select("id")
    .eq("empresa_id", vinculo.empresa_id)
    .eq("id", clienteId)
    .maybeSingle();

  if (clienteError || !cliente) {
    return {
      erro: resposta({ ok: false, erro: "Cliente não encontrado." }, 404),
    };
  }

  return { vinculo, supabase };
}

export async function GET(request: NextRequest, context: Context) {
  const { id: clienteId } = await context.params;
  const ctx = await contexto(clienteId);
  if ("erro" in ctx) {
    return ctx.erro;
  }

  const itemIds = idsDaQuery(request);
  if (!itemIds.length || itemIds.some((id) => !uuidValido(id))) {
    return resposta({ ok: false, erro: "Selecione ao menos um item válido." }, 400);
  }

  const admin = createAdminClient();
  const empresaId = ctx.vinculo.empresa_id;

  const { data: itens, error: itensError } = await admin
    .from("carteira_cliente_itens")
    .select(
      "id, titulo_id, venda_item_id, produto_nome, unidade_medida, quantidade, valor_original, valor_aberto, status"
    )
    .eq("empresa_id", empresaId)
    .eq("cliente_id", clienteId)
    .in("id", itemIds);

  if (itensError) {
    return resposta({ ok: false, erro: itensError.message }, 500);
  }

  if ((itens ?? []).length !== itemIds.length) {
    return resposta(
      { ok: false, erro: "Item não encontrado na carteira desta empresa." },
      404
    );
  }

  const tituloId = itens?.[0]?.titulo_id;
  if (!tituloId || itens?.some((item) => item.titulo_id !== tituloId)) {
    return resposta(
      { ok: false, erro: "Selecione itens de uma única venda para cancelar." },
      409
    );
  }

  const { data: titulo, error: tituloError } = await admin
    .from("carteira_cliente_titulos")
    .select("id, venda_id, numero_venda, valor_original, valor_aberto, status")
    .eq("empresa_id", empresaId)
    .eq("id", tituloId)
    .maybeSingle();

  if (tituloError || !titulo) {
    return resposta({ ok: false, erro: "Título da carteira não encontrado." }, 404);
  }

  const { data: todosItens, error: todosError } = await admin
    .from("carteira_cliente_itens")
    .select("id, status, valor_original, valor_aberto")
    .eq("empresa_id", empresaId)
    .eq("titulo_id", titulo.id);

  if (todosError) {
    return resposta({ ok: false, erro: todosError.message }, 500);
  }

  const { data: alocacoes, error: alocError } = await admin
    .from("carteira_cliente_recebimento_alocacoes")
    .select("id, item_id, valor")
    .eq("empresa_id", empresaId)
    .in("item_id", itemIds);

  if (alocError) {
    return resposta({ ok: false, erro: alocError.message }, 500);
  }

  const alocacaoIds = (alocacoes ?? []).map((item) => item.id);
  const { data: estornos } = alocacaoIds.length
    ? await admin
        .from("carteira_cliente_recebimento_estornos")
        .select("alocacao_id")
        .eq("empresa_id", empresaId)
        .in("alocacao_id", alocacaoIds)
    : { data: [] as Array<{ alocacao_id: string }> };

  const estornados = new Set(
    (estornos ?? []).map((item) => String(item.alocacao_id ?? ""))
  );

  const alocadoPorItem = new Map<string, number>();
  for (const alocacao of alocacoes ?? []) {
    if (estornados.has(alocacao.id)) {
      continue;
    }
    alocadoPorItem.set(
      alocacao.item_id,
      (alocadoPorItem.get(alocacao.item_id) ?? 0) + Number(alocacao.valor ?? 0)
    );
  }

  let pagoTotal = 0;
  for (const item of itens ?? []) {
    const analise = pagoAlocadoDoItem({
      valorOriginal: item.valor_original,
      valorAberto: item.valor_aberto,
      alocadoAtivo: alocadoPorItem.get(item.id) ?? 0,
    });
    if (!analise.ok) {
      return resposta({
        ok: true,
        preflight: {
          bloqueado: true,
          motivo_bloqueio: analise.erro,
          venda_id: titulo.venda_id,
          numero: titulo.numero_venda,
        },
      });
    }
    pagoTotal += analise.pago;
  }

  const mesmaVenda = conferirItensMesmaVenda(
    (itens ?? []).map((item) => ({ venda_id: String(titulo.venda_id) }))
  );
  if (!mesmaVenda.ok) {
    return resposta({ ok: false, erro: mesmaVenda.erro }, 409);
  }

  const resumo = resumoValoresCancelamentoItens({
    valorOriginalVenda: titulo.valor_original,
    valorAbertoVenda: titulo.valor_aberto,
    selecionados: itens ?? [],
  });

  const usaCompleto =
    !vendaJaTeveCancelamentoParcial(todosItens ?? []) &&
    todosItensAtivosSelecionados({
      itensDaVenda: (todosItens ?? []).map((item) => ({
        ...item,
        titulo_id: titulo.id,
        produto_nome: "",
        quantidade: 1,
      })),
      selecionadosIds: itemIds,
    });

  const { data: fiscal } = await admin
    .from("fiscal_emissoes")
    .select("modelo, numero, serie, status")
    .eq("empresa_id", empresaId)
    .eq("origem_tipo", "venda")
    .eq("origem_id", titulo.venda_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return resposta({
    ok: true,
    preflight: {
      bloqueado: false,
      venda_id: titulo.venda_id,
      numero: titulo.numero_venda,
      usa_cancelamento_completo: usaCompleto,
      itens: (itens ?? []).map((item) => ({
        id: item.id,
        produto_nome: item.produto_nome,
        quantidade: Number(item.quantidade ?? 0),
        unidade_medida: item.unidade_medida,
        valor_original: Number(item.valor_original ?? 0),
        valor_aberto: Number(item.valor_aberto ?? 0),
        status: item.status,
        pago: alocadoPorItem.get(item.id) ?? 0,
      })),
      ...resumo,
      valor_pago_cliente: Number(pagoTotal.toFixed(2)),
      exige_destino_recebido: pagoTotal > 0.009,
      permite_credito: true,
      possui_documento_fiscal: Boolean(fiscal?.status),
      fiscal_modelo: fiscal?.modelo ?? null,
      fiscal_numero: fiscal?.numero ?? null,
      fiscal_status: fiscal?.status ?? null,
    },
  });
}

export async function POST(request: NextRequest, context: Context) {
  const { id: clienteId } = await context.params;
  const ctx = await contexto(clienteId);
  if ("erro" in ctx) {
    return ctx.erro;
  }

  let body: {
    item_ids?: string[];
    motivo?: string;
    destino_valor_recebido?: DestinoRecebido | null;
    confirmar?: string;
    confirmar_fiscal_comercial?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return resposta({ ok: false, erro: "JSON inválido." }, 400);
  }

  if (body.confirmar !== "CANCELAR_ITENS_CARTEIRA") {
    return resposta(
      { ok: false, erro: "Confirmação explícita ausente." },
      400
    );
  }

  const itemIds = (body.item_ids ?? []).map((id) => String(id).trim()).filter(Boolean);
  if (!itemIds.length || itemIds.some((id) => !uuidValido(id))) {
    return resposta({ ok: false, erro: "Selecione ao menos um item válido." }, 400);
  }

  const motivo = String(body.motivo ?? "").trim();
  if (motivo.length < 5) {
    return resposta(
      { ok: false, erro: "Informe o motivo com pelo menos 5 caracteres." },
      400
    );
  }

  const destino = body.destino_valor_recebido ?? null;
  if (destino !== null && destino !== "DEVOLUCAO" && destino !== "CREDITO") {
    return resposta({ ok: false, erro: "Destino do valor recebido inválido." }, 400);
  }

  const admin = createAdminClient();
  const empresaId = ctx.vinculo.empresa_id;

  const { data: itens } = await admin
    .from("carteira_cliente_itens")
    .select("id, titulo_id")
    .eq("empresa_id", empresaId)
    .eq("cliente_id", clienteId)
    .in("id", itemIds);

  const tituloId = itens?.[0]?.titulo_id;
  if (!tituloId) {
    return resposta({ ok: false, erro: "Item não encontrado." }, 404);
  }

  const { data: titulo } = await admin
    .from("carteira_cliente_titulos")
    .select("venda_id")
    .eq("empresa_id", empresaId)
    .eq("id", tituloId)
    .maybeSingle();

  if (!titulo?.venda_id) {
    return resposta({ ok: false, erro: "Venda da carteira não encontrada." }, 404);
  }

  const { data: fiscalPost } = await admin
    .from("fiscal_emissoes")
    .select("id, status")
    .eq("empresa_id", empresaId)
    .eq("origem_tipo", "venda")
    .eq("origem_id", titulo.venda_id)
    .limit(1)
    .maybeSingle();

  if (fiscalPost?.status && body.confirmar_fiscal_comercial !== true) {
    return resposta(
      {
        ok: false,
        erro:
          "Esta venda possui documento fiscal. Confirme que a operação alterará somente as movimentações comerciais dos itens selecionados.",
        exige_confirmacao_fiscal: true,
      },
      409
    );
  }

  const { data, error } = await admin.rpc("rpc_cancelar_itens_carteira", {
    p_empresa_id: empresaId,
    p_usuario_id: ctx.vinculo.usuario_id,
    p_cliente_id: clienteId,
    p_item_ids: itemIds,
    p_motivo: motivo,
    p_destino_recebido: destino,
  });

  if (error) {
    return resposta({ ok: false, erro: error.message }, 422);
  }

  return resposta({ ok: true, resultado: data });
}
