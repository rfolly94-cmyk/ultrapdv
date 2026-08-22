import { redirect } from "next/navigation";

import { RecursoNaoContratado } from "@/components/plataforma/recurso-nao-contratado";
import { PedidosOnlineWorkspace } from "@/components/vendas/pedidos-online-workspace";
import { planoPermiteRecursoEmpresa } from "@/lib/plataforma/entitlements/exigir-recurso";
import { carregarEntitlementsEmpresa } from "@/lib/plataforma/recursos/carregar";
import { createClient } from "@/lib/supabase/server";
import type { CatalogoPedido } from "@/lib/catalogo/tipos";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Pedidos Online",
};

export default async function PedidosOnlinePage() {
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

  const empresaId = String(vinculo.empresa_id);
  const plano = await planoPermiteRecursoEmpresa(empresaId, "catalogo");
  if (!plano.permitido) {
    const entitlements = await carregarEntitlementsEmpresa(empresaId);
    return (
      <main className="updv-page">
        <div className="px-4 py-6">
          <RecursoNaoContratado
            titulo="Pedidos online"
            descricao="Este recurso não está disponível no plano atual da sua empresa. A administração de pedidos do catálogo online está disponível em planos que incluem este recurso. Pedidos já recebidos não são apagados."
            planoNome={entitlements.planoNome}
            voltarHref="/vendas"
            voltarLabel="Voltar para Vendas"
          />
        </div>
      </main>
    );
  }

  const { data: pedidos, error } = await supabase
    .from("catalogo_pedidos")
    .select(`
      id,
      codigo,
      cliente_nome,
      cliente_whatsapp,
      tipo_entrega,
      cep,
      rua,
      numero,
      bairro,
      complemento,
      cidade,
      referencia,
      observacao,
      subtotal,
      total,
      status,
      venda_id,
      created_at,
      catalogo_pedido_itens (
        id,
        produto_id,
        codigo_produto,
        nome_produto,
        quantidade,
        preco_unitario,
        subtotal
      )
    `)
    .eq("empresa_id", vinculo.empresa_id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const vendaIds = Array.from(
    new Set(
      (pedidos ?? [])
        .map((pedido) => pedido.venda_id)
        .filter((id): id is string => Boolean(id))
    )
  );

  const { data: vendas } = vendaIds.length
    ? await supabase
        .from("vendas")
        .select("id, numero")
        .eq("empresa_id", vinculo.empresa_id)
        .in("id", vendaIds)
    : { data: [] };

  const numeroPorVenda = new Map(
    (vendas ?? []).map((venda) => [venda.id, Number(venda.numero)])
  );

  const itens: CatalogoPedido[] = (pedidos ?? []).map((pedido) => ({
    id: pedido.id,
    codigo: Number(pedido.codigo),
    cliente_nome: pedido.cliente_nome,
    cliente_whatsapp: pedido.cliente_whatsapp,
    tipo_entrega: pedido.tipo_entrega,
    cep: pedido.cep,
    rua: pedido.rua,
    numero: pedido.numero,
    bairro: pedido.bairro,
    complemento: pedido.complemento,
    cidade: pedido.cidade,
    referencia: pedido.referencia,
    observacao: pedido.observacao,
    subtotal: Number(pedido.subtotal ?? 0),
    total: Number(pedido.total ?? 0),
    status: pedido.status,
    venda_id: pedido.venda_id,
    venda_numero: pedido.venda_id
      ? numeroPorVenda.get(pedido.venda_id) ?? null
      : null,
    created_at: pedido.created_at,
    itens: (Array.isArray(pedido.catalogo_pedido_itens)
      ? pedido.catalogo_pedido_itens
      : []
    ).map((item) => ({
      id: item.id,
      produto_id: item.produto_id,
      codigo_produto: item.codigo_produto,
      nome_produto: item.nome_produto,
      quantidade: Number(item.quantidade),
      preco_unitario: Number(item.preco_unitario),
      subtotal: Number(item.subtotal),
    })),
  }));

  return (
    <PedidosOnlineWorkspace
      pedidos={itens}
      pedidosNovos={itens.filter((pedido) => pedido.status === "NOVO").length}
    />
  );
}
