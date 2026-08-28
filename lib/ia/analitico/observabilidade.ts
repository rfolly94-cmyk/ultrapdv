import type { ConsultaAnalitica } from "./tipos";

export function registrarObservabilidadeAnalitica(params: {
  consulta: ConsultaAnalitica;
  linhas: number;
  ms: number;
  usouIa: boolean;
}) {
  if (process.env.NODE_ENV !== "development") {
    return;
  }
  console.info(
    JSON.stringify({
      origem: "ia-analitico",
      plano: {
        metricas: params.consulta.metricas,
        dimensoes: params.consulta.dimensoes,
        periodo: params.consulta.periodo,
        comparacao: params.consulta.comparacao,
        limite: params.consulta.limite,
      },
      metricas: params.consulta.metricas,
      dimensoes: params.consulta.dimensoes,
      periodo: params.consulta.periodo,
      comparacao: params.consulta.comparacao,
      linhas: params.linhas,
      ms: params.ms,
      usouIa: params.usouIa,
    })
  );
}
