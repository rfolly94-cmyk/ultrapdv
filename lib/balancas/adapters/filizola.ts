import {
  MENSAGEM_LAYOUT_NAO_IMPLEMENTADO,
  type ProdutoCargaBalanca,
  type ResultadoExportacaoBalanca,
} from "../tipos";

export function exportarFilizola(
  layout: string,
  produtos: ProdutoCargaBalanca[]
): ResultadoExportacaoBalanca {
  void layout;
  void produtos;
  return { ok: false, erro: MENSAGEM_LAYOUT_NAO_IMPLEMENTADO };
}
