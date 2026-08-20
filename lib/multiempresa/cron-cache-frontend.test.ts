import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { chaveCarrinho } from "@/lib/catalogo/carrinho";

import { fonte } from "./fonte";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");

function arquivosTs(dir: string): string[] {
  const encontrados: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const caminho = join(dir, entrada);
    const info = statSync(caminho);
    if (info.isDirectory()) {
      if (entrada === "node_modules" || entrada === ".next") continue;
      encontrados.push(...arquivosTs(caminho));
      continue;
    }
    if (entrada.endsWith(".ts") || entrada.endsWith(".tsx")) {
      encontrados.push(caminho);
    }
  }
  return encontrados;
}

test("cron fiscal: cada registro usa o próprio empresa_id, não a sessão", () => {
  const reconciliar = fonte("app/api/cron/fiscal/reconciliar/route.ts");
  const contingencia = fonte("app/api/cron/fiscal/contingencia/route.ts");

  assert.match(reconciliar, /CRON_SECRET/);
  assert.match(reconciliar, /empresaId: item\.empresa_id/);
  assert.match(reconciliar, /\.eq\("empresa_id", item\.empresa_id\)/);
  assert.doesNotMatch(reconciliar, /buscarVinculoEmpresaAtiva/);
  assert.match(contingencia, /item\.empresa_id/);
});

test("webhooks: não há rota de webhook PIX/Geranet no app", () => {
  const rotas = arquivosTs(join(raiz, "app", "api")).filter((arquivo) =>
    arquivo.replaceAll("\\", "/").includes("webhook")
  );
  assert.deepEqual(rotas, []);
});

test("cache Next: app/ não usa unstable_cache nem revalidateTag de tenant", () => {
  const app = arquivosTs(join(raiz, "app"));
  const lib = arquivosTs(join(raiz, "lib"));

  for (const arquivo of [...app, ...lib]) {
    if (arquivo.includes("node_modules") || arquivo.includes(".next")) continue;
    const relativo = arquivo.slice(raiz.length + 1).replaceAll("\\", "/");
    if (relativo.endsWith(".test.ts")) continue;
    const conteudo = fonte(relativo);
    assert.doesNotMatch(
      conteudo,
      /unstable_cache/,
      `${relativo} usa unstable_cache`
    );
    assert.doesNotMatch(
      conteudo,
      /revalidateTag/,
      `${relativo} usa revalidateTag`
    );
  }
});

test("frontend: persistência de carrinho não reutiliza slug de outro catálogo", () => {
  assert.equal(chaveCarrinho("slug-a").includes("slug-a"), true);
  assert.equal(chaveCarrinho("slug-a").includes("slug-b"), false);
});

test("frontend: troca de empresa no PDV ainda não existe — risco futuro se persistir estado sem tenant", () => {
  const pdv = fonte("app/contabilidade/actions.ts");
  assert.match(pdv, /definirEmpresaAtiva/);
  const fontePdv = fonte("app/pdv/actions.ts");
  assert.doesNotMatch(fontePdv, /definirEmpresaAtiva/);
});
