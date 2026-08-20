export function contarConfirmacaoProprietarios(
  idsDonos: Array<string | null | undefined>,
  confirmado: (id: string) => boolean
) {
  let proprietariosConfirmados = 0;
  let proprietariosPendentes = 0;

  for (const id of idsDonos) {
    if (!id) {
      continue;
    }
    if (confirmado(id)) {
      proprietariosConfirmados += 1;
    } else {
      proprietariosPendentes += 1;
    }
  }

  return {
    proprietariosConfirmados,
    proprietariosPendentes,
  };
}
