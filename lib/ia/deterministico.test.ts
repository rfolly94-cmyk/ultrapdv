import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import { interpretarIntencaoDeterministica } from "./deterministico/interpretar-intencao";
import { extrairPeriodoDeterministico } from "./deterministico/periodo";
import { MENSAGEM_IA_PRECISA_MODO, MENSAGEM_IA_SEM_PERMISSAO } from "./tipos";

const ctxA = { empresaId: empresaA };

function nome(texto: string, extra?: Partial<typeof ctxA> & { anterior?: Parameters<typeof interpretarIntencaoDeterministica>[1]["anterior"] }) {
  return interpretarIntencaoDeterministica(texto, { ...ctxA, ...extra })?.nome ?? null;
}

test("sinônimos de carteira.maior_devedor apontam a mesma intenção", () => {
  const frases = [
    "quem deve mais?",
    "qual cliente está devendo mais?",
    "maior devedor",
    "cliente com maior débito",
    "qual cliente tem a conta mais alta?",
    "quem está com maior saldo em aberto?",
    "qual cliente está me devendo mais?",
  ];
  for (const frase of frases) {
    assert.equal(nome(frase), "carteira.maior_devedor", frase);
  }
});

test("sinônimos de vendas.resumo compartilham período de hoje", () => {
  const frases = [
    "quanto vendi hoje?",
    "quanto vendemos hoje?",
    "vendas de hoje",
    "faturamento de hoje",
    "qual foi minha venda hoje?",
    "quanto faturamos hoje?",
  ];
  for (const frase of frases) {
    const resolvida = interpretarIntencaoDeterministica(frase, ctxA);
    assert.equal(resolvida?.nome, "vendas.resumo", frase);
    assert.equal(resolvida?.periodo, "hoje", frase);
    assert.equal(resolvida?.ferramenta, "consultar_vendas", frase);
  }
});

test("ranking de produto mais vendido hoje", () => {
  assert.equal(nome("produto mais vendido hoje"), "vendas.ranking_produtos");
  assert.equal(nome("qual produto vendeu mais hoje?"), "vendas.ranking_produtos");
  assert.equal(
    interpretarIntencaoDeterministica("produto mais vendido hoje", ctxA)?.periodo,
    "hoje"
  );
});

test("estoque: acabando, baixo e zerados", () => {
  assert.equal(nome("produto acabando"), "estoque.baixo");
  assert.equal(nome("estoque baixo"), "estoque.baixo");
  assert.equal(nome("produtos com estoque baixo"), "estoque.baixo");
  assert.equal(nome("produtos zerados"), "estoque.zerados");
  assert.equal(nome("estoque negativo"), "estoque.negativos");
});

test("períodos locais não dependem de IA", () => {
  assert.equal(extrairPeriodoDeterministico("vendas de ontem").periodo, "ontem");
  assert.equal(extrairPeriodoDeterministico("faturamento anteontem").periodo, "anteontem");
  assert.equal(extrairPeriodoDeterministico("esta semana").periodo, "semana");
  assert.equal(extrairPeriodoDeterministico("semana passada").periodo, "semana_anterior");
  assert.equal(extrairPeriodoDeterministico("últimos 7 dias").periodo, "7d");
  assert.equal(extrairPeriodoDeterministico("este mês").periodo, "mes");
  assert.equal(extrairPeriodoDeterministico("mês passado").periodo, "mes_anterior");
  assert.equal(extrairPeriodoDeterministico("últimos 30 dias").periodo, "30d");
  assert.equal(extrairPeriodoDeterministico("este ano").periodo, "ano");
});

test("follow-up estruturado usa o mesmo cliente só na mesma empresa", () => {
  const anterior = {
    empresaId: empresaA,
    intencao: "carteira.maior_devedor",
    clienteId: "cli-joao",
    clienteNome: "João",
  };
  const mesma = interpretarIntencaoDeterministica("quanto está vencido?", {
    empresaId: empresaA,
    anterior,
  });
  assert.equal(mesma?.nome, "carteira.cliente");
  assert.equal(mesma?.clienteId, "cli-joao");

  const outraEmpresa = interpretarIntencaoDeterministica("quanto está vencido?", {
    empresaId: empresaB,
    anterior,
  });
  assert.notEqual(outraEmpresa?.clienteId, "cli-joao");
  assert.notEqual(outraEmpresa?.nome, "carteira.cliente");
});

