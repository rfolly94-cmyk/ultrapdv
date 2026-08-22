"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { exigirEmpresaOperacionalOuRedirecionar } from "@/lib/assinatura/exigir-empresa-operacional";
import {
  exigirOperacaoCatalogo,
  resultadoNegacaoCatalogo,
} from "@/lib/catalogo/acesso-operacao";
import { createClient } from "@/lib/supabase/server";
import type { CatalogoPedidoStatus } from "@/lib/catalogo/tipos";
import { ErroPermissao } from "@/lib/permissoes/erro";

type Resultado =
  | { ok: true; mensagem: string }
  | { ok: false; erro: string };

async function getContexto() {
  const supabase = await createClient();
  const { data: claimsData, error: authError } =
    await supabase.auth.getClaims();

  if (authError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id")
    .eq("usuario_id", String(claimsData.claims.sub))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  await exigirEmpresaOperacionalOuRedirecionar(String(vinculo.empresa_id));

  try {
    await exigirOperacaoCatalogo({
      empresaId: String(vinculo.empresa_id),
      acao: "pedidos",
      origem: "vendas/pedidos",
    });
  } catch (error) {
    if (error instanceof ErroPermissao) {
      if (error.status === 401) redirect("/login");
      redirect("/acesso-negado");
    }
    throw error;
  }

  return { supabase, empresaId: vinculo.empresa_id };
}

async function contextoOuNegacao() {
  try {
    return { ok: true as const, ...(await getContexto()) };
  } catch (error) {
    const negacao = resultadoNegacaoCatalogo(error);
    if (negacao) {
      return negacao;
    }
    throw error;
  }
}

async function atualizarStatus(
  pedidoId: string,
  status: CatalogoPedidoStatus,
  permitidos: CatalogoPedidoStatus[]
): Promise<Resultado> {
  const contexto = await contextoOuNegacao();
  if (!contexto.ok) {
    return contexto;
  }
  const { supabase, empresaId } = contexto;

  const { data: pedido, error } = await supabase
    .from("catalogo_pedidos")
    .select("id, status, venda_id")
    .eq("empresa_id", empresaId)
    .eq("id", pedidoId)
    .maybeSingle();

  if (error || !pedido) {
    return { ok: false, erro: "Pedido não encontrado." };
  }

  if (!permitidos.includes(pedido.status as CatalogoPedidoStatus)) {
    return { ok: false, erro: "Este pedido não pode ser alterado agora." };
  }

  const { error: erroUpdate } = await supabase
    .from("catalogo_pedidos")
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("empresa_id", empresaId)
    .eq("id", pedidoId);

  if (erroUpdate) {
    return { ok: false, erro: erroUpdate.message };
  }

  revalidatePath("/vendas/pedidos");
  revalidatePath("/vendas");

  return { ok: true, mensagem: "Pedido atualizado." };
}

export async function aceitarPedidoCatalogo(pedidoId: string) {
  return atualizarStatus(pedidoId, "ACEITO", [
    "NOVO",
    "EM_ATENDIMENTO",
  ]);
}

export async function cancelarPedidoCatalogo(pedidoId: string) {
  const contexto = await contextoOuNegacao();
  if (!contexto.ok) {
    return contexto;
  }
  const { supabase, empresaId } = contexto;

  const { data: pedido } = await supabase
    .from("catalogo_pedidos")
    .select("id, status, venda_id")
    .eq("empresa_id", empresaId)
    .eq("id", pedidoId)
    .maybeSingle();

  if (!pedido) {
    return { ok: false, erro: "Pedido não encontrado." };
  }

  if (pedido.status === "CONVERTIDO" || pedido.venda_id) {
    return {
      ok: false,
      erro: "Pedido já convertido em venda. A venda é a fonte da verdade.",
    };
  }

  return atualizarStatus(pedidoId, "CANCELADO", [
    "NOVO",
    "EM_ATENDIMENTO",
    "ACEITO",
  ]);
}

export async function converterPedidoParaVenda(pedidoId: string) {
  const contexto = await contextoOuNegacao();
  if (!contexto.ok) {
    return contexto;
  }
  const { supabase, empresaId } = contexto;

  const { data: pedido } = await supabase
    .from("catalogo_pedidos")
    .select("id, codigo, status, venda_id")
    .eq("empresa_id", empresaId)
    .eq("id", pedidoId)
    .maybeSingle();

  if (!pedido) {
    return { ok: false as const, erro: "Pedido não encontrado." };
  }

  if (pedido.status === "CANCELADO") {
    return {
      ok: false as const,
      erro: "Pedido cancelado. Reabra o pedido antes de converter.",
    };
  }

  if (pedido.status === "CONVERTIDO" || pedido.venda_id) {
    let vendaNumero: number | null = null;

    if (pedido.venda_id) {
      const { data: venda } = await supabase
        .from("vendas")
        .select("numero")
        .eq("empresa_id", empresaId)
        .eq("id", pedido.venda_id)
        .maybeSingle();

      vendaNumero = venda?.numero != null ? Number(venda.numero) : null;
    }

    return {
      ok: false as const,
      erro: vendaNumero
        ? `Este pedido já foi convertido na Venda nº ${vendaNumero}.`
        : "Este pedido já foi convertido em venda.",
      vendaId: pedido.venda_id,
      vendaNumero,
    };
  }

  if (pedido.status === "NOVO") {
    const { error } = await supabase
      .from("catalogo_pedidos")
      .update({
        status: "EM_ATENDIMENTO",
        updated_at: new Date().toISOString(),
      })
      .eq("empresa_id", empresaId)
      .eq("id", pedidoId)
      .is("venda_id", null)
      .eq("status", "NOVO");

    if (error) {
      return { ok: false as const, erro: error.message };
    }
  }

  revalidatePath("/vendas/pedidos");
  return { ok: true as const };
}
