import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");

export function fonte(...partes: string[]) {
  return readFileSync(join(raiz, ...partes), "utf8");
}
