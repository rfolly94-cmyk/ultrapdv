import type { ResultadoClassificacaoFiscal } from "./tipos";
import type { PropostaAtualizacaoFiscal } from "./tipos";

export function montarPropostasAtualizacaoFiscal(params: {
  empresaId: string;
  produtoId: string;
  classificacao: ResultadoClassificacaoFiscal;
  criadoEm?: string;
}): PropostaAtualizacaoFiscal[] {
  const criadoEm = params.criadoEm ?? new Date().toISOString();
  const versao = Object.entries(params.classificacao.versoes)
    .map(([fonte, valor]) => `${fonte}:${valor}`)
    .join(",") || "sem-versao";
  const fontes = params.classificacao.fontes.map(
    (item) => `${item.codigo}:${item.versao}`
  );

  return params.classificacao.diferencas
    .filter((item) => item.sugerido)
    .map((item) => ({
      empresaId: params.empresaId,
      produtoId: params.produtoId,
      campo: item.campo,
      atual: item.atual,
      sugerido: item.sugerido,
      confianca: params.classificacao.confianca,
      justificativa: params.classificacao.justificativa,
      fontes,
      versao,
      criadoEm,
    }));
}
