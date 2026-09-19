import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

const EVENTOS = [
  "login_sucesso",
  "login_falha",
  "logout",
  "acesso_bloqueado_usuario_inativo",
  "acesso_bloqueado_empresa_inativa",
] as const;

export type EventoAcessoAuth = (typeof EVENTOS)[number];

export async function registrarEventoAcessoAuth(params: {
  evento: EventoAcessoAuth;
  usuarioId?: string | null;
  empresaId?: string | null;
  detalhe?: string | null;
}) {
  try {
    const admin = createAdminClient();
    await admin.from("auth_eventos_acesso").insert({
      evento: params.evento,
      usuario_id: params.usuarioId || null,
      empresa_id: params.empresaId || null,
      detalhe: params.detalhe ? String(params.detalhe).slice(0, 120) : null,
    });
  } catch (error) {
    console.error(
      "[auth] falha ao registrar evento",
      error instanceof Error ? error.message : "erro"
    );
  }
}
