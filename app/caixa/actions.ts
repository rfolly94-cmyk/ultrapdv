"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { exigirEmpresaOperacionalOuRedirecionar } from "@/lib/assinatura/exigir-empresa-operacional";
import { exigirOperacaoCaixa } from "@/lib/caixa/acesso-operacao";
import { carregarDetalheCaixa } from "@/lib/caixa/carregar";
import { mensagemErroCaixa, parseValorCaixa, uuidCaixaValido } from "@/lib/caixa/valor";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { ErroEntitlement } from "@/lib/plataforma/entitlements/erro";
import { createClient } from "@/lib/supabase/server";

type Resultado =
  | { ok: true }
  | { ok: false; erro: string };

async function getContexto() {
  const supabase = await createClient();
  const { data: claimsData, error: authError } = await supabase.auth.getClaims();
  const usuarioId = claimsData?.claims?.sub;

  if (authError || !usuarioId) {
    redirect("/login");
  }

  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id")
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
    empresaId: String(vinculo.empresa_id),
  };
}

function resultadoNegacao(error: unknown): Resultado {
  if (error instanceof ErroPermissao && error.status === 401) {
    redirect("/login");
  }
  if (error instanceof ErroEntitlement || error instanceof ErroPermissao) {
    return { ok: false, erro: error.message };
  }
  throw error;
}

export async function abrirCaixa(input: {
  saldoInicial: string;
  observacao?: string;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();

    try {
      await exigirOperacaoCaixa({
        empresaId,
        acao: "abrir",
        origem: "abrirCaixa",
      });
    } catch (error) {
      return resultadoNegacao(error);
    }

    const saldo = parseValorCaixa(input.saldoInicial);
    if (saldo === null) {
      return { ok: false, erro: "Informe o saldo inicial em dinheiro." };
    }
    if (saldo < 0) {
      return { ok: false, erro: "O saldo inicial não pode ser negativo." };
    }

    const { error } = await supabase.rpc("rpc_abrir_caixa", {
      p_saldo_inicial: saldo,
      p_observacao: String(input.observacao ?? "").trim() || null,
    });

    if (error) {
      return {
        ok: false,
        erro: mensagemErroCaixa(error, "Não foi possível abrir o caixa."),
      };
    }

    revalidatePath("/caixa");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErroCaixa(error, "Não foi possível abrir o caixa."),
    };
  }
}

export async function movimentarCaixa(input: {
  caixaId: string;
  tipo: "suprimento" | "sangria";
  valor: string;
  motivo: string;
  observacao?: string;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();

    try {
      await exigirOperacaoCaixa({
        empresaId,
        acao: "movimentar",
        origem: "movimentarCaixa",
      });
    } catch (error) {
      return resultadoNegacao(error);
    }

    if (!uuidCaixaValido(input.caixaId)) {
      return { ok: false, erro: "Caixa inválido." };
    }

    const valor = parseValorCaixa(input.valor);
    if (valor === null || valor <= 0) {
      return { ok: false, erro: "Informe um valor maior que zero." };
    }

    const motivo = String(input.motivo ?? "").trim();
    if (motivo.length < 3) {
      return { ok: false, erro: "Informe o motivo com pelo menos 3 caracteres." };
    }

    const { error } = await supabase.rpc("rpc_movimentar_caixa", {
      p_caixa_id: input.caixaId,
      p_tipo: input.tipo,
      p_valor: valor,
      p_motivo: motivo,
      p_observacao: String(input.observacao ?? "").trim() || null,
    });

    if (error) {
      return {
        ok: false,
        erro: mensagemErroCaixa(
          error,
          input.tipo === "sangria"
            ? "Não foi possível registrar a sangria."
            : "Não foi possível registrar o suprimento."
        ),
      };
    }

    revalidatePath("/caixa");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErroCaixa(error, "Não foi possível registrar a movimentação."),
    };
  }
}

export async function fecharCaixa(input: {
  caixaId: string;
  dinheiroContado: string;
  observacao?: string;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();

    try {
      await exigirOperacaoCaixa({
        empresaId,
        acao: "fechar",
        origem: "fecharCaixa",
      });
    } catch (error) {
      return resultadoNegacao(error);
    }

    if (!uuidCaixaValido(input.caixaId)) {
      return { ok: false, erro: "Caixa inválido." };
    }

    const contado = parseValorCaixa(input.dinheiroContado);
    if (contado === null) {
      return { ok: false, erro: "Informe o dinheiro contado." };
    }
    if (contado < 0) {
      return { ok: false, erro: "O dinheiro contado não pode ser negativo." };
    }

    const { error } = await supabase.rpc("rpc_fechar_caixa", {
      p_caixa_id: input.caixaId,
      p_dinheiro_contado: contado,
      p_observacao: String(input.observacao ?? "").trim() || null,
    });

    if (error) {
      return {
        ok: false,
        erro: mensagemErroCaixa(error, "Não foi possível fechar o caixa."),
      };
    }

    revalidatePath("/caixa");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErroCaixa(error, "Não foi possível fechar o caixa."),
    };
  }
}

export async function carregarResumoCaixa(caixaId: string) {
  try {
    const { empresaId } = await getContexto();

    try {
      await exigirOperacaoCaixa({
        empresaId,
        acao: "acessar",
        origem: "carregarResumoCaixa",
      });
    } catch (error) {
      if (error instanceof ErroPermissao && error.status === 401) {
        redirect("/login");
      }
      return {
        ok: false as const,
        erro:
          error instanceof Error
            ? error.message
            : "Sem permissão para ver o caixa.",
      };
    }

    if (!uuidCaixaValido(caixaId)) {
      return { ok: false as const, erro: "Caixa inválido." };
    }

    const detalhe = await carregarDetalheCaixa({ empresaId, caixaId });
    if (!detalhe) {
      return { ok: false as const, erro: "Caixa não encontrado." };
    }

    return { ok: true as const, caixa: detalhe };
  } catch (error) {
    return {
      ok: false as const,
      erro: mensagemErroCaixa(error, "Não foi possível carregar o resumo."),
    };
  }
}
