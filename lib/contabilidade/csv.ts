export function csvLinha(valores: Array<string | number | null | undefined>) {
  return valores
    .map((valor) => {
      const texto = valor == null ? "" : String(valor);
      if (/[;"\n]/.test(texto)) {
        return `"${texto.replace(/"/g, '""')}"`;
      }
      return texto;
    })
    .join(";");
}

export function csvDocumento(linhas: string[][]) {
  return `\uFEFF${linhas.map((linha) => csvLinha(linha)).join("\r\n")}`;
}
