"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { exigirEmpresaOperacionalOuRedirecionar } from "@/lib/assinatura/exigir-empresa-operacional";
import { exigirOperacaoCaixa } from "@/lib/caixa/acesso-operacao";
import {
  conferenciaAbertaParaCliente,
  conferenciaRevelaEsperado,
  mapearConferenciaCaixa,
  mapearMeioConferenciaRpc,
  podeRevelarEsperadoCaixaCego,
} from "@/lib/caixa/conferencia";
import { carregarDetalheCaixa, carregarFechamentoCego } from "@/lib/caixa/carregar";
import { recusarSessaoCaixaSeControleDesativado } from "@/lib/caixa/controle-servidor";
import { validarMotivoReabertura } from "@/lib/caixa/reabertura";
import type { ConferenciaCaixa, MeioConferenciaCaixa } from "@/lib/caixa/tipos";
import { mensagemErroCaixa, parseValorCaixa, uuidCaixaValido } from "@/lib/caixa/valor";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { ErroEntitlement } from "@/lib/plataforma/entitlements/erro";
import { createClient } from "@/lib/supabase/server";

type ResultadoErro = { ok: false; erro: string };
type Resultado = { ok: true } | ResultadoErro;

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

function resultadoNegacao(error: unknown): ResultadoErro {
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

    const recusaControle = await recusarSessaoCaixaSeControleDesativado(
      supabase,
      empresaId
    );
    if (recusaControle) {
      return recusaControle;
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
    revalidatePath("/pdv");
    revalidatePath("/fiscal");
    revalidatePath("/fiscal/nfe/nova");
    revalidatePath("/fiscal/nfe", "layout");
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

    const recusaControle = await recusarSessaoCaixaSeControleDesativado(
      supabase,
      empresaId
    );
    if (recusaControle) {
      return recusaControle;
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

function numeroJson(valor: unknown) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export async function iniciarFechamentoCaixa(input: {
  caixaId: string;
}): Promise<
  { ok: true; conferencia: ConferenciaCaixa } | { ok: false; erro: string }
> {
  try {
    const { supabase, empresaId } = await getContexto();
    let podeRevelarEsperadoCego = false;

    try {
      const sessao =       await exigirOperacaoCaixa({
        empresaId,
        acao: "fechar",
        origem: "iniciarFechamentoCaixa",
      });
      podeRevelarEsperadoCego = podeRevelarEsperadoCaixaCego(sessao.permissoes);
    } catch (error) {
      return resultadoNegacao(error);
    }

    if (!uuidCaixaValido(input.caixaId)) {
      return { ok: false, erro: "Caixa inválido." };
    }

    const [cegoEmpresa, rpc] = await Promise.all([
      carregarFechamentoCego(supabase, empresaId),
      supabase.rpc("rpc_iniciar_fechamento_caixa", {
        p_caixa_id: input.caixaId,
      }),
    ]);

    if (rpc.error) {
      return {
        ok: false,
        erro: mensagemErroCaixa(rpc.error, "Não foi possível iniciar a conferência."),
      };
    }

    const conferencia = mapearConferenciaCaixa(rpc.data);
    if (!conferencia || conferencia.caixa_id !== input.caixaId) {
      return { ok: false, erro: "Não foi possível iniciar a conferência." };
    }

    const conferenciaCliente = conferenciaAbertaParaCliente({
      conferencia,
      fechamentoCegoEmpresa: cegoEmpresa,
    });
    if (
      !podeRevelarEsperadoCego &&
      conferenciaRevelaEsperado(conferenciaCliente)
    ) {
      return { ok: false, erro: "Não foi possível iniciar a conferência." };
    }

    return {
      ok: true,
      conferencia: conferenciaCliente,
    };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErroCaixa(error, "Não foi possível iniciar a conferência."),
    };
  }
}

export async function confirmarFechamentoCaixa(input: {
  caixaId: string;
  versaoLivro: string;
  meios: Array<{ chave: string; valorInformado: string }>;
  observacao?: string;
}): Promise<
  | {
      ok: true;
      dinheiroContado: number;
      dinheiroEsperado: number;
      diferenca: number;
      meios: MeioConferenciaCaixa[];
    }
  | { ok: false; erro: string }
> {
  try {
    const { supabase, empresaId } = await getContexto();

    try {
      await exigirOperacaoCaixa({
        empresaId,
        acao: "fechar",
        origem: "confirmarFechamentoCaixa",
      });
    } catch (error) {
      return resultadoNegacao(error);
    }

    if (!uuidCaixaValido(input.caixaId)) {
      return { ok: false, erro: "Caixa inválido." };
    }

    const versao = String(input.versaoLivro ?? "").trim();
    if (!versao) {
      return { ok: false, erro: "Atualize a conferência antes de fechar." };
    }

    const meios: Array<{ chave: string; valor_informado: number }> = [];
    for (const item of input.meios ?? []) {
      const chave = String(item.chave ?? "").trim();
      const informado = parseValorCaixa(item.valorInformado);
      if (!chave) {
        return { ok: false, erro: "Informe o valor conferido de todas as formas." };
      }
      if (informado === null) {
        return { ok: false, erro: "Informe o valor conferido de todas as formas." };
      }
      if (informado < 0) {
        return { ok: false, erro: "O valor informado não pode ser negativo." };
      }
      meios.push({ chave, valor_informado: informado });
    }

    const { data, error } = await supabase.rpc("rpc_confirmar_fechamento_caixa", {
      p_caixa_id: input.caixaId,
      p_versao_livro: versao,
      p_meios: meios,
      p_observacao: String(input.observacao ?? "").trim() || null,
    });

    if (error) {
      return {
        ok: false,
        erro: mensagemErroCaixa(error, "Não foi possível fechar o caixa."),
      };
    }

    const bruto = (data ?? {}) as Record<string, unknown>;
    const meiosBrutos = Array.isArray(bruto.meios) ? bruto.meios : [];

    revalidatePath("/caixa");
    revalidatePath("/pdv");
    revalidatePath("/fiscal");
    revalidatePath("/fiscal/nfe", "layout");
    return {
      ok: true,
      dinheiroContado: numeroJson(bruto.dinheiro_contado),
      dinheiroEsperado: numeroJson(bruto.dinheiro_fisico_esperado),
      diferenca: numeroJson(bruto.diferenca),
      meios: meiosBrutos
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map(mapearMeioConferenciaRpc),
    };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErroCaixa(error, "Não foi possível fechar o caixa."),
    };
  }
}

export async function definirFechamentoCaixaCego(input: {
  habilitado: boolean;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();

    try {
      await exigirOperacaoCaixa({
        empresaId,
        acao: "acessar",
        origem: "definirFechamentoCaixaCego",
      });
      await exigirPermissao({
        modulo: "configuracoes",
        acao: "editar_empresa",
      });
    } catch (error) {
      return resultadoNegacao(error);
    }

    const { error } = await supabase.rpc("rpc_definir_fechamento_caixa_cego", {
      p_habilitado: Boolean(input.habilitado),
    });

    if (error) {
      return {
        ok: false,
        erro: mensagemErroCaixa(
          error,
          "Não foi possível atualizar o fechamento cego."
        ),
      };
    }

    revalidatePath("/caixa");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErroCaixa(
        error,
        "Não foi possível atualizar o fechamento cego."
      ),
    };
  }
}

