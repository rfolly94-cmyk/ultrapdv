import "server-only";

import type { createClient } from "@/lib/supabase/server";

import type { RelatorioCaixaEmpresa } from "./relatorio";

type SupabaseServidor = Awaited<ReturnType<typeof createClient>>;

export async function carregarEmpresaRelatorioCaixa(input: {
  supabase: SupabaseServidor;
  empresaId: string;
}): Promise<RelatorioCaixaEmpresa | null> {
  const { data } = await input.supabase
    .from("empresas")
    .select("id, razao_social, nome_fantasia, cnpj")
    .eq("id", input.empresaId)
    .maybeSingle();

  if (!data || String((data as { id?: unknown }).id) !== input.empresaId) {
    return null;
  }

  const razao = String((data as { razao_social?: unknown }).razao_social ?? "").trim();
  const fantasia = String((data as { nome_fantasia?: unknown }).nome_fantasia ?? "").trim();

  return {
    razaoSocial: razao || fantasia || "Empresa",
    nomeFantasia: fantasia || null,
    cnpj: String((data as { cnpj?: unknown }).cnpj ?? "").trim(),
    logoUrl: null,
    filialNome: null,
  };
}
