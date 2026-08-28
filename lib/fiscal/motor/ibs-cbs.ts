import type { ClassificacaoIbsCbs, StatusMotorFiscal } from "./tipos";

export type CstIbsCbsCatalogo = {
  codigo: string;
  descricao: string | null;
  permiteNfe: boolean;
  permiteNfce: boolean;
  ativo: boolean;
};

export type CclassTribCatalogo = {
  codigo: string;
  cstCodigo: string;
  descricao: string | null;
  reducaoIbs: number;
  reducaoCbs: number;
  permiteNfe: boolean;
  permiteNfce: boolean;
  ativo: boolean;
};

export function validarCombinacaoIbsCbs(params: {
  cst: string | null | undefined;
  cClassTrib: string | null | undefined;
  csts: CstIbsCbsCatalogo[];
  classes: CclassTribCatalogo[];
  aliquotaIbsUf?: number | null;
  aliquotaCbs?: number | null;
  dataReferencia: string;
  ibsObrigatorio: boolean;
}): ClassificacaoIbsCbs {
  const cst = String(params.cst ?? "").trim();
  const cClass = String(params.cClassTrib ?? "").trim();

  if (!params.ibsObrigatorio && !cst && !cClass) {
    return {
      cst: null,
      cstDescricao: null,
      cClassTrib: null,
      cClassTribDescricao: null,
      combinacaoValida: null,
      reducaoIbs: null,
      reducaoCbs: null,
      impostoSeletivo: null,
      status: "ok",
      motivo:
        "IBS/CBS ainda não obrigatório neste CRT/data. Nada foi inventado.",
    };
  }

  if (params.csts.length === 0) {
    return vazio("sem_base", "Catálogo CST IBS/CBS não disponível neste ambiente.");
  }

  if (!cst) {
    return vazio(
      "informacao_insuficiente",
      "CST IBS/CBS não informado. Não é possível validar cClassTrib."
    );
  }

  const cstRow = params.csts.find((item) => item.codigo === cst && item.ativo);
  if (!cstRow) {
    return {
      ...vazio("provavel_divergencia", `CST IBS/CBS ${cst} inexistente ou inativo na tabela oficial.`),
      cst,
    };
  }

  if (!cClass) {
    return {
      cst,
      cstDescricao: cstRow.descricao,
      cClassTrib: null,
      cClassTribDescricao: null,
      combinacaoValida: false,
      reducaoIbs: null,
      reducaoCbs: null,
      impostoSeletivo: cst.startsWith("4") || cst === "410" ? null : false,
      status: "informacao_insuficiente",
      motivo: `CST ${cst} existe, mas falta cClassTrib compatível.`,
    };
  }

  const classe = params.classes.find(
    (item) => item.codigo === cClass && item.ativo
  );
  if (!classe) {
    return {
      cst,
      cstDescricao: cstRow.descricao,
      cClassTrib: cClass,
      cClassTribDescricao: null,
      combinacaoValida: false,
      reducaoIbs: null,
      reducaoCbs: null,
      impostoSeletivo: null,
      status: "provavel_divergencia",
      motivo: `cClassTrib ${cClass} inexistente ou inativo na tabela oficial.`,
    };
  }

  if (classe.cstCodigo !== cst) {
    return {
      cst,
      cstDescricao: cstRow.descricao,
      cClassTrib: cClass,
      cClassTribDescricao: classe.descricao,
      combinacaoValida: false,
      reducaoIbs: classe.reducaoIbs,
      reducaoCbs: classe.reducaoCbs,
      impostoSeletivo: null,
      status: "provavel_divergencia",
      motivo: `Combinação inválida: cClassTrib ${cClass} pertence ao CST ${classe.cstCodigo}, não ao ${cst}.`,
    };
  }

  const aliquotaAusente =
    params.aliquotaIbsUf == null && params.aliquotaCbs == null;
  if (aliquotaAusente && classe.reducaoIbs === 0 && classe.reducaoCbs === 0) {
    return {
      cst,
      cstDescricao: cstRow.descricao,
      cClassTrib: cClass,
      cClassTribDescricao: classe.descricao,
      combinacaoValida: true,
      reducaoIbs: classe.reducaoIbs,
      reducaoCbs: classe.reducaoCbs,
      impostoSeletivo: false,
      status: "aguardando_legislacao",
      motivo:
        "Combinação CST + cClassTrib válida. Alíquota regular IBS/CBS não está publicada nesta base; não foi inventada.",
    };
  }

  return {
    cst,
    cstDescricao: cstRow.descricao,
    cClassTrib: cClass,
    cClassTribDescricao: classe.descricao,
    combinacaoValida: true,
    reducaoIbs: classe.reducaoIbs,
    reducaoCbs: classe.reducaoCbs,
    impostoSeletivo: false,
    status: "ok",
    motivo: `Combinação CST ${cst} + cClassTrib ${cClass} válida na tabela oficial vigente em ${params.dataReferencia}.`,
  };
}

function vazio(status: StatusMotorFiscal, motivo: string): ClassificacaoIbsCbs {
  return {
    cst: null,
    cstDescricao: null,
    cClassTrib: null,
    cClassTribDescricao: null,
    combinacaoValida: null,
    reducaoIbs: null,
    reducaoCbs: null,
    impostoSeletivo: null,
    status,
    motivo,
  };
}
