export type FonteFiscalOficial = {
  codigo: string;
  nome: string;
  origem: string;
  versao: string;
  status: "ativa" | "pendente" | "descontinuada";
  vigenciaInicio: string;
  vigenciaFim: string | null;
};

export type RegraFiscalOficial = {
  tipo: string;
  codigo: string;
  descricao: string | null;
  payload: Record<string, unknown>;
  fonte: string;
  versao: string;
  vigenciaInicio: string;
  vigenciaFim: string | null;
};

export function regraVigenteEm(
  regra: Pick<RegraFiscalOficial, "vigenciaInicio" | "vigenciaFim">,
  referenciaIso: string
) {
  const dia = String(referenciaIso).slice(0, 10);
  if (dia < regra.vigenciaInicio) {
    return false;
  }
  if (regra.vigenciaFim && dia > regra.vigenciaFim) {
    return false;
  }
  return true;
}
