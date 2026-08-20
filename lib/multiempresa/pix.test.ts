import assert from "node:assert/strict";
import { test } from "node:test";

import { buscarDaEmpresaAtiva } from "./app-layer";
import {
  cobrancaA,
  cobrancaB,
  empresaA,
  empresaB,
  usuarioA,
  vinculosPadrao,
} from "./cenario";
import { fonte } from "./fonte";
import { buscarPorIdComRls } from "./rls-memoria";

const cobrancas = [
  { id: cobrancaA, empresa_id: empresaA, txid: "txid-a" },
  { id: cobrancaB, empresa_id: empresaB, txid: "txid-b" },
];

const integracoes = [
  { id: "ia", empresa_id: empresaA, gateway: "geranet" },
  { id: "ib", empresa_id: empresaB, gateway: "geranet" },
];

test("PIX: A não consulta integração nem cobrança B", () => {
  assert.equal(buscarPorIdComRls(cobrancas, usuarioA, vinculosPadrao, cobrancaB), null);
  assert.equal(buscarDaEmpresaAtiva(integracoes, empresaA, "ib"), null);
  assert.equal(buscarDaEmpresaAtiva(cobrancas, empresaA, cobrancaB), null);
});

test("PIX: UNIQUE de integração é por empresa", () => {
  assert.match(
    fonte("supabase/migrations/20260816200000_pix_geranet.sql"),
    /CONSTRAINT integracoes_pix_empresa_unique UNIQUE \(empresa_id\)/
  );
});

test("PIX: cancelar/consultar filtram cobranca da empresa ativa antes do provider", () => {
  const geranet = fonte("lib/pagamentos/pix/geranet.ts");
  assert.match(geranet, /async function carregarCobrancaDaEmpresa/);
  assert.match(geranet, /\.eq\("id", cobrancaId\)/);
  assert.match(geranet, /\.eq\("empresa_id", empresaId\)/);
  assert.match(geranet, /Recurso não encontrado/);
  assert.doesNotMatch(geranet, /Cobrança PIX não encontrada nesta empresa/);
});

test("PIX: rota de cancelar resolve empresa da sessão, não do body", () => {
  const rota = fonte("app/api/pagamentos/pix/geranet/cancelar/route.ts");
  assert.match(rota, /resolverEmpresaPix/);
  assert.match(rota, /const \{ empresaId \} = await resolverEmpresaPix/);
  assert.doesNotMatch(rota, /empresa_id.*body/);
});

test("PIX: contexto resolve empresa ativa antes do vault", () => {
  const contexto = fonte("lib/pagamentos/pix/contexto.ts");
  assert.match(contexto, /buscarVinculoEmpresaAtiva/);
  assert.match(contexto, /carregarIntegracaoPix\(empresaId\)/);
});

test("PIX: vault.secrets não é consultado pelo client authenticated", () => {
  assert.doesNotMatch(fonte("lib/pagamentos/pix/contexto.ts"), /from\("vault/);
  assert.doesNotMatch(fonte("app/api/pagamentos/pix/geranet/cancelar/route.ts"), /vault\.secrets/);
  assert.match(
    fonte("lib/pagamentos/pix/brcode/brcode.test.ts"),
    /fonte\.includes\("salvar_segredo"\), false/
  );
});

test("PIX: RPCs de finalização interna revogadas de authenticated", () => {
  const revoke = fonte(
    "supabase/migrations/20260818130000_revoke_execute_anon_funcoes_internas.sql"
  );
  for (const nome of [
    "pix_geranet_validar_na_finalizacao",
    "pix_geranet_vincular_na_finalizacao",
    "pix_local_validar_na_finalizacao",
    "pix_local_vincular_na_finalizacao",
    "garantir_forma_pix_unica_empresa",
  ]) {
    assert.match(revoke, new RegExp(nome));
  }
});
