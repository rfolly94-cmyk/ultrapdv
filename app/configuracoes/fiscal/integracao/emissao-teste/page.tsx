import {
  redirect,
} from "next/navigation";

import {
  createClient,
} from "@/lib/supabase/server";

import {
  EmissaoTesteClient,
} from "./emissao-teste-client";

export default async function EmissaoTestePage({
  searchParams,
}: {
  searchParams: Promise<{
    produto_id?: string;
    idempotency_key?: string;
  }>;
}) {
  const params =
    await searchParams;

  const produtoIdInicial =
    String(
      params.produto_id ?? ""
    ).trim();

  const idempotencyKeyInicial =
    String(
      params.idempotency_key ?? ""
    ).trim();

  const supabase =
    await createClient();

  const {
    data: claimsData,
  } =
    await supabase.auth.getClaims();

  if (!claimsData?.claims?.sub) {
    redirect("/login");
  }

  const {
    data: vinculo,
  } =
    await supabase
      .from("usuarios_empresas")
      .select("empresa_id")
      .eq("usuario_id", String(claimsData.claims.sub))
      .eq("principal", true)
      .eq("ativo", true)
      .maybeSingle();

  if (!vinculo?.empresa_id) {
    redirect("/onboarding");
  }

  const {
    data: produtos,
    error: produtosError,
  } =
    await supabase
      .from("produtos")
      .select(`
        id,
        codigo,
        nome,
        preco_venda
      `)
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .eq("ativo", true)
      .order("nome");

  if (produtosError) {
    throw new Error(
      `Erro ao carregar produtos: ${produtosError.message}`
    );
  }

  return (
    <div className="updv-config">
      <h2 className="text-[15px] font-semibold text-zinc-950">
        Primeira NFC-e
      </h2>

      <p className="mt-1 text-[13px] text-zinc-500">
        Emissão controlada em
        homologação Geranet.
      </p>

      <div className="mt-4">
        <EmissaoTesteClient
          produtoIdInicial={
            produtoIdInicial
          }
          idempotencyKeyInicial={
            idempotencyKeyInicial
          }
          produtos={
            (produtos ?? []).map(
              (produto) => ({
                id:
                  produto.id,
                codigo:
                  String(
                    produto.codigo ?? ""
                  ),
                nome:
                  String(
                    produto.nome ?? ""
                  ),
                precoVenda:
                  Number(
                    produto.preco_venda ?? 0
                  ),
              })
            )
          }
        />
      </div>
    </div>
  );
}