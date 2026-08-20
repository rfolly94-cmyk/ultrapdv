import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  ehContador,
} from "@/lib/contabilidade/acesso";
import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import { temAcessoModulo } from "@/lib/permissoes/tem-permissao";

export type EmpresaContabilidade = {
  empresaId: string;
  nome: string;
  cnpj: string | null;
  perfil: string;
  principal: boolean;
};

export type ContextoContabilidade = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  usuarioId: string;
  empresaId: string;
  perfil: string;
  empresaNome: string;
  empresaCnpj: string | null;
  fusoHorario: string;
  empresas: EmpresaContabilidade[];
  ehContador: boolean;
};

export async function obterContextoContabilidade(): Promise<ContextoContabilidade> {
  const supabase = await createClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();
  const usuarioId = claimsData?.claims?.sub;

  if (error || !usuarioId) {
    redirect("/login");
  }

  const { data: vinculos, error: vinculosError } = await supabase
    .from("usuarios_empresas")
    .select(`
      empresa_id,
      perfil,
      principal,
      ativo,
      empresas (
        nome_fantasia,
        cnpj
      )
    `)
    .eq("usuario_id", String(usuarioId))
    .eq("ativo", true);

  if (vinculosError || !vinculos?.length) {
    redirect("/onboarding");
  }

  const empresas: EmpresaContabilidade[] = vinculos.map((vinculo) => {
    const empresa = Array.isArray(vinculo.empresas)
      ? vinculo.empresas[0]
      : vinculo.empresas;

    return {
      empresaId: String(vinculo.empresa_id),
      nome: empresa?.nome_fantasia ?? "Empresa",
      cnpj: empresa?.cnpj ?? null,
      perfil: String(vinculo.perfil ?? "").toLowerCase(),
      principal: Boolean(vinculo.principal),
    };
  });

  const atual =
    empresas.find((item) => item.principal) ?? empresas[0];

  const sessao = await obterPermissoesSessao();
  if (!temAcessoModulo(sessao?.permissoes, "contabilidade")) {
    redirect("/painel");
  }

  const { data: fiscal } = await supabase
    .from("empresas_fiscal")
    .select("fuso_horario")
    .eq("empresa_id", atual.empresaId)
    .maybeSingle();

  return {
    supabase,
    usuarioId: String(usuarioId),
    empresaId: atual.empresaId,
    perfil: atual.perfil,
    empresaNome: atual.nome,
    empresaCnpj: atual.cnpj,
    fusoHorario: fiscal?.fuso_horario || "America/Sao_Paulo",
    empresas,
    ehContador: ehContador(atual.perfil),
  };
}
