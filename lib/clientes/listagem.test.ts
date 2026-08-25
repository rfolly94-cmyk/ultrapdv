import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "../multiempresa/fonte";
import {
  agregarCarteiraPorCliente,
  aplicarBaixaNaListagem,
  clientePassaNoFiltroListagem,
  contadoresListagemClientes,
  creditoCarteiraAberto,
  itensColunaFinanceira,
  montarHrefListagemClientes,
  parseFiltroListagemClientes,
  estadoBotoesBaixaModal,
  resolverModoRecebimentoListagem,
  rotuloTotalListagem,
  sanitizarBuscaCliente,
  situacaoCarteiraCliente,
  totalFinanceiroListagem,
  tituloCarteiraVencido,
} from "./listagem";

const hoje = "2026-08-22";

function carteira(input: {
  titulos?: Parameters<typeof agregarCarteiraPorCliente>[0]["titulos"];
  creditos?: Parameters<typeof agregarCarteiraPorCliente>[0]["creditos"];
}) {
  return agregarCarteiraPorCliente({
    titulos: input.titulos ?? [],
    creditos: input.creditos ?? [],
    hojeIso: hoje,
  });
}

test("débito aberto usa título ABERTO/PARCIAL e ignora quitado, cancelado e estorno", () => {
  const mapa = carteira({
    titulos: [
      {
        cliente_id: "c1",
        valor_aberto: 200,
        status: "ABERTO",
        vencimento: "2026-09-01",
      },
      {
        cliente_id: "c1",
        valor_aberto: 80,
        status: "PARCIAL",
        vencimento: "2026-09-10",
      },
      {
        cliente_id: "c1",
        valor_aberto: 0,
        status: "QUITADO",
        vencimento: "2026-07-01",
      },
      {
        cliente_id: "c1",
        valor_aberto: 50,
        status: "CANCELADO",
        vencimento: "2026-07-01",
      },
      {
        cliente_id: "c1",
        valor_aberto: 30,
        status: "CANCELADA",
        vencimento: "2026-07-01",
      },
    ],
  });

  assert.equal(mapa.get("c1")?.debitoAberto, 280);
  assert.equal(mapa.get("c1")?.vencido, 0);
});

test("crédito aberto usa DISPONIVEL/PARCIAL e ignora utilizado/cancelado", () => {
  const mapa = carteira({
    creditos: [
      {
        cliente_id: "c1",
        valor_disponivel: 40,
        status: "DISPONIVEL",
      },
      {
        cliente_id: "c1",
        valor_disponivel: 10,
        status: "PARCIAL",
      },
      {
        cliente_id: "c1",
        valor_disponivel: 0,
        status: "UTILIZADO",
      },
      {
        cliente_id: "c1",
        valor_disponivel: 25,
        status: "CANCELADO",
      },
    ],
  });

  assert.equal(mapa.get("c1")?.creditoAberto, 50);
  assert.equal(creditoCarteiraAberto("DISPONIVEL", 0), false);
});

test("cliente com débito 200 e crédito 50 entra nos dois filtros com os valores brutos", () => {
  const mapa = carteira({
    titulos: [
      {
        cliente_id: "c1",
        valor_aberto: 200,
        status: "ABERTO",
        vencimento: "2026-09-01",
      },
    ],
    creditos: [
      {
        cliente_id: "c1",
        valor_disponivel: 50,
        status: "DISPONIVEL",
      },
    ],
  });
  const situacao = situacaoCarteiraCliente({
    cliente: { id: "c1", limite_credito: 1000, bloqueado: false },
    carteira: mapa.get("c1"),
  });

  assert.equal(situacao.debitoAberto, 200);
  assert.equal(situacao.creditoAberto, 50);
  assert.notEqual(situacao.debitoAberto - situacao.creditoAberto, 200);
  assert.equal(
    clientePassaNoFiltroListagem({
      filtro: "debito",
      cliente: { id: "c1" },
      situacao,
    }),
    true
  );
  assert.equal(
    clientePassaNoFiltroListagem({
      filtro: "credito",
      cliente: { id: "c1" },
      situacao,
    }),
    true
  );
  assert.equal(
    clientePassaNoFiltroListagem({
      filtro: "zerado",
      cliente: { id: "c1" },
      situacao,
    }),
    false
  );
  assert.deepEqual(itensColunaFinanceira({ filtro: "debito", situacao }), [
    { variante: "debito", rotulo: "Débito em aberto", valor: 200 },
  ]);
  assert.deepEqual(itensColunaFinanceira({ filtro: "credito", situacao }), [
    { variante: "credito", rotulo: "Crédito", valor: 50 },
  ]);
});

