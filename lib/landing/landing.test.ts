import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "../multiempresa/fonte";
import {
  decidirAcessoRota,
  rotaLivrePermissao,
  resolverExigenciaRota,
} from "../permissoes/rotas";

test("rota / é pública e não exige autenticação", () => {
  assert.equal(rotaLivrePermissao("/"), true);
  assert.equal(resolverExigenciaRota("/").tipo, "livre");
  assert.equal(
    decidirAcessoRota({ pathname: "/", permissoes: null }).ok,
    true
  );
  assert.equal(rotaLivrePermissao("/painel"), false);
});

test("landing de / não consulta banco nem redireciona para o painel", () => {
  const pagina = fonte("app/page.tsx");
  const landing = fonte("components/landing/landing-page.tsx");
  const cabecalho = fonte("components/landing/landing-header.tsx");

  assert.match(pagina, /LandingPage/);
  assert.match(pagina, /Sistema de Gestão, PDV e Estoque/);
  assert.doesNotMatch(pagina, /redirect\(/);
  assert.doesNotMatch(pagina, /createClient|from\("/);
  assert.doesNotMatch(landing, /redirect\(["']\/painel/);
  assert.doesNotMatch(landing, /createClient|supabase/);
  assert.match(cabecalho, /href="\/cadastro"/);
  assert.match(cabecalho, /href="\/login"/);
  assert.match(landing, /Começar agora/);
  assert.match(landing, /href="\/cadastro"/);
  assert.match(landing, /href="\/login"/);
  assert.match(landing, /PDV/);
  assert.match(landing, /Estoque/);
  assert.match(landing, /Clientes/);
  assert.match(landing, /Carteira/);
  assert.match(landing, /Vendas/);
  assert.match(landing, /NF-e e NFC-e/);
  assert.match(landing, /Relatórios/);
  assert.match(landing, /Catálogo/);
  assert.match(landing, /Multiempresa/);
  assert.doesNotMatch(landing, /\.exe/);
  assert.doesNotMatch(landing, /empresa_id|RLS/);
});

test("AppShell mantém / sem menu interno", () => {
  const shell = fonte("components/app-shell.tsx");
  assert.match(shell, /pathname === "\/"/);
});
