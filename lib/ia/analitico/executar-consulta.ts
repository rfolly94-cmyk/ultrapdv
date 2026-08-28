import type { ContextoFerramentaIa } from "../ferramentas/contexto";
import { aplicarContextoNaConsulta } from "./contexto-consulta";
import { carregarFontesAnaliticas } from "./fontes";
import { janelaComparacaoAnalitica, janelaConsultaAnalitica } from "./periodos";
import { calcularResultadoAnalitico } from "./resultados";
import { registrarObservabilidadeAnalitica } from "./observabilidade";
import type { ConsultaAnalitica, ContextoAnaliticoAssistente, ResultadoAnalitico } from "./tipos";

export { aplicarContextoNaConsulta } from "./contexto-consulta";

export async function executarConsultaAnalitica(params: {
  ctx: ContextoFerramentaIa;
  consulta: ConsultaAnalitica;
  contextoAnterior?: ContextoAnaliticoAssistente | null;
}): Promise<ResultadoAnalitico> {
  const inicio = Date.now();
  const consulta = aplicarContextoNaConsulta(
    params.consulta,
    params.contextoAnterior,
    params.ctx.empresaId
  );

  const janela = janelaConsultaAnalitica({
    periodo: consulta.periodo,
    de: consulta.de,
    ate: consulta.ate,
  });
  const janelaAnterior = consulta.comparacao
    ? janelaComparacaoAnalitica({
        periodo: consulta.periodo,
        de: consulta.de,
        ate: consulta.ate,
      })
    : null;

  const fontes = await carregarFontesAnaliticas({
    ctx: params.ctx,
    consulta,
    janela,
    janelaAnterior,
  });
  const resultado = calcularResultadoAnalitico(consulta, fontes);
  registrarObservabilidadeAnalitica({
    consulta,
    linhas: resultado.linhas.length,
    ms: Date.now() - inicio,
    usouIa: true,
  });
  return resultado;
}
