import { exportarFilizola } from "./filizola";
import { exportarToledo, layoutToledoMgv7Implementado } from "./toledo";
import { exportarUrano } from "./urano";
import {
  MENSAGEM_LAYOUT_NAO_IMPLEMENTADO,
  type FabricanteBalanca,
  type ProdutoCargaBalanca,
  type ResultadoExportacaoBalanca,
} from "../tipos";

export function layoutExportacaoImplementado(
  fabricante: FabricanteBalanca,
  layout: string | null | undefined
) {
  const id = String(layout ?? "").trim();
  if (fabricante === "toledo") {
    return layoutToledoMgv7Implementado(id);
  }
  return false;
}

export function exportarPorFabricante(
  fabricante: FabricanteBalanca,
  layout: string,
  produtos: ProdutoCargaBalanca[]
): ResultadoExportacaoBalanca {
  if (fabricante === "toledo") {
    return exportarToledo(layout, produtos);
  }
  if (fabricante === "urano") {
    return exportarUrano(layout, produtos);
  }
  if (fabricante === "filizola") {
    return exportarFilizola(layout, produtos);
  }

  return { ok: false, erro: MENSAGEM_LAYOUT_NAO_IMPLEMENTADO };
}
