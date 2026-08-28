import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import { exportarBalanca } from "../exportar-balanca";
import type { ConfiguracaoBalanca, ProdutoCargaBalanca } from "../tipos";
import { MENSAGEM_LAYOUT_NAO_IMPLEMENTADO } from "../tipos";
import { exportarFilizola } from "./filizola";
import { exportarUrano } from "./urano";
import {
  ARQUIVO_ITENS_MGV7,
  MGV7_TAMANHO_DESCRICAO,
  codigoItemMgv7,
  descreverItemMgv7,
  encodeWindows1252,
  exportarToledoMgv7,
  montarLinhaItensMgv7,
  reaisParaCentavosMgv7,
  validadeMgv7,
} from "./toledo-mgv7";

function txt(valor: string, tamanho: number) {
  return valor.padEnd(tamanho, " ");
}

function produto(parcial: Partial<ProdutoCargaBalanca> = {}): ProdutoCargaBalanca {
  return {
    plu: "1234",
    codigoProduto: "SKU-NAO-USAR",
    descricao: "Banana prata",
    preco: 59.9,
    unidade: "KG",
    validadeDias: 2,
    tara: 0.05,
    departamento: "1",
    mensagem: "não vai para o MGV7",
    ...parcial,
  };
}

function linhaEsperada(params: {
  depto: string;
  tipo: string;
  plu: string;
  preco: string;
  validade: string;
  d1: string;
  d2?: string;
  d3?: string;
  d4?: string;
  dv: string;
  de: string;
}) {
  return (
    params.depto +
    params.tipo +
    params.plu +
    params.preco +
    params.validade +
    txt(params.d1, 25) +
    txt(params.d2 ?? "", 25) +
    "000000" +
    "0000" +
    "000000" +
    params.dv +
    params.de +
    "0000" +
    txt("", 12) +
    txt("", 11) +
    "0" +
    "0000" +
    "0000" +
    "0000" +
    "0000" +
    "0000" +
    "0000" +
    txt("", 12) +
    "000000" +
    "||" +
    txt(params.d3 ?? "", 35) +
    txt(params.d4 ?? "", 35) +
    "000000" +
    "000000" +
    "000000" +
    "000000" +
    "0" +
    "||" +
    "0" +
    "||" +
    txt("", 12) +
    "0000" +
    "000000" +
    "||" +
    "0" +
    "00000" +
    "\r\n"
  );
}

const FIXTURE_BANANA_5990 = linhaEsperada({
  depto: "01",
  tipo: "0",
  plu: "001234",
  preco: "005990",
  validade: "002",
  d1: "Banana prata",
  dv: "1",
  de: "1",
});

test("R$ 59,90 vira exatamente 005990 no MGV7", () => {
  const centavos = reaisParaCentavosMgv7(59.9);
  assert.deepEqual(centavos, { ok: true, centavos: 5990 });
  const precoOficial = reaisParaCentavosMgv7(2.78);
  assert.deepEqual(precoOficial, { ok: true, centavos: 278 });
});

test("Itensmgv.txt v4 gera linha posicional exata com CRLF", () => {
  const saida = montarLinhaItensMgv7(produto());
  assert.equal(saida.ok, true);
  if (!saida.ok) {
    return;
  }
  assert.equal(saida.linha, FIXTURE_BANANA_5990);
  assert.equal(saida.linha.endsWith("\r\n"), true);
  assert.equal(saida.linha.length, 290);
  assert.equal(saida.linha.slice(0, 2), "01");
  assert.equal(saida.linha.slice(2, 3), "0");
  assert.equal(saida.linha.slice(3, 9), "001234");
  assert.equal(saida.linha.slice(9, 15), "005990");
  assert.equal(saida.linha.slice(15, 18), "002");
  assert.equal(saida.linha.includes(","), false);
  assert.equal(saida.linha.includes(";"), false);
  assert.equal(saida.linha.includes("SKU-NAO-USAR"), false);
});

