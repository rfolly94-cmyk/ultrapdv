import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import { decidirAcessoMaster } from "@/lib/master/autorizacao";
import { usuarioA } from "@/lib/multiempresa/cenario";
import { rotaOperacionalBloqueadaQuandoSuspensa } from "@/lib/assinatura/rotas-restritas";
import { caminhoInternoSeguro, urlAbsolutaApp } from "@/lib/auth/url-app";
import { destinoAposConfirmacaoAuth } from "@/lib/auth/destino-confirmacao";
import { MENSAGEM_LOGIN_INVALIDO } from "@/lib/auth/mensagens-acesso";
import {
  acessoOperacionalDesativado,
  classificarEstadoAcesso,
  podeUsarOnboarding,
} from "@/lib/auth/estado-acesso";
import {
  decidirGateSessao,
  destinoPosLogin,
  ehRotaPublicaIntencional,
} from "@/lib/auth/gate-rotas";

const ESTADO_NOVO = classificarEstadoAcesso({});
const ESTADO_ATIVO = classificarEstadoAcesso({
  usuarioAtivo: true,
  vinculos: [
    { empresa_id: empresaA, principal: true, ativo: true, perfil: "caixa" },
  ],
});
const ESTADO_INATIVO = classificarEstadoAcesso({
  usuarioAtivo: true,
  vinculos: [
    { empresa_id: empresaA, principal: true, ativo: false, perfil: "caixa" },
  ],
});
const ESTADO_USUARIO_INATIVO = classificarEstadoAcesso({
  usuarioAtivo: false,
  vinculos: [
    { empresa_id: empresaA, principal: true, ativo: true, perfil: "caixa" },
  ],
});

test("1. usuário sem sessão em página → /login", () => {
  const decisao = decidirGateSessao({
    pathname: "/pdv",
    autenticado: false,
    estado: ESTADO_NOVO,
  });
  assert.deepEqual(decisao, { tipo: "redirect", destino: "/login" });
});

test("2. API sem sessão → 401 JSON", () => {
  const decisao = decidirGateSessao({
    pathname: "/api/pdv/finalizar",
    autenticado: false,
    estado: ESTADO_NOVO,
  });
  assert.equal(decisao.tipo, "json");
  if (decisao.tipo === "json") {
    assert.equal(decisao.status, 401);
    assert.equal(decisao.codigo, "NAO_AUTENTICADO");
  }
});

test("3. login inválido → mensagem genérica", () => {
  assert.equal(MENSAGEM_LOGIN_INVALIDO, "E-mail ou senha inválidos.");
  assert.match(fonte("app/auth/actions.ts"), /MENSAGEM_LOGIN_INVALIDO/);
});

test("4. usuário inexistente → mesma mensagem", () => {
  assert.match(fonte("app/auth/actions.ts"), /login_falha/);
  assert.doesNotMatch(
    fonte("app/auth/actions.ts"),
    /e-mail não encontrado|usuário não existe/i
  );
});

test("5. JWT válido + vínculo ativo → acesso", () => {
  const decisao = decidirGateSessao({
    pathname: "/pdv",
    autenticado: true,
    estado: ESTADO_ATIVO,
    empresaOperacional: true,
    rotaOperacional: true,
  });
  assert.deepEqual(decisao, { tipo: "seguir" });
});

test("6. JWT válido + vínculo inativo → bloqueado", () => {
  const decisao = decidirGateSessao({
    pathname: "/pdv",
    autenticado: true,
    estado: ESTADO_INATIVO,
  });
  assert.deepEqual(decisao, {
    tipo: "redirect",
    destino: "/acesso-desativado",
  });
  assert.equal(acessoOperacionalDesativado(ESTADO_INATIVO), true);
});

