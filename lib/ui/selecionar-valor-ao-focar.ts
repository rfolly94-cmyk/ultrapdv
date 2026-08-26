import type { FocusEvent, MouseEvent } from "react";

type CampoSelecionavel = HTMLInputElement | HTMLTextAreaElement;

const selecaoPendentePorClique = new WeakSet<HTMLElement>();

function selecionarSeAindaFocado(campo: CampoSelecionavel) {
  if (typeof document === "undefined") {
    return;
  }
  if (document.activeElement !== campo) {
    return;
  }
  if (typeof campo.select !== "function") {
    return;
  }
  campo.select();
}

/**
 * No mousedown, marca seleção total só se o campo ainda não estava focado.
 * Assim o segundo clique (já focado) continua permitindo mover o cursor.
 */
export function marcarSelecaoValorSeCliqueInicial(
  event: MouseEvent<CampoSelecionavel>
) {
  const campo = event.currentTarget;
  if (typeof document === "undefined") {
    return;
  }
  if (document.activeElement !== campo) {
    selecaoPendentePorClique.add(campo);
  }
}

/**
 * Impede o mouseup do primeiro clique de desfazer a seleção total.
 */
export function consumirSelecaoValorPendente(
  event: MouseEvent<CampoSelecionavel>
) {
  const campo = event.currentTarget;
  if (!selecaoPendentePorClique.has(campo)) {
    return;
  }
  selecaoPendentePorClique.delete(campo);
  event.preventDefault();
  if (typeof campo.select === "function") {
    campo.select();
  }
}

/**
 * Seleciona todo o conteúdo ao focar um campo de valor (clique ou Tab).
 * Não usar em busca, CPF/CNPJ, telefone, código de barras, data ou texto livre.
 */
export function selecionarValorAoFocar(
  event: FocusEvent<CampoSelecionavel>
) {
  const campo = event.currentTarget;
  if (campo.disabled) {
    return;
  }

  selecionarSeAindaFocado(campo);
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => selecionarSeAindaFocado(campo));
  }
  setTimeout(() => selecionarSeAindaFocado(campo), 0);
}
