import assert from "node:assert/strict";
import test from "node:test";

import {
  escolherFormaTef,
  escolherPixMaquininha,
  ehPixMaquininha,
  modalidadePinpadDaForma,
  opcoesCreditoTef,
} from "./atalhos-checkout";

const creditoC6 = {
  id: "credito-c6",
  codigo: "CC",
  nome: "Crédito C6 PAY",
  tipo: "cartao",
  codigo_fiscal: "03",
  permite_parcelamento: true,
  ordem: 2,
};
const creditoOutro = {
  id: "credito-loja",
  codigo: "CC2",
  nome: "Crédito loja",
  tipo: "cartao",
  codigo_fiscal: "03",
  permite_parcelamento: false,
  ordem: 1,
};
const debitoC6 = {
  id: "debito-c6",
  codigo: "CD",
  nome: "Débito C6 PAY",
  tipo: "cartao",
  codigo_fiscal: "04",
  ordem: 3,
};
const pixMaquina = {
  id: "pix-c6",
  codigo: "PIX_C6",
  nome: "PIX C6 PAY",
  tipo: "pix",
  ordem: 4,
};
const pixQr = {
  id: "pix-qr",
  codigo: "PIX",
  nome: "PIX C6 Bank",
  tipo: "pix",
  ordem: 5,
};
const dinheiro = {
  id: "dinheiro",
  codigo: "DH",
  nome: "Dinheiro",
  tipo: "dinheiro",
  permite_troco: true,
  ordem: 0,
};

test("crédito e débito escolhem a forma C6 PAY da empresa", () => {
  const formas = [creditoOutro, creditoC6, debitoC6, dinheiro];
  assert.equal(escolherFormaTef(formas, "credito")?.id, "credito-c6");
  assert.equal(escolherFormaTef(formas, "debito")?.id, "debito-c6");
  assert.deepEqual(
    opcoesCreditoTef(creditoC6).map((item) => item.codigo),
    ["avista", "parcelado"]
  );
  assert.deepEqual(
    opcoesCreditoTef({ ...creditoC6, permite_parcelamento: false }).map((item) => item.codigo),
    ["avista"]
  );
});

test("PIX na maquininha não usa o QR do C6 Bank", () => {
  assert.equal(ehPixMaquininha(pixMaquina), true);
  assert.equal(ehPixMaquininha(pixQr), false);
  assert.equal(escolherPixMaquininha([pixQr, pixMaquina, dinheiro])?.id, "pix-c6");
  assert.equal(modalidadePinpadDaForma(pixMaquina), "pix");
  assert.equal(modalidadePinpadDaForma(pixQr), null);
  assert.equal(modalidadePinpadDaForma(debitoC6), "debito");
});
