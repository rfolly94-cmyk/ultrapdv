import { redirect } from "next/navigation";

import { buscarVinculoEmpresaAtiva } from "@/lib/empresa/empresa-ativa";
import { createClient } from "@/lib/supabase/server";
import {
  ABAS_RELATORIO,
  TAMANHOS_PAGINA,
  type AbaRelatorio,
  type FiltrosRelatorio,
} from "./tipos";
import { periodoRelatorioValido } from "./periodo";

export async function obterContextoRelatorio() {
  const supabase = await createClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();

  if (error || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: vinculo } = await buscarVinculoEmpresaAtiva<{
    empresa_id: string;
    empresas:
      | { nome_fantasia?: string | null; razao_social?: string | null }
      | Array<{ nome_fantasia?: string | null; razao_social?: string | null }>
      | null;
  }>(
    supabase,
    claimsData.claims.sub,
    "empresa_id, empresas ( nome_fantasia, razao_social )"
  );

  if (!vinculo) {
    redirect("/onboarding");
  }

  const empresa = Array.isArray(vinculo.empresas)
    ? vinculo.empresas[0]
    : vinculo.empresas;

  return {
    supabase,
    usuarioId: String(claimsData.claims.sub),
    empresaId: String(vinculo.empresa_id),
    empresaNome:
      empresa?.nome_fantasia || empresa?.razao_social || "Empresa",
  };
}

export function parseFiltrosRelatorio(
  params: Record<string, string | string[] | undefined>
): FiltrosRelatorio {
  const valor = (chave: string) => {
    const atual = params[chave];
    return Array.isArray(atual) ? atual[0] ?? "" : atual ?? "";
  };

  const abaBruta = valor("aba");
  const exportar = valor("exportar") === "1";
  const porPaginaBruto = Number(valor("por_pagina") || 50);
  const pagina = Number(valor("pagina") || 1);
  const porPagina = exportar
    ? 10000
    : TAMANHOS_PAGINA.includes(porPaginaBruto as 25 | 50 | 100)
      ? porPaginaBruto
      : 50;

  return {
    aba: ABAS_RELATORIO.includes(abaBruta as AbaRelatorio)
      ? (abaBruta as AbaRelatorio)
      : "vendas",
    periodo: periodoRelatorioValido(valor("periodo")),
    de: valor("de") || null,
    ate: valor("ate") || null,
    q: valor("q").trim(),
    status: valor("status"),
    clienteId: valor("cliente"),
    vendedorId: valor("vendedor"),
    formaId: valor("forma"),
    categoriaId: valor("categoria"),
    marcaId: valor("marca"),
    situacao: valor("situacao") || "todos",
    subaba: valor("subaba"),
    ordenacao: valor("ordenacao"),
    modelo: valor("modelo"),
    semComprar: valor("sem_comprar"),
    pagina: exportar
      ? 1
      : Number.isFinite(pagina) && pagina > 0
        ? Math.floor(pagina)
        : 1,
    porPagina,
  };
}

export async function buscarEmLotes<T>(
  ids: string[],
  buscar: (fatia: string[]) => Promise<T[]>,
  tamanho = 200
) {
  const saida: T[] = [];
  for (let i = 0; i < ids.length; i += tamanho) {
    saida.push(...(await buscar(ids.slice(i, i + tamanho))));
  }
  return saida;
}
