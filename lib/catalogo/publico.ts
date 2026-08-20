import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { CatalogoPublicoResposta } from "@/lib/catalogo/tipos";
import { validarSlug } from "@/lib/catalogo/regras";

export async function carregarCatalogoPublico(
  slugBruto: string
): Promise<CatalogoPublicoResposta> {
  const validado = validarSlug(slugBruto);

  if (!validado.ok) {
    return { status: "nao_encontrado" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rpc_catalogo_publico", {
    p_slug: validado.slug,
  });

  if (error) {
    console.error("ERRO RPC CATALOGO PUBLICO:", error);
    throw new Error("Não foi possível carregar o catálogo.");
  }

  const resposta = data as CatalogoPublicoResposta | null;

  if (!resposta || !resposta.status) {
    return { status: "nao_encontrado" };
  }

  return resposta;
}