test("arquivo Itensmgv.txt junta vários produtos sem UUID interno", () => {
  const saida = exportarToledoMgv7([
    produto(),
    produto({
      plu: "99",
      descricao: "Maçã fuji",
      preco: 12.5,
      validadeDias: null,
      departamento: "06",
    }),
  ]);
  assert.equal(saida.ok, true);
  if (!saida.ok) {
    return;
  }
  assert.equal(saida.nomeArquivo, ARQUIVO_ITENS_MGV7);
  const maca = linhaEsperada({
    depto: "06",
    tipo: "0",
    plu: "000099",
    preco: "001250",
    validade: "000",
    d1: "Maçã fuji",
    dv: "0",
    de: "0",
  });
  assert.equal(saida.conteudo, FIXTURE_BANANA_5990 + maca);
  assert.equal(saida.conteudo.includes(empresaA), false);
  assert.equal(saida.conteudo.includes(empresaB), false);
});

test("acentuação cabe em 1 byte Windows-1252 e respeita D1/D2/D3/D4", () => {
  const encoded = encodeWindows1252("Açaí");
  assert.equal(Array.isArray(encoded), true);
  if (Array.isArray(encoded)) {
    assert.deepEqual(encoded, [0x41, 0xe7, 0x61, 0xed]);
  }

  const longa = "A".repeat(26);
  const desc = descreverItemMgv7(longa);
  assert.equal(desc.ok, true);
  if (!desc.ok) {
    return;
  }
  assert.equal(desc.d1, "A".repeat(25));
  assert.equal(desc.d2, "A" + " ".repeat(24));
  assert.equal(desc.d3.length, 35);
  assert.equal(desc.d4.length, 35);

  const estouro = descreverItemMgv7("A".repeat(MGV7_TAMANHO_DESCRICAO + 1));
  assert.equal(estouro.ok, false);

  const invalido = encodeWindows1252("banana😀");
  assert.equal("erro" in invalido, true);
});

test("PLU, validade e código do item seguem a spec MGV7", () => {
  assert.deepEqual(codigoItemMgv7("1234"), { ok: true, valor: "001234" });
  assert.equal(codigoItemMgv7("1234567").ok, false);
  assert.equal(codigoItemMgv7("12a").ok, false);
  assert.deepEqual(validadeMgv7(null), {
    ok: true,
    valor: "000",
    dias: 0,
    imprimeDatas: false,
  });
  assert.equal(validadeMgv7(991).ok, false);
  assert.equal(validadeMgv7(1000).ok, false);
});

test("Urano e Filizola continuam sem adapter", () => {
  assert.deepEqual(exportarUrano("qualquer", [produto()]), {
    ok: false,
    erro: MENSAGEM_LAYOUT_NAO_IMPLEMENTADO,
  });
  assert.deepEqual(exportarFilizola("qualquer", [produto()]), {
    ok: false,
    erro: MENSAGEM_LAYOUT_NAO_IMPLEMENTADO,
  });
});

test("exportação MGV7 da empresa A não serializa produto da B", () => {
  const configA: ConfiguracaoBalanca = {
    id: "cfg-a",
    empresaId: empresaA,
    nome: "Toledo Açougue",
    fabricante: "toledo",
    modelo: "Prix 4 Uno",
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
    },
    ativo: true,
  };

  const saida = exportarBalanca({
    config: configA,
    vinculados: [
      {
        produtoId: "p-a",
        empresaId: empresaA,
        codigo: "A1",
        nome: "Alcatra",
        unidade: "KG",
        precoVenda: 59.9,
        configuracaoId: "cfg-a",
        enviarBalanca: true,
        plu: "10",
        descricaoBalanca: "Alcatra",
        validadeEtiquetaDias: 3,
        taraPadrao: null,
        departamento: "02",
        mensagem: null,
        status: "pronto",
        problemas: [],
      },
      {
        produtoId: "p-b",
        empresaId: empresaB,
        codigo: "B1",
        nome: "Item B",
        unidade: "KG",
        precoVenda: 8,
        configuracaoId: "cfg-b",
        enviarBalanca: false,
        plu: "20",
        descricaoBalanca: "Item B",
        validadeEtiquetaDias: 1,
        taraPadrao: null,
        departamento: "03",
        mensagem: null,
        status: "nao_vinculado",
        problemas: [],
      },
    ],
    somenteValidos: true,
  });

  assert.equal(saida.ok, true);
  if (!saida.ok) {
    return;
  }
  assert.equal(saida.nomeArquivo, "Itensmgv.txt");
  assert.equal(saida.conteudo.includes("000010"), true);
  assert.equal(saida.conteudo.includes("000020"), false);
  assert.equal(saida.conteudo.includes("Item B"), false);
  assert.equal(saida.conteudo.includes(empresaB), false);
});
