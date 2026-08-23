import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");
function fonte(...partes: string[]) {
  return readFileSync(join(raiz, ...partes), "utf8");
}

test("APIs de produto exigem Bearer e resolvem empresa no servidor", () => {
  for (const arquivo of [
    "app/api/produtos/route.ts",
    "app/api/produtos/opcoes/route.ts",
    "app/api/produtos/[id]/route.ts",
    "app/api/produtos/[id]/fiscal/route.ts",
    "app/api/produtos/[id]/catalogo/route.ts",
    "app/api/produtos/[id]/foto/route.ts",
  ]) {
    const rota = fonte(arquivo);
    assert.match(rota, /resolverContextoEmpresaAtiva/, arquivo);
    assert.match(rota, /exigirOperacaoProduto/, arquivo);
    assert.doesNotMatch(rota, /createAdminClient|SUPABASE_SECRET_KEY/, arquivo);
    assert.doesNotMatch(rota, /dados\.empresa_id|body\.empresa_id|empresaId do/, arquivo);
  }

  const cadastro = fonte("lib/produtos/persistir-api.ts");
  assert.match(cadastro, /rpc_cadastrar_produto/);
  assert.match(cadastro, /p_empresa_id: input\.empresaId/);
  assert.match(cadastro, /produtos_fiscal/);
  assert.match(cadastro, /catalogo_publicado/);
  assert.match(cadastro, /export async function persistirFotoProdutoApi/);
  assert.match(cadastro, /catalogo_imagem_path/);
  assert.match(fonte("app/api/produtos/[id]/foto/route.ts"), /persistirFotoProdutoApi/);
  const comercial = cadastro.slice(
    cadastro.indexOf("export async function persistirProdutoComercialApi"),
    cadastro.indexOf("export async function cadastrarProdutoApi")
  );
  assert.doesNotMatch(comercial, /estoque_atual/);
});

test("rotas de produto mobile ficam autenticadas e validam ação na API", () => {
  assert.match(fonte("lib/permissoes/rotas.ts"), /\/api\/produtos/);
});
