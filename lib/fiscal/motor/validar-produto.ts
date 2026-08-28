import type { ResultadoClassificacaoFiscal } from "./tipos";
import type { ResultadoValidacaoProduto } from "./tipos";

export function validarFiscalProdutoResultado(
  classificacao: ResultadoClassificacaoFiscal
): ResultadoValidacaoProduto {
  if (
    classificacao.status === "informacao_insuficiente" ||
    classificacao.status === "contexto_incompleto" ||
    classificacao.status === "sem_base"
  ) {
    return { status: "informacao_insuficiente", classificacao };
  }

  const divergenciasFortes = classificacao.diferencas.filter((item) =>
    ["ncm", "cest", "origem"].includes(item.campo)
  );
  if (
    classificacao.status === "provavel_divergencia" &&
    classificacao.confianca === "alta"
  ) {
    return { status: "provavel_divergencia", classificacao };
  }
  if (divergenciasFortes.length > 0 && classificacao.confianca === "alta") {
    return { status: "provavel_divergencia", classificacao };
  }
  if (
    classificacao.status === "atencao" ||
    classificacao.status === "aguardando_legislacao" ||
    classificacao.confianca === "media" ||
    classificacao.diferencas.length > 0
  ) {
    return { status: "atencao", classificacao };
  }
  return { status: "correto", classificacao };
}
