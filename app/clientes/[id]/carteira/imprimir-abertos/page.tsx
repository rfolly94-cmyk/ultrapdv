import { notFound, redirect } from "next/navigation";

import { ControlesImpressao } from "@/components/impressao/controles-impressao";
import { itensEmAbertoParaImpressao } from "@/lib/carteira/cancelar-itens";
import { dataDaVendaCarteira } from "@/lib/carteira/periodo";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ auto?: string }>;
};

function dinheiro(valor: number | string | null | undefined) {
  return Number(valor ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function dataCurta(valor: string | null | undefined) {
  if (!valor) {
    return "—";
  }
  return new Date(valor).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });
}

export default async function ImprimirItensAbertosCarteiraPage({
  params,
  searchParams,
}: Props) {
  const { id: clienteId } = await params;
  const { auto } = await searchParams;
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

  const [
    clienteResult,
    empresaResult,
    titulosResult,
    itensResult,
    vendasResult,
  ] = await Promise.all([
    supabase
      .from("clientes")
      .select("id, nome, nome_fantasia")
      .eq("empresa_id", vinculo.empresa_id)
      .eq("id", clienteId)
      .maybeSingle(),
    supabase
      .from("empresas")
      .select("razao_social, nome_fantasia")
      .eq("id", vinculo.empresa_id)
      .maybeSingle(),
    supabase
      .from("carteira_cliente_titulos")
      .select("id, venda_id, numero_venda, valor_aberto, status, created_at")
      .eq("empresa_id", vinculo.empresa_id)
      .eq("cliente_id", clienteId),
    supabase
      .from("carteira_cliente_itens")
      .select(
        "id, titulo_id, produto_nome, quantidade, valor_original, valor_aberto, status"
      )
      .eq("empresa_id", vinculo.empresa_id)
      .eq("cliente_id", clienteId),
    supabase
      .from("vendas")
      .select("id, finalizada_at, created_at")
      .eq("empresa_id", vinculo.empresa_id)
      .eq("cliente_id", clienteId),
  ]);

  if (clienteResult.error) {
    throw new Error(clienteResult.error.message);
  }
  if (!clienteResult.data) {
    notFound();
  }

  type ItemAberto = {
    id: string;
    titulo_id: string;
    produto_nome: string;
    quantidade: number | string;
    valor_original: number | string;
    valor_aberto: number | string;
    status: string;
  };

  const abertos = itensEmAbertoParaImpressao(
    (itensResult.data ?? []) as ItemAberto[]
  );
  const tituloPorId = new Map(
    (titulosResult.data ?? []).map((titulo) => [titulo.id, titulo])
  );
  const vendaPorId = new Map(
    (vendasResult.data ?? []).map((venda) => [venda.id, venda])
  );

  const grupos = new Map<
    string,
    {
      numero: number | string | null;
      data: string | null;
      itens: ItemAberto[];
    }
  >();

  for (const item of abertos) {
    const titulo = tituloPorId.get(item.titulo_id);
    if (!titulo) {
      continue;
    }
    const venda = vendaPorId.get(titulo.venda_id);
    const atual = grupos.get(titulo.id) ?? {
      numero: titulo.numero_venda,
      data: dataDaVendaCarteira({
        finalizada_at: venda?.finalizada_at ?? null,
        created_at: venda?.created_at ?? titulo.created_at,
      }),
      itens: [] as ItemAberto[],
    };
    atual.itens.push(item);
    grupos.set(titulo.id, atual);
  }

  const total = abertos.reduce(
    (soma, item) => soma + Number(item.valor_aberto ?? 0),
    0
  );
  const empresa =
    empresaResult.data?.nome_fantasia ||
    empresaResult.data?.razao_social ||
    "ULTRAPDV";
  const cliente =
    clienteResult.data.nome_fantasia || clienteResult.data.nome || "Cliente";
  const hoje = new Date().toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });

  return (
    <div className="mx-auto max-w-xl bg-white p-6 text-zinc-950">
      <ControlesImpressao
        autoPrint={auto === "1"}
        voltarHref={`/clientes/${clienteId}/carteira`}
        pdfUrl={`/api/impressao/carteira-abertos/${clienteId}?papel=80mm`}
        tipoDocumento="recibo"
        papel="80mm"
      />
      <div className="font-mono text-sm leading-6">
        <p className="text-center text-base font-bold">{empresa}</p>
        <p className="text-center font-semibold">ITENS EM ABERTO — CARTEIRA</p>
        <p className="mt-4">Cliente: {cliente}</p>
        <p>Data: {hoje}</p>
        <p className="mt-3">--------------------------------</p>
        {Array.from(grupos.values()).map((grupo, index) => (
          <div key={`${grupo.numero}-${index}`} className="mt-3">
            <p className="font-semibold">Venda #{grupo.numero ?? "—"}</p>
            <p>{dataCurta(grupo.data)}</p>
            {grupo.itens.map((item) => {
              const original = Number(item.valor_original ?? 0);
              const aberto = Number(item.valor_aberto ?? 0);
              const pago = Math.max(0, original - aberto);
              return (
                <div key={item.id} className="mt-3">
                  <p>{item.produto_nome}</p>
                  <p>Qtd: {Number(item.quantidade ?? 0)}</p>
                  <p>Original: {dinheiro(original)}</p>
                  <p>Pago: {dinheiro(pago)}</p>
                  <p>Aberto: {dinheiro(aberto)}</p>
                </div>
              );
            })}
            <p className="mt-3">--------------------------------</p>
          </div>
        ))}
        {!abertos.length && (
          <p className="mt-3">Nenhum item em aberto neste cliente.</p>
        )}
        <p className="mt-3 font-bold">TOTAL EM ABERTO: {dinheiro(total)}</p>
        <p className="mt-3">--------------------------------</p>
        <p className="text-center">UltraPDV</p>
      </div>
    </div>
  );
}
