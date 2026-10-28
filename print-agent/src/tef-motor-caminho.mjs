export function resolverExecutavelMotor(candidatos, existe) {
  for (const candidato of candidatos) {
    if (typeof candidato === "string" && candidato && existe(candidato)) {
      return candidato;
    }
  }
  return null;
}

export function candidatosExecutavelMotor({ instalado, ambiente, repositorio }) {
  return [instalado, ambiente, repositorio];
}
