import assert from "node:assert/strict";
import { test } from "node:test";

import {
  empresaA,
  empresaB,
  usuarioA,
  vinculosPadrao,
} from "./cenario";
import { fonte } from "./fonte";
import { buscarDaEmpresaAtiva } from "./app-layer";
import {
  filtrarPorRls,
  inserirUnicoPorEmpresa,
  escreverComRls,
} from "./rls-memoria";

const MIGRACAO = "supabase/migrations/20260828010000_notificacoes.sql";

test("notificações: tabelas, UNIQUE, RLS e estado por usuário", () => {
  const sql = fonte(MIGRACAO);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.notificacoes_configuracoes/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.notificacoes/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.notificacoes_usuarios/);
  assert.match(sql, /tem_acesso_empresa\(empresa_id\)/);
  assert.match(sql, /UNIQUE \(empresa_id, chave_deduplicacao\)/);
  assert.match(sql, /UNIQUE \(empresa_id, notificacao_id, usuario_id\)/);
  assert.match(sql, /usuario_id = auth\.uid\(\)/);
  assert.match(sql, /notificacoes_reset_estado_usuario_ao_reativar/);
  assert.doesNotMatch(sql, /supabase db reset/);
});

test("empresa A não lê notificações da B", () => {
  const registros = [
    { id: "n-a", empresa_id: empresaA, chave: "estoque_baixo:p1" },
    { id: "n-b", empresa_id: empresaB, chave: "estoque_baixo:p1" },
  ];
  const visiveisA = filtrarPorRls(registros, usuarioA, vinculosPadrao);
  assert.equal(visiveisA.length, 1);
  assert.equal(visiveisA[0]?.id, "n-a");
  assert.equal(buscarDaEmpresaAtiva(registros, empresaA, "n-b"), null);
});

test("empresa A não altera estado de notificação da B", () => {
  const registros = [
    { id: "n-b", empresa_id: empresaB, lida: false },
  ];
  const saida = escreverComRls(
    registros,
    usuarioA,
    vinculosPadrao,
    "n-b",
    (item) => ({ ...item, lida: true })
  );
  assert.equal(saida.ok, false);
});

test("mesma chave pode existir em empresas diferentes", () => {
  const vinculos: Array<{ empresa_id: string; chave: string }> = [];
  inserirUnicoPorEmpresa(
    vinculos,
    { empresa_id: empresaA, chave: "estoque_baixo:p1" },
    (item) => item.chave
  );
  inserirUnicoPorEmpresa(
    vinculos,
    { empresa_id: empresaB, chave: "estoque_baixo:p1" },
    (item) => item.chave
  );
  assert.equal(vinculos.length, 2);
  assert.throws(
    () =>
      inserirUnicoPorEmpresa(
        vinculos,
        { empresa_id: empresaA, chave: "estoque_baixo:p1" },
        (item) => item.chave
      ),
    /unique_violation/
  );
});

test("actions resolvem empresa da sessão e não aceitam empresa_id do cliente", () => {
  const actions = fonte("app/notificacoes/actions.ts");
  assert.match(actions, /obterPermissoesSessao/);
  assert.match(actions, /sessao\.empresaId/);
  assert.match(actions, /usuarioId: sessao\.usuarioId/);
  assert.doesNotMatch(actions, /formData\.get\("empresa_id"\)/);
  assert.doesNotMatch(actions, /input\.empresaId/);
  assert.doesNotMatch(actions, /input\.usuarioId/);
  assert.match(actions, /actionUrlSegura/);
  assert.match(fonte("lib/permissoes/menu.ts"), /Notificações/);
  assert.match(
    fonte("components/app-shell.tsx"),
    /SinoNotificacoes/
  );
  assert.match(
    fonte("components/notificacoes/sino-notificacoes.tsx"),
    /Central de notificações/
  );
  assert.match(
    fonte("components/notificacoes/sino-notificacoes.tsx"),
    /Tudo certo por aqui/
  );
});
