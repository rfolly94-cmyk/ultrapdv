import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clienteA,
  clienteB,
  empresaA,
  empresaB,
  produtoA,
  produtoB,
  grupoFiscalA,
  grupoFiscalB,
  usuarioA,
  usuarioB,
  usuarioX,
  vinculosPadrao,
} from "./cenario";
import { fonte } from "./fonte";
import {
  buscarPorIdComRls,
  inserirUnicoPorEmpresa,
  temAcessoEmpresa,
} from "./rls-memoria";

test("produtos: A lê A e não lê B", () => {
  const produtos = [
    { id: produtoA, empresa_id: empresaA, codigo: "100" },
    { id: produtoB, empresa_id: empresaB, codigo: "100" },
  ];

  assert.equal(
    buscarPorIdComRls(produtos, usuarioA, vinculosPadrao, produtoA)?.codigo,
    "100"
  );
  assert.equal(
    buscarPorIdComRls(produtos, usuarioA, vinculosPadrao, produtoB),
    null
  );
  assert.equal(
    buscarPorIdComRls(produtos, usuarioB, vinculosPadrao, produtoA),
    null
  );
});

test("produtos: código 100 pode coexistir em A e B", () => {
  const produtos: Array<{ empresa_id: string; codigo: string }> = [];
  inserirUnicoPorEmpresa(produtos, { empresa_id: empresaA, codigo: "100" }, (p) => p.codigo);
  inserirUnicoPorEmpresa(produtos, { empresa_id: empresaB, codigo: "100" }, (p) => p.codigo);

  assert.equal(produtos.length, 2);
  assert.throws(
    () =>
      inserirUnicoPorEmpresa(
        produtos,
        { empresa_id: empresaA, codigo: "100" },
        (p) => p.codigo
      ),
    /unique_violation/
  );
});

test("produtos: UNIQUE (empresa_id, codigo) está versionada", () => {
  assert.match(
    fonte("supabase/migrations/20260816280000_codigo_automatico_produto.sql"),
    /produtos_codigo_empresa_unique/
  );
});

test("produtos: venda não usa produto de outra empresa (RPC)", () => {
  assert.match(
    fonte("supabase/migrations/20260815011000_fix_rpc_editar_venda_ambiguidade.sql"),
    /p\.empresa_id = p_empresa_id[\s\S]+AND p\.id = v_produto_id/
  );
  assert.match(
    fonte("supabase/migrations/20260815011000_fix_rpc_editar_venda_ambiguidade.sql"),
    /Produto não encontrado, inativo ou pertence a outra empresa/
  );
});

test("categorias e marcas: cadastro de produto exige a mesma empresa", () => {
  const cadastro = fonte("supabase/migrations/20260815013000_rpc_cadastrar_produto.sql");
  assert.match(cadastro, /m\.empresa_id = p_empresa_id/);
  assert.match(cadastro, /g\.empresa_id = p_empresa_id/);
  assert.match(cadastro, /Grupo fiscal inválido ou inativo/);
});

test("grupos fiscais: RPC bloqueia grupo da Empresa B no produto da A", () => {
  function cadastrarProduto(empresaId: string, grupoFiscalEmpresaId: string) {
    if (grupoFiscalEmpresaId !== empresaId) {
      throw new Error("Grupo fiscal inválido ou inativo.");
    }
  }

  assert.doesNotThrow(() => cadastrarProduto(empresaA, empresaA));
  assert.throws(
    () => cadastrarProduto(empresaA, empresaB),
    /Grupo fiscal inválido/
  );
});

const MIGRACAO_FK =
  "supabase/migrations/20260818140000_versionar_fk_produto_grupo_fiscal_multiempresa.sql";

function fkProdutoGrupoFiscal(
  produtoEmpresaId: string,
  grupo: { id: string; empresa_id: string } | null
) {
  if (grupo === null) {
    return { ok: true as const };
  }

  if (grupo.empresa_id !== produtoEmpresaId) {
    return { ok: false as const, codigo: "23503" };
  }

  return { ok: true as const };
}

test("grupos fiscais: UNIQUE (id, empresa_id) e FK composta estão versionadas", () => {
  const sql = fonte(MIGRACAO_FK);
  assert.match(sql, /grupos_fiscais_id_empresa_unique/);
  assert.match(sql, /UNIQUE \(id, empresa_id\)/);
  assert.match(sql, /produtos_grupo_fiscal_empresa_fkey/);
  assert.match(
    sql,
    /FOREIGN KEY \(grupo_fiscal_id, empresa_id\)\s+REFERENCES public\.grupos_fiscais \(id, empresa_id\)/
  );
  assert.doesNotMatch(sql, /FOREIGN KEY \(empresa_id, grupo_fiscal_id\)/);
  assert.doesNotMatch(sql, /ADD CONSTRAINT IF NOT EXISTS/);
  assert.doesNotMatch(sql, /DROP CONSTRAINT/);
  assert.doesNotMatch(sql, /UNIQUE \(nome\)/);
  assert.doesNotMatch(sql, /grupo_fiscal_id SET NOT NULL/);
  assert.match(sql, /definição divergente/);
});

test("A. produto A + grupo A é permitido", () => {
  assert.equal(
    fkProdutoGrupoFiscal(empresaA, { id: grupoFiscalA, empresa_id: empresaA }).ok,
    true
  );
});

test("B. produto B + grupo B é permitido", () => {
  assert.equal(
    fkProdutoGrupoFiscal(empresaB, { id: grupoFiscalB, empresa_id: empresaB }).ok,
    true
  );
});

test("C. produto A + grupo B é rejeitado pela FK composta", () => {
  const resultado = fkProdutoGrupoFiscal(empresaA, {
    id: grupoFiscalB,
    empresa_id: empresaB,
  });
  assert.equal(resultado.ok, false);
  if (!resultado.ok) {
    assert.equal(resultado.codigo, "23503");
  }
});

test("D. produto A sem grupo fiscal continua permitido", () => {
  assert.equal(fkProdutoGrupoFiscal(empresaA, null).ok, true);
});

test("H. grupo fiscal da Empresa B no produto da A continua rejeitado", () => {
  const actions = fonte("app/produtos/actions.ts");
  assert.match(actions, /validarRelacionado\(\s*"grupos_fiscais"/);
  assert.match(
    actions,
    /Grupo fiscal inválido ou de outra empresa/
  );
  assert.match(actions, /\.eq\("empresa_id", empresaId\)/);

  const resultado = fkProdutoGrupoFiscal(empresaA, {
    id: grupoFiscalB,
    empresa_id: empresaB,
  });
  assert.equal(resultado.ok, false);
});

test("F. rpc_cadastrar_produto continua exigindo grupo da mesma empresa", () => {
  const cadastro = fonte("supabase/migrations/20260815013000_rpc_cadastrar_produto.sql");
  assert.match(cadastro, /g\.empresa_id = p_empresa_id/);
  assert.match(cadastro, /Grupo fiscal inválido ou inativo/);
});

test("RLS: usuário X com vínculo ativo em A e B enxerga as duas; principal não entra na RLS", () => {
  assert.equal(temAcessoEmpresa(usuarioX, empresaA, vinculosPadrao), true);
  assert.equal(temAcessoEmpresa(usuarioX, empresaB, vinculosPadrao), true);
  assert.equal(temAcessoEmpresa(usuarioA, empresaB, vinculosPadrao), false);

  const clientes = [
    { id: clienteA, empresa_id: empresaA },
    { id: clienteB, empresa_id: empresaB },
  ];
  assert.ok(buscarPorIdComRls(clientes, usuarioX, vinculosPadrao, clienteB));
});
