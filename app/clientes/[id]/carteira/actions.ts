"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { exigirEmpresaOperacionalOuRedirecionar } from "@/lib/assinatura/exigir-empresa-operacional";
import {
  exigirOperacaoCarteira,
} from "@/lib/carteira/acesso-operacao";
import { ErroEntitlement } from "@/lib/plataforma/entitlements/erro";
import { createClient } from "@/lib/supabase/server";
import { carregarResumoCarteiraListagem } from "@/lib/clientes/carregar-resumo-carteira";
import { ErroPermissao } from "@/lib/permissoes/erro";

type ReceberInput = {
  clienteId: string;
  formaPagamentoId: string;
  modo:
    | "TOTAL"
    | "PARCIAL"
    | "ITENS";
  valorTexto?: string;
  itemIds?: string[];
  observacao?: string;
  idempotencyKey: string;
};

type Resultado =
  | {
      ok: true;
      valorRecebido: number;
      saldoAtual: number;
    }
  | {
      ok: false;
      erro: string;
    };

function uuidValido(
  valor: string
) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    valor
  );
}

function decimal(
  valor?: string
) {
  const textoOriginal =
    String(
      valor ?? ""
    ).trim();

  if (!textoOriginal) {
    return null;
  }

  let texto =
    textoOriginal;

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

  return Math.round(
    numero * 100
  ) / 100;
}

async function getContexto() {
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

  const { data: vinculo } =
    await supabase
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

  return {
    supabase,
    empresaId:
      vinculo.empresa_id,
  };
}

