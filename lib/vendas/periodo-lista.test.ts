import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  dataColunaListaVenda,
  filtroCoalesceDataVenda,
  formatarPeriodoPersonalizadoExibicao,
  montarHrefListaVendas,
  parseFiltrosListaVendas,
  periodoListaVendasValido,
  resolverPeriodoListaVendas,
  vendaNoPeriodoLista,
} from "./periodo-lista";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

const agoraCuiabaVsSp = new Date("2026-08-21T03:30:00.000Z");

test("sem periodo na URL o padrão é hoje", () => {
  assert.equal(periodoListaVendasValido(undefined), "hoje");
  assert.equal(parseFiltrosListaVendas({}).periodo, "hoje");
  assert.equal(parseFiltrosListaVendas({ periodo: "7dias" }).periodo, "7dias");
  assert.equal(
    parseFiltrosListaVendas({ periodo: "personalizado" }).periodo,
    "hoje"
  );
});

test("hoje usa o fuso da empresa, não um offset global", () => {
  const sp = resolverPeriodoListaVendas(
    "hoje",
    null,
    null,
    "America/Sao_Paulo",
    agoraCuiabaVsSp
  );
  const cuiaba = resolverPeriodoListaVendas(
    "hoje",
    null,
    null,
    "America/Cuiaba",
    agoraCuiabaVsSp
  );

  assert.equal(sp.hojeIso, "2026-08-21");
  assert.equal(cuiaba.hojeIso, "2026-08-20");
  assert.notEqual(sp.inicio.toISOString(), cuiaba.inicio.toISOString());
  assert.equal(sp.inicio.toISOString(), "2026-08-21T03:00:00.000Z");
  assert.equal(sp.fim.toISOString(), "2026-08-22T03:00:00.000Z");
  assert.equal(cuiaba.inicio.toISOString(), "2026-08-20T04:00:00.000Z");
  assert.equal(cuiaba.fim.toISOString(), "2026-08-21T04:00:00.000Z");
});

test("intervalo é início inclusivo e dia seguinte exclusivo, sem 23:59:59", () => {
  const janela = resolverPeriodoListaVendas(
    "personalizado",
    "2026-08-01",
    "2026-08-20",
    "America/Sao_Paulo",
    agoraCuiabaVsSp
  );

  assert.equal(janela.inicio.toISOString(), "2026-08-01T03:00:00.000Z");
  assert.equal(janela.fim.toISOString(), "2026-08-21T03:00:00.000Z");
  assert.doesNotMatch(janela.fim.toISOString(), /23:59:59/);

  const filtro = filtroCoalesceDataVenda(janela.inicio, janela.fim);
  assert.match(filtro, /finalizada_at\.gte\./);
  assert.match(filtro, /finalizada_at\.lt\./);
  assert.match(filtro, /finalizada_at\.is\.null/);
  assert.match(filtro, /created_at\.gte\./);
  assert.match(filtro, /created_at\.lt\./);
  assert.doesNotMatch(filtro, /23:59:59/);
});

test("coluna Data da listagem usa finalizada_at com fallback created_at", () => {
  assert.equal(
    dataColunaListaVenda({
      finalizada_at: "2026-08-20T18:00:00.000Z",
      created_at: "2026-08-19T12:00:00.000Z",
    }),
    "2026-08-20T18:00:00.000Z"
  );
  assert.equal(
    dataColunaListaVenda({
      finalizada_at: null,
      created_at: "2026-08-19T12:00:00.000Z",
    }),
    "2026-08-19T12:00:00.000Z"
  );

  const janela = resolverPeriodoListaVendas(
    "hoje",
    null,
    null,
    "America/Sao_Paulo",
    agoraCuiabaVsSp
  );
  assert.equal(
    vendaNoPeriodoLista("2026-08-21T12:00:00.000Z", janela.inicio, janela.fim),
    true
  );
  assert.equal(
    vendaNoPeriodoLista("2026-08-20T23:00:00.000Z", janela.inicio, janela.fim),
    false
  );
});

test("últimos 7 dias incluem hoje e os 6 dias civis anteriores", () => {
  const janela = resolverPeriodoListaVendas(
    "7dias",
    null,
    null,
    "America/Sao_Paulo",
    new Date("2026-08-20T15:00:00.000Z")
  );
  assert.equal(janela.inicio.toISOString(), "2026-08-14T03:00:00.000Z");
  assert.equal(janela.fim.toISOString(), "2026-08-21T03:00:00.000Z");
});

test("href preserva combinação de período, status, modelo e busca", () => {
  assert.equal(
    montarHrefListaVendas({
      periodo: "hoje",
      inicio: null,
      fim: null,
      status: "todos",
      modelo: "todos",
      q: "",
    }),
    "/vendas?periodo=hoje"
  );
  assert.equal(
    montarHrefListaVendas({
      periodo: "7dias",
      inicio: null,
      fim: null,
      status: "finalizada",
      modelo: "65",
      q: "Rafael",
    }),
    "/vendas?periodo=7dias&status=finalizada&modelo=65&q=Rafael"
  );
  assert.equal(
    montarHrefListaVendas({
      periodo: "personalizado",
      inicio: "2026-08-01",
      fim: "2026-08-20",
      status: "todos",
      modelo: "todos",
      q: "",
    }),
    "/vendas?periodo=personalizado&inicio=2026-08-01&fim=2026-08-20"
  );
  assert.equal(
    formatarPeriodoPersonalizadoExibicao("2026-08-01", "2026-08-20"),
    "01/08/2026 - 20/08/2026"
  );
});

test("listagem aplica período e empresa_id na mesma consulta de vendas", () => {
  const pagina = fonte("app/vendas/page.tsx");
  assert.match(pagina, /from\("vendas"\)/);
  assert.match(pagina, /\.eq\(\s*"empresa_id"/);
  assert.match(pagina, /filtroCoalesceDataVenda/);
  assert.match(pagina, /carregarFusoHorarioFiscal/);
  assert.match(pagina, /usuarios_empresas/);
  assert.match(pagina, /principal.*true/);
  assert.doesNotMatch(pagina, /23:59:59/);
  assert.match(
    fonte("components/vendas/vendas-lista.tsx"),
    /formatarData\(venda\.dataVenda\)/
  );
  assert.match(
    fonte("app/vendas/page.tsx"),
    /dataColunaListaVenda/
  );
});
