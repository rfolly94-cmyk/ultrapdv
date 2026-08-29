import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  distribuirValorProporcional,
  normalizarTotaisNota,
  totalLiquidoNota,
  totaisNotaDoSnapshot,
  validarTotaisNota,
} from "./totais-nota";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

test("totais da nota saem zerados sem snapshot", () => {
  assert.deepEqual(totaisNotaDoSnapshot(null), {
    frete: 0,
    seguro: 0,
    outro: 0,
    desconto: 0,
  });
});

test("totais da nota leem snapshot_fiscal.totais_nota", () => {
  const totais = totaisNotaDoSnapshot({
    totais_nota: { frete: 10.5, seguro: 1, outro: 2, desconto: 3.1 },
  });
  assert.equal(totais.frete, 10.5);
  assert.equal(totais.seguro, 1);
  assert.equal(totais.outro, 2);
  assert.equal(totais.desconto, 3.1);
});

test("total da NF-e soma produtos + frete + seguro + outro − desconto", () => {
  assert.equal(
    totalLiquidoNota(100, {
      frete: 10,
      seguro: 5,
      outro: 2,
      desconto: 7,
    }),
    110
  );
});

test("desconto maior que produtos é recusado", () => {
  assert.match(
    validarTotaisNota({
      totalProdutos: 10,
      totais: normalizarTotaisNota({ desconto: 10.01 }),
    }) ?? "",
    /desconto/i
  );
});

test("rateio de frete fecha no último item", () => {
  const mapa = distribuirValorProporcional({
    valor: 10,
    itens: [
      { id: "a", baseCentavos: 7000 },
      { id: "b", baseCentavos: 3000 },
    ],
  });
  assert.equal(Math.round((mapa.get("a") ?? 0) * 100), 700);
  assert.equal(Math.round((mapa.get("b") ?? 0) * 100), 300);
});

test("Nova NF-e persiste e emite totais editáveis", () => {
  const form = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");
  const actions = fonte("app/fiscal/nfe/operacoes-actions.ts");
  const emitirOperacao = fonte("app/api/fiscal/geranet/nfe-emitir-operacao/route.ts");
  const emitirVenda = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  assert.match(form, /Valor do Frete \(R\$\)/);
  assert.match(form, /salvarTotaisOperacaoFiscal/);
  assert.match(form, /from "@\/lib\/fiscal\/nfe55\/totais-nota"/);
  assert.match(form, /normalizarTotaisNota/);
  assert.match(form, /totalLiquidoNota/);
  assert.match(actions, /totais_nota/);
  assert.match(emitirOperacao, /totaisNotaDoSnapshot/);
  assert.match(emitirVenda, /totaisFiscaisEmissaoNfeVenda/);
  assert.match(emitirVenda, /aplicarPrecosComerciaisOperacaoNosItensVenda/);
  assert.doesNotMatch(emitirVenda, /temTotaisSnapshot/);
  assert.doesNotMatch(
    emitirVenda,
    /ainda não transmite NF-e com acréscimo global/
  );
});
