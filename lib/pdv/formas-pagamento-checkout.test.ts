import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { avaliarPagamentosPdv } from "./pagamentos-teto";
import {
  MENSAGEM_CONFIGURE_PIX,
  MENSAGEM_FORMA_PIX_LEGADA,
  consolidarPagamentosCheckoutPdv,
  ehFormaPixLegada,
  escolherFormaPixComercial,
  filtrarFormasPagamentoCheckoutPdv,
  rotuloFormaCheckout,
  validarFormaPixNovaVenda,
} from "./formas-pagamento-checkout";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");

function fonte(...partes: string[]) {
  return readFileSync(join(raiz, ...partes), "utf8");
}

const dinheiro = {
  id: "dinheiro",
  codigo: "DINHEIRO",
  nome: "Dinheiro",
  tipo: "DINHEIRO",
  codigo_fiscal: "01",
  permite_troco: true,
  permite_fiado: false,
  ordem: 10,
  ativo: true,
};

const pixDinamico = {
  id: "pix-dinamico",
  codigo: "PIX_DINAMICO",
  nome: "PIX Dinâmico",
  tipo: "PIX",
  codigo_fiscal: "17",
  permite_troco: false,
  permite_fiado: false,
  ordem: 20,
  ativo: true,
};

const pixEstatico = {
  id: "pix-estatico",
  codigo: "PIX_ESTATICO",
  nome: "PIX Estático",
  tipo: "PIX",
  codigo_fiscal: "20",
  permite_troco: false,
  permite_fiado: false,
  ordem: 30,
  ativo: true,
};

const pixUnico = {
  id: "pix",
  codigo: "PIX",
  nome: "PIX",
  tipo: "PIX",
  codigo_fiscal: "20",
  permite_troco: false,
  permite_fiado: false,
  ordem: 20,
  ativo: true,
};

const debito = {
  id: "debito",
  codigo: "CARTAO_DEBITO",
  nome: "Cartão de Débito",
  tipo: "CARTAO_DEBITO",
  codigo_fiscal: "04",
  permite_troco: false,
  permite_fiado: false,
  ordem: 40,
  ativo: true,
};

const credito = {
  id: "credito",
  codigo: "CARTAO_CREDITO",
  nome: "Cartão de Crédito",
  tipo: "CARTAO_CREDITO",
  codigo_fiscal: "03",
  permite_troco: false,
  permite_fiado: false,
  ordem: 50,
  ativo: true,
};

const legadoAtivo = [dinheiro, pixDinamico, pixEstatico, debito, credito];
const checkout = [dinheiro, pixUnico, pixDinamico, pixEstatico, debito, credito];

test("1. modo local → checkout mostra UMA linha PIX", () => {
  const visiveis = filtrarFormasPagamentoCheckoutPdv(checkout);
  const pix = visiveis.filter((forma) => rotuloFormaCheckout(forma) === "PIX");
  assert.equal(pix.length, 1);
  assert.equal(pix[0]?.id, "pix");
  assert.equal(pix[0]?.nome, "PIX");
  assert.match(fonte("components/pdv/pdv-shell.tsx"), /pixLocalAtivo/);
  assert.match(
    fonte("components/pdv/pix-local-checkout.tsx"),
    /PIX Local \/ Manual/
  );
});

test("2. modo local → não mostra PIX Dinâmico", () => {
  const visiveis = filtrarFormasPagamentoCheckoutPdv(checkout);
  assert.equal(
    visiveis.some((forma) => forma.nome === "PIX Dinâmico"),
    false
  );
  assert.equal(ehFormaPixLegada(pixDinamico), true);
});

test("3. modo local → não mostra PIX Estático", () => {
  const visiveis = filtrarFormasPagamentoCheckoutPdv(checkout);
  assert.equal(
    visiveis.some((forma) => forma.nome === "PIX Estático"),
    false
  );
  assert.equal(ehFormaPixLegada(pixEstatico), true);
});

test("4. modo local → abre painel PIX Local", () => {
  const shell = fonte("components/pdv/pdv-shell.tsx");
  const local = fonte("components/pdv/pix-local-checkout.tsx");
  assert.match(shell, /pixConfig\?\.modo === "local_manual"/);
  assert.match(shell, /<PixLocalCheckout/);
  assert.doesNotMatch(shell, /pixHabilitado \|\| !ehFormaPix/);
  assert.match(local, /PIX Local \/ Manual/);
  assert.match(local, /Gerar QR Code/);
  assert.equal(escolherFormaPixComercial(checkout)?.id, "pix");
});

test("5. modo geranet → checkout mostra UMA linha PIX", () => {
  const visiveis = filtrarFormasPagamentoCheckoutPdv(checkout);
  assert.equal(
    visiveis.filter((forma) => rotuloFormaCheckout(forma) === "PIX").length,
    1
  );
  assert.match(fonte("components/pdv/pdv-shell.tsx"), /pixGeranetAtivo/);
});

test("6. modo geranet → não mostra PIX Estático", () => {
  const nomes = filtrarFormasPagamentoCheckoutPdv(checkout).map(
    (forma) => forma.nome
  );
  assert.equal(nomes.includes("PIX Estático"), false);
});

test("7. modo geranet → não mostra PIX Dinâmico", () => {
  const nomes = filtrarFormasPagamentoCheckoutPdv(checkout).map(
    (forma) => forma.nome
  );
  assert.equal(nomes.includes("PIX Dinâmico"), false);
});

