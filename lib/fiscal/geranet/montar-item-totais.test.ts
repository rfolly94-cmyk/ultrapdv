import assert from "node:assert/strict";
import { test } from "node:test";

import { calcularTotaisItemGeranet } from "./montar-item";

test("venda 31: Geranet bruto 35 e desconto 33; líquido 2 só na conferência", () => {
  const totais = calcularTotaisItemGeranet({
    quantidade: 1,
    valorUnitario: 35,
    desconto: 33,
  });

  assert.equal(totais.valorBrutoItem.toFixed(2), "35.00");
  assert.equal(totais.desconto.toFixed(8), "33.00000000");
  assert.equal(totais.valorLiquidoFiscal.toFixed(2), "2.00");
  assert.notEqual(
    totais.valorBrutoItem.toFixed(2),
    totais.valorLiquidoFiscal.toFixed(2)
  );
});

test("35 com desconto 34: valorTotal Geranet 35, líquido 1", () => {
  const totais = calcularTotaisItemGeranet({
    quantidade: 1,
    valorUnitario: 35,
    desconto: 34,
  });

  assert.equal(totais.valorBrutoItem.toFixed(2), "35.00");
  assert.equal(totais.desconto.toFixed(8), "34.00000000");
  assert.equal(totais.valorLiquidoFiscal.toFixed(2), "1.00");
});