export async function receberCarteira(
  input: ReceberInput
): Promise<Resultado> {
  try {
    const {
      supabase,
      empresaId,
    } =
      await getContexto();

    try {
      await exigirOperacaoCarteira({
        empresaId,
        acao: "receber_carteira",
        origem: "receberCarteira",
      });
    } catch (error) {
      if (error instanceof ErroEntitlement || error instanceof ErroPermissao) {
        return { ok: false, erro: error.message };
      }
      throw error;
    }

    if (
      !uuidValido(
        input.clienteId
      )
    ) {
      return {
        ok: false,
        erro:
          "Cliente inválido.",
      };
    }

    if (
      !uuidValido(
        input.formaPagamentoId
      )
    ) {
      return {
        ok: false,
        erro:
          "Forma de pagamento inválida.",
      };
    }

    if (
      !uuidValido(
        input.idempotencyKey
      )
    ) {
      return {
        ok: false,
        erro:
          "Chave de idempotência inválida.",
      };
    }

    if (
      ![
        "TOTAL",
        "PARCIAL",
        "ITENS",
      ].includes(
        input.modo
      )
    ) {
      return {
        ok: false,
        erro:
          "Modo de recebimento inválido.",
      };
    }

    const itemIds =
      Array.from(
        new Set(
          input.itemIds ??
            []
        )
      );

    if (
      itemIds.some(
        (id) =>
          !uuidValido(id)
      )
    ) {
      return {
        ok: false,
        erro:
          "Há item selecionado inválido.",
      };
    }

    const valor =
      input.modo ===
      "PARCIAL"
        ? decimal(
            input.valorTexto
          )
        : null;

    if (
      input.modo ===
        "PARCIAL" &&
      (
        valor === null ||
        valor <= 0
      )
    ) {
      return {
        ok: false,
        erro:
          "Informe um valor parcial maior que zero.",
      };
    }

    if (
      input.modo ===
        "ITENS" &&
      itemIds.length === 0
    ) {
      return {
        ok: false,
        erro:
          "Selecione ao menos um item.",
      };
    }

    const {
      data,
      error,
    } = await supabase.rpc(
      "rpc_receber_carteira_cliente",
      {
        p_empresa_id:
          empresaId,
        p_cliente_id:
          input.clienteId,
        p_forma_pagamento_id:
          input.formaPagamentoId,
        p_modo:
          input.modo,
        p_valor:
          valor,
        p_item_ids:
          itemIds,
        p_observacao:
          input.observacao?.trim() ||
          null,
        p_idempotency_key:
          input.idempotencyKey,
      }
    );

    if (error) {
      console.error(
        "ERRO RECEBER CARTEIRA:",
        error
      );

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

    if (!registro) {
      return {
        ok: false,
        erro:
          "Recebimento não retornou dados.",
      };
    }

    revalidatePath(
      `/clientes/${input.clienteId}/carteira`
    );

    revalidatePath(
      "/clientes"
    );

    return {
      ok: true,
      valorRecebido:
        Number(
          registro.valor_recebido ??
            0
        ),
      saldoAtual:
        Number(
          registro.saldo_atual ??
            0
        ),
    };
  } catch (error) {
    console.error(
      "ERRO RECEBER CARTEIRA:",
      error
    );

    return {
      ok: false,
      erro:
        error instanceof Error
          ? error.message
          : "Erro inesperado ao receber pagamento.",
    };
  }
}

export async function carregarResumoCarteiraCliente(clienteId: string) {
  try {
    const { supabase, empresaId } = await getContexto();

    try {
      await exigirOperacaoCarteira({
        empresaId,
        acao: "acessar_carteira",
        origem: "carregarResumoCarteiraCliente",
      });
    } catch (error) {
      if (error instanceof ErroEntitlement || error instanceof ErroPermissao) {
        return { ok: false as const, erro: error.message };
      }
      throw error;
    }

    if (!uuidValido(clienteId)) {
      return { ok: false as const, erro: "Cliente inválido." };
    }

    const resumo = await carregarResumoCarteiraListagem({
      supabase,
      empresaId,
      clienteId,
    });

    if (!resumo) {
      return { ok: false as const, erro: "Cliente não encontrado." };
    }

    return { ok: true as const, resumo };
  } catch (error) {
    return {
      ok: false as const,
      erro:
        error instanceof Error
          ? error.message
          : "Erro ao carregar a carteira do cliente.",
    };
  }
}

type EstornarInput = {
  clienteId: string;
  recebimentoId: string;
  motivo: string;
};

export async function estornarRecebimentoCarteira(
  input: EstornarInput
): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();

    try {
      await exigirOperacaoCarteira({
        empresaId,
        acao: "receber_carteira",
        origem: "estornarRecebimentoCarteira",
      });
    } catch (error) {
      if (error instanceof ErroEntitlement || error instanceof ErroPermissao) {
        return { ok: false, erro: error.message };
      }
      throw error;
    }

    if (!uuidValido(input.clienteId) || !uuidValido(input.recebimentoId)) {
      return { ok: false, erro: "Recebimento inválido." };
    }

    const motivo = String(input.motivo ?? "").trim();
    if (motivo.length < 5) {
      return {
        ok: false,
        erro: "Informe o motivo com pelo menos 5 caracteres.",
      };
    }

    const { data: cliente } = await supabase
      .from("clientes")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("id", input.clienteId)
      .maybeSingle();

    if (!cliente) {
      return { ok: false, erro: "Cliente não encontrado." };
    }

    const { data, error } = await supabase.rpc(
      "rpc_estornar_recebimento_carteira",
      {
        p_empresa_id: empresaId,
        p_cliente_id: input.clienteId,
        p_recebimento_id: input.recebimentoId,
        p_motivo: motivo,
      }
    );

    if (error) {
      return { ok: false, erro: error.message };
    }

    revalidatePath(`/clientes/${input.clienteId}/carteira`);
    revalidatePath("/clientes");

    return {
      ok: true,
      valorRecebido: Number(data?.valor_estornado ?? 0),
      saldoAtual: Number(data?.saldo_atual ?? 0),
    };
  } catch (error) {
    return {
      ok: false,
      erro:
        error instanceof Error
          ? error.message
          : "Erro inesperado ao estornar recebimento.",
    };
  }
}
