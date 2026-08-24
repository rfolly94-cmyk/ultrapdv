import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");
function fonte(...partes: string[]) {
  return readFileSync(join(raiz, ...partes), "utf8");
}

test("APIs de cliente e carteira exigem Bearer e resolvem empresa no servidor", () => {
  for (const arquivo of [
    "app/api/clientes/route.ts",
    "app/api/clientes/[id]/route.ts",
    "app/api/clientes/[id]/carteira/route.ts",
  ]) {
    const rota = fonte(arquivo);
    assert.match(rota, /resolverContextoEmpresaAtiva/, arquivo);
    assert.doesNotMatch(rota, /createAdminClient|SUPABASE_SECRET_KEY/, arquivo);
  }

  assert.match(fonte("app/api/clientes/route.ts"), /exigirOperacaoCliente/);
  assert.match(fonte("app/api/clientes/[id]/route.ts"), /exigirOperacaoCliente/);
  assert.match(
    fonte("app/api/clientes/[id]/carteira/route.ts"),
    /exigirOperacaoCarteira/
  );
  assert.doesNotMatch(
    fonte("app/api/clientes/[id]/carteira/route.ts"),
    /exigirOperacaoCliente|exigirCliente\(/
  );

  const persistir = fonte("lib/clientes/persistir-api.ts");
  assert.match(persistir, /saldo_devedor: 0/);
  const editar = persistir.slice(
    persistir.indexOf("export async function persistirClienteApi"),
    persistir.indexOf("export async function carregarClienteApi")
  );
  assert.doesNotMatch(editar, /saldo_devedor/);

  const receber = fonte("app/api/clientes/[id]/carteira/receber/route.ts");
  assert.match(receber, /rpc_receber_carteira_cliente/);
  assert.match(receber, /Access-Control-Allow-Origin|aplicarCors/);

  const carteiraLoader = fonte("lib/clientes/carregar-carteira-api.ts");
  assert.match(carteiraLoader, /quitadas:/);
  assert.match(carteiraLoader, /abertos:/);
  assert.match(carteiraLoader, /montarTitulosAbaCarteira/);
  assert.match(carteiraLoader, /movimentos:/);
  assert.match(carteiraLoader, /compras:/);
  assert.match(carteiraLoader, /carteira_cliente_movimentacoes/);
  assert.match(fonte("lib/carteira/titulos.ts"), /tituloPassaNaAba/);
  assert.match(carteiraLoader, /dataQuitacaoTitulo/);
});
