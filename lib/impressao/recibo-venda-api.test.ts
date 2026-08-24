import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "../multiempresa/fonte";

test("Bearer válido consegue baixar recibo e cookie web continua válido", () => {
  const rota = fonte("app/api/impressao/recibo/[id]/route.ts");
  const claims = fonte("lib/supabase/claims.ts");
  const server = fonte("lib/supabase/server.ts");

  assert.match(rota, /obterClaimsSessao/);
  assert.doesNotMatch(rota, /auth\.getClaims\(\)/);
  assert.match(claims, /getClaims\(bearer\)/);
  assert.match(claims, /return supabase\.auth\.getClaims\(\)/);
  assert.match(server, /Authorization: `Bearer \$\{bearer\}`/);
  assert.doesNotMatch(rota, /createAdminClient|SUPABASE_SECRET_KEY|SERVICE_ROLE/);
});

test("sem autenticação a rota do recibo responde 401", () => {
  const rota = fonte("app/api/impressao/recibo/[id]/route.ts");
  const get = rota.slice(rota.indexOf("export async function GET"));

  assert.match(get, /Não autenticado\./);
  assert.match(get, /status: 401|jsonErro\("Não autenticado\.", 401\)/);
  assert.match(get, /error \|\| !usuarioId/);
});

test("usuário de outra empresa não acessa recibo", () => {
  const rota = fonte("app/api/impressao/recibo/[id]/route.ts");
  const loader = fonte("lib/impressao/carregar-recibo.ts");
  const get = rota.slice(rota.indexOf("export async function GET"));

  assert.match(get, /buscarVinculoEmpresaAtiva/);
  assert.match(get, /carregarReciboVendaDaEmpresaAtiva/);
  assert.match(get, /empresaId: vinculo\.empresa_id/);
  assert.match(get, /vendaId: id/);
  assert.match(get, /Venda não encontrada\./);
  assert.match(loader, /\.eq\("empresa_id", empresaId\)/);
  assert.match(loader, /\.eq\("id", vendaId\)/);
  assert.match(loader, /venda\.empresa_id !== empresaId/);
  assert.doesNotMatch(loader, /createAdminClient|SERVICE_ROLE|SUPABASE_SECRET_KEY/);
});

test("empresa_id do recibo não vem do cliente", () => {
  const rota = fonte("app/api/impressao/recibo/[id]/route.ts");
  const get = rota.slice(rota.indexOf("export async function GET"));

  assert.doesNotMatch(get, /searchParams\.get\("empresa/);
  assert.doesNotMatch(get, /empresa_id.*request|request.*empresa_id/);
  assert.doesNotMatch(rota, /body\.empresa_id|empresaId:\s*id/);
  assert.match(get, /vinculo\.empresa_id/);
});
