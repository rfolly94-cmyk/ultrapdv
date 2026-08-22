import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  lojaPublicaIndisponivel,
  planoCatalogoPublicoPermitido,
  resolverEmpresaCatalogoPorSlug,
} from "@/lib/catalogo/acesso-publico";
import type { CatalogoPublicoResposta } from "@/lib/catalogo/tipos";
import { validarSlug } from "@/lib/catalogo/regras";

export async function carregarCatalogoPublico(
  slugBruto: string
): Promise<CatalogoPublicoResposta> {
  const validado = validarSlug(slugBruto);

  if (!validado.ok) {
    return { status: "nao_encontrado" };
  }

  const loja = await resolverEmpresaCatalogoPorSlug(validado.slug);
  if (!loja) {
    return { status: "nao_encontrado" };
  }

  const permitido = await planoCatalogoPublicoPermitido(loja.empresaId);
  if (!permitido) {
    return lojaPublicaIndisponivel({
      nomeExibido: loja.nomeExibido,
      slug: loja.slug,
    });
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
