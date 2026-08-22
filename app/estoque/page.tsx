import { redirect } from "next/navigation";

import { planoPermiteRecursoEmpresa } from "@/lib/plataforma/entitlements/exigir-recurso";
import { createClient } from "@/lib/supabase/server";
import { EstoqueWorkspace } from "../../components/estoque/estoque-workspace";

export default async function EstoquePage() {
  const supabase =
    await createClient();

  const {
    data: claimsData,
    error: authError,
  } =
    await supabase.auth.getClaims();

  const usuarioId =
    claimsData?.claims?.sub;

  if (
    authError ||
    !usuarioId
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
      .eq("usuario_id", String(usuarioId))
      .eq("principal", true)
      .eq("ativo", true)
      .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  const plano = await planoPermiteRecursoEmpresa(
    String(vinculo.empresa_id),
    "estoque"
  );
  if (!plano.permitido) {
    return null;
  }

  const empresa =
    Array.isArray(
      vinculo.empresas
    )
      ? vinculo.empresas[0]
      : vinculo.empresas;

  const [
    produtosResult,
    estoqueResult,
  ] = await Promise.all([
    supabase
      .from("produtos")
      .select(`
        id,
        codigo,
        codigo_barras,
        nome,
        unidade_medida,
        ativo
      `)
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .order("nome"),

    supabase
      .from("estoque_atual")
      .select(`
        produto_id,
        quantidade,
        estoque_minimo,
        estoque_maximo
      `)
      .eq(
        "empresa_id",
        vinculo.empresa_id
      ),
  ]);

  if (
    produtosResult.error
  ) {
    throw new Error(
      produtosResult.error
        .message
    );
  }

  if (
    estoqueResult.error
  ) {
    throw new Error(
      estoqueResult.error
        .message
    );
  }

  const estoquePorProduto =
    new Map(
      (
        estoqueResult.data ??
        []
      ).map(
        (item) => [
          item.produto_id,
          item,
        ]
      )
    );

  const produtos =
    (
      produtosResult.data ??
      []
    ).map(
      (produto) => {
        const estoque =
          estoquePorProduto.get(
            produto.id
          );

        return {
          ...produto,
          quantidade:
            estoque?.quantidade ??
            0,
          estoque_minimo:
            estoque?.estoque_minimo ??
            0,
          estoque_maximo:
            estoque?.estoque_maximo ??
            null,
        };
      }
    );

  return (
    <EstoqueWorkspace
      empresaNome={
        empresa?.nome_fantasia ??
        "Empresa"
      }
      produtos={
        produtos
      }
    />
  );
}