export async function carregarResumoCaixa(caixaId: string) {
  try {
    const { empresaId } = await getContexto();
    let podeRevelarEsperadoCego = false;

    try {
      const sessao = await exigirOperacaoCaixa({
        empresaId,
        acao: "acessar",
        origem: "carregarResumoCaixa",
      });
      podeRevelarEsperadoCego = podeRevelarEsperadoCaixaCego(sessao.permissoes);
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

    const detalhe = await carregarDetalheCaixa({
      empresaId,
      caixaId,
      podeRevelarEsperadoCego,
    });
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

export async function reabrirCaixa(input: {
  caixaId: string;
  motivo: string;
}): Promise<Resultado> {
  try {
    const { supabase, empresaId } = await getContexto();

    try {
      await exigirOperacaoCaixa({
        empresaId,
        acao: "reabrir",
        origem: "reabrirCaixa",
      });
    } catch (error) {
      return resultadoNegacao(error);
    }

    const recusaControle = await recusarSessaoCaixaSeControleDesativado(
      supabase,
      empresaId
    );
    if (recusaControle) {
      return recusaControle;
    }

    if (!uuidCaixaValido(input.caixaId)) {
      return { ok: false, erro: "Caixa inválido." };
    }

    const motivo = validarMotivoReabertura(input.motivo);
    if (!motivo.ok) {
      return { ok: false, erro: motivo.erro };
    }

    const { error } = await supabase.rpc("rpc_reabrir_caixa", {
      p_caixa_id: input.caixaId,
      p_motivo: motivo.motivo,
    });

    if (error) {
      return {
        ok: false,
        erro: mensagemErroCaixa(error, "Não foi possível reabrir o caixa."),
      };
    }

    revalidatePath("/caixa");
    revalidatePath("/pdv");
    revalidatePath("/fiscal");
    revalidatePath("/fiscal/nfe/nova");
    revalidatePath("/fiscal/nfe", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      erro: mensagemErroCaixa(error, "Não foi possível reabrir o caixa."),
    };
  }
}
