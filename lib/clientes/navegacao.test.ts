import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "../multiempresa/fonte";
import {
  hrefCadastroCliente,
  hrefCarteiraCliente,
  hrefExtratoCliente,
  hrefImprimirExtratoCliente,
  hrefNovaVendaCliente,
  hrefReceberCliente,
  hrefVendasDoCliente,
  hrefWhatsappCliente,
  parseAbaCarteiraCliente,
} from "./navegacao";

const clienteId = "11111111-1111-4111-8111-111111111111";

test("Cadastro e Carteira usam as rotas oficiais do cliente", () => {
  assert.equal(hrefCadastroCliente(clienteId), `/clientes?editar=${clienteId}`);
  assert.equal(
    hrefCarteiraCliente(clienteId),
    `/clientes/${clienteId}/carteira`
  );
  assert.equal(
    hrefExtratoCliente(clienteId),
    `/clientes/${clienteId}/carteira?aba=MOVIMENTACOES`
  );
  assert.equal(hrefReceberCliente(clienteId), `/clientes/${clienteId}/carteira`);
  assert.equal(
    hrefVendasDoCliente(clienteId),
    `/clientes/${clienteId}/carteira?aba=COMPRAS`
  );
  assert.equal(
    hrefImprimirExtratoCliente(clienteId),
    `/clientes/${clienteId}/carteira/imprimir-abertos`
  );
  assert.equal(hrefNovaVendaCliente(), "/pdv");
  assert.equal(hrefWhatsappCliente("(24) 99999-0000"), "https://wa.me/5524999990000");
  assert.equal(hrefWhatsappCliente(""), null);
  assert.equal(parseAbaCarteiraCliente("COMPRAS"), "COMPRAS");
  assert.equal(parseAbaCarteiraCliente("x"), "EM_ABERTO");
});

test("cliente aberto esconde a lista geral e navega Cadastro / Carteira", () => {
  const pagina = fonte("app/clientes/page.tsx");
  const nav = fonte("components/clientes/cliente-navegacao.tsx");
  const carteira = fonte("app/clientes/[id]/carteira/page.tsx");

  assert.match(pagina, /const mostrarLista = !clienteEdicao && !params\.novo/);
  assert.match(pagina, /\{mostrarLista \? \(/);
  assert.match(pagina, /ClienteNavegacao/);
  assert.doesNotMatch(pagina, /Saldo devedor/);
  assert.doesNotMatch(pagina, /Crédito disponível/);
  assert.doesNotMatch(pagina, /Crédito líquido/);
  assert.match(pagina, /\.eq\(\s*"empresa_id",\s*vinculo\.empresa_id/);
  assert.match(fonte("lib/clientes/carregar-listagem.ts"), /\.eq\(\s*"empresa_id"/);
  assert.match(nav, /Voltar para clientes/);
  assert.match(nav, /label: "Cadastro"/);
  assert.match(nav, /label: "Carteira"/);
  assert.match(nav, /exact: true/);
  assert.match(nav, /hrefCadastroCliente/);
  assert.match(nav, /hrefCarteiraCliente/);
  assert.match(carteira, /ClienteNavegacao/);
  assert.match(carteira, /eq\(\s*"empresa_id"/);
  assert.match(carteira, /parseAbaCarteiraCliente/);
  assert.match(carteira, /abaInicial/);
  assert.doesNotMatch(carteira, /CarteiraClienteWorkspace[\s\S]*rpc_cancelar/);
});
