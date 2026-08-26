import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import {
  MENSAGEM_ESTOQUE_INSUFICIENTE,
  avaliarQuantidadeEstoquePdv,
  mensagemEstoqueInsuficientePdv,
  permitirVendaSemEstoqueDoRegistro,
  validarItensEstoquePdv,
} from "./venda-sem-estoque";

const MIGRATION =
  "supabase/migrations/20260825200000_pdv_permitir_venda_sem_estoque.sql";

test("estoque 0 + opção desmarcada = bloqueia", () => {
  const r = avaliarQuantidadeEstoquePdv({
    permitirVendaSemEstoque: false,
    disponivel: 0,
    quantidade: 1,
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.erro, new RegExp(MENSAGEM_ESTOQUE_INSUFICIENTE));
    assert.match(r.erro, /Disponível: 0/);
  }
});

test("estoque negativo + opção desmarcada = bloqueia", () => {
  const r = avaliarQuantidadeEstoquePdv({
    permitirVendaSemEstoque: false,
    disponivel: -3,
    quantidade: 1,
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.erro, mensagemEstoqueInsuficientePdv(-3));
  }
});

test("quantidade maior que estoque + opção desmarcada = bloqueia", () => {
  const r = avaliarQuantidadeEstoquePdv({
    permitirVendaSemEstoque: false,
    disponivel: 2,
    quantidade: 3,
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.erro, /Disponível: 2/);
  }
});

test("estoque suficiente + opção desmarcada = permite", () => {
  assert.equal(
    avaliarQuantidadeEstoquePdv({
      permitirVendaSemEstoque: false,
      disponivel: 2,
      quantidade: 2,
    }).ok,
    true
  );
  assert.equal(
    avaliarQuantidadeEstoquePdv({
      permitirVendaSemEstoque: false,
      disponivel: 5,
      quantidade: 1,
    }).ok,
    true
  );
});

test("estoque 0 + opção marcada = permite", () => {
  assert.equal(
    avaliarQuantidadeEstoquePdv({
      permitirVendaSemEstoque: true,
      disponivel: 0,
      quantidade: 1,
    }).ok,
    true
  );
});

test("quantidade maior que estoque + opção marcada = permite", () => {
  assert.equal(
    avaliarQuantidadeEstoquePdv({
      permitirVendaSemEstoque: true,
      disponivel: 1,
      quantidade: 10,
    }).ok,
    true
  );
});

test("configuração da empresa A não afeta empresa B", () => {
  const configs = [
    { empresa_id: empresaA, permitir_venda_sem_estoque: true },
    { empresa_id: empresaB, permitir_venda_sem_estoque: false },
  ];

  function configDaEmpresa(empresaId: string) {
    const registro = configs.find((item) => item.empresa_id === empresaId);
    return permitirVendaSemEstoqueDoRegistro(
      registro?.permitir_venda_sem_estoque
    );
  }

  assert.equal(configDaEmpresa(empresaA), true);
  assert.equal(configDaEmpresa(empresaB), false);
  assert.equal(
    avaliarQuantidadeEstoquePdv({
      permitirVendaSemEstoque: configDaEmpresa(empresaA),
      disponivel: 0,
      quantidade: 1,
    }).ok,
    true
  );
  assert.equal(
    avaliarQuantidadeEstoquePdv({
      permitirVendaSemEstoque: configDaEmpresa(empresaB),
      disponivel: 0,
      quantidade: 1,
    }).ok,
    false
  );
});

test("revalidar estoque no momento da finalização agrega itens e usa saldo atual", () => {
  const estoque = new Map([
    ["p1", 2],
    ["p2", 0],
  ]);

  assert.equal(
    validarItensEstoquePdv({
      permitirVendaSemEstoque: false,
      itens: [
        { produtoId: "p1", quantidade: 1 },
        { produtoId: "p1", quantidade: 1 },
      ],
      estoquePorProduto: estoque,
    }).ok,
    true
  );

  const estouro = validarItensEstoquePdv({
    permitirVendaSemEstoque: false,
    itens: [
      { produtoId: "p1", quantidade: 1 },
      { produtoId: "p1", quantidade: 2 },
    ],
    estoquePorProduto: estoque,
  });
  assert.equal(estouro.ok, false);

  const zerado = validarItensEstoquePdv({
    permitirVendaSemEstoque: false,
    itens: [{ produtoId: "p2", quantidade: 1 }],
    estoquePorProduto: estoque,
  });
  assert.equal(zerado.ok, false);

  assert.equal(
    validarItensEstoquePdv({
      permitirVendaSemEstoque: true,
      itens: [{ produtoId: "p2", quantidade: 4 }],
      estoquePorProduto: estoque,
    }).ok,
    true
  );
});

