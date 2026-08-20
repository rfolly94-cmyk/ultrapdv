export type GrupoFiscalResumo = {
  id: string;
  nome: string;
  ativo: boolean;
  cfop_interno: string | null;
  cfop_interestadual: string | null;
  icms_cst_csosn: string | null;
  icms_aliquota: number | string | null;
  pis_cst: string | null;
  pis_aliquota: number | string | null;
  cofins_cst: string | null;
  cofins_aliquota: number | string | null;
  ipi_aplicavel?: boolean | null;
  ipi_cst: string | null;
  ipi_aliquota: number | string | null;
  ipi_enquadramento?: string | null;
  cst_ibscbs: string | null;
  classificacao_ibscbs: string | null;
  aliquota_ibs_uf: number | string | null;
  aliquota_ibs_municipio: number | string | null;
  aliquota_cbs: number | string | null;
};

export type StatusFiscalProduto = {
  ok: boolean;
  rotulo: "Fiscal OK" | "Fiscal pendente";
  motivo: string | null;
  motivos: string[];
};

export function somenteDigitos(
  valor: string | null | undefined
) {
  return String(valor ?? "").replace(/\D/g, "");
}

export function ncmValido(
  ncm: string | null | undefined
) {
  return somenteDigitos(ncm).length === 8;
}

export function grupoFiscalMinimoParaEmissao(
  grupo: GrupoFiscalResumo | null | undefined
) {
  if (!grupo || !grupo.ativo) {
    return false;
  }

  return Boolean(
    grupo.cfop_interno &&
      grupo.icms_cst_csosn &&
      grupo.pis_cst &&
      grupo.cofins_cst
  );
}

export function avaliarStatusFiscalProduto(input: {
  ncm: string | null | undefined;
  grupo: GrupoFiscalResumo | null | undefined;
}): StatusFiscalProduto {
  const motivos: string[] = [];
  const ncmDigitos = somenteDigitos(input.ncm);

  if (!ncmValido(input.ncm)) {
    motivos.push(
      ncmDigitos.length === 0
        ? "NCM não informado"
        : "NCM inválido (precisa ter 8 dígitos)."
    );
  }

  if (!input.grupo) {
    motivos.push("Grupo fiscal não informado");
  } else {
    if (!input.grupo.ativo) {
      motivos.push("O grupo fiscal selecionado está inativo.");
    }

    if (!input.grupo.cfop_interno) {
      motivos.push("Grupo fiscal sem CFOP");
    }

    if (!input.grupo.icms_cst_csosn) {
      motivos.push("ICMS não configurado");
    }

    if (!input.grupo.pis_cst) {
      motivos.push("PIS não configurado");
    }

    if (!input.grupo.cofins_cst) {
      motivos.push("COFINS não configurado");
    }
  }

  if (motivos.length > 0) {
    return {
      ok: false,
      rotulo: "Fiscal pendente",
      motivo: motivos[0] ?? null,
      motivos,
    };
  }

  return {
    ok: true,
    rotulo: "Fiscal OK",
    motivo: null,
    motivos: [],
  };
}
