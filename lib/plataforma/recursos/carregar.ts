import "server-only";

import { cache } from "react";

import { createAdminClient } from "@/lib/supabase/admin";
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
  planoNome: string | null;
  recursos: RecursoDoPlano[];
  limites: LimiteDoPlano[];
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function nomeDoPlano(valor: unknown) {
  const plano = Array.isArray(valor) ? valor[0] : valor;
  if (!plano || typeof plano !== "object") {
    return null;
  }
  const nome = texto((plano as { nome?: unknown }).nome);
  return nome || null;
}

function entitlementsVazios(empresaId: string): EntitlementsEmpresa {
  return {
    empresaId,
    assinatura: null,
    planoNome: null,
    recursos: [],
    limites: [],
  };
}

async function carregarEntitlementsComCliente(
  supabase: { from: (tabela: string) => any },
  empresaId: string
): Promise<EntitlementsEmpresa> {
  const id = texto(empresaId);
  if (!id) {
    return entitlementsVazios(id);
  }

  const { data: assinatura, error } = await supabase
    .from("assinaturas_empresas")
    .select("empresa_id, plano_id, status, planos ( nome )")
    .eq("empresa_id", id)
    .maybeSingle();

  if (error || !assinatura || typeof assinatura !== "object") {
    return entitlementsVazios(id);
  }

  const linha = assinatura as {
    empresa_id?: unknown;
    plano_id?: unknown;
    status?: unknown;
    planos?: unknown;
  };
  const planoId = texto(linha.plano_id);
  const planoNome = nomeDoPlano(linha.planos);
  const base: AssinaturaParaEntitlement = {
    empresa_id: String(linha.empresa_id),
    plano_id: planoId || null,
    status: texto(linha.status) || null,
  };

  if (!planoId) {
    return {
      empresaId: id,
      assinatura: base,
      planoNome,
      recursos: [],
      limites: [],
    };
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
    planoNome,
    recursos: (Array.isArray(recursos) ? recursos : []).map((item) => {
      const linhaRecurso = item as {
        habilitado?: unknown;
        recursos_plataforma?: unknown;
      };
      const recurso = Array.isArray(linhaRecurso.recursos_plataforma)
        ? linhaRecurso.recursos_plataforma[0]
        : linhaRecurso.recursos_plataforma;
      return {
        chave: texto((recurso as { chave?: string } | null)?.chave),
        habilitado: Boolean(linhaRecurso.habilitado),
        ativo: Boolean((recurso as { ativo?: boolean } | null)?.ativo),
      };
    }),
    limites: (Array.isArray(limites) ? limites : []).map((item) => {
      const linhaLimite = item as { chave?: unknown; valor?: unknown };
      return {
        chave: texto(linhaLimite.chave),
        valor: linhaLimite.valor == null ? null : Number(linhaLimite.valor),
      };
    }),
  };
}

export const carregarEntitlementsEmpresa = cache(
  async (empresaId: string): Promise<EntitlementsEmpresa> => {
    return carregarEntitlementsComCliente(await createClient(), empresaId);
  }
);

export const carregarEntitlementsEmpresaServico = cache(
  async (empresaId: string): Promise<EntitlementsEmpresa> => {
    return carregarEntitlementsComCliente(createAdminClient(), empresaId);
  }
);

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
