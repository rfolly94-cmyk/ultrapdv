import type { SupabaseClient } from "@supabase/supabase-js";

import { tabelaIaIndisponivel } from "./schema";
import type { AcaoAssistente, ContextoDeterministicoAssistente, MensagemAssistente, ModoRespostaAssistente, PapelMensagemIa, PropostaFiscalProduto } from "./tipos";
import type { ContextoAnaliticoAssistente } from "./analitico/tipos";
import type { CardPropostaAcao } from "./acoes/tipos";

function mapearMensagem(row: Record<string, unknown>): MensagemAssistente {
  const metadata =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as Record<string, unknown>)
      : {};
  const acoes = Array.isArray(metadata.acoes)
    ? (metadata.acoes as AcaoAssistente[])
    : [];
  const proposta =
    metadata.propostaFiscal && typeof metadata.propostaFiscal === "object"
      ? (metadata.propostaFiscal as PropostaFiscalProduto)
      : null;
  const propostaAcao =
    metadata.propostaAcao && typeof metadata.propostaAcao === "object"
      ? (metadata.propostaAcao as CardPropostaAcao)
      : null;
  const modo =
    metadata.modo === "direto" || metadata.modo === "ia"
      ? (metadata.modo as ModoRespostaAssistente)
      : null;
  const contextoDeterministico =
    metadata.contextoDeterministico &&
    typeof metadata.contextoDeterministico === "object"
      ? (metadata.contextoDeterministico as ContextoDeterministicoAssistente)
      : null;
  const contextoAnalitico =
    metadata.contextoAnalitico && typeof metadata.contextoAnalitico === "object"
      ? (metadata.contextoAnalitico as ContextoAnaliticoAssistente)
      : null;
  return {
    id: String(row.id),
    papel: row.papel === "usuario" ? "usuario" : "assistente",
    conteudo: String(row.conteudo ?? ""),
    acoes,
    propostaFiscal: proposta,
    propostaAcao,
    modo,
    contextoDeterministico,
    contextoAnalitico,
    createdAt: String(row.created_at ?? ""),
  };
}

export async function garantirConversaIa(params: {
  supabase: SupabaseClient;
  empresaId: string;
  usuarioId: string;
  titulo?: string;
}) {
  const { data: existente, error } = await params.supabase
    .from("ia_conversas")
    .select("id, empresa_id")
    .eq("empresa_id", params.empresaId)
    .eq("usuario_id", params.usuarioId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error && tabelaIaIndisponivel(error)) {
    return { ok: false as const, indisponivel: true, erro: error.message };
  }
  if (existente && String(existente.empresa_id) === params.empresaId) {
    return { ok: true as const, conversaId: String(existente.id) };
  }
  const { data: criada, error: erroInsert } = await params.supabase
    .from("ia_conversas")
    .insert({
      empresa_id: params.empresaId,
      usuario_id: params.usuarioId,
      titulo: params.titulo ?? "Assistente UltraPDV",
    })
    .select("id")
    .maybeSingle();
  if (erroInsert || !criada) {
    if (tabelaIaIndisponivel(erroInsert)) {
      return { ok: false as const, indisponivel: true, erro: erroInsert?.message ?? "" };
    }
    return { ok: false as const, erro: erroInsert?.message ?? "Não foi possível abrir a conversa." };
  }
  return { ok: true as const, conversaId: String(criada.id) };
}

export async function listarMensagensIa(params: {
  supabase: SupabaseClient;
  empresaId: string;
  usuarioId: string;
  conversaId: string;
  limite?: number;
}) {
  const { data, error } = await params.supabase
    .from("ia_mensagens")
    .select("id, empresa_id, papel, conteudo, metadata, created_at")
    .eq("empresa_id", params.empresaId)
    .eq("conversa_id", params.conversaId)
    .eq("usuario_id", params.usuarioId)
    .order("created_at", { ascending: true })
    .limit(params.limite ?? 40);
  if (error) {
    if (tabelaIaIndisponivel(error)) {
      return { ok: false as const, indisponivel: true, erro: error.message };
    }
    return { ok: false as const, erro: error.message };
  }
  return {
    ok: true as const,
    mensagens: (data ?? [])
      .filter((row) => String(row.empresa_id) === params.empresaId)
      .map((row) => mapearMensagem(row as Record<string, unknown>)),
  };
}

export async function gravarMensagemIa(params: {
  supabase: SupabaseClient;
  empresaId: string;
  usuarioId: string;
  conversaId: string;
  papel: PapelMensagemIa;
  conteudo: string;
  acoes?: AcaoAssistente[];
  propostaFiscal?: PropostaFiscalProduto | null;
  propostaAcao?: CardPropostaAcao | null;
  modo?: ModoRespostaAssistente | null;
  contextoDeterministico?: ContextoDeterministicoAssistente | null;
  contextoAnalitico?: ContextoAnaliticoAssistente | null;
}) {
  const conteudo = String(params.conteudo ?? "").trim().slice(0, 8000);
  if (!conteudo) {
    return { ok: false as const, erro: "Mensagem vazia." };
  }
  const { data, error } = await params.supabase
    .from("ia_mensagens")
    .insert({
      empresa_id: params.empresaId,
      conversa_id: params.conversaId,
      usuario_id: params.usuarioId,
      papel: params.papel,
      conteudo,
      metadata: {
        acoes: params.acoes ?? [],
        propostaFiscal: params.propostaFiscal ?? null,
        propostaAcao: params.propostaAcao ?? null,
        modo: params.modo ?? null,
        contextoDeterministico: params.contextoDeterministico ?? null,
        contextoAnalitico: params.contextoAnalitico ?? null,
      },
    })
    .select("id, empresa_id, papel, conteudo, metadata, created_at")
    .maybeSingle();
  if (error || !data) {
    if (tabelaIaIndisponivel(error)) {
      return { ok: false as const, indisponivel: true, erro: error?.message ?? "" };
    }
    return { ok: false as const, erro: error?.message ?? "Não foi possível gravar." };
  }
  await params.supabase
    .from("ia_conversas")
    .update({ updated_at: new Date().toISOString() })
    .eq("empresa_id", params.empresaId)
    .eq("id", params.conversaId)
    .eq("usuario_id", params.usuarioId);
  return {
    ok: true as const,
    mensagem: mapearMensagem(data as Record<string, unknown>),
  };
}

export async function buscarPropostaNaConversa(params: {
  supabase: SupabaseClient;
  empresaId: string;
  usuarioId: string;
  conversaId: string;
  propostaId: string;
}) {
  const { data, error } = await params.supabase
    .from("ia_mensagens")
    .select("id, empresa_id, metadata")
    .eq("empresa_id", params.empresaId)
    .eq("conversa_id", params.conversaId)
    .eq("usuario_id", params.usuarioId)
    .eq("papel", "assistente")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    return null;
  }
  for (const row of data ?? []) {
    if (String(row.empresa_id) !== params.empresaId) {
      continue;
    }
    const metadata =
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {};
    const proposta = metadata.propostaFiscal as PropostaFiscalProduto | undefined;
    if (proposta?.propostaId === params.propostaId) {
      return proposta;
    }
  }
  return null;
}
