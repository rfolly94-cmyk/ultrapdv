export function campoEmv(id: string, valor: string) {
  if (!/^\d{2}$/.test(id)) {
    throw new Error("ID EMV inválido.");
  }

  const tamanho = String(valor.length).padStart(2, "0");
  if (tamanho.length !== 2) {
    throw new Error("Campo EMV excede 99 caracteres.");
  }

  return `${id}${tamanho}${valor}`;
}
