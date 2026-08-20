import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "../multiempresa/fonte";
import {
  celularBrasileiroValido,
  formatarTelefoneBrasileiro,
  montarTelefoneWhatsapp,
  normalizarTelefoneBrasileiro,
} from "./telefone";
import { urlWhatsapp } from "./whatsapp";

const WHATSAPP = "5566999179897";

test("normaliza celular brasileiro sem DDI duplicado", () => {
  assert.equal(normalizarTelefoneBrasileiro("(66) 99917-9897"), "66999179897");
  assert.equal(normalizarTelefoneBrasileiro("66999179897"), "66999179897");
  assert.equal(normalizarTelefoneBrasileiro("55 66 99917-9897"), "66999179897");
  assert.equal(
    normalizarTelefoneBrasileiro("+55 (66) 99917-9897"),
    "66999179897"
  );
  assert.equal(
    normalizarTelefoneBrasileiro("555566999179897"),
    "66999179897"
  );
});

test("máscara visual é (DD) 99999-9999 e limita a 11 dígitos", () => {
  assert.equal(formatarTelefoneBrasileiro("66"), "(66");
  assert.equal(formatarTelefoneBrasileiro("66999"), "(66) 999");
  assert.equal(
    formatarTelefoneBrasileiro("(66) 99917-9897"),
    "(66) 99917-9897"
  );
  assert.equal(
    formatarTelefoneBrasileiro("55 66 99917-9897"),
    "(66) 99917-9897"
  );
  assert.equal(
    formatarTelefoneBrasileiro("66999179897999"),
    "(66) 99917-9897"
  );
});

test("monta WhatsApp com DDI 55 e rejeita incompleto", () => {
  assert.equal(montarTelefoneWhatsapp("(66) 99917-9897"), WHATSAPP);
  assert.equal(montarTelefoneWhatsapp("66999179897"), WHATSAPP);
  assert.equal(montarTelefoneWhatsapp("55 66 99917-9897"), WHATSAPP);
  assert.equal(montarTelefoneWhatsapp("+55 (66) 99917-9897"), WHATSAPP);

  assert.equal(montarTelefoneWhatsapp("(66) 99917-989"), null);
  assert.equal(montarTelefoneWhatsapp("(6) 99917-9897"), null);
  assert.equal(montarTelefoneWhatsapp("669991798"), null);
  assert.equal(celularBrasileiroValido("06 99917-9897"), false);
});

test("URL do WhatsApp só tem dígitos no número e não duplica 55", () => {
  const entradas = [
    "(66) 99917-9897",
    "66999179897",
    "55 66 99917-9897",
    "+55 (66) 99917-9897",
  ];

  for (const entrada of entradas) {
    const url = urlWhatsapp(entrada, "Pedido");
    const numeroNaUrl = url.match(/^https:\/\/wa\.me\/(\d+)\?/)?.[1];

    assert.equal(numeroNaUrl, WHATSAPP);
    assert.equal(numeroNaUrl?.startsWith("5555"), false);
    assert.match(url, /^https:\/\/wa\.me\/5566999179897\?text=/);
  }

  assert.equal(urlWhatsapp("(66) 99917-989", "Pedido"), "");
});

test("checkout público abre WhatsApp da loja, não do cliente", () => {
  const checkout = fonte("app/catalogo/[slug]/catalogo-publico-client.tsx");

  assert.match(checkout, /urlWhatsapp\(loja\.whatsapp_numero/);
  assert.doesNotMatch(
    checkout,
    /urlWhatsapp\(\s*(dados\.clienteWhatsapp|whatsapp)\s*,/
  );
});
