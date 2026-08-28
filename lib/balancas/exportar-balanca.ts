import { exportarPorFabricante } from "./adapters";
import {
  departamentoEfetivoBalanca,
  departamentoPadraoDaConfiguracao,
} from "./departamento";
import {
  MENSAGEM_EXPORTACAO_COM_INVALIDOS,
  MENSAGEM_LAYOUT_NAO_IMPLEMENTADO,
  MENSAGEM_SEM_PRODUTOS_VALIDOS,
  type ConfiguracaoBalanca,
  type ProdutoCargaBalanca,
  type ProdutoVinculadoBalanca,
  type ResultadoExportacaoBalanca,
} from "./tipos";

export function montarCargaProdutosValidos(
  vinculados: ProdutoVinculadoBalanca[],
  departamentoPadrao: string | null = null
): ProdutoCargaBalanca[] {
  return vinculados
    .filter((item) => item.enviarBalanca && item.status === "pronto")
    .map((item) => ({
      plu: String(item.plu ?? "").trim(),
      codigoProduto: item.codigo,
      descricao: String(item.descricaoBalanca ?? item.nome).trim(),
      preco: Number(item.precoVenda),
      unidade: item.unidade,
      validadeDias: item.validadeEtiquetaDias,
      tara: item.taraPadrao,
      departamento: departamentoEfetivoBalanca(
        item.departamento,
        departamentoPadrao
      ).valor,
      mensagem: item.mensagem,
    }));
}

export function exportarBalanca(params: {
  config: ConfiguracaoBalanca;
  vinculados: ProdutoVinculadoBalanca[];
  somenteValidos: boolean;
}): ResultadoExportacaoBalanca {
  const daConfig = params.vinculados.filter((item) => item.enviarBalanca);
  const comErro = daConfig.some(
    (item) =>
      item.status !== "pronto" && item.status !== "nao_vinculado"
  );

  if (comErro && !params.somenteValidos) {
    return { ok: false, erro: MENSAGEM_EXPORTACAO_COM_INVALIDOS };
  }

  const produtos = montarCargaProdutosValidos(
    daConfig,
    departamentoPadraoDaConfiguracao(params.config)
  );
  if (produtos.length === 0) {
    return { ok: false, erro: MENSAGEM_SEM_PRODUTOS_VALIDOS };
  }

  const layout = String(params.config.layout ?? "").trim();
  if (!layout) {
    return { ok: false, erro: MENSAGEM_LAYOUT_NAO_IMPLEMENTADO };
  }

  return exportarPorFabricante(
    params.config.fabricante,
    layout,
    produtos
  );
}
