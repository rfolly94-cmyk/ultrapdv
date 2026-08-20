import assert from "node:assert/strict";
import { test } from "node:test";

import {
  empresaA,
  empresaB,
  vendaA,
  vendaB,
} from "../multiempresa/cenario";
import { fonte } from "../multiempresa/fonte";
import {
  clienteSemComprarHa,
  faturamentoVendas,
  paginarSemAlterarTotais,
  quantidadeItensVendidos,
  quantidadeVendasValidas,
  somarPagamentosPorForma,
  ticketMedio,
  totalDescontos,
  ultimaCompraPorCliente,
  vendasDaEmpresaAtiva,
  vendasNoPeriodo,
} from "./calculo";
import { montarPlanilhaRelatorio } from "./exportar";
import { relatorioFiscalSomenteLeitura } from "./fiscal";
import { resolverPeriodoRelatorio } from "./periodo";

const inicio = new Date("2026-08-01T00:00:00-03:00");
const fim = new Date("2026-09-01T00:00:00-03:00");

test("1. empresa A não recebe vendas da empresa B", () => {
  const vendas = vendasDaEmpresaAtiva(
    [
      { id: vendaA, empresa_id: empresaA, status: "finalizada", created_at: "2026-08-10T12:00:00-03:00", valor_total: 100 },
      { id: vendaB, empresa_id: empresaB, status: "finalizada", created_at: "2026-08-10T12:00:00-03:00", valor_total: 999 },
    ],
    empresaA
  );
  assert.equal(vendas.length, 1);
  assert.equal(vendas[0].id, vendaA);
  assert.match(fonte("lib/relatorios/vendas.ts"), /eq\("empresa_id", ctx.empresaId\)/);
});

test("2. empresa A não recebe produtos da empresa B", () => {
  assert.match(fonte("lib/relatorios/produtos.ts"), /eq\("empresa_id", base.ctx.empresaId\)/);
  assert.match(fonte("lib/relatorios/produtos.ts"), /item.empresa_id === base.ctx.empresaId/);
});

test("3. empresa A não recebe estoque da empresa B", () => {
  assert.match(fonte("lib/relatorios/estoque.ts"), /eq\("empresa_id", ctx.empresaId\)/);
  assert.match(fonte("lib/relatorios/estoque.ts"), /filtrarRegistrosDaEmpresaAtiva/);
});

test("4. empresa A não recebe clientes da empresa B", () => {
  assert.match(fonte("lib/relatorios/clientes.ts"), /eq\("empresa_id", base.ctx.empresaId\)/);
  assert.match(fonte("lib/relatorios/clientes.ts"), /filtrarRegistrosDaEmpresaAtiva/);
});

test("5. empresa A não recebe carteira da empresa B", () => {
  assert.match(fonte("lib/relatorios/carteira.ts"), /eq\("empresa_id", ctx.empresaId\)/);
  assert.match(fonte("lib/relatorios/carteira.ts"), /saldo_devedor/);
});

test("6. empresa A não recebe pagamentos da empresa B", () => {
  assert.match(fonte("lib/relatorios/vendas.ts"), /from\("vendas_pagamentos"\)/);
  assert.match(fonte("lib/relatorios/vendas.ts"), /eq\("empresa_id", empresaId\)/);
});

test("7. empresa A não recebe documentos fiscais da empresa B", () => {
  assert.match(fonte("lib/relatorios/fiscal.ts"), /from\("fiscal_emissoes"\)/);
  assert.match(fonte("lib/relatorios/fiscal.ts"), /eq\("empresa_id", ctx.empresaId\)/);
});

test("venda cancelada não entra no faturamento", () => {
  const vendas = [
    { id: "1", status: "finalizada", valor_total: 100, desconto: 10, created_at: "2026-08-10T12:00:00-03:00" },
    { id: "2", status: "cancelada", valor_total: 80, desconto: 0, created_at: "2026-08-10T13:00:00-03:00" },
  ];
  assert.equal(faturamentoVendas(vendas), 100);
  assert.equal(quantidadeVendasValidas(vendas), 1);
});

test("ticket médio correto e sem divisão por zero", () => {
  assert.equal(ticketMedio(200, 2), 100);
  assert.equal(ticketMedio(100, 0), 0);
});

test("desconto correto somente de vendas válidas", () => {
  const vendas = [
    { id: "1", status: "finalizada", valor_total: 100, desconto: 15, created_at: "2026-08-10T12:00:00-03:00" },
    { id: "2", status: "cancelada", valor_total: 80, desconto: 40, created_at: "2026-08-10T13:00:00-03:00" },
  ];
  assert.equal(totalDescontos(vendas), 15);
});

test("pagamento misto é somado por ocorrência real", () => {
  const resumo = somarPagamentosPorForma(
    [
      { venda_id: "v1", forma_pagamento_nome: "Fiado", valor: 80, status: "confirmado" },
      { venda_id: "v1", forma_pagamento_nome: "Dinheiro", valor: 20, status: "confirmado" },
      { venda_id: "v1", forma_pagamento_nome: "PIX", valor: 100, status: "cancelado" },
    ],
    new Set(["v1"])
  );
  const mapa = Object.fromEntries(resumo.map((item) => [item.nome, item.valor]));
  assert.equal(mapa.Fiado, 80);
  assert.equal(mapa.Dinheiro, 20);
  assert.equal(mapa.PIX, undefined);
});

