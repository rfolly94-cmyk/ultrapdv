"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { exigirEmpresaOperacionalOuRedirecionar } from "@/lib/assinatura/exigir-empresa-operacional";
import { createClient } from "@/lib/supabase/server";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";

type Resultado =
  | {
      ok: true;
      quantidadeAnterior?: number;
      quantidadeAtual?: number;
    }
  | {
      ok: false;
      erro: string;
    };

export type MovimentacaoEstoque = {
  id: string;
  created_at: string;
  tipo: string;
  origem: string;
  quantidade: number | string;
  saldo_anterior: number | string;
  saldo_posterior: number | string;
  observacao: string | null;
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
    const acao =
      input.operacao === "AJUSTE" ? "ajustar" : "movimentar";

    try {
      await exigirPermissao({ modulo: "estoque", acao });
    } catch (error) {
      if (error instanceof ErroPermissao) {
        return { ok: false, erro: error.message };
      }
      throw error;
    }

    const {
      supabase,
      empresaId,
    } =
      await getContexto();

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
      data,
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

    const registro =
      Array.isArray(data)
        ? data[0]
        : data;

    revalidatePath(
      "/estoque"
    );

    return {
      ok: true,
      quantidadeAnterior:
        Number(
          registro?.quantidade_anterior ??
            quantidade
        ),
      quantidadeAtual:
        Number(
          registro?.quantidade_atual ??
            quantidade
        ),
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
    try {
      await exigirPermissao({ modulo: "estoque", acao: "ajustar" });
    } catch (error) {
      if (error instanceof ErroPermissao) {
        return { ok: false, erro: error.message };
      }
      throw error;
    }

    const {
      supabase,
      empresaId,
    } =
      await getContexto();

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

export async function listarMovimentacoesEstoque(
  produtoId: string
): Promise<
  | {
      ok: true;
      movimentacoes: MovimentacaoEstoque[];
    }
  | {
      ok: false;
      erro: string;
    }
> {
  try {
    const {
      supabase,
      empresaId,
    } =
      await getContexto();

    if (!produtoId.trim()) {
      return {
        ok: false,
        erro:
          "Produto inválido.",
      };
    }

    const { data, error } =
      await supabase
        .from(
          "estoque_movimentacoes"
        )
        .select(
          `
          id,
          created_at,
          tipo,
          origem,
          quantidade,
          saldo_anterior,
          saldo_posterior,
          observacao
        `
        )
        .eq(
          "empresa_id",
          empresaId
        )
        .eq(
          "produto_id",
          produtoId
        )
        .order(
          "created_at",
          {
            ascending:
              false,
          }
        )
        .limit(80);

    if (error) {
      return {
        ok: false,
        erro:
          error.message,
      };
    }

    return {
      ok: true,
      movimentacoes:
        data ?? [],
    };
  } catch (error) {
    return {
      ok: false,
      erro:
        error instanceof Error
          ? error.message
          : "Erro inesperado ao carregar o histórico.",
    };
  }
}
