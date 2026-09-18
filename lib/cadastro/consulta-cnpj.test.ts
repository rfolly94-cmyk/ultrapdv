import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

test("consulta de CNPJ é server-side, autenticada e sem service role", () => {
  const rota = fonte("app/api/cadastro/cnpj/route.ts");
  const hook = fonte("lib/cadastro/use-consulta-cnpj.ts");
  const campo = fonte("components/cadastro/consulta-cnpj-campo.tsx");
  const clientes = fonte("components/cadastro/cliente-campos-cnpj.tsx");
  const transportadoras = fonte("components/transportadoras/transportadoras-workspace.tsx");
  const onboarding = fonte("components/onboarding/onboarding-empresa-form.tsx");
  const lib = fonte("lib/cadastro/cnpj.ts");

  assert.match(rota, /obterClaimsSessao/);
  assert.match(rota, /consultarCnpjWs/);
  assert.match(rota, /consumirRateLimitConsultaCnpj/);
  assert.doesNotMatch(rota, /createAdminClient|SERVICE_ROLE|SUPABASE_SECRET_KEY|service_role/);
  assert.doesNotMatch(rota, /searchParams\.get\(["']empresa_id["']\)/);
  assert.doesNotMatch(rota, /resolverContextoEmpresaAtiva/);

  assert.match(lib, /publica\.cnpj\.ws\/cnpj/);
  assert.match(hook, /\/api\/cadastro\/cnpj/);
  assert.doesNotMatch(hook, /publica\.cnpj\.ws/);
  assert.doesNotMatch(campo, /publica\.cnpj\.ws/);
  assert.doesNotMatch(clientes, /publica\.cnpj\.ws/);
  assert.doesNotMatch(transportadoras, /publica\.cnpj\.ws/);
  assert.doesNotMatch(onboarding, /publica\.cnpj\.ws/);

  assert.match(campo, /Consultar CNPJ/);
  assert.match(campo, /from "lucide-react"/);
  assert.match(campo, /<Search /);
  assert.doesNotMatch(campo, /Atualizar dados pelo CNPJ/);
  assert.doesNotMatch(campo, /Consultar CNPJ<\/button>/);
  assert.match(campo, /MENSAGEM_CONSULTANDO_CNPJ/);
  assert.match(lib, /Consultando CNPJ/);
  assert.match(clientes, /ConsultaCnpjCampo/);
  assert.match(transportadoras, /ConsultaCnpjCampo/);
  assert.match(onboarding, /ConsultaCnpjCampo/);
});

test("consulta de CNPJ não infere regra fiscal", () => {
  const lib = fonte("lib/cadastro/cnpj.ts");
  const clientes = fonte("components/cadastro/cliente-campos-cnpj.tsx");
  assert.doesNotMatch(lib, /\bcfop\b/i);
  assert.doesNotMatch(lib, /\bcst\b/i);
  assert.doesNotMatch(lib, /\bcsosn\b/i);
  assert.doesNotMatch(lib, /\bcrt\b/i);
  assert.doesNotMatch(clientes, /indicador_ie_destinatario/);
});
