"use server";

import { revalidatePath } from "next/cache";

import { aplicarAcaoAssinatura } from "@/lib/assinatura/aplicar-acao";
import type { AcaoAssinatura } from "@/lib/assinatura/tipos";
import { exigirMaster } from "@/lib/master/exigir-master";
import { registrarAuditoriaPlataforma } from "@/lib/plataforma/auditoria";
import {
  payloadPlanoParaRpc,
  validarPayloadPlano,
} from "@/lib/plataforma/recursos/validar-plano";

async function gravarAssinatura(
  empresaId: string,
  acao: AcaoAssinatura,
  params: {
    planoId?: string | null;
    vencimentoEm?: string | null;
    carenciaAte?: string | null;
    liberadoAte?: string | null;
    diasLiberacao?: number;
    motivo?: string | null;
  }
) {
  const { admin, usuarioId } = await exigirMaster();
  const { data: atual, error } = await admin
    .from("assinaturas_empresas")
    .select(
      "id, empresa_id, plano_id, status, inicio_em, vencimento_em, carencia_ate, liberado_ate, suspenso_em, cancelado_em, observacao, planos ( nome )"
    )
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (error) {
    return { ok: false as const, erro: error.message };
  }
  if (!atual) {
    return { ok: false as const, erro: "Assinatura não encontrada." };
  }

  const planoAtual = Array.isArray(atual.planos) ? atual.planos[0] : atual.planos;
  let planoNome: string | null = planoAtual?.nome ? String(planoAtual.nome) : null;
  let valorMensalContratado: number | null | undefined;
  if (params.planoId) {
    const { data: plano } = await admin
      .from("planos")
      .select("id, nome, valor_mensal")
      .eq("id", params.planoId)
      .maybeSingle();
    planoNome = plano?.nome ? String(plano.nome) : planoNome;
    valorMensalContratado =
      plano?.valor_mensal == null ? null : Number(plano.valor_mensal);
  }

  const { proxima, evento } = aplicarAcaoAssinatura(
    {
      id: String(atual.id),
      empresa_id: empresaId,
      plano_id: atual.plano_id ? String(atual.plano_id) : null,
      status: String(atual.status),
      inicio_em: atual.inicio_em ? String(atual.inicio_em) : null,
      vencimento_em: atual.vencimento_em ? String(atual.vencimento_em) : null,
      carencia_ate: atual.carencia_ate ? String(atual.carencia_ate) : null,
      liberado_ate: atual.liberado_ate ? String(atual.liberado_ate) : null,
      suspenso_em: atual.suspenso_em ? String(atual.suspenso_em) : null,
      cancelado_em: atual.cancelado_em ? String(atual.cancelado_em) : null,
      observacao: atual.observacao ? String(atual.observacao) : null,
      plano_nome: planoNome,
    },
    acao,
    { ...params, planoNome }
  );

  const { data: gravada, error: updateError } = await admin
    .from("assinaturas_empresas")
    .update({
      plano_id: proxima.plano_id,
      status: proxima.status,
      vencimento_em: proxima.vencimento_em,
      carencia_ate: proxima.carencia_ate,
      liberado_ate: proxima.liberado_ate,
      suspenso_em: proxima.suspenso_em,
      cancelado_em: proxima.cancelado_em,
      observacao: proxima.observacao,
      ...(valorMensalContratado !== undefined
        ? { valor_mensal_contratado: valorMensalContratado }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("empresa_id", empresaId)
    .eq("id", atual.id)
    .select("id, status, liberado_ate")
    .maybeSingle();

  if (updateError) {
    return { ok: false as const, erro: updateError.message };
  }
  if (!gravada) {
    return { ok: false as const, erro: "A assinatura não foi atualizada." };
  }

  await registrarAuditoriaPlataforma(admin, {
    adminUsuarioId: usuarioId,
    acao: evento,
    empresaId,
    metadados: {
      motivo: params.motivo ?? null,
      de: atual.status,
      para: proxima.status,
      plano_de: planoAtual?.nome ?? null,
      plano_para: planoNome,
      vencimento: proxima.vencimento_em,
      carencia_ate: proxima.carencia_ate,
      liberado_ate: proxima.liberado_ate,
    },
  });

  revalidatePath("/master");
  revalidatePath("/master/empresas");
  revalidatePath(`/master/empresas/${empresaId}`);
  revalidatePath("/assinatura");
  revalidatePath("/pdv");
  revalidatePath("/produtos");
  revalidatePath("/clientes");
  revalidatePath("/estoque");
  revalidatePath("/cadastro");
  revalidatePath("/vendas");
  revalidatePath("/configuracoes/importar-dados");
  revalidatePath("/configuracoes/catalogo");
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function masterAlterarPlano(formData: FormData) {
  const empresaId = String(formData.get("empresa_id") ?? "");
  return gravarAssinatura(empresaId, "alterar_plano", {
    planoId: String(formData.get("plano_id") ?? "") || null,
    vencimentoEm: String(formData.get("vencimento_em") ?? "") || null,
  });
}

export async function masterAlterarVencimento(formData: FormData) {
  return gravarAssinatura(String(formData.get("empresa_id") ?? ""), "alterar_vencimento", {
    vencimentoEm: String(formData.get("vencimento_em") ?? "") || null,
  });
}

export async function masterAtivarEmpresa(formData: FormData) {
  return gravarAssinatura(String(formData.get("empresa_id") ?? ""), "ativar", {
    motivo: String(formData.get("motivo") ?? ""),
  });
}

export async function masterSuspenderEmpresa(formData: FormData) {
  const motivo = String(formData.get("motivo") ?? "").trim();
  if (!motivo) {
    return { ok: false as const, erro: "Informe o motivo da suspensão." };
  }
  return gravarAssinatura(String(formData.get("empresa_id") ?? ""), "suspender", {
    motivo,
  });
}

export async function masterCarenciaEmpresa(formData: FormData) {
  const carenciaAte = String(formData.get("carencia_ate") ?? "").trim();
  if (!carenciaAte) {
    return { ok: false as const, erro: "Informe a data da carência." };
  }
  return gravarAssinatura(String(formData.get("empresa_id") ?? ""), "carencia", {
    carenciaAte,
    motivo: String(formData.get("motivo") ?? ""),
  });
}

export async function masterLiberarTemporariamente(formData: FormData) {
  const personalizado = String(formData.get("liberado_ate") ?? "").trim();
  const dias = Number(formData.get("dias") ?? 7);
  return gravarAssinatura(String(formData.get("empresa_id") ?? ""), "liberar", {
    diasLiberacao: dias,
    liberadoAte: personalizado ? new Date(`${personalizado}T23:59:59-03:00`).toISOString() : null,
    motivo: String(formData.get("motivo") ?? ""),
  });
}

export async function masterCancelarAssinatura(formData: FormData) {
  return gravarAssinatura(String(formData.get("empresa_id") ?? ""), "cancelar", {
    motivo: String(formData.get("motivo") ?? ""),
  });
}

export async function masterSalvarPlano(entrada: {
  id?: string | null;
  nome?: unknown;
  descricao?: unknown;
  valorMensal?: unknown;
  valorAnual?: unknown;
  ordem?: unknown;
  ativo?: unknown;
  destaque?: unknown;
  textoDestaque?: unknown;
  oferecerTeste?: unknown;
  diasTeste?: unknown;
  nivelSuporte?: unknown;
  limites?: unknown;
  recursos?: unknown;
}): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  const { supabase } = await exigirMaster();
  const validado = validarPayloadPlano(entrada);
  if (!validado.ok) {
    return validado;
  }

  const { data, error } = await supabase.rpc("rpc_master_salvar_plano", {
    p_payload: payloadPlanoParaRpc(validado.payload),
  });

  if (error) {
    return {
      ok: false,
      erro: mensagemErroSalvarPlano(error.message),
    };
  }

  const retorno = (data ?? {}) as { id?: string; nome?: string };
  const planoId = String(retorno.id ?? validado.payload.id ?? "").trim();

  revalidatePath("/master/planos");
  revalidatePath("/master");
  revalidatePath("/master/empresas");
  return { ok: true, id: planoId };
}

function mensagemErroSalvarPlano(mensagem: string) {
  const texto = mensagem.toLowerCase();
  if (texto.includes("nao_autorizado") || texto.includes("42501")) {
    return "Você não tem permissão para alterar planos.";
  }
  if (texto.includes("nome_obrigatorio")) {
    return "Informe o nome do plano.";
  }
  if (texto.includes("planos_nome_unico") || texto.includes("duplicate")) {
    return "Já existe um plano com este nome.";
  }
  if (texto.includes("plano_nao_encontrado")) {
    return "Plano não encontrado.";
  }
  return "Não foi possível salvar o plano.";
}