test("vencido considera só valor ainda aberto com vencimento anterior a hoje", () => {
  assert.equal(
    tituloCarteiraVencido({
      status: "ABERTO",
      valorAberto: 90,
      vencimento: "2026-08-21",
      hojeIso: hoje,
    }),
    true
  );
  assert.equal(
    tituloCarteiraVencido({
      status: "PARCIAL",
      valorAberto: 20,
      vencimento: "2026-08-22",
      hojeIso: hoje,
    }),
    false
  );
  assert.equal(
    tituloCarteiraVencido({
      status: "QUITADO",
      valorAberto: 0,
      vencimento: "2026-08-01",
      hojeIso: hoje,
    }),
    false
  );
  assert.equal(
    tituloCarteiraVencido({
      status: "ABERTO",
      valorAberto: 40,
      vencimento: null,
      hojeIso: hoje,
    }),
    false
  );

  const mapa = carteira({
    titulos: [
      {
        cliente_id: "c1",
        valor_aberto: 90,
        status: "ABERTO",
        vencimento: "2026-08-10",
      },
      {
        cliente_id: "c1",
        valor_aberto: 30,
        status: "PARCIAL",
        vencimento: "2026-09-01",
      },
      {
        cliente_id: "c1",
        valor_aberto: 15,
        status: "CANCELADO",
        vencimento: "2026-08-01",
      },
    ],
  });

  assert.equal(mapa.get("c1")?.debitoAberto, 120);
  assert.equal(mapa.get("c1")?.vencido, 90);
});

test("saldo zerado exige ausência de débito aberto e de crédito aberto", () => {
  const zerado = situacaoCarteiraCliente({
    cliente: { id: "c1", limite_credito: 500 },
    carteira: { debitoAberto: 0, creditoAberto: 0, vencido: 0 },
  });
  const soCredito = situacaoCarteiraCliente({
    cliente: { id: "c2" },
    carteira: { debitoAberto: 0, creditoAberto: 10, vencido: 0 },
  });

  assert.equal(
    clientePassaNoFiltroListagem({
      filtro: "zerado",
      cliente: { id: "c1" },
      situacao: zerado,
    }),
    true
  );
  assert.equal(
    clientePassaNoFiltroListagem({
      filtro: "zerado",
      cliente: { id: "c2" },
      situacao: soCredito,
    }),
    false
  );
  assert.deepEqual(itensColunaFinanceira({ filtro: "zerado", situacao: zerado }), [
    { variante: "quitado", rotulo: "Quitado", valor: 0 },
  ]);
});

test("limite disponível e comprometido não usam saldo líquido", () => {
  const situacao = situacaoCarteiraCliente({
    cliente: { id: "c1", limite_credito: 400, bloqueado: false },
    carteira: { debitoAberto: 150, creditoAberto: 80, vencido: 0 },
  });

  assert.equal(situacao.limiteDisponivel, 250);
  assert.equal(
    clientePassaNoFiltroListagem({
      filtro: "limite_disponivel",
      cliente: { id: "c1", limite_credito: 400 },
      situacao,
    }),
    true
  );
  assert.equal(
    clientePassaNoFiltroListagem({
      filtro: "limite_comprometido",
      cliente: { id: "c1", limite_credito: 400 },
      situacao,
    }),
    true
  );
});

