import type { ConsultaAnalitica, ContextoAnaliticoAssistente } from "./tipos";

export function aplicarContextoNaConsulta(
  consulta: ConsultaAnalitica,
  contextoAnterior: ContextoAnaliticoAssistente | null | undefined,
  empresaId: string
): ConsultaAnalitica {
  const proxima = { ...consulta, filtros: [...consulta.filtros] };
  if (!proxima.reutilizarContexto || !contextoAnterior) {
    return proxima;
  }
  if (contextoAnterior.empresaId !== empresaId) {
    proxima.reutilizarContexto = false;
    return proxima;
  }
  if (!contextoAnterior.entidadeIds.length) {
    return proxima;
  }
  const campo =
    contextoAnterior.entidadeTipo === "cliente"
      ? "cliente_id"
      : contextoAnterior.entidadeTipo === "produto"
        ? "produto_id"
        : "ids";
  proxima.filtros.push({
    campo,
    operador: "in",
    valor: contextoAnterior.entidadeIds,
  });
  proxima.periodo = contextoAnterior.periodo;
  return proxima;
}
