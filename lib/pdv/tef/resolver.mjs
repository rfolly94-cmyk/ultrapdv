import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = fileURLToPath(new URL("../../../", import.meta.url));

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const arquivo = path.join(raiz, specifier.slice(2));
    const comExtensao = existsSync(`${arquivo}.ts`)
      ? `${arquivo}.ts`
      : existsSync(`${arquivo}.tsx`)
        ? `${arquivo}.tsx`
        : arquivo;
    return nextResolve(pathToFileURL(comExtensao).href, context);
  }
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !path.extname(specifier)
  ) {
    const base = fileURLToPath(new URL(specifier, context.parentURL));
    if (existsSync(`${base}.ts`)) {
      return nextResolve(pathToFileURL(`${base}.ts`).href, context);
    }
    if (existsSync(path.join(base, "index.ts"))) {
      return nextResolve(pathToFileURL(path.join(base, "index.ts")).href, context);
    }
  }
  return nextResolve(specifier, context);
}
