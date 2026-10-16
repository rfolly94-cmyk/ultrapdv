export const TOKEN_DIRETORIO_PRODUCAO = "producao";
export const TOKEN_DIRETORIO_SANDBOX = "sandbox";

export function tokenDiretorioBiblioteca(ambiente: string) {
  return ambiente === "producao" ? TOKEN_DIRETORIO_PRODUCAO : TOKEN_DIRETORIO_SANDBOX;
}

export function diretoriosRelativosBiblioteca() {
  return {
    sandbox: "bin/tef/TEF/PGWeb",
    producao: "C:/ProgramData/UltraPDV/TEF/Producao/PGWeb",
  };
}

export function pastaProducaoIsolada(sandbox: string, producao: string) {
  const origem = sandbox.trim().replaceAll("/", "\\").toLowerCase();
  const destino = producao.trim().replaceAll("/", "\\").toLowerCase();
  if (!origem || !destino || origem === destino) {
    return false;
  }
  return destino.endsWith("\\producao\\pgweb") && origem.endsWith("\\tef\\pgweb") && !destino.includes("\\tef\\pgweb");
}