test("fiado bloqueado usa o campo bloqueado já existente", () => {
  const situacao = situacaoCarteiraCliente({
    cliente: { id: "c1", bloqueado: true },
  });
  assert.equal(
    clientePassaNoFiltroListagem({
      filtro: "fiado_bloqueado",
      cliente: { id: "c1", bloqueado: true },
      situacao,
    }),
    true
  );
  assert.equal(
    clientePassaNoFiltroListagem({
      filtro: "fiado_bloqueado",
      cliente: { id: "c1", bloqueado: false },
      situacao,
    }),
    false
  );
});

test("totais e contadores seguem o filtro financeiro, não o líquido", () => {
  const situacoes = [
    situacaoCarteiraCliente({
      cliente: { id: "a", limite_credito: 1000 },
      carteira: { debitoAberto: 200, creditoAberto: 50, vencido: 80 },
    }),
    situacaoCarteiraCliente({
      cliente: { id: "b" },
      carteira: { debitoAberto: 0, creditoAberto: 30, vencido: 0 },
    }),
  ];

  assert.equal(
    totalFinanceiroListagem({ filtro: "debito", situacoes }),
    200
  );
  assert.equal(
    totalFinanceiroListagem({ filtro: "credito", situacoes }),
    80
  );
  assert.equal(
    totalFinanceiroListagem({ filtro: "vencidos", situacoes }),
    80
  );
  assert.deepEqual(contadoresListagemClientes(situacoes), {
    debito: 1,
    credito: 2,
    vencidos: 1,
  });
  assert.equal(rotuloTotalListagem("debito"), "Total em aberto");
  assert.equal(rotuloTotalListagem("credito"), "Total em crédito");
  assert.equal(rotuloTotalListagem("vencidos"), "Total vencido");
});

test("parse do filtro e href preservam busca no backend", () => {
  assert.equal(parseFiltroListagemClientes("credito"), "credito");
  assert.equal(parseFiltroListagemClientes("foo"), "todos");
  assert.equal(sanitizarBuscaCliente("Rafael_%"), "Rafael");
  assert.equal(
    montarHrefListagemClientes({ filtro: "debito", q: "Rafael" }),
    "/clientes?filtro=debito&q=Rafael"
  );
  assert.equal(montarHrefListagemClientes({ filtro: "todos" }), "/clientes");
});