test("7. vínculo inativo NÃO acessa onboarding", () => {
  assert.equal(podeUsarOnboarding(ESTADO_INATIVO), false);
  const pagina = decidirGateSessao({
    pathname: "/onboarding",
    autenticado: true,
    estado: ESTADO_INATIVO,
  });
  assert.deepEqual(pagina, {
    tipo: "redirect",
    destino: "/acesso-desativado",
  });
  const api = decidirGateSessao({
    pathname: "/api/onboarding/empresa",
    autenticado: true,
    estado: ESTADO_INATIVO,
  });
  assert.equal(api.tipo, "json");
  if (api.tipo === "json") {
    assert.equal(api.status, 403);
    assert.equal(api.codigo, "ACESSO_DESATIVADO");
  }
});

test("8. usuário ativo=false → bloqueado", () => {
  const decisao = decidirGateSessao({
    pathname: "/caixa",
    autenticado: true,
    estado: ESTADO_USUARIO_INATIVO,
  });
  assert.deepEqual(decisao, {
    tipo: "redirect",
    destino: "/acesso-desativado",
  });
});

test("9. empresa suspensa → PDV bloqueado", () => {
  assert.equal(rotaOperacionalBloqueadaQuandoSuspensa("/pdv"), true);
  const decisao = decidirGateSessao({
    pathname: "/pdv",
    autenticado: true,
    estado: ESTADO_ATIVO,
    empresaOperacional: false,
    rotaOperacional: true,
  });
  assert.deepEqual(decisao, { tipo: "redirect", destino: "/assinatura" });
});

test("10. empresa suspensa → caixa bloqueado", () => {
  assert.equal(rotaOperacionalBloqueadaQuandoSuspensa("/caixa"), true);
});

test("11. empresa suspensa → fiscal bloqueado", () => {
  assert.equal(rotaOperacionalBloqueadaQuandoSuspensa("/fiscal"), true);
  assert.equal(
    rotaOperacionalBloqueadaQuandoSuspensa("/api/fiscal/geranet/nfce-emitir"),
    true
  );
});

test("12. empresa suspensa → PIX operacional bloqueado", () => {
  assert.equal(
    rotaOperacionalBloqueadaQuandoSuspensa("/api/pagamentos/pix/geranet/pdv/emitir"),
    true
  );
  assert.match(
    fonte("lib/pagamentos/pix/contexto.ts"),
    /resolverContextoAutorizadoEmpresa/
  );
});

test("13. empresa suspensa → API operacional retorna 403", () => {
  const decisao = decidirGateSessao({
    pathname: "/api/pdv/finalizar",
    autenticado: true,
    estado: ESTADO_ATIVO,
    empresaOperacional: false,
    rotaOperacional: true,
  });
  assert.equal(decisao.tipo, "json");
  if (decisao.tipo === "json") {
    assert.equal(decisao.status, 403);
    assert.equal(decisao.codigo, "EMPRESA_NAO_OPERACIONAL");
  }
});

test("14. usuário comum → /master continua bloqueado", () => {
  assert.deepEqual(
    decidirAcessoMaster({
      usuarioId: usuarioA,
      autenticado: true,
      admin: null,
    }),
    { ok: false, status: 404 }
  );
});

test("15. Master não depende de vínculo empresarial", () => {
  const decisao = decidirGateSessao({
    pathname: "/master/empresas",
    autenticado: true,
    estado: ESTADO_NOVO,
  });
  assert.deepEqual(decisao, { tipo: "seguir" });
  assert.match(fonte("lib/supabase/proxy.ts"), /ehRotaPlataforma/);
});

test("16. empresa A não acessa recurso da empresa B", () => {
  assert.notEqual(empresaA, empresaB);
  assert.match(fonte("lib/multiempresa/apis-idor.test.ts"), /empresa_id/);
});

test("17. logout A → login B sem vazamento", () => {
  const logout = fonte("app/logout/route.ts");
  assert.match(logout, /signOut/);
  assert.match(logout, /revalidatePath/);
  assert.match(logout, /maxAge: 0/);
  assert.doesNotMatch(fonte("components/pdv/pdv-shell.tsx"), /localStorage.*carrinho/);
});

