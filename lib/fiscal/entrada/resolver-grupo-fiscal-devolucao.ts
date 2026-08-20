import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";

export const COLUNAS_GRUPO_FISCAL_DEVOLUCAO =
  "id, empresa_id, nome, icms_cst_csosn, cst_ibscbs, classificacao_ibscbs, aliquota_ibs_uf, aliquota_ibs_municipio, aliquota_cbs";

export type GrupoFiscalDevolucao = {
  id: string;
  empresa_id: string;
  nome?: string | null;
  icms_cst_csosn?: string | null;
  cst_ibscbs?: string | null;
  classificacao_ibscbs?: string | null;
  aliquota_ibs_uf?: number | string | null;
  aliquota_ibs_municipio?: number | string | null;
  aliquota_cbs?: number | string | null;
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

export function snapshotFiscalDevolucaoCongelado(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return false;
  }

  const registro = snapshot as Record<string, unknown>;
  const icms = texto(registro.icms_resolvido).replace(/\D/g, "");
  const cfop = texto(registro.cfop).replace(/\D/g, "");
  return icms.length > 0 || /^\d{4}$/.test(cfop);
}

export function grupoFiscalIdParaDevolucaoFornecedor(params: {
  empresaIdAtiva: string;
  snapshotFiscal?: unknown;
  grupoFiscalIdItemDevolucao?: string | null;
  produtoEmpresaId?: string | null;
  produtoGrupoFiscalId?: string | null;
}): {
  grupoFiscalId: string | null;
  origem: "snapshot" | "produto";
} {
  if (snapshotFiscalDevolucaoCongelado(params.snapshotFiscal)) {
    return {
      grupoFiscalId: texto(params.grupoFiscalIdItemDevolucao) || null,
      origem: "snapshot",
    };
  }

  const empresaId = texto(params.empresaIdAtiva);
  const produtoEmpresaId = texto(params.produtoEmpresaId);
  if (
    empresaId &&
    produtoEmpresaId &&
    !registroPertenceAEmpresaAtiva(
      { empresa_id: produtoEmpresaId },
      empresaId
    )
  ) {
    return { grupoFiscalId: null, origem: "produto" };
  }

  return {
    grupoFiscalId: texto(params.produtoGrupoFiscalId) || null,
    origem: "produto",
  };
}

export function grupoFiscalDaEmpresaAtiva(
  grupo:
    | GrupoFiscalDevolucao
    | null
    | undefined,
  empresaIdAtiva: string
) {
  if (!grupo || !registroPertenceAEmpresaAtiva(grupo, empresaIdAtiva)) {
    return null;
  }
  return grupo;
}
