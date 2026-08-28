export const URL_NCM_CLASSIF_OFICIAL =
  "https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json";

export const FONTE_NCM = "ncm_oficial";
export const FONTE_CEST = "cest_oficial";
export const FONTE_CST_IBS = "cst_ibscbs_catalogo";
export const FONTE_CCLASS = "cclasstrib_catalogo";

export function urlCestOficialConfigurada() {
  const env = process.env.ULTRAPDV_FISCAL_CEST_URL?.trim();
  return env || null;
}
