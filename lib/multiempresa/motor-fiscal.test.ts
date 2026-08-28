import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB, usuarioA, vinculosPadrao } from "./cenario";
import { fonte } from "./fonte";
import { filtrarPorRls } from "./rls-memoria";

const MIGRACAO = "supabase/migrations/20260828030000_motor_fiscal_ia.sql";

test("motor fiscal: versões globais e análises por empresa", () => {
  const sql = fonte(MIGRACAO);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.fiscal_base_versoes/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.fiscal_ia_analises/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.fiscal_ia_propostas/);
  assert.match(sql, /tem_acesso_empresa\(empresa_id\)/);
  assert.doesNotMatch(sql, /supabase db reset/);
  assert.match(sql, /Nunca sobrescreve versão anterior/);
});

test("empresa A não lê análise nem proposta da B", () => {
  const analises = [
    { id: "an-a", empresa_id: empresaA, usuario_id: usuarioA },
    { id: "an-b", empresa_id: empresaB, usuario_id: usuarioA },
  ];
  const visiveis = filtrarPorRls(analises, usuarioA, vinculosPadrao);
  assert.equal(visiveis.length, 1);
  assert.equal(visiveis[0]?.id, "an-a");
});
