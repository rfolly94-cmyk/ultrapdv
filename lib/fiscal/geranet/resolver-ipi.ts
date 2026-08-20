import {
  camposIpiDoGrupo,
  cstIpiSaidaValido,
  cstIpiTributado,
  normalizarCenqInformado,
  numeroIpi,
  parsePerfilIpi,
  validarCenqIpi,
  type ConfiguracaoIpiGrupo,
  type ModeloDocumentoFiscal,
  type PerfilIpi,
} from "@/lib/fiscal/ipi";

export type CamposIpiGeranet = {
  ipiCst: string;
  ipiEnquadramento: string;
  ipiManual: "0";
  ipiAliquota?: string;
};

export type ResolverIpiGeranetInput = {
  modelo: ModeloDocumentoFiscal;
  perfilIpi: PerfilIpi | null;
  grupo: ConfiguracaoIpiGrupo;
};

export {
  camposIpiDoGrupo,
  parsePerfilIpi,
};

export function itemTemChaveIpi(
  item: Record<string, unknown>
) {
  return Object.keys(item).some((chave) =>
    chave.toLowerCase().startsWith("ipi")
  );
}

export function resolverIpiGeranet(
  input: ResolverIpiGeranetInput
): CamposIpiGeranet | Record<string, never> {
  if (input.modelo === "65") {
    return {};
  }

  if (input.modelo !== "55") {
    return {};
  }

  if (!input.perfilIpi) {
    throw new Error(
      "Configure o perfil perante o IPI em Configurações fiscais antes de emitir NF-e. Esta informação não é deduzida do CRT."
    );
  }

  if (input.perfilIpi === "NAO_CONTRIBUINTE") {
    return {};
  }

  if (
    input.perfilIpi !== "INDUSTRIAL" &&
    input.perfilIpi !== "EQUIPARADO_INDUSTRIAL"
  ) {
    return {};
  }

  if (!input.grupo.ipiAplicavel) {
    return {};
  }

  const cst = String(input.grupo.ipiCst ?? "").trim();

  if (!cstIpiSaidaValido(cst)) {
    throw new Error(
      "O grupo fiscal aplica IPI, mas o CST de saída é inválido. Use 50, 51, 52, 53, 54, 55 ou 99."
    );
  }

  const cenq = normalizarCenqInformado(
    input.grupo.ipiEnquadramento
  );
  const erroCenq = validarCenqIpi(cenq, cst);

  if (erroCenq) {
    throw new Error(erroCenq);
  }

  const base: CamposIpiGeranet = {
    ipiCst: cst,
    ipiEnquadramento: cenq,
    ipiManual: "0",
  };

  if (!cstIpiTributado(cst)) {
    return base;
  }

  const aliquota = numeroIpi(input.grupo.ipiAliquota);

  if (aliquota === null || aliquota < 0 || aliquota > 100) {
    throw new Error(
      "O grupo fiscal aplica IPI tributado, mas a alíquota é inválida."
    );
  }

  if (cst === "50" && aliquota <= 0) {
    throw new Error(
      "CST IPI 50 exige alíquota maior que zero."
    );
  }

  return {
    ...base,
    ipiAliquota: aliquota.toFixed(4),
  };
}