test("quantidade vendida considera somente vendas finalizadas", () => {
  const qtd = quantidadeItensVendidos(
    [
      { venda_id: "v1", quantidade: 2 },
      { venda_id: "v2", quantidade: 9 },
    ],
    new Set(["v1"])
  );
  assert.equal(qtd, 2);
});

test("filtro por período usa a data da venda", () => {
  const vendas = vendasNoPeriodo(
    [
      { id: "1", status: "finalizada", created_at: "2026-07-31T23:00:00-03:00" },
      { id: "2", status: "finalizada", finalizada_at: "2026-08-15T10:00:00-03:00", created_at: "2026-07-01T10:00:00-03:00" },
      { id: "3", status: "finalizada", created_at: "2026-09-01T00:00:00-03:00" },
    ],
    inicio,
    fim
  );
  assert.deepEqual(vendas.map((item) => item.id), ["2"]);
});

test("última compra ignora venda cancelada e filtro sem comprar usa essa data", () => {
  const ultimas = ultimaCompraPorCliente([
    {
      cliente_id: "c1",
      status: "cancelada",
      created_at: "2026-08-19T12:00:00-03:00",
    },
    {
      cliente_id: "c1",
      status: "finalizada",
      created_at: "2026-05-01T12:00:00-03:00",
    },
  ]);
  assert.equal(ultimas.get("c1"), "2026-05-01T12:00:00-03:00");
  const agora = new Date("2026-08-20T12:00:00-03:00").getTime();
  assert.equal(clienteSemComprarHa(ultimas.get("c1"), 30, agora), true);
  assert.equal(clienteSemComprarHa("2026-08-19T12:00:00-03:00", 30, agora), false);
});

test("paginação não altera totais gerais", () => {
  const registros = Array.from({ length: 120 }, (_, i) => i);
  const pagina = paginarSemAlterarTotais(registros, 2, 50);
  assert.equal(pagina.total, 120);
  assert.equal(pagina.registros.length, 50);
  assert.equal(pagina.registros[0], 50);
});

test("estoque atual usa a fonte oficial estoque_atual", () => {
  assert.match(fonte("lib/relatorios/estoque.ts"), /from\("estoque_atual"\)/);
  assert.match(fonte("lib/relatorios/estoque.ts"), /estoque_minimo/);
});

test("exportação respeita filtro e empresa ativa", () => {
  const buffer = montarPlanilhaRelatorio(
    {
      titulo: "Vendas no período",
      vazio: "",
      indicadores: [{ label: "Faturamento", valor: "R$ 100,00" }],
      colunas: ["Venda", "Total"],
      linhas: [{ id: vendaA, celulas: ["#1", "100"] }],
      totalFiltrado: 1,
    },
    "Empresa A",
    "Este mês"
  );
  assert.equal(Buffer.isBuffer(buffer), true);
  assert.match(fonte("app/api/relatorios/exportar/route.ts"), /obterContextoRelatorio/);
  assert.match(fonte("lib/relatorios/contexto.ts"), /buscarVinculoEmpresaAtiva/);
  assert.doesNotMatch(fonte("app/api/relatorios/exportar/route.ts"), /empresa_id.*searchParams/);
});

test("relatório fiscal é somente consulta", () => {
  const modo = relatorioFiscalSomenteLeitura();
  assert.equal(modo.emite, false);
  assert.equal(modo.reenvia, false);
  assert.equal(modo.reconcilia, false);
  assert.equal(modo.alteraStatus, false);
  assert.equal(modo.geraNumero, false);

  const fiscal = fonte("lib/relatorios/fiscal.ts");
  const pagina = fonte("app/relatorios/page.tsx");
  assert.doesNotMatch(fiscal, /nfe-emitir|nfce-emitir|\/reconciliar/);
  assert.doesNotMatch(fiscal, /\.update\(|\.insert\(|\.rpc\(/);
  assert.doesNotMatch(pagina, /nfe-emitir|rpc_reservar/);
  assert.match(fiscal, /Pendências fiscais/);
});

test("período padrão do relatório é o mês corrente", () => {
  const janela = resolverPeriodoRelatorio("mes", null, null, new Date("2026-08-20T12:00:00-03:00"));
  assert.equal(janela.rotulo, "Este mês");
  assert.equal(janela.inicio.toISOString().startsWith("2026-08-01"), true);
});

test("menu Relatórios não cria permissão nova", () => {
  assert.match(fonte("lib/permissoes/menu.ts"), /href: "\/relatorios"/);
  assert.match(fonte("lib/permissoes/menu.ts"), /visivel: \(\) => true/);
  assert.doesNotMatch(
    fonte("lib/permissoes/tipos.ts"),
    /MODULOS_PERMISSAO = \[[^\]]*relatorios/
  );
  assert.match(fonte("components/layout/app-sidebar.tsx"), /Relatórios/);
  assert.match(fonte("lib/permissoes/rotas.ts"), /\/relatorios/);
});
