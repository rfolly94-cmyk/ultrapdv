import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolverRaizAgente(
  metaUrl = import.meta.url,
  env = process.env
) {
  const informado = String(env.ULTRAPDV_INSTALL_DIR ?? "").trim();
  if (informado) {
    return path.resolve(informado);
  }

  const aqui = path.dirname(fileURLToPath(metaUrl));
  const pasta = path.basename(aqui);
  if (pasta === "src" || pasta === "app") {
    return path.resolve(aqui, "..");
  }
  return aqui;
}

export function pastaDados(raiz) {
  return path.join(raiz, "data");
}
