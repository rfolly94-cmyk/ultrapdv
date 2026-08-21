import "server-only";

import { buscarVinculoEmpresaAtiva } from "@/lib/empresa/empresa-ativa";
import { createClient } from "@/lib/supabase/server";
import {
  completarConfiguracoesImpressao,
  ehTipoDocumentoImpressao,
  ehUuid,
  sanitizarConfiguracaoImpressao,
} from "./regras";
import type {
  ConfiguracaoImpressao,
  TipoDocumentoImpressao,
} from "./tipos";

type LinhaConfig = {
  id: string;
  empresa_id: string;
  usuario_id: string;
  dispositivo_id: string;
  tipo_documento: string;
  impressora_nome: string | null;
  papel: string;
  copias: number;
  impressao_automatica: boolean;
  ativo: boolean;
};

async function contextoImpressao() {
  const supabase = await createClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();
  const usuarioId = claimsData?.claims?.sub;

  if (error || !usuarioId) {
    return { ok: false as const, erro: "Não autenticado.", status: 401 };
  }

  const { data: vinculo } = await buscarVinculoEmpresaAtiva<{
    empresa_id: string;
  }>(supabase, usuarioId, "empresa_id");

  if (!vinculo) {
    return {
      ok: false as const,
      erro: "Empresa ativa não encontrada.",
      status: 403,
    };
  }

  return {
    ok: true as const,
    supabase,
    usuarioId: String(usuarioId),
    empresaId: String(vinculo.empresa_id),
  };
}

function linhaParaConfig(linha: LinhaConfig): ConfiguracaoImpressao | null {
  return sanitizarConfiguracaoImpressao({
    id: linha.id,
    tipoDocumento: linha.tipo_documento,
    impressoraNome: linha.impressora_nome,
    papel: linha.papel,
    copias: linha.copias,
    impressaoAutomatica: linha.impressao_automatica,
    ativo: linha.ativo,
  });
}

export async function buscarConfiguracoesImpressao(dispositivoId: string) {
  if (!ehUuid(dispositivoId)) {
    return { ok: false as const, erro: "Dispositivo inválido." };
  }

  const ctx = await contextoImpressao();
  if (!ctx.ok) {
    return ctx;
  }

  const { data, error } = await ctx.supabase
    .from("impressoes_configuracoes")
    .select(
      "id, empresa_id, usuario_id, dispositivo_id, tipo_documento, impressora_nome, papel, copias, impressao_automatica, ativo"
    )
    .eq("empresa_id", ctx.empresaId)
    .eq("usuario_id", ctx.usuarioId)
    .eq("dispositivo_id", dispositivoId);

  if (error) {
    return { ok: false as const, erro: error.message };
  }

  const daEmpresa = (data ?? []).filter(
    (linha) =>
      linha.empresa_id === ctx.empresaId &&
      linha.usuario_id === ctx.usuarioId &&
      linha.dispositivo_id === dispositivoId
  );

  const configs = completarConfiguracoesImpressao(
    daEmpresa
      .map((linha) => linhaParaConfig(linha as LinhaConfig))
      .filter((item): item is ConfiguracaoImpressao => Boolean(item))
  );

  return {
    ok: true as const,
    empresaId: ctx.empresaId,
    usuarioId: ctx.usuarioId,
    dispositivoId,
    configs,
  };
}

export async function salvarConfiguracaoImpressao(input: {
  dispositivoId: string;
  tipoDocumento: TipoDocumentoImpressao | string;
  impressoraNome?: string | null;
  papel?: string;
  copias?: number;
  impressaoAutomatica?: boolean;
}) {
  if (!ehUuid(input.dispositivoId)) {
    return { ok: false as const, erro: "Dispositivo inválido." };
  }

  if (!ehTipoDocumentoImpressao(input.tipoDocumento)) {
    return { ok: false as const, erro: "Tipo de documento inválido." };
  }

  const sanitizada = sanitizarConfiguracaoImpressao({
    tipoDocumento: input.tipoDocumento,
    impressoraNome: input.impressoraNome,
    papel: input.papel,
    copias: input.copias,
    impressaoAutomatica: input.impressaoAutomatica,
    ativo: true,
  });

  if (!sanitizada) {
    return { ok: false as const, erro: "Configuração inválida." };
  }

  const ctx = await contextoImpressao();
  if (!ctx.ok) {
    return ctx;
  }

  const agora = new Date().toISOString();
  const { error } = await ctx.supabase.from("impressoes_configuracoes").upsert(
    {
      empresa_id: ctx.empresaId,
      usuario_id: ctx.usuarioId,
      dispositivo_id: input.dispositivoId,
      tipo_documento: sanitizada.tipoDocumento,
      impressora_nome: sanitizada.impressoraNome,
      papel: sanitizada.papel,
      copias: sanitizada.copias,
      impressao_automatica: sanitizada.impressaoAutomatica,
      ativo: true,
      updated_at: agora,
    },
    { onConflict: "empresa_id,usuario_id,dispositivo_id,tipo_documento" }
  );

  if (error) {
    return { ok: false as const, erro: error.message };
  }

  return { ok: true as const, config: sanitizada };
}

export async function buscarEmissaoAutorizadaDaVenda(input: {
  vendaId: string;
  modelo: "55" | "65";
}) {
  const vendaId = String(input.vendaId ?? "").trim();
  if (!vendaId) {
    return { ok: false as const, erro: "Venda inválida." };
  }

  const ctx = await contextoImpressao();
  if (!ctx.ok) {
    return ctx;
  }

  const { data, error } = await ctx.supabase
    .from("fiscal_emissoes")
    .select("id, empresa_id, origem_id, modelo, status, pdf_hex")
    .eq("empresa_id", ctx.empresaId)
    .eq("origem_tipo", "venda")
    .eq("origem_id", vendaId)
    .eq("modelo", input.modelo)
    .eq("status", "autorizada")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { ok: false as const, erro: error.message };
  }

  if (!data || data.empresa_id !== ctx.empresaId || data.status !== "autorizada") {
    return { ok: true as const, emissaoId: null, danfeDisponivel: false };
  }

  return {
    ok: true as const,
    emissaoId: String(data.id),
    danfeDisponivel: Boolean(data.pdf_hex),
  };
}
