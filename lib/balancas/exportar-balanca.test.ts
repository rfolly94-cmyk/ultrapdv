import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, produtoA } from "@/lib/multiempresa/cenario";
import { exportarBalanca, montarCargaProdutosValidos } from "./exportar-balanca";
import {
  MENSAGEM_EXPORTACAO_COM_INVALIDOS,
  MENSAGEM_LAYOUT_NAO_IMPLEMENTADO,
  type ConfiguracaoBalanca,
  type ProdutoVinculadoBalanca,
} from "./tipos";

const config: ConfiguracaoBalanca = {
  id: "cfg-a",
  empresaId: empresaA,
  nome: "Toledo",
  fabricante: "toledo",
  modelo: null,
  layout: "mgv7",
  tipoIntegracao: "arquivo",
  configuracao: {
    etiqueta: {
      prefixo: "",
      plu: true,
      modo: "peso",
      quantidadeDigitos: 6,
      casasDecimais: 3,
      digitoVerificador: false,
    },
    departamentoPadrao: "01",
  },
  ativo: true,
};

function item(
  parcial: Partial<ProdutoVinculadoBalanca>
): ProdutoVinculadoBalanca {
  return {
    produtoId: produtoA,
    empresaId: empresaA,
    codigo: "100",
    nome: "Banana",
    unidade: "KG",
    precoVenda: 9.9,
    configuracaoId: "cfg-a",
    enviarBalanca: true,
    plu: "1234",
    descricaoBalanca: "Banana kg",
    validadeEtiquetaDias: 2,
    taraPadrao: 0.01,
    departamento: "01",
    mensagem: null,
    status: "pronto",
    problemas: [],
    ...parcial,
  };
}

test("preço da carga vem de preco_venda e muda na próxima montagem", () => {
  const primeira = montarCargaProdutosValidos([item({ precoVenda: 4.5 })]);
  const segunda = montarCargaProdutosValidos([item({ precoVenda: 6.7 })]);
  assert.equal(primeira[0]?.preco, 4.5);
  assert.equal(segunda[0]?.preco, 6.7);
});

test("exportação bloqueia registros inválidos", () => {
  const saida = exportarBalanca({
    config,
    vinculados: [
      item({}),
      item({
        produtoId: "p2",
        status: "plu_ausente",
        problemas: ["Informe o PLU"],
      }),
    ],
    somenteValidos: false,
  });
  assert.deepEqual(saida, {
    ok: false,
    erro: MENSAGEM_EXPORTACAO_COM_INVALIDOS,
  });
});

test("Toledo MGV7 gera Itensmgv.txt e os demais fabricantes continuam bloqueados", () => {
  const saida = exportarBalanca({
    config,
    vinculados: [item({})],
    somenteValidos: true,
  });
  assert.equal(saida.ok, true);
  if (!saida.ok) {
    return;
  }
  assert.equal(saida.nomeArquivo, "Itensmgv.txt");
  assert.equal(saida.conteudo.includes("\r\n"), true);
  assert.equal(saida.conteudo.slice(9, 15), "000990");

  assert.deepEqual(
    exportarBalanca({
      config: { ...config, fabricante: "urano", layout: "qualquer" },
      vinculados: [item({})],
      somenteValidos: true,
    }),
    { ok: false, erro: MENSAGEM_LAYOUT_NAO_IMPLEMENTADO }
  );
});

test("exportação da configuração A não inclui produtos exclusivos da B", () => {
  const carga = montarCargaProdutosValidos([
    item({
      produtoId: "p-a",
      codigo: "A1",
      configuracaoId: "cfg-a",
      enviarBalanca: true,
    }),
    item({
      produtoId: "p-b",
      codigo: "B1",
      configuracaoId: "cfg-b",
      enviarBalanca: false,
      status: "nao_vinculado",
    }),
  ]);
  assert.equal(carga.length, 1);
  assert.equal(carga[0]?.codigoProduto, "A1");
  assert.equal(
    montarCargaProdutosValidos([
      item({ produtoId: "p-b", enviarBalanca: false, status: "pronto" }),
    ]).length,
    0
  );
});

test("carga usa departamento padrão 01 quando o produto não tem próprio", () => {
  const carga = montarCargaProdutosValidos(
    [item({ departamento: null })],
    "01"
  );
  assert.equal(carga[0]?.departamento, "01");
  assert.equal(
    montarCargaProdutosValidos([item({ departamento: "03" })], "01")[0]
      ?.departamento,
    "03"
  );
});
