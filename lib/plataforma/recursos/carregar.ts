import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  empresaPossuiRecurso,
  obterLimite,
  type AssinaturaParaEntitlement,
  type LimiteDoPlano,
  type RecursoDoPlano,
} from "@/lib/plataforma/recursos/resolver";
import type { ChaveLimite } from "@/lib/plataforma/recursos/catalogo";

export type EntitlementsEmpresa = {
  empresaId: string;
  assinatura: AssinaturaParaEntitlement | null;
  recursos: RecursoDoPlano[];
  limites: LimiteDoPlano[];
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

export async function carregarEntitlementsEmpresa(
  empresaId: string
): Promise<EntitlementsEmpresa> {
  const id = texto(empresaId);
  const vazio: EntitlementsEmpresa = {
    empresaId: id,
    assinatura: null,
    recursos: [],
    limites: [],
  };

  if (!id) {
    return vazio;
  }

  const supabase = await createClient();
  const { data: assinatura, error } = await supabase
    .from("assinaturas_empresas")
    .select("empresa_id, plano_id, status")
    .eq("empresa_id", id)
    .maybeSingle();

  if (error || !assinatura) {
    return vazio;
  }

  const planoId = texto(assinatura.plano_id);
  const base: AssinaturaParaEntitlement = {
    empresa_id: String(assinatura.empresa_id),
    plano_id: planoId || null,
    status: texto(assinatura.status) || null,
  };

  if (!planoId) {
    return { empresaId: id, assinatura: base, recursos: [], limites: [] };
  }

  const [{ data: recursos }, { data: limites }] = await Promise.all([
    supabase
      .from("planos_recursos")
      .select("habilitado, recursos_plataforma ( chave, ativo )")
      .eq("plano_id", planoId),
    supabase
      .from("planos_limites")
      .select("chave, valor")
      .eq("plano_id", planoId),
  ]);

  return {
    empresaId: id,
    assinatura: base,
    recursos: (recursos ?? []).map((item) => {
      const recurso = Array.isArray(item.recursos_plataforma)
        ? item.recursos_plataforma[0]
        : item.recursos_plataforma;
      return {
        chave: texto((recurso as { chave?: string } | null)?.chave),
        habilitado: Boolean(item.habilitado),
        ativo: Boolean((recurso as { ativo?: boolean } | null)?.ativo),
      };
    }),
    limites: (limites ?? []).map((item) => ({
      chave: texto(item.chave),
      valor: item.valor == null ? null : Number(item.valor),
    })),
  };
}

export async function empresaPossuiRecursoAtual(
  empresaId: string,
  chave: string
) {
  const dados = await carregarEntitlementsEmpresa(empresaId);
  return empresaPossuiRecurso({
    empresaId,
    chave,
    assinatura: dados.assinatura,
    recursosDoPlano: dados.recursos,
  });
}

export async function obterLimiteEmpresaAtual(
  empresaId: string,
  chave: ChaveLimite
) {
  const dados = await carregarEntitlementsEmpresa(empresaId);
  return obterLimite({
    empresaId,
    chave,
    assinatura: dados.assinatura,
    limitesDoPlano: dados.limites,
  });
}
