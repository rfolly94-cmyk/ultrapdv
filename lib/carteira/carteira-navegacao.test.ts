import assert from "node:assert/strict";
import { test } from "node:test";

import { acoesPorEstadoVendaCarteira } from "./acoes";
import {
  dataDentroDoPeriodo,
  dataDaVendaCarteira,
  periodoCarteiraValido,
  resolverPeriodoCarteira,
} from "./periodo";
import {
  buscaTituloCarteira,
  dataQuitacaoTitulo,
  ordenarTitulosCarteira,
  tituloPassaNaAba,
} from "./titulos";
import {
  resumoFiscalVendaCarteira,
  vendaPossuiDocumentoFiscal,
} from "./fiscal-consulta";
import { fonte } from "../multiempresa/fonte";

test("TESTE A: vendas com saldo ficam acima das quitadas", () => {
  const ordenados = ordenarTitulosCarteira([
    {
      id: "q1",
      status: "QUITADO",
      created_at: "2026-08-21T12:00:00.000Z",
      quitado_em: "2026-08-21T12:00:00.000Z",
      numero_venda: 52,
    },
    {
      id: "a1",
      status: "ABERTO",
      created_at: "2026-08-18T12:00:00.000Z",
      numero_venda: 44,
    },
    {
      id: "p1",
      status: "PARCIAL",
      created_at: "2026-08-19T12:00:00.000Z",
      numero_venda: 48,
    },
    {
      id: "a2",
      status: "ABERTO",
      created_at: "2026-08-20T12:00:00.000Z",
      numero_venda: 50,
    },
  ]);

  assert.deepEqual(
    ordenados.map((item) => item.numero_venda),
    [50, 48, 44, 52]
  );
});

test("TESTE B: venda quitada agora entra no topo das quitadas, abaixo das abertas", () => {
  const antes = ordenarTitulosCarteira([
    { id: "50", status: "ABERTO", created_at: "2026-08-20T10:00:00.000Z", numero_venda: 50 },
    { id: "48", status: "ABERTO", created_at: "2026-08-19T10:00:00.000Z", numero_venda: 48 },
    { id: "44", status: "ABERTO", created_at: "2026-08-18T10:00:00.000Z", numero_venda: 44 },
    {
      id: "40",
      status: "QUITADO",
      created_at: "2026-08-10T10:00:00.000Z",
      quitado_em: "2026-08-15T10:00:00.000Z",
      numero_venda: 40,
    },
    {
      id: "35",
      status: "QUITADO",
      created_at: "2026-08-08T10:00:00.000Z",
      quitado_em: "2026-08-12T10:00:00.000Z",
      numero_venda: 35,
    },
  ]);

  assert.deepEqual(
    antes.map((item) => item.numero_venda),
    [50, 48, 44, 40, 35]
  );

  const depois = ordenarTitulosCarteira(
    antes.map((item) =>
      item.id === "48"
        ? {
            ...item,
            status: "QUITADO",
            quitado_em: "2026-08-21T15:00:00.000Z",
          }
        : item
    )
  );

  assert.deepEqual(
    depois.map((item) => item.numero_venda),
    [50, 44, 48, 40, 35]
  );
});

test("TESTE C: baixa parcial permanece em Em aberto", () => {
  assert.equal(tituloPassaNaAba("PARCIAL", "EM_ABERTO", 300), true);
  assert.equal(tituloPassaNaAba("PARCIAL", "QUITADAS", 300), false);
});

test("TESTE D: saldo zero vai para Quitadas", () => {
  assert.equal(tituloPassaNaAba("QUITADO", "EM_ABERTO", 0), false);
  assert.equal(tituloPassaNaAba("QUITADO", "QUITADAS", 0), true);
});

test("TESTE E: venda quitada oferece cancelar recebimento", () => {
  assert.deepEqual(
    acoesPorEstadoVendaCarteira({ statusTitulo: "QUITADO" }),
    [
      "ver_venda",
      "ver_recebimentos",
      "cancelar_recebimento",
      "cancelar_venda",
    ]
  );
});

test("TESTE F: após estorno a venda volta para Em aberto se houver saldo", () => {
  assert.equal(tituloPassaNaAba("ABERTO", "EM_ABERTO", 500), true);
  assert.equal(tituloPassaNaAba("ABERTO", "QUITADAS", 500), false);
});

test("TESTE G: cancelar recebimento não é ação de venda aberta", () => {
  const acoes = acoesPorEstadoVendaCarteira({
    statusTitulo: "PARCIAL",
    valorAberto: 300,
  });
  assert.equal(acoes.includes("cancelar_recebimento"), false);
  assert.equal(acoes.includes("receber"), true);
});

