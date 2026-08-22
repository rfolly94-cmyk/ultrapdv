"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auditarCompetencia } from "@/lib/contabilidade/auditoria";
import { parseCompetencia } from "@/lib/contabilidade/competencia";
import { obterContextoContabilidade } from "@/lib/contabilidade/contexto";
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirOperacaoContabilidade } from "@/lib/contabilidade/acesso-operacao";
import { resultadoErroEntitlement } from "@/lib/plataforma/entitlements/exigir-recurso";
import { registrarEventoContabilidade } from "@/lib/contabilidade/eventos";
import { gerarSnapshotInventario } from "@/lib/contabilidade/inventario";

function voltar(caminho: string, tipo: "erro" | "sucesso", mensagem: string): never {
  redirect(`${caminho}?${tipo}=${encodeURIComponent(mensagem)}`);
}

export async function definirEmpresaAtiva(formData: FormData) {
  const ctx = await obterContextoContabilidade();

  try {
    await exigirOperacaoContabilidade({
      empresaId: ctx.empresaId,
      acao: "acessar",
      origem: "definirEmpresaAtiva",
    });
  } catch (error) {
    const entitlement = resultadoErroEntitlement(error);
    if (entitlement) {
      voltar("/contabilidade", "erro", entitlement.erro);
    }
    if (error instanceof ErroPermissao) {
      voltar("/contabilidade", "erro", error.message);
    }
    throw error;
  }
  const empresaId = String(formData.get("empresa_id") ?? "");
  const destino = String(formData.get("destino") ?? "/contabilidade");

  const autorizada = ctx.empresas.some((item) => item.empresaId === empresaId);
  if (!autorizada) {
    voltar("/contabilidade", "erro", "Empresa não autorizada para este usuário.");
  }

  await ctx.supabase
    .from("usuarios_empresas")
    .update({ principal: false })
    .eq("usuario_id", ctx.usuarioId)
    .eq("ativo", true);

  const { error } = await ctx.supabase
    .from("usuarios_empresas")
    .update({ principal: true })
    .eq("usuario_id", ctx.usuarioId)
    .eq("empresa_id", empresaId)
    .eq("ativo", true);

  if (error) {
    voltar("/contabilidade", "erro", error.message);
  }

  revalidatePath("/", "layout");
  redirect(destino.startsWith("/contabilidade") ? destino : "/contabilidade");
}

export async function liberarCompetenciaAction(formData: FormData) {
  const ctx = await obterContextoContabilidade();

  try {
    await exigirOperacaoContabilidade({
      empresaId: ctx.empresaId,
      acao: "fechamento",
      origem: "liberarCompetenciaAction",
    });
  } catch (error) {
    const entitlement = resultadoErroEntitlement(error);
    if (entitlement) {
      voltar("/contabilidade/competencias", "erro", entitlement.erro);
    }
    if (error instanceof ErroPermissao) {
      voltar("/contabilidade/competencias", "erro", error.message);
    }
    throw error;
  }

  const competencia = parseCompetencia(String(formData.get("competencia") ?? ""));
  const observacao = String(formData.get("observacao") ?? "").trim() || null;
  const confirmarErros = String(formData.get("confirmar_erros") ?? "") === "1";

  const auditoria = await auditarCompetencia(
    ctx.supabase,
    ctx.empresaId,
    competencia,
    ctx.fusoHorario
  );

  if (auditoria.erros > 0 && !confirmarErros) {
    voltar(
      `/contabilidade/competencias?competencia=${competencia.ano}-${String(competencia.mes).padStart(2, "0")}`,
      "erro",
      `Há ${auditoria.erros} erro(s) na auditoria. Confirme a liberação se quiser seguir mesmo assim.`
    );
  }

  const { data: existente } = await ctx.supabase
    .from("contabilidade_competencias")
    .select("id")
    .eq("empresa_id", ctx.empresaId)
    .eq("ano", competencia.ano)
    .eq("mes", competencia.mes)
    .maybeSingle();

  const payload = {
    empresa_id: ctx.empresaId,
    ano: competencia.ano,
    mes: competencia.mes,
    status: "LIBERADA_CONTABILIDADE",
    liberado_em: new Date().toISOString(),
    liberado_por: ctx.usuarioId,
    observacao,
  };

  const { error } = existente
    ? await ctx.supabase
        .from("contabilidade_competencias")
        .update(payload)
        .eq("id", existente.id)
        .eq("empresa_id", ctx.empresaId)
    : await ctx.supabase.from("contabilidade_competencias").insert(payload);

  if (error) {
    voltar("/contabilidade/competencias", "erro", error.message);
  }

  await registrarEventoContabilidade(ctx.supabase, {
    empresaId: ctx.empresaId,
    tipo: "COMPETENCIA_LIBERADA",
    usuarioId: ctx.usuarioId,
    ano: competencia.ano,
    mes: competencia.mes,
    detalhe: observacao ?? `Liberada com ${auditoria.erros} erro(s) e ${auditoria.alertas} alerta(s).`,
  });

  revalidatePath("/contabilidade");
  voltar(
    `/contabilidade/competencias?competencia=${competencia.ano}-${String(competencia.mes).padStart(2, "0")}`,
    "sucesso",
    "Competência liberada para a contabilidade."
  );
}

export async function gerarInventarioAction(formData: FormData) {
  const ctx = await obterContextoContabilidade();

  try {
    await exigirOperacaoContabilidade({
      empresaId: ctx.empresaId,
      acao: "inventario",
      origem: "gerarInventarioAction",
    });
  } catch (error) {
    const entitlement = resultadoErroEntitlement(error);
    if (entitlement) {
      voltar("/contabilidade/inventario", "erro", entitlement.erro);
    }
    if (error instanceof ErroPermissao) {
      voltar("/contabilidade/inventario", "erro", error.message);
    }
    throw error;
  }

  const dataSnapshot = String(formData.get("data_snapshot") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataSnapshot)) {
    voltar("/contabilidade/inventario", "erro", "Informe uma data válida.");
  }

  try {
    const inventario = await gerarSnapshotInventario(ctx.supabase, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      dataSnapshot,
    });

    await registrarEventoContabilidade(ctx.supabase, {
      empresaId: ctx.empresaId,
      tipo: "INVENTARIO_GERADO",
      usuarioId: ctx.usuarioId,
      detalhe: `Snapshot ${dataSnapshot} com ${inventario.itens_count} itens.`,
    });
  } catch (error) {
    voltar(
      "/contabilidade/inventario",
      "erro",
      error instanceof Error ? error.message : "Falha ao gerar inventário."
    );
  }

  revalidatePath("/contabilidade/inventario");
  voltar(
    "/contabilidade/inventario",
    "sucesso",
    "Snapshot de inventário gerado. O estoque operacional não foi alterado."
  );
}
