import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "../multiempresa/fonte";
import {
  montarTitulosAbaCarteira,
  tituloPassaNaAba,
} from "./titulos";

const titulos = [
  {
    id: "t-aberto",
    empresa_id: "emp-a",
    status: "ABERTO",
    valor_aberto: 80,
    valor_original: 80,
    created_at: "2026-08-20T10:00:00.000Z",
    numero_venda: 10,
  },
  {
    id: "t-parcial",
    empresa_id: "emp-a",
    status: "PARCIAL",
    valor_aberto: 30,
    valor_original: 100,
    created_at: "2026-08-19T10:00:00.000Z",
    numero_venda: 9,
  },
  {
    id: "t-quitado",
    empresa_id: "emp-a",
    status: "QUITADO",
    valor_aberto: 0,
    valor_original: 50,
    created_at: "2026-08-18T10:00:00.000Z",
    numero_venda: 8,
  },
  {
    id: "t-cancelado",
    empresa_id: "emp-a",
    status: "CANCELADO",
    valor_aberto: 0,
    valor_original: 40,
    created_at: "2026-08-17T10:00:00.000Z",
    numero_venda: 7,
  },
  {
    id: "t-estornado",
    empresa_id: "emp-a",
    status: "ABERTO",
    valor_aberto: 45,
    valor_original: 45,
    created_at: "2026-08-16T10:00:00.000Z",
    numero_venda: 6,
  },
  {
    id: "t-outra-empresa",
    empresa_id: "emp-b",
    status: "ABERTO",
    valor_aberto: 999,
    valor_original: 999,
    created_at: "2026-08-21T10:00:00.000Z",
    numero_venda: 99,
  },
];

const itens = [
  {
    id: "i-1",
    titulo_id: "t-aberto",
    produto_nome: "Cabo",
    valor_original: 80,
    valor_aberto: 80,
    status: "ABERTO",
  },
  {
    id: "i-2",
    titulo_id: "t-parcial",
    produto_nome: "Película",
    valor_original: 70,
    valor_aberto: 0,
    status: "QUITADO",
  },
  {
    id: "i-3",
    titulo_id: "t-parcial",
    produto_nome: "Capinha",
    valor_original: 30,
    valor_aberto: 30,
    status: "PARCIAL",
  },
  {
    id: "i-4",
    titulo_id: "t-parcial",
    produto_nome: "Película extra",
    valor_original: 20,
    valor_aberto: 0,
    status: "CANCELADO",
  },
  {
    id: "i-5",
    titulo_id: "t-quitado",
    produto_nome: "Fone",
    valor_original: 50,
    valor_aberto: 0,
    status: "QUITADO",
  },
  {
    id: "i-6",
    titulo_id: "t-cancelado",
    produto_nome: "Película B",
    valor_original: 40,
    valor_aberto: 0,
    status: "CANCELADO",
  },
  {
    id: "i-7",
    titulo_id: "t-estornado",
    produto_nome: "Película C",
    valor_original: 45,
    valor_aberto: 45,
    status: "ABERTO",
  },
  {
    id: "i-b",
    titulo_id: "t-outra-empresa",
    produto_nome: "Item empresa B",
    valor_original: 999,
    valor_aberto: 999,
    status: "ABERTO",
  },
];

test("paridade Em aberto: web e mobile usam a mesma regra de títulos", () => {
  const daEmpresaA = titulos.filter((titulo) => titulo.empresa_id === "emp-a");
  const abertos = montarTitulosAbaCarteira(daEmpresaA, itens, "EM_ABERTO");
  const quitadas = montarTitulosAbaCarteira(daEmpresaA, itens, "QUITADAS");

  assert.deepEqual(
    abertos.map((titulo) => titulo.id),
    ["t-aberto", "t-parcial", "t-estornado"]
  );
  assert.deepEqual(
    quitadas.map((titulo) => titulo.id),
    ["t-quitado"]
  );
  assert.equal(
    abertos.some((titulo) => titulo.id === "t-outra-empresa"),
    false
  );

  const parcial = abertos.find((titulo) => titulo.id === "t-parcial");
  assert.ok(parcial);
  assert.equal(parcial.valor_aberto, 30);
  assert.deepEqual(
    parcial.itens.map((item) => item.id),
    ["i-2", "i-3", "i-4"]
  );
  assert.equal(
    parcial.itens.find((item) => item.id === "i-2")?.valor_aberto,
    0
  );
  assert.equal(
    parcial.itens.find((item) => item.id === "i-4")?.status,
    "CANCELADO"
  );
});

test("paridade de saldo, baixa, cancelado e estorno", () => {
  const daEmpresaA = titulos.filter((titulo) => titulo.empresa_id === "emp-a");
  const abertos = montarTitulosAbaCarteira(daEmpresaA, itens, "EM_ABERTO");
  const saldo = abertos.reduce(
    (soma, titulo) => soma + Number(titulo.valor_aberto ?? 0),
    0
  );

  assert.equal(saldo, 155);
  assert.equal(tituloPassaNaAba("QUITADO", "EM_ABERTO", 0), false);
  assert.equal(tituloPassaNaAba("CANCELADO", "EM_ABERTO", 0), false);
  assert.equal(tituloPassaNaAba("PARCIAL", "EM_ABERTO", 30), true);
  assert.equal(tituloPassaNaAba("ABERTO", "EM_ABERTO", 45), true);

  const api = fonte("lib/clientes/carregar-carteira-api.ts");
  const rota = fonte("app/api/clientes/[id]/carteira/route.ts");
  assert.match(api, /montarTitulosAbaCarteira/);
  assert.match(api, /abertos:/);
  assert.match(api, /eq\("empresa_id", input\.empresaId\)/);
  assert.doesNotMatch(api, /searchParams\.get\("empresa|body\.empresa_id/);
  assert.match(rota, /resolverContextoEmpresaAtiva/);
});
