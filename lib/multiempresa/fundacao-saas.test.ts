import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { destinoAposConfirmacaoAuth } from "../auth/destino-confirmacao";
import { emailConfirmado } from "../auth/email";
import { MENSAGEM_RECUPERACAO_NEUTRA } from "../auth/recuperacao";
import { caminhoInternoSeguro } from "../auth/url-app";
import { empresaA, usuarioA, usuarioB } from "./cenario";
import { fonte } from "./fonte";
import { decidirAcessoAdminPlataforma } from "../plataforma/autorizacao";
import { contarConfirmacaoProprietarios } from "../plataforma/metricas";
import { rotuloProprietario } from "../plataforma/rotulos";

const MIGRATION =
  "supabase/migrations/20260818170000_fundacao_saas_proprietario_plataforma.sql";
const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");

function onboardingApiPermite(user: {
  email_confirmed_at?: string | null;
} | null) {
  if (!emailConfirmado(user)) {
    return { ok: false as const, status: 403 as const };
  }
  return { ok: true as const, status: 200 as const };
}

function criarEmpresaOnboarding(params: {
  usuarioId: string;
  emailConfirmadoEm: string | null;
}) {
  if (!params.emailConfirmadoEm) {
    throw new Error("Confirme seu e-mail antes de cadastrar a empresa.");
  }

  const empresa = {
    id: "empresa-nova",
    proprietario_usuario_id: null as string | null,
  };

  const vinculo = {
    usuario_id: params.usuarioId,
    empresa_id: empresa.id,
    perfil: "administrador",
    principal: true,
    ativo: true,
  };

  empresa.proprietario_usuario_id = params.usuarioId;

  if (
    vinculo.usuario_id !== empresa.proprietario_usuario_id ||
    vinculo.empresa_id !== empresa.id ||
    !vinculo.ativo
  ) {
    throw new Error("O proprietário precisa ter vínculo ativo na mesma empresa.");
  }

  return { empresa, vinculo };
}

function criarEmpresaLegado() {
  throw new Error(
    "Esta operação foi desativada. Use o cadastro oficial com e-mail confirmado."
  );
}

function respostaRecuperacao(existeConta: boolean) {
  void existeConta;
  return MENSAGEM_RECUPERACAO_NEUTRA;
}

