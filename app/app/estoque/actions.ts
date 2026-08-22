"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { exigirEmpresaOperacionalOuRedirecionar } from "@/lib/assinatura/exigir-empresa-operacional";
import { exigirOperacaoEstoque } from "@/lib/estoque/acesso-operacao";
import { createClient } from "@/lib/supabase/server";
import { ErroPermissao } from "@/lib/permissoes/erro";
import type { AcaoDoModulo } from "@/lib/permissoes/tipos";
import { ErroEntitlement } from "@/lib/plataforma/entitlements/erro";

type Resultado =
  | { ok: true }
  | {
      ok: false;
      erro: string;
    };

async function getContexto() {
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
      .select(
        "empresa_id, perfil"
      )
      .eq("usuario_id", String(usuarioId))
      .eq("principal", true)
      .eq("ativo", true)
      .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  await exigirEmpresaOperacionalOuRedirecionar(String(vinculo.empresa_id));

  return {
    supabase,
    empresaId:
      vinculo.empresa_id,
    perfil:
      vinculo.perfil,
  };
}

async function exigirEstoque(
  empresaId: string,
  acao: AcaoDoModulo<"estoque">,
  origem: string
) {
  await exigirOperacaoEstoque({
    empresaId: String(empresaId),
    acao,
    origem,
  });
}

function resultadoNegacaoEstoque(error: unknown): {
  ok: false;
  erro: string;
} {
  if (error instanceof ErroPermissao && error.status === 401) {
    redirect("/login");
  }
  if (error instanceof ErroEntitlement || error instanceof ErroPermissao) {
    return { ok: false, erro: error.message };
  }
  throw error;
}

function decimal(
  valor: string
) {
  let texto =
    valor.trim();

  if (!texto) {
    return null;
  }

  if (
    texto.includes(".") &&
    texto.includes(",")
  ) {
    texto = texto
      .replace(/\./g, "")
      .replace(",", ".");
  } else if (
    texto.includes(",")
  ) {
    texto =
      texto.replace(
        ",",
        "."
      );
  }

  const numero =
    Number(texto);

  if (
    !Number.isFinite(
      numero
    )
  ) {
    return null;
  }

  return numero;
}

export async function movimentarEstoque(
  input: {
    produtoId: string;
    operacao:
      | "ENTRADA"
      | "SAIDA"
      | "AJUSTE";
    quantidade: string;
    observacao: string;
  }
): Promise<Resultado> {
  try {
    const {
      supabase,
      empresaId,
    } =
      await getContexto();

    const acao =
      input.operacao === "AJUSTE" ? "ajustar" : "movimentar";

    try {
      await exigirEstoque(
        String(empresaId),
        acao,
        "movimentarEstoque"
      );
    } catch (error) {
      return resultadoNegacaoEstoque(error);
    }

    const quantidade =
      decimal(
        input.quantidade
      );

    if (
      quantidade === null
    ) {
      return {
        ok: false,
        erro:
          "Informe uma quantidade válida.",
      };
    }

    const {
      error,
    } = await supabase.rpc(
      "rpc_movimentar_estoque_produto",
      {
        p_empresa_id:
          empresaId,
        p_produto_id:
          input.produtoId,
        p_operacao:
          input.operacao,
        p_quantidade:
          quantidade,
        p_observacao:
          input.observacao ||
          null,
      }
    );

    if (error) {
      return {
        ok: false,
        erro:
          error.message,
      };
    }

    revalidatePath(
      "/estoque"
    );

    return {
      ok: true,
    };
  } catch (error) {
    return {
      ok: false,
      erro:
        error instanceof Error
          ? error.message
          : "Erro inesperado ao movimentar estoque.",
    };
  }
}

export async function atualizarLimitesEstoque(
  input: {
    produtoId: string;
    estoqueMinimo: string;
    estoqueMaximo: string;
  }
): Promise<Resultado> {
  try {
    const {
      supabase,
      empresaId,
    } =
      await getContexto();

    try {
      await exigirEstoque(
        String(empresaId),
        "ajustar",
        "atualizarLimitesEstoque"
      );
    } catch (error) {
      return resultadoNegacaoEstoque(error);
    }

    const minimo =
      decimal(
        input.estoqueMinimo
      );

    const maximoTexto =
      input.estoqueMaximo.trim();

    const maximo =
      maximoTexto
        ? decimal(
            maximoTexto
          )
        : null;

    if (
      minimo === null ||
      minimo < 0
    ) {
      return {
        ok: false,
        erro:
          "Estoque mínimo inválido.",
      };
    }

    if (
      maximoTexto &&
      (
        maximo === null ||
        maximo < minimo
      )
    ) {
      return {
        ok: false,
        erro:
          "Estoque máximo deve ser maior ou igual ao mínimo.",
      };
    }

    const {
      error,
    } = await supabase.rpc(
      "rpc_atualizar_limites_estoque_produto",
      {
        p_empresa_id:
          empresaId,
        p_produto_id:
          input.produtoId,
        p_estoque_minimo:
          minimo,
        p_estoque_maximo:
          maximo,
      }
    );

    if (error) {
      return {
        ok: false,
        erro:
          error.message,
      };
    }

    revalidatePath(
      "/estoque"
    );

    return {
      ok: true,
    };
  } catch (error) {
    return {
      ok: false,
      erro:
        error instanceof Error
          ? error.message
          : "Erro inesperado ao atualizar limites.",
    };
  }
}
