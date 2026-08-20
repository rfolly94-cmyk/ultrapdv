import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { PdvEdicaoShell } from "@/components/pdv/pdv-edicao-shell";
import {
  classificarIntegracaoPix,
  pixConfigPublicoPdv,
} from "@/lib/pagamentos/pix/modo-ativo";
import {
  consolidarPagamentosCheckoutPdv,
  filtrarFormasPagamentoCheckoutPdv,
} from "@/lib/pdv/formas-pagamento-checkout";
import { resolverEstadoOperacionalDeEmissaoPersistida } from "@/lib/fiscal/estado-operacional-fiscal";

function centavos(valor: unknown) {
  const numero = Number(valor ?? 0);
  return Number.isFinite(numero)
    ? Math.round(numero * 100)
    : 0;
}

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EditarVendaNoPdvPage({
  params,
}: PageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: claimsData,
    error: authError,
  } = await supabase.auth.getClaims();

  if (
    authError ||
    !claimsData?.claims?.sub
  ) {
    redirect("/login");
  }

  const { data: vinculo } =
    await supabase
      .from("usuarios_empresas")
      .select(`
        empresa_id,
        perfil,
        empresas (
          nome_fantasia
        )
      `)
      .eq("usuario_id", String(claimsData.claims.sub))
      .eq("principal", true)
      .eq("ativo", true)
      .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  const empresa =
    Array.isArray(vinculo.empresas)
      ? vinculo.empresas[0]
      : vinculo.empresas;

  const [
    produtosResult,
    clientesResult,
    formasResult,
    vendaResult,
    itensResult,
    pagamentosResult,
    fiscalResult,
    carteiraResult,
    pixResult,
  ] = await Promise.all([
    supabase
      .from("produtos")
      .select(`
        id,
        codigo,
        codigo_barras,
        nome,
        unidade_medida,
        preco_venda
      `)
      .eq("empresa_id", vinculo.empresa_id)
      .eq("ativo", true)
      .order("nome"),

    supabase
      .from("clientes")
      .select(`
        id,
        nome,
        cpf_cnpj,
        telefone,
        limite_credito,
        saldo_devedor,
        bloqueado
      `)
      .eq("empresa_id", vinculo.empresa_id)
      .eq("ativo", true)
      .order("nome"),

    supabase
      .from("formas_pagamento")
      .select(`
        id,
        codigo,
        nome,
        tipo,
        codigo_fiscal,
        permite_troco,
        permite_fiado,
        permite_parcelamento,
        ordem,
        ativo
      `)
      .eq("empresa_id", vinculo.empresa_id)
      .order("ordem"),

    supabase
      .from("vendas")
      .select(`
        id,
        numero,
        status,
        cliente_id,
        desconto
      `)
      .eq("empresa_id", vinculo.empresa_id)
      .eq("id", id)
      .maybeSingle(),

    supabase
      .from("vendas_itens")
      .select(`
        id,
        produto_id,
        produto_codigo,
        produto_nome,
        unidade_medida,
        quantidade,
        valor_unitario,
        desconto
      `)
      .eq("empresa_id", vinculo.empresa_id)
      .eq("venda_id", id)
      .order("created_at"),

    supabase
      .from("vendas_pagamentos")
      .select(`
        forma_pagamento_id,
        valor
      `)
      .eq("empresa_id", vinculo.empresa_id)
      .eq("venda_id", id)
      .eq("status", "confirmado")
      .order("created_at"),

    supabase
      .from("fiscal_emissoes")
      .select("id, status, resposta_resumo, cstat, motivo, protocolo, chave_acesso, geranet_http_status, geranet_situacao, erro_comunicacao, modelo")
      .eq("empresa_id", vinculo.empresa_id)
      .eq("origem_tipo", "venda")
      .eq("origem_id", id)
      .in("status", [
        "autorizada",
        "enviando",
        "erro_comunicacao",
        "aguardando_reconciliacao",
        "aguardando_transmissao_contingencia",
        "transmitindo_contingencia",
        "cancelada",
      ]),

    supabase
      .from("carteira_cliente_titulos")
      .select("id, status")
      .eq("empresa_id", vinculo.empresa_id)
      .eq("venda_id", id)
      .limit(1),

    supabase
      .from("integracoes_pix")
      .select("id, modo, ativo, provedor")
      .eq("empresa_id", vinculo.empresa_id)
      .maybeSingle(),
  ]);

  const erro =
    produtosResult.error ??
    clientesResult.error ??
    formasResult.error ??
    vendaResult.error ??
    itensResult.error ??
    pagamentosResult.error ??
    fiscalResult.error ??
    carteiraResult.error;

  if (erro) {
    throw new Error(erro.message);
  }

  const venda = vendaResult.data;

  if (!venda) {
    return (
      <Bloqueio
        vendaId={id}
        mensagem="Venda não encontrada."
      />
    );
  }

  if (venda.status !== "finalizada") {
    return (
      <Bloqueio
        vendaId={id}
        mensagem={`Somente venda finalizada pode ser editada. Status atual: ${venda.status}.`}
      />
    );
  }

  if (
    (fiscalResult.data ?? []).some(
      (emissao) =>
        resolverEstadoOperacionalDeEmissaoPersistida(emissao)
          .documentoFiscalSensivel
    )
  ) {
    return (
      <Bloqueio
        vendaId={id}
        mensagem="Esta venda possui documento fiscal autorizado ou em estado sensível. Cancele/reconcilie o documento fiscal antes de editar a venda."
      />
    );
  }

  if ((carteiraResult.data ?? []).length > 0) {
    return (
      <Bloqueio
        vendaId={id}
        mensagem="Esta venda possui histórico FIADO/Carteira. Para preservar baixas e alocações do cliente, use Cancelar venda e refaça o lançamento."
      />
    );
  }

  if ((itensResult.data ?? []).length === 0) {
    return (
      <Bloqueio
        vendaId={id}
        mensagem="A venda não possui itens para carregar no PDV."
      />
    );
  }

  const descontoItens =
    (itensResult.data ?? []).reduce(
      (total, item) =>
        total + Number(item.desconto ?? 0),
      0
    );

  const descontoCabecalho = Math.max(
    0,
    Number(venda.desconto ?? 0) - descontoItens
  );

  const formasOriginais = formasResult.data ?? [];
  const formasCheckout = filtrarFormasPagamentoCheckoutPdv(
    formasOriginais.filter((forma) => forma.ativo !== false)
  );

  const vendaEdicao = {
    id: venda.id,
    numero: Number(venda.numero),
    clienteId: venda.cliente_id,
    descontoCentavos: centavos(descontoCabecalho),
    itens: (itensResult.data ?? []).map(
      (item) => ({
        vendaItemId: item.id,
        produtoId: item.produto_id,
        codigo: item.produto_codigo ?? "",
        nome: item.produto_nome,
        unidadeMedida: item.unidade_medida ?? "UN",
        quantidade: Number(item.quantidade),
        valorUnitarioCentavos: centavos(
          item.valor_unitario
        ),
      })
    ),
    pagamentos: consolidarPagamentosCheckoutPdv(
      (pagamentosResult.data ?? [])
        .filter((pagamento) => Boolean(pagamento.forma_pagamento_id))
        .map((pagamento) => ({
          formaPagamentoId: pagamento.forma_pagamento_id as string,
          valorCentavos: centavos(pagamento.valor),
        })),
      formasOriginais,
      formasCheckout
    ),
  };

  return (
    <PdvEdicaoShell
      empresaNome={
        empresa?.nome_fantasia ?? "Empresa"
      }
      produtos={produtosResult.data ?? []}
      clientes={clientesResult.data ?? []}
      formasPagamento={formasCheckout}
      vendaEdicao={vendaEdicao}
      pixConfig={pixConfigPublicoPdv(
        classificarIntegracaoPix(pixResult.data)
      )}
    />
  );
}

function Bloqueio({
  vendaId,
  mensagem,
}: {
  vendaId: string;
  mensagem: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-100 p-6">
      <div className="w-full max-w-xl rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-wide text-red-700">
          Edição da venda bloqueada
        </p>

        <h1 className="mt-2 text-2xl font-bold text-zinc-950">
          Não foi possível reabrir esta venda no PDV
        </h1>

        <p className="mt-4 text-sm leading-6 text-zinc-700">
          {mensagem}
        </p>

        <Link
          href={`/vendas/${vendaId}`}
          className="mt-6 inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
        >
          Voltar para a venda
        </Link>
      </div>
    </main>
  );
}