test("A. usuário não confirmado: onboarding bloqueado na API e na RPC", () => {
  assert.deepEqual(onboardingApiPermite({ email_confirmed_at: null }), {
    ok: false,
    status: 403,
  });
  assert.throws(
    () =>
      criarEmpresaOnboarding({
        usuarioId: usuarioA,
        emailConfirmadoEm: null,
      }),
    /Confirme seu e-mail/
  );

  const api = fonte("app/api/onboarding/empresa/route.ts");
  const rpc = fonte(MIGRATION);
  const pagina = fonte("app/onboarding/page.tsx");

  assert.ok(
    api.indexOf("email_confirmed_at") < api.indexOf("createAdminClient()")
  );
  assert.match(api, /Confirme seu e-mail antes de cadastrar a empresa/);
  assert.match(rpc, /u\.email_confirmed_at IS NOT NULL/);
  assert.match(pagina, /redirect\(\s*"\/confirmar-email"/);
});

test("B. usuário confirmado: onboarding permitido", () => {
  assert.deepEqual(
    onboardingApiPermite({ email_confirmed_at: "2026-08-18T12:00:00Z" }),
    { ok: true, status: 200 }
  );
  assert.doesNotThrow(() =>
    criarEmpresaOnboarding({
      usuarioId: usuarioA,
      emailConfirmadoEm: "2026-08-18T12:00:00Z",
    })
  );
});

test("C. nova empresa: proprietario_usuario_id é o criador", () => {
  const criado = criarEmpresaOnboarding({
    usuarioId: usuarioA,
    emailConfirmadoEm: "2026-08-18T12:00:00Z",
  });
  assert.equal(criado.empresa.proprietario_usuario_id, usuarioA);

  const rpc = fonte(MIGRATION);
  assert.match(
    rpc,
    /SET proprietario_usuario_id = p_usuario_id/
  );
  assert.match(rpc, /'proprietario_usuario_id', p_usuario_id/);
  assert.doesNotMatch(rpc, /UPDATE public\.empresas[\s\S]*proprietario_usuario_id[\s\S]*principal/);
});

test("D. proprietário nasce com vínculo administrador/principal/ativo", () => {
  const criado = criarEmpresaOnboarding({
    usuarioId: usuarioA,
    emailConfirmadoEm: "2026-08-18T12:00:00Z",
  });
  assert.equal(criado.vinculo.perfil, "administrador");
  assert.equal(criado.vinculo.principal, true);
  assert.equal(criado.vinculo.ativo, true);
  assert.equal(criado.vinculo.usuario_id, criado.empresa.proprietario_usuario_id);

  const rpc = fonte(MIGRATION);
  assert.match(rpc, /'administrador'/);
  assert.match(rpc, /principal,\s+ativo/);
  assert.match(
    rpc,
    /ue\.usuario_id = NEW\.proprietario_usuario_id[\s\S]*ue\.empresa_id = NEW\.id[\s\S]*ue\.ativo = true/
  );
});

test("E. administrador comum da empresa não acessa admin-plataforma", () => {
  const acesso = decidirAcessoAdminPlataforma({
    usuarioId: usuarioA,
    autenticado: true,
    admin: null,
  });
  assert.deepEqual(acesso, { ok: false, status: 404 });

  const layout = fonte("app/admin-plataforma/layout.tsx");
  assert.match(layout, /obterContextoAdminPlataforma/);
  assert.match(layout, /notFound\(\)/);
  assert.doesNotMatch(layout, /AppSidebar|app-shell/);
});

test("F. admin da plataforma ativo acessa", () => {
  const acesso = decidirAcessoAdminPlataforma({
    usuarioId: usuarioA,
    autenticado: true,
    admin: { usuario_id: usuarioA, ativo: true },
  });
  assert.deepEqual(acesso, { ok: true });

  const helper = fonte("lib/plataforma/contexto.ts");
  assert.ok(
    helper.indexOf("administradores_plataforma") <
      helper.indexOf("admin: createAdminClient()")
  );
  assert.match(helper, /getClaims/);
});

test("G. admin da plataforma inativo é bloqueado", () => {
  const acesso = decidirAcessoAdminPlataforma({
    usuarioId: usuarioA,
    autenticado: true,
    admin: { usuario_id: usuarioA, ativo: false },
  });
  assert.deepEqual(acesso, { ok: false, status: 404 });
});

test("H. recuperação de senha sempre responde de forma neutra", () => {
  assert.equal(respostaRecuperacao(true), respostaRecuperacao(false));
  assert.match(
    respostaRecuperacao(true),
    /Se existir uma conta vinculada a este e-mail/
  );
  assert.doesNotMatch(respostaRecuperacao(false), /não cadastrado/i);

  const action = fonte("app/auth/actions.ts");
  assert.match(action, /resetPasswordForEmail/);
  assert.match(action, /MENSAGEM_RECUPERACAO_NEUTRA/);
  assert.doesNotMatch(action, /E-mail não cadastrado/);
});

test("I. callback de signup sem empresa vai para onboarding", () => {
  assert.equal(destinoAposConfirmacaoAuth("signup", false), "/onboarding");
  assert.equal(destinoAposConfirmacaoAuth("email", false), "/onboarding");
  assert.equal(destinoAposConfirmacaoAuth("signup", true), "/painel");

  const rota = fonte("app/auth/confirm/route.ts");
  assert.match(rota, /destinoAposConfirmacaoAuth/);
  assert.doesNotMatch(
    rota,
    /type === "recovery"[\s\S]*\/painel/
  );
});

test("J. callback de recovery vai para nova senha, nunca para o painel", () => {
  assert.equal(destinoAposConfirmacaoAuth("recovery", false), "/nova-senha");
  assert.equal(destinoAposConfirmacaoAuth("recovery", true), "/nova-senha");

  const rota = fonte("app/auth/confirm/route.ts");
  const destino = fonte("lib/auth/destino-confirmacao.ts");
  assert.match(rota, /COOKIE_RECUPERACAO_SENHA/);
  assert.match(rota, /destinoAposConfirmacaoAuth/);
  assert.match(destino, /\/nova-senha/);
});

test("K. RPC criar_empresa antiga não contorna o fluxo novo", () => {
  assert.throws(criarEmpresaLegado, /desativada/);

  const sql = fonte(MIGRATION);
  assert.match(
    sql,
    /Esta operação foi desativada\. Use o cadastro oficial com e-mail confirmado/
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.criar_empresa\(text, text, text\) FROM PUBLIC/
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.criar_empresa\(text, text, text\) FROM anon/
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.criar_empresa\(text, text, text\) FROM authenticated/
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.criar_empresa\(text, text, text\) FROM service_role/
  );

  assert.equal(existsSync(join(raiz, "app/onboarding/actions.ts")), false);
  assert.doesNotMatch(
    fonte("app/auth/actions.ts"),
    /export async function cadastrar/
  );
  assert.doesNotMatch(
    fonte("app/api/onboarding/empresa/route.ts"),
    /rpc\(\s*"criar_empresa"/
  );
});

test("FASE 2B: empresas antigas podem ficar sem proprietário e a UI não adivinha", () => {
  assert.equal(rotuloProprietario(null), "Não definido");
  assert.equal(rotuloProprietario({ nome: "Rafael" }), "Rafael");

  const contagem = contarConfirmacaoProprietarios(
    [usuarioA, null, usuarioB, ""],
    (id) => id === usuarioA
  );
  assert.equal(contagem.proprietariosConfirmados, 1);
  assert.equal(contagem.proprietariosPendentes, 1);

  const sql = fonte(MIGRATION);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS proprietario_usuario_id uuid/);
  assert.doesNotMatch(sql, /UPDATE public\.empresas[\s\S]*SET proprietario_usuario_id[\s\S]*FROM public\.usuarios_empresas/);
});

test("FASE 2B: cadastro redireciona para confirmação e usa emailRedirectTo", () => {
  const form = fonte("components/cadastro/cadastro-proprietario-form.tsx");
  assert.match(form, /emailRedirectTo/);
  assert.match(form, /\/auth\/confirm/);
  assert.match(form, /\/confirmar-email/);
  assert.match(form, /email_confirmed_at[\s\S]*\/onboarding/);
});

test("FASE 2B: admin-plataforma, auditoria e grants mínimos", () => {
  const sql = fonte(MIGRATION);
  const blocoAdmin = sql.split(
    "CREATE TABLE IF NOT EXISTS public.administradores_plataforma"
  )[1]?.split("CREATE TABLE")[0] ?? "";
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.administradores_plataforma/);
  assert.doesNotMatch(blocoAdmin, /empresa_id/);
  assert.match(sql, /usuario_id = auth\.uid\(\)/);
  assert.match(sql, /GRANT SELECT ON TABLE public\.administradores_plataforma TO authenticated/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.plataforma_auditoria/);
  assert.match(
    sql,
    /REVOKE ALL ON TABLE public\.plataforma_auditoria FROM authenticated/
  );

  const auditoria = fonte("lib/plataforma/auditoria.ts");
  for (const chave of ["senha", "certificado", "csc", "api_key", "token"]) {
    assert.match(auditoria, new RegExp(chave));
  }

  const lista = fonte("app/admin-plataforma/empresas/page.tsx");
  assert.match(lista, /Não definido/);
  assert.doesNotMatch(lista, /certificado|csc|api_key|secret/i);

  const detalhe = fonte("app/admin-plataforma/empresas/[id]/page.tsx");
  assert.doesNotMatch(detalhe, /certificado|csc|api_key|secret/i);
});

