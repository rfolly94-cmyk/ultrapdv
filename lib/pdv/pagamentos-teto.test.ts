import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  MENSAGEM_PAGAMENTOS_ULTRAPASSAM,
  MENSAGEM_PIX_ULTRAPASSA_SALDO,
  avaliarPagamentosPdv,
  recalcularTotalLiquidoVenda,
  saldoRestanteParaParcela,
  validarParcelaPixContraSaldo,
} from "./pagamentos-teto";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");

function fonte(...partes: string[]) {
  return readFileSync(join(raiz, ...partes), "utf8");
}

const pix = { permiteTroco: false };
const cartao = { permiteTroco: false };
const fiado = { permiteTroco: false };
const dinheiro = { permiteTroco: true };

test("1. venda 100 / PIX 100 → permite", () => {
  const r = avaliarPagamentosPdv({
    totalVendaCentavos: 10000,
    pagamentos: [{ valorCentavos: 10000, ...pix }],
  });
  assert.equal(r.bloqueado, false);
  assert.equal(r.trocoCentavos, 0);
});

test("2. venda 100 / PIX 1000 → bloqueia", () => {
  const r = avaliarPagamentosPdv({
    totalVendaCentavos: 10000,
    pagamentos: [{ valorCentavos: 100000, ...pix }],
  });
  assert.equal(r.bloqueado, true);
  assert.equal(r.excedenteCentavos, 90000);
  assert.match(r.mensagem ?? "", /R\$\s*100,00/);
  assert.match(r.mensagem ?? "", /R\$\s*1.000,00/);
  assert.match(r.mensagem ?? "", /R\$\s*900,00/);
  assert.match(
    r.mensagem ?? "",
    new RegExp(MENSAGEM_PAGAMENTOS_ULTRAPASSAM.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  );
});

test("3. venda 100 / PIX 60 + cartão 50 → bloqueia", () => {
  const r = avaliarPagamentosPdv({
    totalVendaCentavos: 10000,
    pagamentos: [
      { valorCentavos: 6000, ...pix },
      { valorCentavos: 5000, ...cartao },
    ],
  });
  assert.equal(r.bloqueado, true);
  assert.equal(r.excedenteCentavos, 1000);
});

test("4. venda 100 / dinheiro 40 + PIX 60 → permite", () => {
  const r = avaliarPagamentosPdv({
    totalVendaCentavos: 10000,
    pagamentos: [
      { valorCentavos: 4000, ...dinheiro },
      { valorCentavos: 6000, ...pix },
    ],
  });
  assert.equal(r.bloqueado, false);
  assert.equal(r.trocoCentavos, 0);
});

test("5. venda 100 / dinheiro 70 + PIX 50 → permite com troco 20", () => {
  const r = avaliarPagamentosPdv({
    totalVendaCentavos: 10000,
    pagamentos: [
      { valorCentavos: 7000, ...dinheiro },
      { valorCentavos: 5000, ...pix },
    ],
  });
  assert.equal(r.bloqueado, false);
  assert.equal(r.trocoCentavos, 2000);
});

test("6. desconto reduz total e trava usa total líquido", () => {
  const totalLiquido = recalcularTotalLiquidoVenda({
    itens: [{ quantidade: 1, precoUnitarioCentavos: 12000 }],
    descontoCentavos: 2000,
  });
  const r = avaliarPagamentosPdv({
    totalVendaCentavos: totalLiquido,
    pagamentos: [{ valorCentavos: 12000, ...pix }],
  });
  assert.equal(totalLiquido, 10000);
  assert.equal(r.bloqueado, true);
  assert.match(r.mensagem ?? "", /R\$\s*100,00/);
});

test("7. fiado acima do total da venda bloqueia", () => {
  const r = avaliarPagamentosPdv({
    totalVendaCentavos: 10000,
    pagamentos: [{ valorCentavos: 11000, ...fiado }],
  });
  assert.equal(r.bloqueado, true);
});

test("8. cartão acima do restante bloqueia", () => {
  const r = avaliarPagamentosPdv({
    totalVendaCentavos: 10000,
    pagamentos: [{ valorCentavos: 15000, ...cartao }],
  });
  assert.equal(r.bloqueado, true);
});

test("9. PIX Local acima do restante não gera QR", () => {
  assert.throws(
    () =>
      validarParcelaPixContraSaldo({
        valorPixCentavos: 10000,
        saldoRestanteCentavos: 4000,
      }),
    new RegExp(MENSAGEM_PIX_ULTRAPASSA_SALDO)
  );
  assert.match(fonte("lib/pagamentos/pix/local-pdv.ts"), /validarParcelaPixContraSaldo/);
});

test("10. PIX Geranet acima do restante não cria cobrança", () => {
  assert.equal(saldoRestanteParaParcela({
    totalVendaCentavos: 10000,
    outrosPagamentosCentavos: 6000,
  }), 4000);
  assert.match(fonte("lib/pagamentos/pix/geranet-pdv.ts"), /validarParcelaPixContraSaldo/);
});

test("11. frontend bloqueia", () => {
  const shell = fonte("components/pdv/pdv-shell.tsx");
  assert.match(shell, /avaliarPagamentosPdv/);
  assert.match(shell, /pagamentoExcedente/);
  assert.match(shell, /disabled=\{isPending \|\| totalCentavos <= 0 \|\| avaliacaoPagamentos.bloqueado\}/);
});

test("12. chamada direta ao servidor também bloqueia", () => {
  const acao = [
    fonte("app/pdv/actions.ts"),
    fonte("lib/pdv/validar-teto-servidor.ts"),
  ].join("\n");
  assert.match(acao, /avaliarTetoPagamentosNoServidor/);
  assert.match(acao, /avaliarPagamentosPdv/);
  assert.match(acao, /preco_venda/);
  assert.match(acao, /permite_troco/);
  assert.match(acao, /rpc_finalizar_venda/);
});

test("13. valores com centavos funcionam corretamente", () => {
  const r = avaliarPagamentosPdv({
    totalVendaCentavos: 1099,
    pagamentos: [{ valorCentavos: 1100, ...pix }],
  });
  assert.equal(r.bloqueado, true);
  assert.equal(r.excedenteCentavos, 1);
  const ok = avaliarPagamentosPdv({
    totalVendaCentavos: 1099,
    pagamentos: [{ valorCentavos: 1099, ...pix }],
  });
  assert.equal(ok.bloqueado, false);
});

test("14. dinheiro/troco existente continua funcionando", () => {
  const r = avaliarPagamentosPdv({
    totalVendaCentavos: 10000,
    pagamentos: [{ valorCentavos: 15000, ...dinheiro }],
  });
  assert.equal(r.bloqueado, false);
  assert.equal(r.trocoCentavos, 5000);
});

test("15. pagamentos divididos existentes continuam funcionando", () => {
  const r = avaliarPagamentosPdv({
    totalVendaCentavos: 10000,
    pagamentos: [
      { valorCentavos: 4000, ...dinheiro },
      { valorCentavos: 3000, ...pix },
      { valorCentavos: 3000, ...cartao },
    ],
  });
  assert.equal(r.bloqueado, false);
  assert.equal(r.totalInformadoCentavos, 10000);
});
