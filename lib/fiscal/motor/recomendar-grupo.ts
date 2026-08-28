import type { GrupoFiscalResumo } from "@/lib/fiscal/status-fiscal-produto";

import { validarCstCsosn } from "./cst";
import type { ClassificacaoIbsCbs, ConfiancaMotor } from "./tipos";

export const MENSAGEM_NENHUM_GRUPO_COMPATIVEL =
  "Nenhum grupo fiscal existente possui compatibilidade suficiente com esta classificação.";

export type GrupoParaRecomendacao = GrupoFiscalResumo & {
  empresa_id?: string;
};

export function recomendarGrupoFiscalExistente(params: {
  empresaId: string;
  grupos: GrupoParaRecomendacao[];
  crt: 1 | 2 | 3 | 4 | null;
  origem: string | null;
  ncm: string | null;
  cest: string | null;
  ibsCbs: ClassificacaoIbsCbs;
}): {
  recomendado: {
    id: string;
    nome: string;
    compatibilidade: "alta" | "media";
    motivos: string[];
    diferencas: string[];
  } | null;
  mensagem: string | null;
  confianca: ConfiancaMotor;
} {
  const daEmpresa = params.grupos.filter(
    (grupo) =>
      grupo.ativo &&
      (!grupo.empresa_id || grupo.empresa_id === params.empresaId)
  );
  if (daEmpresa.length === 0) {
    return {
      recomendado: null,
      mensagem: MENSAGEM_NENHUM_GRUPO_COMPATIVEL,
      confianca: "nenhuma",
    };
  }

  const ranqueados = daEmpresa
    .map((grupo) => pontuarGrupo(grupo, params))
    .filter((item) => item.pontos >= 4)
    .sort((a, b) => b.pontos - a.pontos);

  const melhor = ranqueados[0];
  if (!melhor) {
    return {
      recomendado: null,
      mensagem: MENSAGEM_NENHUM_GRUPO_COMPATIVEL,
      confianca: "nenhuma",
    };
  }

  const segundo = ranqueados[1];
  if (segundo && melhor.pontos - segundo.pontos < 1 && melhor.pontos < 6) {
    return {
      recomendado: null,
      mensagem: MENSAGEM_NENHUM_GRUPO_COMPATIVEL,
      confianca: "baixa",
    };
  }

  return {
    recomendado: {
      id: melhor.grupo.id,
      nome: melhor.grupo.nome,
      compatibilidade: melhor.pontos >= 6 ? "alta" : "media",
      motivos: melhor.motivos,
      diferencas: melhor.diferencas,
    },
    mensagem: null,
    confianca: melhor.pontos >= 6 ? "alta" : "media",
  };
}

function pontuarGrupo(
  grupo: GrupoParaRecomendacao,
  params: {
    crt: 1 | 2 | 3 | 4 | null;
    origem: string | null;
    ncm: string | null;
    cest: string | null;
    ibsCbs: ClassificacaoIbsCbs;
    empresaId: string;
  }
) {
  const motivos: string[] = [];
  const diferencas: string[] = [];
  let pontos = 0;

  const icms = validarCstCsosn({
    crt: params.crt,
    codigo: grupo.icms_cst_csosn,
  });
  if (icms.ok) {
    pontos += 2;
    motivos.push("CSOSN/CST compatível com o CRT da empresa");
  } else {
    diferencas.push(icms.motivo);
  }

  if (grupo.pis_cst && grupo.cofins_cst) {
    pontos += 1;
    motivos.push("PIS/COFINS preenchidos");
  } else {
    diferencas.push("PIS/COFINS incompletos no grupo");
  }

  if (params.ibsCbs.cst && grupo.cst_ibscbs === params.ibsCbs.cst) {
    pontos += 2;
    motivos.push("CST IBS/CBS compatível");
  } else if (params.ibsCbs.cst) {
    diferencas.push("CST IBS/CBS diferente");
  }

  if (
    params.ibsCbs.cClassTrib &&
    grupo.classificacao_ibscbs === params.ibsCbs.cClassTrib
  ) {
    pontos += 2;
    motivos.push("cClassTrib compatível");
  } else if (params.ibsCbs.cClassTrib) {
    diferencas.push("cClassTrib diferente");
  }

  if (params.cest) {
    diferencas.push(
      "CEST pertence ao produto, não ao grupo. CEST não implica ST automática."
    );
  }
  if (params.origem) {
    diferencas.push("Origem da mercadoria é do produto, não do grupo.");
  }
  if (params.ncm) {
    motivos.push("NCM é do produto; o grupo não armazena NCM.");
  }

  return { grupo, pontos, motivos, diferencas };
}
