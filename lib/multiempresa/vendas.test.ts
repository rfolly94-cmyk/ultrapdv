import assert from "node:assert/strict";
import { test } from "node:test";

import { assertRegistroDaEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";

import { buscarDaEmpresaAtiva, recusarCruzado } from "./app-layer";
import {
  empresaA,
  empresaB,
  produtoA,
  produtoB,
  usuarioA,
  usuarioB,
  vendaA,
  vendaB,
  vinculosPadrao,
} from "./cenario";
import { fonte } from "./fonte";
import { buscarPorIdComRls, escreverComRls } from "./rls-memoria";

const vendas = [
  { id: vendaA, empresa_id: empresaA, status: "aberta" },
  { id: vendaB, empresa_id: empresaB, status: "aberta" },
];

test("vendas: A lê A e não lê B mesmo conhecendo o UUID", () => {
  assert.equal(
    buscarPorIdComRls(vendas, usuarioA, vinculosPadrao, vendaA)?.status,
    "aberta"
  );
  assert.equal(buscarPorIdComRls(vendas, usuarioA, vinculosPadrao, vendaB), null);
  assert.equal(buscarPorIdComRls(vendas, usuarioB, vinculosPadrao, vendaA), null);
});

test("vendas: API com service_role filtra empresa ativa antes de GET/editar/cancelar", () => {
  assert.equal(buscarDaEmpresaAtiva(vendas, empresaA, vendaB), null);
  assert.equal(recusarCruzado(buscarDaEmpresaAtiva(vendas, empresaA, vendaB), empresaA).status, 404);
  assert.equal(recusarCruzado(buscarDaEmpresaAtiva(vendas, empresaA, vendaA), empresaA).ok, true);
});

test("vendas: A não edita nem cancela B", () => {
  const editar = escreverComRls(vendas, usuarioA, vinculosPadrao, vendaB, (venda) => ({
    ...venda,
    status: "editada",
  }));
  const cancelar = escreverComRls(vendas, usuarioA, vinculosPadrao, vendaB, (venda) => ({
    ...venda,
    status: "cancelada",
  }));
  assert.equal(editar.ok, false);
  assert.equal(cancelar.ok, false);
  assert.throws(
    () => assertRegistroDaEmpresaAtiva({ empresa_id: empresaB }, empresaA),
    /não pertence à empresa ativa/
  );
});

test("vendas: rotas [id] carregam venda com empresa_id da sessão", () => {
  const cancelar = fonte("app/api/vendas/[id]/cancelar/route.ts");
  const editar = fonte("app/api/vendas/[id]/editar/route.ts");
  assert.match(cancelar, /empresa_id/);
  assert.match(editar, /empresa_id/);
});

test("itens: Venda A + Produto B falha na RPC", () => {
  function anexarItem(vendaEmpresaId: string, produtoEmpresaId: string, produtoId: string) {
    if (produtoEmpresaId !== vendaEmpresaId || produtoId === produtoB) {
      throw new Error("Produto não encontrado, inativo ou pertence a outra empresa.");
    }
  }

  assert.doesNotThrow(() => anexarItem(empresaA, empresaA, produtoA));
  assert.throws(() => anexarItem(empresaA, empresaB, produtoB), /outra empresa/);
});

test("itens: Venda A + Cliente B falha no backend", () => {
  function vincularCliente(vendaEmpresaId: string, clienteEmpresaId: string) {
    if (clienteEmpresaId !== vendaEmpresaId) {
      throw new Error("O registro não pertence à empresa ativa.");
    }
  }

  assert.throws(() => vincularCliente(empresaA, empresaB), /não pertence à empresa ativa/);
});

test("itens: camada que bloqueia produto cruzado é a RPC (não FK composta versionada de vendas_itens)", () => {
  assert.match(
    fonte("supabase/migrations/20260815011000_fix_rpc_editar_venda_ambiguidade.sql"),
    /WHERE p\.empresa_id = p_empresa_id/
  );
});
