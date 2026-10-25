export function exigirBibliotecaSimulada(biblioteca) {
  if (biblioteca?.real === true) {
    throw new Error("A biblioteca real não pode ser carregada por este módulo.");
  }
}
