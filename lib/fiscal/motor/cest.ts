import { regraVigenteEm } from "@/lib/fiscal/base-oficial/tipos";

import { cestSeteDigitos, ncmOitoDigitos, type CandidatoCest } from "./tipos";
import { pontuarCandidatoPorTokens, tokensBuscaFiscal } from "./texto";

export type RegraCestLocal = {
  codigo: string;
  descricao: string | null;
  ncm: string | null;
  segmento: string | null;
  versao: string;
  vigenciaInicio: string;
  vigenciaFim: string | null;
  ativo: boolean;
};

export function validarCest(params: {
  cest: string | null | undefined;
  ncm: string | null | undefined;
  descricao?: string | null;
  regras: RegraCestLocal[];
  dataReferencia: string;
}): {
  status:
    | "compativel"
    | "incompativel"
    | "multiplos"
    | "sem_cest"
    | "inexistente"
    | "sem_base";
  candidatos: CandidatoCest[];
  motivo: string;
  produtoPossuiCest: boolean;
} {
  if (params.regras.length === 0) {
    return {
      status: "sem_base",
      candidatos: [],
      motivo:
        "A base CEST oficial ainda não foi importada. Nenhum CEST foi afirmado.",
      produtoPossuiCest: false,
    };
  }

  const ncm = ncmOitoDigitos(params.ncm);
  const vigentes = params.regras.filter(
    (item) =>
      item.ativo &&
      regraVigenteEm(
        { vigenciaInicio: item.vigenciaInicio, vigenciaFim: item.vigenciaFim },
        params.dataReferencia
      )
  );

  const cestInformado = cestSeteDigitos(params.cest);
  if (cestInformado) {
    const match = vigentes.filter(
      (item) => item.codigo.replace(/\D/g, "") === cestInformado
    );
    if (match.length === 0) {
      return {
        status: "inexistente",
        candidatos: [],
        motivo: `CEST ${cestInformado} não existe na base oficial vigente.`,
        produtoPossuiCest: false,
      };
    }
    const comNcm = ncm
      ? match.filter((item) => !item.ncm || item.ncm.replace(/\D/g, "") === ncm)
      : match;
    if (ncm && comNcm.length === 0) {
      return {
        status: "incompativel",
        candidatos: match.map(mapear),
        motivo: `CEST ${cestInformado} existe, mas não é compatível com o NCM ${ncm} na regra vigente.`,
        produtoPossuiCest: true,
      };
    }
    return {
      status: "compativel",
      candidatos: (comNcm.length ? comNcm : match).map(mapear),
      motivo: `CEST ${cestInformado} encontrado na base oficial. Isso não implica substituição tributária na operação.`,
      produtoPossuiCest: true,
    };
  }

  if (!ncm) {
    return {
      status: "sem_cest",
      candidatos: [],
      motivo: "Sem NCM vigente não é possível sugerir CEST.",
      produtoPossuiCest: false,
    };
  }

  const porNcm = vigentes.filter(
    (item) => item.ncm && item.ncm.replace(/\D/g, "") === ncm
  );
  if (porNcm.length === 0) {
    return {
      status: "sem_cest",
      candidatos: [],
      motivo: `Nenhum CEST vigente associado ao NCM ${ncm}. O produto pode não possuir CEST.`,
      produtoPossuiCest: false,
    };
  }

  const tokens = tokensBuscaFiscal(params.descricao);
  const ranqueados = porNcm
    .map((item) => ({
      item,
      pontos: tokens.length
        ? pontuarCandidatoPorTokens(item.descricao ?? "", tokens)
        : 0,
    }))
    .sort((a, b) => b.pontos - a.pontos);

  if (ranqueados.length > 1 && (ranqueados[0]?.pontos ?? 0) < 0.5) {
    return {
      status: "multiplos",
      candidatos: ranqueados.map((item) => mapear(item.item)),
      motivo: `O NCM ${ncm} possui ${porNcm.length} CEST. Informe segmento/mercadoria para distinguir. CEST não implica ST.`,
      produtoPossuiCest: true,
    };
  }

  return {
    status: ranqueados.length === 1 ? "compativel" : "multiplos",
    candidatos: ranqueados.map((item) => mapear(item.item)),
    motivo:
      ranqueados.length === 1
        ? `CEST ${ranqueados[0]?.item.codigo} compatível com o NCM ${ncm}. Não implica ST automática.`
        : `Há mais de um CEST para o NCM ${ncm}.`,
    produtoPossuiCest: true,
  };
}

function mapear(item: RegraCestLocal): CandidatoCest {
  return {
    codigo: item.codigo.replace(/\D/g, "").padStart(7, "0").slice(0, 7),
    descricao: item.descricao ?? "",
    ncm: item.ncm,
    segmento: item.segmento,
    versao: item.versao,
  };
}
