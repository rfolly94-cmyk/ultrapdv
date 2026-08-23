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
import { ClienteNavegacao } from "@/components/clientes/cliente-navegacao";
import { parseAbaCarteiraCliente } from "@/lib/clientes/navegacao";
import { RecursoNaoContratado } from "@/components/plataforma/recurso-nao-contratado";
import { planoPermiteRecursoEmpresa } from "@/lib/plataforma/entitlements/exigir-recurso";
import { carregarEntitlementsEmpresa } from "@/lib/plataforma/recursos/carregar";

type Props = {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    aba?: string;
  }>;
};

export default async function CarteiraClientePage({
  params,
  searchParams,
}: Props) {
  const {
    id: clienteId,
  } =
    await params;
  const queryCarteira = await searchParams;
  const abaInicial = parseAbaCarteiraCliente(queryCarteira.aba);

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

  const plano = await planoPermiteRecursoEmpresa(
    String(vinculo.empresa_id),
    "carteira"
  );
  if (!plano.permitido) {
    const entitlements = await carregarEntitlementsEmpresa(
      String(vinculo.empresa_id)
    );
    return (
      <main className="updv-page">
        <div className="px-4 py-6">
          <RecursoNaoContratado
            titulo="Carteira"
            descricao="Este recurso não está disponível no plano atual da sua empresa. A carteira do cliente, extrato e recebimentos estão disponíveis em planos que incluem este recurso. Vendas fiado no PDV continuam funcionando."
            planoNome={entitlements.planoNome}
            voltarHref="/clientes"
            voltarLabel="Voltar para clientes"
          />
        </div>
      </main>
    );
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
    estornosResult,
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
          created_at,
          updated_at
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

      supabase
        .from("carteira_cliente_recebimento_estornos")
        .select(`
          id,
          recebimento_id,
          alocacao_id,
          venda_id,
          titulo_id,
          usuario_id,
          valor,
          motivo,
          status,
          created_at,
          concluido_at
        `)
        .eq("empresa_id", vinculo.empresa_id)
        .eq("cliente_id", clienteId)
        .order("created_at", { ascending: false }),
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
    estornosResult.error,
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
  const titulos = titulosResult.data ?? [];
  const itens = itensResult.data ?? [];
  const recebimentos = recebimentosResult.data ?? [];
  const vendas = vendasResult.data ?? [];

  const recebimentoIds = recebimentos.map((item) => item.id);
  const vendaIds = Array.from(
    new Set(
      [
        ...titulos.map((titulo) => titulo.venda_id),
        ...vendas.map((venda) => venda.id),
      ].filter((id): id is string => Boolean(id))
    )
  );

  const [alocacoesResult, fiscaisResult] = await Promise.all([
    recebimentoIds.length
      ? supabase
          .from("carteira_cliente_recebimento_alocacoes")
          .select(`
            id,
            recebimento_id,
            item_id,
            valor,
            created_at
          `)
          .eq("empresa_id", vinculo.empresa_id)
          .in("recebimento_id", recebimentoIds)
      : Promise.resolve({ data: [], error: null }),
    vendaIds.length
      ? supabase
          .from("fiscal_emissoes")
          .select("origem_id, modelo, numero, serie, status")
          .eq("empresa_id", vinculo.empresa_id)
          .eq("origem_tipo", "venda")
          .in("origem_id", vendaIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (alocacoesResult.error) {
    throw new Error(alocacoesResult.error.message);
  }
  if (fiscaisResult.error) {
    throw new Error(fiscaisResult.error.message);
  }

  return (
    <div className="updv-page">
      <ClienteNavegacao
        clienteId={clienteId}
        clienteNome={cliente.nome}
        description={
          saldo > 0
            ? `Cliente · Saldo: -${saldo.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              })}`
            : "Cliente"
        }
      />
    <CarteiraClienteWorkspace
      abaInicial={abaInicial}
      cliente={
        cliente
      }
      titulos={titulos}
      itens={itens}
      creditos={creditosResult.data ?? []}
      recebimentos={recebimentos}
      movimentos={movimentosResult.data ?? []}
      formasPagamento={formasResult.data ?? []}
      vendas={vendas}
      alocacoes={alocacoesResult.data ?? []}
      estornos={estornosResult.data ?? []}
      fiscais={fiscaisResult.data ?? []}
    />
    </div>
  );
}
