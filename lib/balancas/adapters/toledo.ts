import {
  MENSAGEM_LAYOUT_NAO_IMPLEMENTADO,
  type ProdutoCargaBalanca,
  type ResultadoExportacaoBalanca,
} from "../tipos";
import {
  LAYOUT_TOLEDO_MGV7,
  exportarToledoMgv7,
  layoutToledoMgv7Implementado,
} from "./toledo-mgv7";

export { LAYOUT_TOLEDO_MGV7, layoutToledoMgv7Implementado };

export function exportarToledo(
  layout: string,
  produtos: ProdutoCargaBalanca[]
): ResultadoExportacaoBalanca {
  if (layoutToledoMgv7Implementado(layout)) {
    return exportarToledoMgv7(produtos);
  }

  return { ok: false, erro: MENSAGEM_LAYOUT_NAO_IMPLEMENTADO };
}
