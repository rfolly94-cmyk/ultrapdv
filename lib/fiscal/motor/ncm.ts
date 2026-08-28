import { regraVigenteEm } from "@/lib/fiscal/base-oficial/tipos";

import { ncmOitoDigitos, type CandidatoNcm } from "./tipos";
import { pontuarCandidatoPorTokens, tokensBuscaFiscal } from "./texto";

export type RegraNcmLocal = {
  codigo: string;
  descricao: string | null;
  versao: string;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  ativo: boolean;
};

export function validarNcmVigente(params: {
  codigo: string | null | undefined;
  regras: RegraNcmLocal[];
  dataReferencia: string;
}): {
  status: "vigente" | "inexistente" | "extinto" | "formato_invalido" | "sem_base";
  regra: CandidatoNcm | null;
  motivo: string;
} {
  const codigo = ncmOitoDigitos(params.codigo);
  if (params.codigo && !codigo) {
    return {
      status: "formato_invalido",
      regra: null,
      motivo: "NCM precisa ter 8 dígitos.",
    };
  }
  if (!codigo) {
    return {
      status: "inexistente",
      regra: null,
      motivo: "NCM não informado.",
    };
  }
  if (params.regras.length === 0) {
    return {
      status: "sem_base",
      regra: null,
      motivo:
        "A base NCM oficial ainda não foi importada. O código não foi afirmado nem inventado.",
    };
  }
  const matches = params.regras.filter(
    (item) => item.codigo === codigo || item.codigo.replace(/\D/g, "") === codigo
  );
  if (matches.length === 0) {
    return {
      status: "inexistente",
      regra: null,
      motivo: `NCM ${codigo} não existe na base oficial carregada.`,
    };
  }
  const vigente = matches.find(
    (item) =>
      item.ativo &&
      regraVigenteEm(
        { vigenciaInicio: item.vigenciaInicio, vigenciaFim: item.vigenciaFim },
        params.dataReferencia
      )
  );
  if (!vigente) {
    return {
      status: "extinto",
      regra: null,
      motivo: `NCM ${codigo} existe, mas não está vigente em ${params.dataReferencia}.`,
    };
  }
  return {
    status: "vigente",
    regra: {
      codigo: vigente.codigo.replace(/\D/g, "").padStart(8, "0").slice(0, 8),
      descricao: vigente.descricao ?? "",
      vigenciaInicio: vigente.vigenciaInicio,
      vigenciaFim: vigente.vigenciaFim,
      versao: vigente.versao,
      pontuacao: 1,
    },
    motivo: `NCM ${codigo} vigente na versão ${vigente.versao}.`,
  };
}

export function pesquisarNcmLocal(params: {
  termos: string;
  regras: RegraNcmLocal[];
  dataReferencia: string;
  limite?: number;
}): CandidatoNcm[] {
  if (params.regras.length === 0) {
    return [];
  }
  const direto = ncmOitoDigitos(params.termos);
  if (direto) {
    const validacao = validarNcmVigente({
      codigo: direto,
      regras: params.regras,
      dataReferencia: params.dataReferencia,
    });
    return validacao.regra ? [validacao.regra] : [];
  }
  const tokens = tokensBuscaFiscal(params.termos);
  if (tokens.length === 0) {
    return [];
  }
  const limite = params.limite ?? 8;
  const ranqueados: CandidatoNcm[] = [];
  for (const regra of params.regras) {
    const codigo = regra.codigo.replace(/\D/g, "");
    if (codigo.length !== 8 || !regra.ativo) {
      continue;
    }
    if (
      !regraVigenteEm(
        { vigenciaInicio: regra.vigenciaInicio, vigenciaFim: regra.vigenciaFim },
        params.dataReferencia
      )
    ) {
      continue;
    }
    const pontuacao = pontuarCandidatoPorTokens(regra.descricao ?? "", tokens);
    if (pontuacao <= 0) {
      continue;
    }
    ranqueados.push({
      codigo,
      descricao: regra.descricao ?? "",
      vigenciaInicio: regra.vigenciaInicio,
      vigenciaFim: regra.vigenciaFim,
      versao: regra.versao,
      pontuacao,
    });
  }
  ranqueados.sort((a, b) => b.pontuacao - a.pontuacao);
  return ranqueados.slice(0, limite);
}
