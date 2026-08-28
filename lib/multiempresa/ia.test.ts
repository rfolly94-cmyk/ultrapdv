import assert from "node:assert/strict";
import { test } from "node:test";

import {
  empresaA,
  empresaB,
  usuarioA,
  usuarioB,
  vinculosPadrao,
} from "./cenario";
import { fonte } from "./fonte";
import { buscarDaEmpresaAtiva } from "./app-layer";
import { filtrarPorRls, escreverComRls, inserirUnicoPorEmpresa } from "./rls-memoria";

const MIGRACAO = "supabase/migrations/20260828020000_assistente_ia.sql";

test("assistente IA: tabelas, RLS e isolamento por empresa/usuário", () => {
  const sql = fonte(MIGRACAO);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.ia_conversas/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.ia_mensagens/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.ia_auditoria/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.fiscal_base_fontes/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.fiscal_base_regras/);
  assert.match(sql, /tem_acesso_empresa\(empresa_id\)/);
  assert.match(sql, /usuario_id = auth\.uid\(\)/);
  assert.doesNotMatch(sql, /supabase db reset/);
});

test("empresa A não lê conversa nem auditoria da B", () => {
  const conversas = [
    { id: "c-a", empresa_id: empresaA, usuario_id: usuarioA },
    { id: "c-b", empresa_id: empresaB, usuario_id: usuarioA },
  ];
  const visiveisA = filtrarPorRls(conversas, usuarioA, vinculosPadrao);
  assert.equal(visiveisA.length, 1);
  assert.equal(visiveisA[0]?.id, "c-a");
  assert.equal(buscarDaEmpresaAtiva(conversas, empresaA, "c-b"), null);
});

test("mesma conversa isolada por empresa e troca de contexto", () => {
  const vinculos: Array<{ empresa_id: string; chave: string }> = [];
  inserirUnicoPorEmpresa(
    vinculos,
    { empresa_id: empresaA, chave: `${usuarioA}:assistente` },
    (item) => item.chave
  );
  inserirUnicoPorEmpresa(
    vinculos,
    { empresa_id: empresaB, chave: `${usuarioA}:assistente` },
    (item) => item.chave
  );
  assert.equal(vinculos.length, 2);
  assert.match(fonte("components/app-shell.tsx"), /AssistenteFlutuante key=\{identidade/);
});

test("usuário A não altera auditoria da empresa B", () => {
  const registros = [{ id: "aud-b", empresa_id: empresaB }];
  const saida = escreverComRls(
    registros,
    usuarioA,
    vinculosPadrao,
    "aud-b",
    (item) => ({ ...item, violacao: true })
  );
  assert.equal(saida.ok, false);
  assert.notEqual(usuarioA, usuarioB);
});