test("perguntas abertas e classificação livre não entram no modo gratuito", () => {
  assert.equal(nome("o que você recomenda para aumentar as vendas?"), null);
  assert.equal(nome("classifique este produto pelo texto da embalagem"), null);
  assert.equal(nome("me explique por que o faturamento caiu"), null);
  assert.equal(nome("estou vendendo mais e ganhando menos?"), null);
  assert.equal(nome("quais produtos vendem bem e estão acabando?"), null);
  assert.equal(nome("quais clientes compram bastante e atrasam?"), null);
  assert.equal(nome("onde tenho mais dinheiro parado?"), null);
});

test("sugestões gratuitas resolvem sem provider", () => {
  const sugestoes: Array<[string, string]> = [
    ["Quanto vendi hoje?", "vendas.resumo"],
    ["Produto mais vendido hoje", "vendas.ranking_produtos"],
    ["Quem está devendo mais?", "carteira.maior_devedor"],
    ["Clientes com contas vencidas", "carteira.vencidos"],
    ["Produtos com estoque baixo", "estoque.baixo"],
    ["Produtos zerados", "estoque.zerados"],
    ["Como está meu caixa?", "caixa.status"],
    ["O que precisa da minha atenção?", "notificacoes.resumo"],
    ["Notas rejeitadas", "fiscal.notas_rejeitadas"],
  ];
  for (const [frase, esperado] of sugestoes) {
    assert.equal(nome(frase), esperado, frase);
  }
});

test("fluxo híbrido consulta determinística antes do provider e não gera SQL", () => {
  const executar = fonte("lib/ia/executar-assistente.ts");
  const idxDireto = executar.indexOf("responderDeterministico");
  const idxProvider = executar.indexOf("chatComFerramentasIa");
  assert.ok(idxDireto > 0 && idxProvider > idxDireto);
  assert.match(executar, /modo: "direto"/);
  assert.match(executar, /MENSAGEM_IA_PRECISA_MODO/);
  assert.doesNotMatch(fonte("lib/ia/deterministico/interpretar-intencao.ts"), /chatComFerramentasIa|ULTRAPDV_IA_API_KEY/);
  assert.doesNotMatch(fonte("lib/ia/deterministico/responder.ts"), /chatComFerramentasIa|\.rpc\(|executeSql|from\(`\$\{/);
  assert.match(fonte("lib/ia/provider.ts"), /sem_credito/);
  assert.match(fonte("lib/ia/deterministico/telemetria.ts"), /deterministico/);
});

test("permissões continuam na tool, não no interpretador", () => {
  assert.match(fonte("lib/ia/ferramentas/clientes.ts"), /autorizarFerramentaIa/);
  assert.match(fonte("lib/ia/ferramentas/caixa.ts"), /autorizarFerramentaIa/);
  assert.match(fonte("lib/ia/permissoes.ts"), /MENSAGEM_IA_SEM_PERMISSAO/);
  assert.equal(MENSAGEM_IA_SEM_PERMISSAO, "Você não possui permissão para consultar essa informação.");
  assert.doesNotMatch(fonte("lib/ia/deterministico/interpretar-intencao.ts"), /temPermissao|planoPermite/);
});

test("multiempresa: empresa_id do cliente é ignorado e contexto não cruza empresa", () => {
  assert.match(fonte("lib/ia/deterministico/responder.ts"), /ignorarEmpresaIdDoCliente/);
  assert.match(fonte("lib/ia/executar-assistente.ts"), /empresaId !== empresaId|anterior\.empresaId !== ctx\.empresaId|contextoDeterministico\.empresaId !== empresaId/);
  assert.doesNotMatch(fonte("app/ia/actions.ts"), /input\.empresaId/);
  assert.equal(MENSAGEM_IA_PRECISA_MODO.includes("consultas de vendas"), true);
});
