import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

const CHAVES_PROIBIDAS = [
  "senha",
  "password",
  "secret",
  "token",
  "api_key",
  "apikey",
  "certificado",
  "csc",
  "authorization",
];

function metadadosSeguros(entrada: Record<string, unknown> | undefined) {
  const saida: Record<string, unknown> = {};

  for (const [chave, valor] of Object.entries(entrada ?? {})) {
    const nome = chave.toLowerCase();
    if (CHAVES_PROIBIDAS.some((proibida) => nome.includes(proibida))) {
      continue;
    }
    saida[chave] = valor;
  }

  return saida;
}

export async function registrarAuditoriaPlataforma(
  admin: SupabaseClient,
  {
    adminUsuarioId,
    acao,
    empresaId,
    usuarioAlvoId,
    metadados,
  }: {
    adminUsuarioId: string;
    acao: string;
    empresaId?: string | null;
    usuarioAlvoId?: string | null;
    metadados?: Record<string, unknown>;
  }
) {
  const { error } = await admin.from("plataforma_auditoria").insert({
    admin_usuario_id: adminUsuarioId,
    acao,
    empresa_id: empresaId ?? null,
    usuario_alvo_id: usuarioAlvoId ?? null,
    metadados: metadadosSeguros(metadados),
  });

  if (error) {
    console.error("[plataforma] falha ao registrar auditoria", error.message);
  }
}