test("8. modo geranet → abre painel PIX Integrado", () => {
  const shell = fonte("components/pdv/pdv-shell.tsx");
  const geranet = fonte("components/pdv/pix-geranet-checkout.tsx");
  assert.match(shell, /pixConfig\?\.modo === "geranet"/);
  assert.match(shell, /<PixGeranetCheckout/);
  assert.match(geranet, /PIX Integrado \/ Geranet/);
  assert.match(geranet, /Provedor:/);
  assert.match(geranet, /Gerar PIX/);
});

test("9. configuração inativa → PIX não pode ser usado", () => {
  const shell = fonte("components/pdv/pdv-shell.tsx");
  const servidor = fonte("lib/pagamentos/pix/modo-ativo-servidor.ts");
  assert.match(shell, /MENSAGEM_CONFIGURE_PIX/);
  assert.match(shell, /disabled=\{ehFormaPix\(forma\) && !pixHabilitado\}/);
  assert.match(servidor, /MENSAGEM_PIX_NAO_CONFIGURADO/);
  assert.equal(
    MENSAGEM_CONFIGURE_PIX,
    "Configure o PIX em Configurações → Financeiro"
  );
});

test("10. registros legados continuam acessíveis em vendas antigas", () => {
  const migracao = fonte(
    "supabase/migrations/20260816270000_formas_pix_unica_checkout.sql"
  );
  assert.match(migracao, /ativo = false/);
  assert.doesNotMatch(migracao, /DELETE FROM public\.formas_pagamento/);
  assert.match(
    fonte("app/vendas/[id]/page.tsx"),
    /forma_pagamento_nome/
  );
  const remapeados = consolidarPagamentosCheckoutPdv(
    [{ formaPagamentoId: pixDinamico.id, valorCentavos: 3000 }],
    checkout,
    filtrarFormasPagamentoCheckoutPdv(checkout)
  );
  assert.equal(remapeados[0]?.formaPagamentoId, pixUnico.id);
  assert.equal(remapeados[0]?.valorCentavos, 3000);
});

test("11. venda nova não grava forma PIX legada", () => {
  const visiveis = filtrarFormasPagamentoCheckoutPdv(legadoAtivo.concat([pixUnico]));
  assert.equal(
    visiveis.some((forma) => forma.codigo === "PIX_DINAMICO"),
    false
  );
  assert.equal(
    visiveis.some((forma) => forma.codigo === "PIX_ESTATICO"),
    false
  );
  assert.equal(visiveis.find((forma) => forma.codigo === "PIX")?.id, "pix");
  assert.match(
    fonte("app/pdv/page.tsx"),
    /filtrarFormasPagamentoCheckoutPdv/
  );
});

test("12. servidor bloqueia tentativa de usar ID legado diretamente", () => {
  assert.throws(
    () => validarFormaPixNovaVenda(pixDinamico),
    (error: Error) => error.message === MENSAGEM_FORMA_PIX_LEGADA
  );
  assert.throws(
    () => validarFormaPixNovaVenda(pixEstatico),
    (error: Error) => error.message === MENSAGEM_FORMA_PIX_LEGADA
  );
  assert.doesNotThrow(() => validarFormaPixNovaVenda(pixUnico));
  assert.match(
    fonte("lib/pagamentos/pix/modo-ativo-servidor.ts"),
    /validarFormaPixNovaVenda/
  );
  assert.match(
    fonte("app/pdv/editar-actions.ts"),
    /validarFormaPixNovaVenda/
  );
});

test("13. pagamento dividido continua funcionando", () => {
  const visiveis = filtrarFormasPagamentoCheckoutPdv(checkout);
  assert.deepEqual(
    visiveis.map((forma) => rotuloFormaCheckout(forma)),
    ["Dinheiro", "PIX", "Cartão de Débito", "Cartão de Crédito"]
  );
  const r = avaliarPagamentosPdv({
    totalVendaCentavos: 3500,
    pagamentos: [
      { valorCentavos: 500, permiteTroco: true },
      { valorCentavos: 3000, permiteTroco: false },
    ],
  });
  assert.equal(r.bloqueado, false);
  assert.equal(r.trocoCentavos, 0);
});

test("14. fiscal existente não foi alterado", () => {
  const fiscal = fonte("lib/fiscal/validar-pagamentos-eletronicos.ts");
  assert.match(fiscal, /export const TPAG_PIX_DINAMICO = "17"/);
  assert.match(fiscal, /export const TPAG_PIX_ESTATICO = "20"/);
  assert.doesNotMatch(
    fiscal,
    /formas-pagamento-checkout/
  );
  const migracao = fonte(
    "supabase/migrations/20260816270000_formas_pix_unica_checkout.sql"
  );
  assert.match(migracao, /'20'/);
  assert.doesNotMatch(migracao, /codigo_fiscal = '17'/);
  for (const rota of [
    "app/api/fiscal/geranet/nfce-emitir-venda/route.ts",
    "app/api/fiscal/geranet/nfe-emitir-venda/route.ts",
    "app/api/fiscal/geranet/nfce-contingencia-venda/route.ts",
  ]) {
    assert.doesNotMatch(fonte(rota), /formas-pagamento-checkout/);
  }
});

test("sem forma PIX única o checkout não promove legado", () => {
  const visiveis = filtrarFormasPagamentoCheckoutPdv(legadoAtivo);
  assert.equal(
    visiveis.some((forma) => String(forma.nome ?? "").includes("PIX")),
    false
  );
  assert.equal(escolherFormaPixComercial(legadoAtivo), null);
});