test("listagem consulta carteira no servidor e não esconde linha só no client", () => {
  const pagina = fonte("app/clientes/page.tsx");
  const consulta = fonte("lib/clientes/carregar-listagem.ts");
  const coluna = fonte("components/clientes/coluna-financeira.tsx");
  const modal = fonte("components/clientes/modal-debito-cliente.tsx");
  const receber = fonte("app/api/clientes/[id]/carteira/receber/route.ts");
  const resumo = fonte("lib/clientes/carregar-resumo-carteira.ts");
  const action = fonte("app/clientes/[id]/carteira/actions.ts");

  assert.match(consulta, /carteira_cliente_titulos/);
  assert.match(consulta, /carteira_cliente_creditos/);
  assert.match(consulta, /\.eq\(\s*"empresa_id"/);
  assert.match(consulta, /clientePassaNoFiltroListagem/);
  assert.match(pagina, /carregarListagemClientes/);
  assert.match(pagina, /params\.filtro/);
  assert.doesNotMatch(pagina, /Saldo: -/);
  assert.doesNotMatch(coluna, /Débito em aberto:/);
  assert.doesNotMatch(coluna, /Crédito:/);
  assert.match(modal, /resolverModoRecebimentoListagem/);
  assert.match(modal, /estadoBotoesBaixaModal/);
  assert.match(modal, /bg-red-50/);
  assert.match(receber, /rpc_receber_carteira_com_caixa/);
  assert.match(resumo, /\.eq\(\s*"empresa_id"/);
  assert.match(action, /carregarResumoCarteiraCliente/);
  assert.match(action, /exigirOperacaoCarteira/);
});

test("baixa total usa ITENS e parcial reutiliza PARCIAL da Carteira", () => {
  assert.deepEqual(
    resolverModoRecebimentoListagem({
      tipo: "total",
      itemIds: ["a", "b"],
      totalSelecionado: 200,
      valorInformado: null,
    }),
    { ok: true, modo: "ITENS", valor: null, itemIds: ["a", "b"] }
  );
  assert.equal(
    resolverModoRecebimentoListagem({
      tipo: "parcial",
      itemIds: ["a", "b"],
      totalSelecionado: 200,
      valorInformado: 250,
    }).ok,
    false
  );
  assert.deepEqual(
    resolverModoRecebimentoListagem({
      tipo: "parcial",
      itemIds: ["a", "b"],
      totalSelecionado: 200,
      valorInformado: 120,
    }),
    { ok: true, modo: "PARCIAL", valor: 120, itemIds: ["a", "b"] }
  );
  assert.equal(
    resolverModoRecebimentoListagem({
      tipo: "parcial",
      itemIds: ["a", "b"],
      totalSelecionado: 200,
      valorInformado: 200,
    }).modo,
    "ITENS"
  );
});

test("modal desabilita baixa total quando o valor a receber está em foco ou preenchido", () => {
  const vazio = estadoBotoesBaixaModal({
    valorTexto: "",
    valorFocado: false,
    temItensSelecionados: true,
    valorInformado: null,
    totalSelecionado: 200,
    enviando: false,
  });
  assert.equal(vazio.baixaTotalDesabilitada, false);
  assert.equal(vazio.baixaParcialDesabilitada, false);

  const focadoVazio = estadoBotoesBaixaModal({
    valorTexto: "",
    valorFocado: true,
    temItensSelecionados: true,
    valorInformado: null,
    totalSelecionado: 200,
    enviando: false,
  });
  assert.equal(focadoVazio.baixaTotalDesabilitada, true);
  assert.equal(focadoVazio.baixaParcialDesabilitada, true);

  const parcialValida = estadoBotoesBaixaModal({
    valorTexto: "120",
    valorFocado: false,
    temItensSelecionados: true,
    valorInformado: 120,
    totalSelecionado: 200,
    enviando: false,
  });
  assert.equal(parcialValida.baixaTotalDesabilitada, true);
  assert.equal(parcialValida.baixaParcialDesabilitada, false);

  const maiorQueSelecionado = estadoBotoesBaixaModal({
    valorTexto: "250",
    valorFocado: true,
    temItensSelecionados: true,
    valorInformado: 250,
    totalSelecionado: 200,
    enviando: false,
  });
  assert.equal(maiorQueSelecionado.baixaTotalDesabilitada, true);
  assert.equal(maiorQueSelecionado.baixaParcialDesabilitada, true);
});

test("após zerar débito o cliente some do filtro Clientes com débito", () => {
  const situacaoDebito = situacaoCarteiraCliente({
    cliente: { id: "c1", limite_credito: 500 },
    carteira: { debitoAberto: 200, creditoAberto: 50, vencido: 0 },
  });
  const situacaoZerada = situacaoCarteiraCliente({
    cliente: { id: "c1", limite_credito: 500 },
    carteira: { debitoAberto: 0, creditoAberto: 50, vencido: 0 },
  });
  const resultado = aplicarBaixaNaListagem({
    clientes: [{ id: "c1", situacaoCarteira: situacaoDebito }],
    filtro: "debito",
    clienteId: "c1",
    situacao: situacaoZerada,
    contadores: { debito: 1, credito: 1, vencidos: 0 },
  });

  assert.equal(resultado.clientes.length, 0);
  assert.equal(resultado.total, 0);
  assert.equal(resultado.contadores.debito, 0);
  assert.equal(resultado.contadores.credito, 1);
});
