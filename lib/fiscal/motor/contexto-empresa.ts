import type { SupabaseClient } from "@supabase/supabase-js";

import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { lerCodigoRegimeTributario } from "@/lib/fiscal/geranet/resolver-icms-geranet";

import type { ContextoFiscalEmpresa } from "./tipos";

const ROTULO_CRT: Record<1 | 2 | 3 | 4, string> = {
  1: "Simples Nacional",
  2: "Simples Nacional — excesso de sublimite da receita bruta",
  3: "Regime Normal",
  4: "MEI — Simples Nacional",
};

export function rotuloCrt(crt: 1 | 2 | 3 | 4 | null) {
  return crt ? ROTULO_CRT[crt] : null;
}

export async function montarContextoFiscalEmpresa(params: {
  supabase: SupabaseClient;
  empresaId: string;
}): Promise<ContextoFiscalEmpresa> {
  const faltantes: string[] = [];
  const { data: empresaBruto } = await params.supabase
    .from("empresas")
    .select("id, cnpj, razao_social, nome_fantasia")
    .eq("id", params.empresaId)
    .maybeSingle();
  const empresa =
    empresaBruto && String(empresaBruto.id) === params.empresaId
      ? empresaBruto
      : null;

  const { data: fiscalBruto } = await params.supabase
    .from("empresas_fiscal")
    .select(
      "empresa_id, codigo_regime_tributario, uf, municipio, inscricao_estadual, ambiente"
    )
    .eq("empresa_id", params.empresaId)
    .maybeSingle();
  const fiscal = registroPertenceAEmpresaAtiva(fiscalBruto, params.empresaId)
    ? fiscalBruto
    : null;

  let crt: 1 | 2 | 3 | 4 | null = null;
  try {
    crt = fiscal?.codigo_regime_tributario
      ? lerCodigoRegimeTributario(fiscal.codigo_regime_tributario)
      : null;
  } catch {
    crt = null;
  }

  const cnpj = empresa?.cnpj ? String(empresa.cnpj) : null;
  const uf = fiscal?.uf ? String(fiscal.uf).toUpperCase() : null;
  const municipio = fiscal?.municipio ? String(fiscal.municipio) : null;
  const ie = fiscal?.inscricao_estadual
    ? String(fiscal.inscricao_estadual)
    : null;
  const ambiente = fiscal?.ambiente ? String(fiscal.ambiente) : null;

  if (!crt) {
    faltantes.push("CRT/regime tributário não cadastrado em empresas_fiscal.");
  }
  if (!uf) {
    faltantes.push("UF da empresa não cadastrada.");
  }
  if (!cnpj) {
    faltantes.push("CNPJ da empresa não cadastrado.");
  }

  return {
    empresaId: params.empresaId,
    cnpj,
    razaoSocial: empresa?.razao_social
      ? String(empresa.razao_social)
      : empresa?.nome_fantasia
        ? String(empresa.nome_fantasia)
        : null,
    crt,
    regimeTributario: rotuloCrt(crt),
    uf,
    municipio,
    inscricaoEstadual: ie,
    contribuinteIcms: ie ? true : null,
    ambiente,
    incompleto: faltantes.length > 0,
    faltantes,
  };
}