test("ausência de registro trata estoque como 0 e default da empresa é bloquear", () => {
  assert.equal(permitirVendaSemEstoqueDoRegistro(undefined), false);
  assert.equal(permitirVendaSemEstoqueDoRegistro(null), false);
  assert.equal(permitirVendaSemEstoqueDoRegistro("true"), false);
  assert.equal(
    validarItensEstoquePdv({
      permitirVendaSemEstoque: false,
      itens: [{ produtoId: "inexistente", quantidade: 1 }],
      estoquePorProduto: new Map(),
    }).ok,
    false
  );
});

test("PDV web consulta a config da empresa ativa e revalida na finalização", () => {
  const action = fonte("app/pdv/actions.ts");
  const servidor = fonte("lib/pdv/venda-sem-estoque-servidor.ts");
  const apiMobile = fonte("app/api/pdv/finalizar/route.ts");

  assert.match(servidor, /from\("pdv_configuracoes"\)/);
  assert.match(servidor, /from\("estoque_atual"\)/);
  assert.match(servidor, /eq\("empresa_id", empresaId\)/);
  assert.match(servidor, /registroPertenceAEmpresaAtiva/);
  assert.match(servidor, /validarItensEstoquePdv/);
  assert.doesNotMatch(servidor, /input\.empresaId|body\.empresa_id/);

  assert.match(action, /validarEstoqueNaFinalizacaoPdv/);
  assert.ok(
    action.indexOf("validarEstoqueNaFinalizacaoPdv") <
      action.indexOf("rpc_finalizar_venda")
  );
  assert.match(action, /exigirCaixaAberto === true/);

  assert.match(apiMobile, /executarFinalizacaoVendaPdv\(corpo\)/);
  assert.doesNotMatch(apiMobile, /permitirVendaSemEstoque/);
  assert.doesNotMatch(apiMobile, /empresa_id|empresaId/);
});

test("migration persiste por empresa, default bloqueia e a baixa consulta a config", () => {
  const sql = fonte(MIGRATION);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.pdv_configuracoes/);
  assert.match(
    sql,
    /permitir_venda_sem_estoque boolean NOT NULL DEFAULT false/
  );
  assert.match(sql, /tem_acesso_empresa\(empresa_id\)/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE/);
  assert.match(sql, /DROP CONSTRAINT IF EXISTS estoque_atual_quantidade_check/);
  assert.match(sql, /estoque_baixar_composicao_venda_interno/);
  assert.match(sql, /FROM public\.pdv_configuracoes/);
  assert.match(sql, /rpc_definir_pdv_permitir_venda_sem_estoque/);
  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION public\.rpc_definir_pdv_permitir_venda_sem_estoque\(\s*p_permitir boolean/
  );
  assert.match(sql, /usuarios_empresas/);
  assert.match(sql, /principal = true/);
  assert.doesNotMatch(
    sql,
    /rpc_definir_pdv_permitir_venda_sem_estoque\(\s*p_empresa_id/
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.rpc_definir_pdv_permitir_venda_sem_estoque\(boolean\)\s+TO authenticated/
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.estoque_baixar_composicao_venda_interno/
  );
});

test("engrenagem do PDV web expõe a opção da empresa e o carrinho valida estoque", () => {
  const modal = fonte("components/pdv/pdv-preferencias-modal.tsx");
  const shell = fonte("components/pdv/pdv-shell.tsx");
  const page = fonte("app/pdv/page.tsx");
  const prefs = fonte("app/pdv/preferencias-actions.ts");

  assert.match(modal, /Permitir venda sem estoque/);
  assert.match(
    modal,
    /Permite concluir vendas mesmo quando o estoque disponível for insuficiente/
  );
  assert.match(shell, /avaliarQuantidadeEstoquePdv/);
  assert.match(shell, /permitirVendaSemEstoque/);
  assert.match(page, /pdv_configuracoes/);
  assert.match(page, /estoque_atual/);
  assert.match(prefs, /gravarPermitirVendaSemEstoqueSessao/);
  assert.doesNotMatch(fonte("components/pdv/pdv-edicao-shell.tsx"), /permitirVendaSemEstoque/);
});