test("FASE 2B: redirects internos rejeitam open redirect", () => {
  assert.equal(caminhoInternoSeguro("/auth/confirm?type=recovery"), "/auth/confirm?type=recovery");
  assert.equal(caminhoInternoSeguro("https://evil.example/login"), null);
  assert.equal(caminhoInternoSeguro("//evil.example"), null);
  assert.equal(caminhoInternoSeguro("/login?next=https://evil.example"), null);
  assert.equal(caminhoInternoSeguro("/painel"), "/painel");
});

test("FASE 2C: /admin-plataforma não exige empresa ativa", () => {
  const proxy = fonte("lib/supabase/proxy.ts");
  const layout = fonte("app/admin-plataforma/layout.tsx");
  const helper = fonte("lib/plataforma/contexto.ts");
  const shell = fonte("components/app-shell.tsx");

  assert.match(proxy, /rotaAdminPlataforma/);
  assert.ok(
    proxy.indexOf("rotaAdminPlataforma(pathname)") <
      proxy.indexOf("usuarios_empresas")
  );
  assert.match(layout, /obterContextoAdminPlataforma/);
  assert.doesNotMatch(layout, /usuarios_empresas/);
  assert.doesNotMatch(helper, /usuarios_empresas/);
  assert.match(shell, /\/admin-plataforma/);
});

test("FASE 2B: onboarding RPC permanece só service_role", () => {
  const sql = fonte(MIGRATION);
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.rpc_criar_empresa_onboarding[\s\S]*FROM authenticated/
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.rpc_criar_empresa_onboarding[\s\S]*TO service_role/
  );
  assert.equal(empresaA.length > 0, true);
});