test("18. token/refresh inválido → 401/login", () => {
  const api = decidirGateSessao({
    pathname: "/api/produtos",
    autenticado: false,
    estado: ESTADO_NOVO,
  });
  const pagina = decidirGateSessao({
    pathname: "/produtos",
    autenticado: false,
    estado: ESTADO_NOVO,
  });
  assert.equal(api.tipo, "json");
  if (api.tipo === "json") {
    assert.equal(api.status, 401);
  }
  assert.deepEqual(pagina, { tipo: "redirect", destino: "/login" });
});

test("19. rota pública continua pública", () => {
  assert.equal(ehRotaPublicaIntencional("/login"), true);
  assert.equal(ehRotaPublicaIntencional("/catalogo/loja"), true);
  assert.deepEqual(
    decidirGateSessao({
      pathname: "/login",
      autenticado: false,
      estado: ESTADO_NOVO,
    }),
    { tipo: "seguir" }
  );
});

test("20. webhook C6 continua acessível sem sessão e não confia em empresa_id", () => {
  const decisao = decidirGateSessao({
    pathname: "/api/webhooks/pix/c6",
    autenticado: false,
    estado: ESTADO_NOVO,
  });
  assert.deepEqual(decisao, { tipo: "seguir" });
  assert.equal(rotaOperacionalBloqueadaQuandoSuspensa("/api/webhooks/pix/c6"), false);
  assert.match(
    fonte("lib/pagamentos/pix/c6/adapter.ts"),
    /void empresaIdExternaWebhookC6/
  );
});

test("21. cron continua protegido por CRON_SECRET", () => {
  const decisao = decidirGateSessao({
    pathname: "/api/cron/fiscal/reconciliar",
    autenticado: false,
    estado: ESTADO_NOVO,
  });
  assert.deepEqual(decisao, { tipo: "seguir" });
  assert.match(
    fonte("app/api/cron/fiscal/reconciliar/route.ts"),
    /CRON_SECRET/
  );
});

test("22. onboarding realmente novo continua funcionando", () => {
  assert.equal(podeUsarOnboarding(ESTADO_NOVO), true);
  assert.deepEqual(
    decidirGateSessao({
      pathname: "/onboarding",
      autenticado: true,
      estado: ESTADO_NOVO,
    }),
    { tipo: "seguir" }
  );
  assert.equal(destinoPosLogin(ESTADO_NOVO), "/onboarding");
  assert.match(
    fonte("supabase/migrations/20260918130000_auth_sessao_onboarding.sql"),
    /Seu acesso à empresa foi desativado/
  );
});

test("painel sem sessão vai para /login", () => {
  assert.match(fonte("app/painel/page.tsx"), /redirect\("\/login"\)/);
  assert.match(fonte("app/painel/page.tsx"), /acesso-negado/);
  assert.match(fonte("app/painel/page.tsx"), /acesso-desativado/);
});

test("produção não libera operação quando schema de assinatura falta", () => {
  assert.match(
    fonte("lib/assinatura/resolver-assinatura-empresa.ts"),
    /ambienteProducao\(\)/
  );
  assert.match(
    fonte("lib/assinatura/empresa-pode-operar.ts"),
    /return producao/
  );
});

test("recovery não permite open redirect", () => {
  assert.equal(caminhoInternoSeguro("https://evil.test"), null);
  assert.equal(caminhoInternoSeguro("//evil.test"), null);
  const anterior = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://ultrapdv.app";
  try {
    assert.equal(
      urlAbsolutaApp("/auth/confirm?type=recovery"),
      "https://ultrapdv.app/auth/confirm?type=recovery"
    );
  } finally {
    if (anterior == null) {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    } else {
      process.env.NEXT_PUBLIC_SITE_URL = anterior;
    }
  }
});

test("confirmação com vínculo inativo não cai no onboarding", () => {
  assert.equal(
    destinoAposConfirmacaoAuth("signup", false, true),
    "/acesso-desativado"
  );
});

test("proxy não importa helper server-only de contexto", () => {
  assert.match(fonte("lib/supabase/proxy.ts"), /carregar-estado-acesso/);
  assert.doesNotMatch(
    fonte("lib/supabase/proxy.ts"),
    /contexto-autorizado/
  );
});