test("venda cancelada só permite consulta", () => {
  assert.deepEqual(
    acoesPorEstadoVendaCarteira({ statusTitulo: "CANCELADO" }),
    ["ver_venda", "ver_historico"]
  );
  assert.equal(tituloPassaNaAba("CANCELADO", "EM_ABERTO"), false);
  assert.equal(tituloPassaNaAba("CANCELADO", "QUITADAS"), false);
  assert.equal(tituloPassaNaAba("CANCELADO", "TODAS"), true);
});

test("quitação usa a data do último recebimento, não o número da venda", () => {
  const quitadoEm = dataQuitacaoTitulo({
    status: "QUITADO",
    updated_at: "2026-08-10T10:00:00.000Z",
    recebimentosProcessadosEm: [
      "2026-08-21T09:30:00.000Z",
      "2026-08-18T09:00:00.000Z",
    ],
  });
  assert.equal(quitadoEm, "2026-08-21T09:30:00.000Z");
});

test("TESTE L/M: filtro de período usa a data da venda", () => {
  const hoje = resolverPeriodoCarteira(
    "hoje",
    null,
    null,
    new Date("2026-08-21T15:00:00-03:00")
  );
  const personalizado = resolverPeriodoCarteira(
    "personalizado",
    "2026-08-01",
    "2026-08-10",
    new Date("2026-08-21T15:00:00-03:00")
  );

  const dataVendaHoje = dataDaVendaCarteira({
    finalizada_at: "2026-08-21T10:00:00-03:00",
    created_at: "2026-08-01T10:00:00-03:00",
  });
  const dataVendaAntiga = dataDaVendaCarteira({
    finalizada_at: "2026-08-05T10:00:00-03:00",
    created_at: "2026-08-05T10:00:00-03:00",
  });

  assert.equal(dataDentroDoPeriodo(dataVendaHoje, hoje), true);
  assert.equal(dataDentroDoPeriodo(dataVendaAntiga, hoje), false);
  assert.equal(dataDentroDoPeriodo(dataVendaAntiga, personalizado), true);
  assert.equal(dataDentroDoPeriodo(dataVendaHoje, personalizado), false);
  assert.equal(periodoCarteiraValido("xyz"), "todos");
});

test("Em aberto + período combina status e data da venda", () => {
  const janela = resolverPeriodoCarteira(
    "30dias",
    null,
    null,
    new Date("2026-08-21T12:00:00-03:00")
  );
  const data = "2026-08-10T12:00:00-03:00";
  assert.equal(
    tituloPassaNaAba("ABERTO", "EM_ABERTO", 100) &&
      dataDentroDoPeriodo(data, janela),
    true
  );
  assert.equal(
    tituloPassaNaAba("QUITADO", "EM_ABERTO", 0) &&
      dataDentroDoPeriodo(data, janela),
    false
  );
});

test("TESTE I/J: fiscal é só consulta de rótulo, sem inventar estado", () => {
  const resumo = resumoFiscalVendaCarteira({
    origem_id: "v1",
    modelo: "65",
    numero: 123,
    status: "autorizada",
  });
  assert.equal(resumo?.linha, "NFC-e #123  AUTORIZADA");
  assert.equal(
    vendaPossuiDocumentoFiscal({
      origem_id: "v1",
      modelo: "65",
      numero: 123,
      status: "autorizada",
    }),
    true
  );
  assert.equal(vendaPossuiDocumentoFiscal(null), false);
});

test("busca rápida por número ou produto", () => {
  const titulo = {
    numero_venda: 135,
    itens: [{ produto_nome: "Frontal A12", produto_codigo: "A12" }],
  };
  assert.equal(buscaTituloCarteira("135", titulo), true);
  assert.equal(buscaTituloCarteira("frontal", titulo), true);
  assert.equal(buscaTituloCarteira("xyz", titulo), false);
});

test("seleção de item abre cancelamento de item, não da venda inteira", () => {
  const ui = fonte(
    "components/clientes/carteira/CarteiraClienteWorkspace.tsx"
  );
  const modal = fonte(
    "components/clientes/carteira/CancelarItensCarteira.tsx"
  );
  assert.match(ui, /Cancelar itens selecionados/);
  assert.match(ui, /setCancelarItemIds/);
  assert.match(ui, /Imprimir itens em aberto/);
  assert.match(modal, /Valor dos itens selecionados/);
  assert.match(modal, /Valor que permanecerá na venda/);
  assert.match(modal, /documento fiscal permanecerá inalterado/);
  assert.doesNotMatch(modal, /rpc_cancelar_venda_comercial/);
});
