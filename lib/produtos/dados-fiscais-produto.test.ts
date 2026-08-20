import assert from "node:assert/strict";
import { test } from "node:test";

import {
  empresaA,
  empresaB,
  produtoA,
  produtoB,
} from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import {
  MENSAGEM_CEST_INVALIDO,
  MENSAGEM_FISCAL_NAO_GRAVADO,
  MENSAGEM_NCM_INVALIDO,
  escolherFiscalDaEmpresa,
  gravarFiscalNaEmpresa,
  lerDadosFiscaisProduto,
  payloadAtualizacaoFiscalProduto,
  validarDadosFiscaisProduto,
} from "./dados-fiscais-produto";

const formCadastro = fonte("app/produtos/produto-cadastro-form.tsx");
const actions = fonte("app/produtos/actions.ts");
const page = fonte("app/produtos/page.tsx");

function formFiscal(campos: Record<string, string>) {
  const form = new FormData();
  for (const [nome, valor] of Object.entries(campos)) {
    form.set(nome, valor);
  }
  return form;
}

test("A. novo produto sem fiscal pode ser salvo", () => {
  const dados = lerDadosFiscaisProduto(formFiscal({}));
  assert.equal(validarDadosFiscaisProduto(dados), null);
  assert.equal(dados.ncm, "");
  assert.equal(dados.cest, "");
  assert.equal(dados.origemProduto, "0");
  assert.match(formCadastro, /name="ncm"/);
  assert.doesNotMatch(formCadastro, /name="ncm"[\s\S]{0,200}required/);
  assert.match(actions, /validarDadosFiscaisProduto\(dadosFiscais\)/);
});

test("B. NCM válido, CEST vazio, origem 0 e grupo salvam ncm/cest/origem", () => {
  const dados = lerDadosFiscaisProduto(
    formFiscal({
      ncm: "12345678",
      cest: "",
      origem_produto: "0",
      grupo_fiscal_id: "grupo-a",
    })
  );

  assert.equal(validarDadosFiscaisProduto(dados), null);

  const payload = payloadAtualizacaoFiscalProduto(dados, true);
  assert.equal(payload.ncm, "12345678");
  assert.equal(payload.cest, null);
  assert.equal(payload.origem_produto, "0");
  assert.deepEqual(Object.keys(payload).sort(), [
    "cest",
    "fiscal_configurado",
    "ncm",
    "origem_produto",
  ]);
});

test("C. CEST vazio grava NULL", () => {
  const payload = payloadAtualizacaoFiscalProduto(
    lerDadosFiscaisProduto(formFiscal({ ncm: "12345678", cest: "   " })),
    false
  );
  assert.equal(payload.cest, null);
  assert.match(actions, /cest: dados\.cest \|\| null|payloadAtualizacaoFiscalProduto/);
});

test("D. NCM inválido é rejeitado na validação fiscal", () => {
  assert.equal(
    validarDadosFiscaisProduto(
      lerDadosFiscaisProduto(formFiscal({ ncm: "123" }))
    ),
    MENSAGEM_NCM_INVALIDO
  );
  assert.match(actions, /if \(erroFiscal\)/);
});

test("E. CEST preenchido inválido é rejeitado", () => {
  assert.equal(
    validarDadosFiscaisProduto(
      lerDadosFiscaisProduto(formFiscal({ cest: "12" }))
    ),
    MENSAGEM_CEST_INVALIDO
  );
});

test("F. editar produto recarrega ncm, cest e origem da mesma empresa", () => {
  assert.match(formCadastro, /somenteDigitos\(produto\?\.ncm\)/);
  assert.match(formCadastro, /somenteDigitos\(produto\?\.cest\)/);
  assert.match(formCadastro, /produto\?\.origem_produto \?\? "0"/);
  assert.match(page, /escolherFiscalDaEmpresa/);
  assert.match(page, /empresa_id,/);
  assert.match(page, /cest: fiscalProduto\?\.cest \?\? null/);
  assert.match(page, /origem_produto: fiscalProduto\?\.origem_produto \?\? null/);
});

test("G. Empresa A não lê nem grava fiscal da Empresa B", () => {
  const linhas = [
    {
      empresa_id: empresaA,
      produto_id: produtoA,
      ncm: "11111111",
      cest: null,
      origem_produto: "0",
    },
    {
      empresa_id: empresaB,
      produto_id: produtoB,
      ncm: "22222222",
      cest: "1111111",
      origem_produto: "1",
    },
  ];

  assert.equal(
    escolherFiscalDaEmpresa(linhas, empresaA)?.ncm,
    "11111111"
  );
  assert.equal(escolherFiscalDaEmpresa(linhas, empresaA)?.cest, null);
  assert.equal(
    escolherFiscalDaEmpresa(
      linhas.filter((linha) => linha.produto_id === produtoB),
      empresaA
    ),
    null
  );

  assert.equal(
    gravarFiscalNaEmpresa(
      linhas,
      empresaA,
      produtoB,
      payloadAtualizacaoFiscalProduto(
        lerDadosFiscaisProduto(formFiscal({ ncm: "99999999" })),
        false
      )
    ),
    null
  );

  const gravado = gravarFiscalNaEmpresa(
    linhas,
    empresaA,
    produtoA,
    payloadAtualizacaoFiscalProduto(
      lerDadosFiscaisProduto(formFiscal({ ncm: "12345678", cest: "" })),
      false
    )
  );
  assert.equal(gravado?.ncm, "12345678");
  assert.equal(gravado?.cest, null);
  assert.equal(
    linhas.find((linha) => linha.empresa_id === empresaB)?.ncm,
    "22222222"
  );

  const persistir = actions.slice(
    actions.indexOf("async function persistirDadosFiscaisProduto")
  );
  assert.match(persistir, /\.eq\("empresa_id", empresaId\)/);
  assert.match(persistir, /\.eq\("produto_id", produtoId\)/);
  assert.match(actions, /getContexto\(\)/);
  assert.doesNotMatch(
    persistir.slice(0, persistir.indexOf("export async function cadastrarProduto")),
    /icms_cst_csosn:|pis_cst:|cofins_cst:|cst_ibscbs:/
  );
});

test("cadastro principal não copia regras do grupo para o produto", () => {
  assert.doesNotMatch(formCadastro, /name="cfop_interno"/);
  assert.doesNotMatch(formCadastro, /name="icms_cst_csosn"/);
  assert.doesNotMatch(formCadastro, /name="pis_cst"/);
  assert.doesNotMatch(formCadastro, /name="cofins_cst"/);
  assert.doesNotMatch(formCadastro, /name="ipi_cst"/);
  assert.doesNotMatch(formCadastro, /name="cst_ibscbs"/);
  assert.doesNotMatch(formCadastro, /name="classificacao_ibscbs"/);
  assert.match(formCadastro, /Dados fiscais/);
  assert.match(formCadastro, /placeholder="00000000"/);
  assert.match(
    formCadastro,
    /Opcional — informe somente quando aplicável ao produto/
  );
  assert.doesNotMatch(formCadastro, /defaultValue=\{?"1111111"/);
  assert.match(actions, /persistirDadosFiscaisProduto/);
  assert.match(actions, /MENSAGEM_FISCAL_NAO_GRAVADO/);
  assert.equal(
    MENSAGEM_FISCAL_NAO_GRAVADO,
    "O produto comercial foi salvo, mas a configuração fiscal não foi gravada."
  );
});
