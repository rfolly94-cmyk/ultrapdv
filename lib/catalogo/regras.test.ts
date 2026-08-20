import assert from "node:assert/strict";
import { test } from "node:test";

import {
  codigoPedidoAmigavel,
  pedidoPodeConverter,
  normalizarSlug,
  normalizarWhatsapp,
  precoPublico,
  produtoVisivelNoCatalogo,
  recalcularPedido,
  validarQuantidadeCatalogo,
  validarSlug,
  validarWhatsapp,
} from "./regras";
import { montarMensagemWhatsapp } from "./whatsapp";

test("slug fica lowercase, sem espaço e sem acento", () => {
  assert.equal(normalizarSlug("Loja Centro"), "loja-centro");
  assert.equal(normalizarSlug("Ultra Cell"), "ultra-cell");
  assert.equal(validarSlug("ultracell").ok, true);
  assert.equal(validarSlug("42741754000142").ok, true);
  assert.equal(validarSlug("PDV").ok, false);
  assert.equal(validarSlug("catálogo").ok, false);
});

test("WhatsApp grava só dígitos nacionais, sem DDI duplicado", () => {
  assert.equal(normalizarWhatsapp("(66) 99999-9999"), "66999999999");
  assert.equal(normalizarWhatsapp("+55 66 99999-9999"), "66999999999");
  assert.deepEqual(validarWhatsapp("(66) 99917-9897"), {
    ok: true,
    numero: "66999179897",
  });
  assert.equal(
    validarWhatsapp("(66) 99917-989").erro,
    "Informe um celular válido com DDD."
  );
});

test("produto só aparece se publicado, ativo e catálogo ativo", () => {
  assert.equal(
    produtoVisivelNoCatalogo({
      catalogoAtivo: true,
      produtoAtivo: true,
      catalogoPublicado: true,
      quantidade: 10,
      produtoSemEstoque: "mostrar_esgotado",
    }),
    true
  );

  assert.equal(
    produtoVisivelNoCatalogo({
      catalogoAtivo: true,
      produtoAtivo: true,
      catalogoPublicado: false,
      quantidade: 10,
      produtoSemEstoque: "mostrar_esgotado",
    }),
    false
  );

  assert.equal(
    produtoVisivelNoCatalogo({
      catalogoAtivo: true,
      produtoAtivo: false,
      catalogoPublicado: true,
      quantidade: 10,
      produtoSemEstoque: "mostrar_esgotado",
    }),
    false
  );

  assert.equal(
    produtoVisivelNoCatalogo({
      catalogoAtivo: true,
      produtoAtivo: true,
      catalogoPublicado: true,
      quantidade: 0,
      produtoSemEstoque: "ocultar",
    }),
    false
  );

  assert.equal(
    produtoVisivelNoCatalogo({
      catalogoAtivo: true,
      produtoAtivo: true,
      catalogoPublicado: true,
      quantidade: 0,
      produtoSemEstoque: "mostrar_esgotado",
    }),
    true
  );
});

test("backend ignora preço enviado pelo navegador", () => {
  const resultado = recalcularPedido([
    { quantidade: 2, precoAtual: 100 },
  ]);

  assert.equal(resultado.total, 200);
  assert.notEqual(resultado.total, 2);
});

test("quantidade absurda é rejeitada", () => {
  assert.equal(validarQuantidadeCatalogo(999999), false);
  assert.equal(validarQuantidadeCatalogo(0), false);
  assert.equal(validarQuantidadeCatalogo(2), true);
});

test("produto sem preço público não inventa valor", () => {
  assert.equal(
    precoPublico({ mostrarPreco: false, precoVenda: 89.9 }),
    null
  );
  assert.equal(
    precoPublico({ mostrarPreco: true, precoVenda: 89.9 }),
    89.9
  );
});

test("mensagem WhatsApp contém itens, total, nome e forma", () => {
  const mensagem = montarMensagemWhatsapp({
    itens: [
      {
        nome: "Frontal A32 OLED",
        quantidade: 2,
        precoUnitario: 79.9,
        mostrarPreco: true,
      },
      {
        nome: "Película A32",
        quantidade: 1,
        precoUnitario: 10,
        mostrarPreco: true,
      },
    ],
    nome: "Rafael",
    tipoEntrega: "retirada",
  });

  assert.match(mensagem, /2x Frontal A32 OLED/);
  assert.match(mensagem, /1x Película A32/);
  assert.match(mensagem, /Total: R\$\s*169,80/);
  assert.match(mensagem, /Nome: Rafael/);
  assert.match(mensagem, /Forma: Retirada/);
});

test("código amigável não usa UUID", () => {
  assert.equal(codigoPedidoAmigavel(1042), "#1042");
});

test("somente pedido pendente pode converter", () => {
  assert.equal(pedidoPodeConverter("NOVO", null), true);
  assert.equal(pedidoPodeConverter("EM_ATENDIMENTO", null), true);
  assert.equal(pedidoPodeConverter("ACEITO", null), true);
  assert.equal(pedidoPodeConverter("CONVERTIDO", null), false);
  assert.equal(pedidoPodeConverter("NOVO", "venda-1"), false);
  assert.equal(pedidoPodeConverter("CANCELADO", null), false);
});
