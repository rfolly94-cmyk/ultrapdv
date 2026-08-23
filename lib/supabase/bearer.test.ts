import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "@/lib/multiempresa/fonte";
import { extrairBearerAuthorization } from "./bearer";

test("Bearer válido é extraído sem prefixo", () => {
  assert.equal(
    extrairBearerAuthorization("Bearer tok_abc.def"),
    "tok_abc.def"
  );
});

test("ausência ou formato inválido não vira token", () => {
  assert.equal(extrairBearerAuthorization(null), null);
  assert.equal(extrairBearerAuthorization("tok_abc"), null);
  assert.equal(extrairBearerAuthorization("Bearer"), null);
});

test("createClient do servidor honra Authorization Bearer", () => {
  const server = fonte("lib/supabase/server.ts");
  const claims = fonte("lib/supabase/claims.ts");
  const sessao = fonte("lib/permissoes/sessao.ts");
  const action = fonte("app/pdv/actions.ts");

  assert.match(server, /extrairBearerAuthorization/);
  assert.match(server, /headers\(\)/);
  assert.match(server, /Authorization: `Bearer \$\{bearer\}`/);
  assert.doesNotMatch(server, /SUPABASE_SECRET_KEY|SERVICE_ROLE/);
  assert.match(claims, /getClaims\(bearer\)/);
  assert.match(sessao, /obterClaimsSessao/);
  assert.match(action, /obterClaimsSessao/);
});
