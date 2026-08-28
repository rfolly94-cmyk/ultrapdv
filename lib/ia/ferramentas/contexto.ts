import type { SupabaseClient } from "@supabase/supabase-js";

import type { PermissoesEfetivas } from "@/lib/permissoes/tipos";

import type { ContextoTelaResolvido } from "../tipos";
import type { ContextoAnaliticoAssistente } from "../analitico/tipos";

export type ContextoFerramentaIa = {
  supabase: SupabaseClient;
  empresaId: string;
  usuarioId: string;
  conversaId: string | null;
  permissoes: PermissoesEfetivas | null;
  tela: ContextoTelaResolvido;
  contextoAnalitico?: ContextoAnaliticoAssistente | null;
};
