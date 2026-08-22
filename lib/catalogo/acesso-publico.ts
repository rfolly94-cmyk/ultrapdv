import "server-only";

import { decidirRecursoDoPlano } from "@/lib/plataforma/entitlements/camadas";
import { carregarEntitlementsEmpresaServico } from "@/lib/plataforma/recursos/carregar";
import { createAdminClient } from "@/lib/supabase/admin";

const MENSAGEM_PUBLICA_INDISPONIVEL = "Catálogo temporariamente indisponível.";

export function mensagemCatalogoPublicoIndisponivel() {
  return MENSAGEM_PUBLICA_INDISPONIVEL;
}

export async function resolverEmpresaCatalogoPorSlug(slug: string) {
  const valor = String(slug ?? "").trim().toLowerCase();
  if (!valor) {
    return null;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("catalogo_config")
    .select("empresa_id, nome_exibido, slug, ativo")
    .eq("slug", valor)
    .maybeSingle();

  if (error || !data?.empresa_id) {
    return null;
  }

  return {
    empresaId: String(data.empresa_id),
    nomeExibido: String(data.nome_exibido ?? "Loja"),
    slug: String(data.slug ?? valor),
    ativo: Boolean(data.ativo),
  };
}

export async function planoCatalogoPublicoPermitido(empresaId: string) {
  const id = String(empresaId ?? "").trim();
  if (!id) {
    return false;
  }

  const dados = await carregarEntitlementsEmpresaServico(id);
  return decidirRecursoDoPlano({
    empresaId: id,
    recurso: "catalogo",
    assinatura: dados.assinatura,
    recursosDoPlano: dados.recursos,
  }).permitido;
}

export function lojaPublicaIndisponivel(input: {
  nomeExibido: string;
  slug: string;
}) {
  return {
    status: "inativo" as const,
    loja: {
      nome_exibido: input.nomeExibido,
      slug: input.slug,
    },
  };
}
