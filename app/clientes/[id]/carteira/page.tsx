import {
  notFound,
  redirect,
} from "next/navigation";

import {
  createClient,
} from "@/lib/supabase/server";

import {
  CarteiraClienteWorkspace,
} from "@/components/clientes/carteira/CarteiraClienteWorkspace";
import { PageHeader } from "@/components/ui/page-header";

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default async function CarteiraClientePage({
  params,
}: Props) {
  const {
    id: clienteId,
  } =
    await params;

  const supabase =
    await createClient();

  const {
    data: claimsData,
    error: authError,
  } =
    await supabase.auth.getClaims();

  if (
    authError ||
    !claimsData?.claims?.sub
  ) {
    redirect("/login");
  }

  const {
    data: vinculo,
  } =
    await supabase
      .from(
        "usuarios_empresas"
      )
      .select(
        "empresa_id"
      )
      .eq(
        "usuario_id",
        String(claimsData.claims.sub)
      )
      .eq(
        "principal",
        true
      )
      .eq(
        "ativo",
        true
      )
      .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  const [
    clienteResult,
    titulosResult,
    itensResult,
    creditosResult,
    recebimentosResult,
    movimentosResult,
    formasResult,
    vendasResult,
  ] =
    await Promise.all([
      supabase
        .from("clientes")
        .select(`
          id,
          nome,
          nome_fantasia,
          cpf_cnpj,
          telefone,
          limite_credito,
          saldo_devedor,
          bloqueado,
          dia_vencimento,
          ativo
        `)
        .eq(
          "empresa_id",
          vinculo.empresa_id
        )
        .eq(
          "id",
          clienteId
        )
        .maybeSingle(),

      supabase
        .from(
          "carteira_cliente_titulos"
        )
        .select(`
          id,
          venda_id,
          numero_venda,
          valor_original,
          valor_aberto,
          vencimento,
          status,
          created_at
        `)
        .eq(
          "empresa_id",
          vinculo.empresa_id
        )
        .eq(
          "cliente_id",
          clienteId
        )
        .order(
          "created_at",
          {
            ascending: false,
          }
        ),

      supabase
        .from(
          "carteira_cliente_itens"
        )
        .select(`
          id,
          titulo_id,
          venda_item_id,
          produto_id,
          produto_codigo,
          produto_nome,
          unidade_medida,
          quantidade,
          valor_original,
          valor_aberto,
          status,
          created_at
        `)
        .eq(
          "empresa_id",
          vinculo.empresa_id
        )
        .eq(
          "cliente_id",
          clienteId
        )
        .order(
          "created_at",
          {
            ascending: true,
          }
        ),

      supabase
        .from(
          "carteira_cliente_creditos"
        )
        .select(`
          id,
          origem,
          venda_id,
          recebimento_id,
          valor_original,
          valor_disponivel,
          status,
          observacao,
          created_at
        `)
        .eq(
          "empresa_id",
          vinculo.empresa_id
        )
        .eq(
          "cliente_id",
          clienteId
        )
        .order(
          "created_at",
          {
            ascending: false,
          }
        ),

      supabase
        .from(
          "carteira_cliente_recebimentos"
        )
        .select(`
          id,
          forma_pagamento_nome,
          modo,
          valor,
          saldo_anterior,
          saldo_posterior,
          observacao,
          processado_at,
          created_at
        `)
        .eq(
          "empresa_id",
          vinculo.empresa_id
        )
        .eq(
          "cliente_id",
          clienteId
        )
        .order(
          "created_at",
          {
            ascending: false,
          }
        )
        .limit(100),

      supabase
        .from(
          "carteira_cliente_movimentacoes"
        )
        .select(`
          id,
          tipo,
          origem,
          valor,
          venda_id,
          titulo_id,
          recebimento_id,
          descricao,
          created_at
        `)
        .eq(
          "empresa_id",
          vinculo.empresa_id
        )
        .eq(
          "cliente_id",
          clienteId
        )
        .order(
          "created_at",
          {
            ascending: false,
          }
        )
        .limit(200),

      supabase
        .from(
          "formas_pagamento"
        )
        .select(`
          id,
          codigo,
          nome,
          permite_fiado,
          ativo,
          ordem
        `)
        .eq(
          "empresa_id",
          vinculo.empresa_id
        )
        .eq(
          "ativo",
          true
        )
        .eq(
          "permite_fiado",
          false
        )
        .order(
          "ordem",
          {
            ascending: true,
          }
        ),

      supabase
        .from("vendas")
        .select(`
          id,
          numero,
          status,
          valor_total,
          finalizada_at,
          cancelada_at,
          motivo_cancelamento,
          created_at
        `)
        .eq(
          "empresa_id",
          vinculo.empresa_id
        )
        .eq(
          "cliente_id",
          clienteId
        )
        .order(
          "created_at",
          {
            ascending: false,
          }
        )
        .limit(100),
    ]);

  if (
    clienteResult.error
  ) {
    throw new Error(
      clienteResult
        .error
        .message
    );
  }

  if (
    !clienteResult.data
  ) {
    notFound();
  }

  const outrosErros = [
    titulosResult.error,
    itensResult.error,
    creditosResult.error,
    recebimentosResult.error,
    movimentosResult.error,
    formasResult.error,
    vendasResult.error,
  ].filter(Boolean);

  if (
    outrosErros.length
  ) {
    throw new Error(
      outrosErros[0]!
        .message
    );
  }

  const cliente = clienteResult.data;
  const saldo = Number(cliente.saldo_devedor ?? 0);

  return (
    <div className="updv-page">
      <PageHeader
        title={cliente.nome}
        description={
          saldo > 0
            ? `Carteira · Saldo: -${saldo.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              })}`
            : "Carteira do cliente"
        }
        breadcrumb={[
          { label: "Clientes", href: "/clientes" },
          { label: cliente.nome, href: `/clientes?editar=${clienteId}` },
          { label: "Carteira" },
        ]}
      />
      <nav className="flex h-9 items-center gap-1 border-b border-zinc-200 px-3 text-[13px] font-medium">
        <a
          href={`/clientes?editar=${clienteId}`}
          className="px-2.5 py-1.5 text-zinc-500 hover:text-zinc-800"
        >
          Cadastro
        </a>
        <span className="relative px-2.5 py-1.5 text-zinc-950">
          Carteira
          <span className="absolute inset-x-2 bottom-0 h-0.5 bg-zinc-950" />
        </span>
      </nav>
    <CarteiraClienteWorkspace
      cliente={
        cliente
      }
      titulos={
        titulosResult.data ??
        []
      }
      itens={
        itensResult.data ??
        []
      }
      creditos={
        creditosResult.data ??
        []
      }
      recebimentos={
        recebimentosResult.data ??
        []
      }
      movimentos={
        movimentosResult.data ??
        []
      }
      formasPagamento={
        formasResult.data ??
        []
      }
      vendas={
        vendasResult.data ??
        []
      }
    />
    </div>
  );
}
