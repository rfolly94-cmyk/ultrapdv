import assert from "node:assert/strict";
import { test } from "node:test";

import { clienteA, clienteB, empresaA, empresaB, produtoA, produtoB } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import { interpretarIntencaoDeterministica } from "./deterministico/interpretar-intencao";
import { aplicarContextoNaConsulta } from "./analitico/contexto-consulta";
import { fontesAnaliticasVazias, type FontesAnaliticas } from "./analitico/fontes-modelo";
import { JOINS_PERMITIDOS } from "./analitico/dimensoes";
import { REGISTRO_METRICAS_ANALITICAS } from "./analitico/metricas";
import { planejarConsultaAnalitica } from "./analitico/planejar-consulta";
import { calcularResultadoAnalitico } from "./analitico/resultados";
import { validarConsultaAnalitica } from "./analitico/validar-consulta";
import {
  MAX_CONSULTAS_ANALITICAS_POR_MENSAGEM,
  NOMES_METRICA_ANALITICA,
  type ConsultaAnalitica,
  type ContextoAnaliticoAssistente,
} from "./analitico/tipos";
import { NOMES_FERRAMENTAS_IA } from "./tipos";

const CAT_BEBIDAS = "cat-bebidas";
const CAT_ELETRO = "cat-eletro";
const CAT_PADARIA = "cat-padaria";
const P_REFRI = produtoA;
const P_CERV = "p-cerveja";
const P_TV = "p-tv";
const P_PAO = "p-pao";
const C_JOAO = clienteA;
const C_MARIA = clienteB;
const C_PEDRO = "c-pedro";

function consultaOk(bruto: Record<string, unknown>): ConsultaAnalitica {
  const validada = validarConsultaAnalitica(bruto);
  assert.equal(validada.ok, true, validada.ok ? "" : validada.erro);
  return (validada as { ok: true; consulta: ConsultaAnalitica }).consulta;
}

function fontesLoja(empresaId = empresaA): FontesAnaliticas {
  const fontes = fontesAnaliticasVazias(empresaId);
  fontes.janela = {
    inicio: new Date("2026-08-01T03:00:00.000Z"),
    fim: new Date("2026-09-01T03:00:00.000Z"),
    rotulo: "este mês",
    dias: 31,
  };
  fontes.janelaAnterior = {
    inicio: new Date("2026-07-01T03:00:00.000Z"),
    fim: new Date("2026-08-01T03:00:00.000Z"),
    rotulo: "mês anterior",
    dias: 31,
  };
  fontes.categorias = new Map([
    [CAT_BEBIDAS, "Bebidas"],
    [CAT_ELETRO, "Eletrônicos"],
    [CAT_PADARIA, "Padaria"],
  ]);
  fontes.produtos = [
    {
      id: P_REFRI,
      empresa_id: empresaId,
      nome: "Refrigerante",
      categoria_id: CAT_BEBIDAS,
      marca_id: null,
      preco_custo: 5,
      preco_venda: 20,
      ativo: true,
    },
    {
      id: P_CERV,
      empresa_id: empresaId,
      nome: "Cerveja",
      categoria_id: CAT_BEBIDAS,
      marca_id: null,
      preco_custo: 8,
      preco_venda: 12,
      ativo: true,
    },
    {
      id: P_TV,
      empresa_id: empresaId,
      nome: "TV",
      categoria_id: CAT_ELETRO,
      marca_id: null,
      preco_custo: 1000,
      preco_venda: 1500,
      ativo: true,
    },
    {
      id: P_PAO,
      empresa_id: empresaId,
      nome: "Pão",
      categoria_id: CAT_PADARIA,
      marca_id: null,
      preco_custo: 1,
      preco_venda: 5,
      ativo: true,
    },
  ];
  fontes.estoque = new Map([
    [P_REFRI, { produto_id: P_REFRI, quantidade: 2, minimo: 5 }],
    [P_CERV, { produto_id: P_CERV, quantidade: 100, minimo: 10 }],
    [P_TV, { produto_id: P_TV, quantidade: 8, minimo: 1 }],
    [P_PAO, { produto_id: P_PAO, quantidade: 0, minimo: 4 }],
  ]);
  fontes.clientes = new Map([
    [C_JOAO, { id: C_JOAO, nome: "João", ativo: true, limite_credito: 1000, bloqueado: false }],
    [C_MARIA, { id: C_MARIA, nome: "Maria", ativo: true, limite_credito: 500, bloqueado: false }],
    [C_PEDRO, { id: C_PEDRO, nome: "Pedro", ativo: true, limite_credito: 800, bloqueado: false }],
  ]);
  fontes.carteira = new Map([
    [C_JOAO, { debitoAberto: 250, vencido: 200, creditoAberto: 0 }],
    [C_MARIA, { debitoAberto: 0, vencido: 0, creditoAberto: 0 }],
    [C_PEDRO, { debitoAberto: 400, vencido: 400, creditoAberto: 0 }],
  ]);
  fontes.vendas = [
    {
      id: "v-tv",
      empresa_id: empresaId,
      cliente_id: C_PEDRO,
      usuario_id: null,
      status: "finalizada",
      valor_total: 2200,
      desconto: 0,
      finalizada_at: "2026-08-10T12:00:00.000Z",
      created_at: "2026-08-10T12:00:00.000Z",
    },
    {
      id: "v-refri",
      empresa_id: empresaId,
      cliente_id: C_JOAO,
      usuario_id: null,
      status: "finalizada",
      valor_total: 800,
      desconto: 0,
      finalizada_at: "2026-08-12T12:00:00.000Z",
      created_at: "2026-08-12T12:00:00.000Z",
    },
    {
      id: "v-pao",
      empresa_id: empresaId,
      cliente_id: C_JOAO,
      usuario_id: null,
      status: "finalizada",
      valor_total: 150,
      desconto: 0,
      finalizada_at: "2026-08-15T12:00:00.000Z",
      created_at: "2026-08-15T12:00:00.000Z",
    },
    {
      id: "v-cerv",
      empresa_id: empresaId,
      cliente_id: C_MARIA,
      usuario_id: null,
      status: "finalizada",
      valor_total: 24,
      desconto: 0,
      finalizada_at: "2026-08-18T12:00:00.000Z",
      created_at: "2026-08-18T12:00:00.000Z",
    },
  ];
  fontes.itens = [
    { venda_id: "v-tv", produto_id: P_TV, produto_nome: "TV", quantidade: 2, valor_total: 2200, empresa_id: empresaId },
    { venda_id: "v-refri", produto_id: P_REFRI, produto_nome: "Refrigerante", quantidade: 40, valor_total: 800, empresa_id: empresaId },
    { venda_id: "v-pao", produto_id: P_PAO, produto_nome: "Pão", quantidade: 30, valor_total: 150, empresa_id: empresaId },
    { venda_id: "v-cerv", produto_id: P_CERV, produto_nome: "Cerveja", quantidade: 2, valor_total: 24, empresa_id: empresaId },
  ];
  fontes.vendasAnterior = [
    {
      id: "v-old-refri",
      empresa_id: empresaId,
      cliente_id: C_JOAO,
      usuario_id: null,
      status: "finalizada",
      valor_total: 2000,
      desconto: 0,
      finalizada_at: "2026-07-10T12:00:00.000Z",
      created_at: "2026-07-10T12:00:00.000Z",
    },
    {
      id: "v-old-tv",
      empresa_id: empresaId,
      cliente_id: C_PEDRO,
      usuario_id: null,
      status: "finalizada",
      valor_total: 1000,
      desconto: 0,
      finalizada_at: "2026-07-20T12:00:00.000Z",
      created_at: "2026-07-20T12:00:00.000Z",
    },
  ];
  fontes.itensAnterior = [
    { venda_id: "v-old-refri", produto_id: P_REFRI, produto_nome: "Refrigerante", quantidade: 100, valor_total: 2000, empresa_id: empresaId },
    { venda_id: "v-old-tv", produto_id: P_TV, produto_nome: "TV", quantidade: 1, valor_total: 1000, empresa_id: empresaId },
  ];
  fontes.fiscal = { revisao: 3, gruposIncompativeis: 1, notasRejeitadas: 2 };
  fontes.caixa = { aberto: true, entradas: 500, saidas: 80, saldoAtual: 420 };
  return fontes;
}

test("corpus: perguntas naturais diferentes reusam as mesmas métricas", () => {
  const corpus: Array<{ pergunta: string; metricas: string[]; dimensao?: string; comparacao?: boolean }> = [
    { pergunta: "o que está indo mal na loja?", metricas: ["faturamento", "margem_percentual"], comparacao: true },
    { pergunta: "estou vendendo mais e ganhando menos?", metricas: ["faturamento", "margem_bruta", "margem_percentual"], comparacao: true },
    { pergunta: "quais produtos vendem muito e estão acabando?", metricas: ["faturamento", "estoque_atual"], dimensao: "produto" },
    { pergunta: "produtos que vendem bem mas estão perto de acabar", metricas: ["faturamento", "estoque_atual"], dimensao: "produto" },
    { pergunta: "onde tenho mais dinheiro parado?", metricas: ["valor_imobilizado"], dimensao: "produto" },
    { pergunta: "quais clientes compram bastante e atrasam?", metricas: ["valor_comprado", "saldo_vencido"], dimensao: "cliente" },
    { pergunta: "qual categoria cresceu mais?", metricas: ["faturamento", "crescimento_periodo"], dimensao: "categoria", comparacao: true },
    { pergunta: "qual categoria vende bastante mas tem margem baixa?", metricas: ["faturamento", "margem_percentual"], dimensao: "categoria" },
    { pergunta: "se eu fosse comprar mercadoria hoje, o que merece atenção?", metricas: ["faturamento", "estoque_atual", "cobertura_estoque_dias"], dimensao: "produto" },
    { pergunta: "compare este mês com o anterior", metricas: ["faturamento"], comparacao: true },
    { pergunta: "dos produtos mais vendidos, quais estão sem estoque?", metricas: ["faturamento", "estoque_atual"], dimensao: "produto" },
  ];
  const ferramentasPorPergunta = new Set<string>();
  for (const item of corpus) {
    const plano = planejarConsultaAnalitica(item.pergunta);
    assert.equal(plano.ok, true, `${item.pergunta}: ${plano.ok ? "" : plano.erro}`);
    if (!plano.ok) continue;
    ferramentasPorPergunta.add("consultar_analitico");
    for (const metrica of item.metricas) {
      assert.ok(plano.consulta.metricas.includes(metrica as never), `${item.pergunta} deveria usar ${metrica}`);
    }
    if (item.dimensao) {
      assert.deepEqual(plano.consulta.dimensoes, [item.dimensao]);
    }
    if (item.comparacao) {
      assert.equal(plano.consulta.comparacao, true, item.pergunta);
    }
    const validada = validarConsultaAnalitica(plano.consulta);
    assert.equal(validada.ok, true, item.pergunta);
  }
  assert.deepEqual([...ferramentasPorPergunta], ["consultar_analitico"]);
  assert.equal(
    NOMES_FERRAMENTAS_IA.filter((nome) => nome.startsWith("consultar_") && nome.includes("acabando")).length,
    0
  );
});

test("backend calcula ranking, join produto e comparação sem o LLM", () => {
  const fontes = fontesLoja();
  const planoAcabando = planejarConsultaAnalitica("quais produtos vendem muito e estão acabando?");
  assert.equal(planoAcabando.ok, true);
  if (!planoAcabando.ok) return;
  const acabando = calcularResultadoAnalitico(planoAcabando.consulta, fontes);
  assert.ok(acabando.linhas.length >= 1);
  assert.equal(acabando.linhas[0].nome, "Refrigerante");
  assert.equal(acabando.linhas[0].valores.estoque_atual, 2);
  assert.ok(!acabando.linhas.some((linha) => linha.nome === "Pão"));

  const parado = calcularResultadoAnalitico(
    consultaOk({
      metricas: ["valor_imobilizado", "valor_estoque_custo", "giro_estoque"],
      dimensoes: ["produto"],
      ordenacao: { metrica: "valor_imobilizado", direcao: "desc" },
      limite: 8,
    }),
    fontes
  );
  assert.equal(parado.linhas[0].nome, "TV");
  assert.equal(parado.linhas[0].valores.valor_imobilizado, 8000);

  const clientes = calcularResultadoAnalitico(
    consultaOk({
      metricas: ["valor_comprado", "saldo_vencido", "inadimplencia_cliente"],
      dimensoes: ["cliente"],
      filtros: [{ campo: "saldo_vencido", operador: "gt", valor: 0 }],
      ordenacao: { metrica: "valor_comprado", direcao: "desc" },
    }),
    fontes
  );
  assert.ok(clientes.linhas.every((linha) => Number(linha.valores.saldo_vencido) > 0));
  assert.ok(clientes.linhas.some((linha) => linha.nome === "João"));
  assert.ok(!clientes.linhas.some((linha) => linha.nome === "Maria"));

  const categorias = calcularResultadoAnalitico(
    consultaOk({
      metricas: ["faturamento", "margem_percentual", "crescimento_periodo"],
      dimensoes: ["categoria"],
      comparacao: true,
      ordenacao: { metrica: "faturamento", direcao: "desc" },
    }),
    fontes
  );
  assert.equal(categorias.linhas[0].nome, "Eletrônicos");
  assert.ok(Number(categorias.linhas[0].valores.margem_percentual) < 15);
  const crescimentoEletro = Number(categorias.linhas[0].valores.crescimento_periodo);
  assert.ok(crescimentoEletro > 0);

  const mes = calcularResultadoAnalitico(
    consultaOk({
      metricas: ["faturamento", "margem_bruta", "margem_percentual"],
      comparacao: true,
      periodo: "mes",
    }),
    fontes
  );
  assert.equal(mes.linhas.length, 0);
  assert.ok(Number(mes.resumo.faturamento) > Number(mes.comparacao?.metricas.faturamento?.anterior));
  assert.ok(
    Number(mes.comparacao?.metricas.margem_percentual?.atual) <
      Number(mes.comparacao?.metricas.margem_percentual?.anterior)
  );
  assert.ok(mes.avisos.some((item) => /posição atual/i.test(item)));
});

test("follow-up reaproveita período e ids da mesma empresa", () => {
  const fontes = fontesLoja();
  const primeira = calcularResultadoAnalitico(
    consultaOk({
      metricas: ["faturamento", "quantidade_vendida"],
      dimensoes: ["produto"],
      ordenacao: { metrica: "faturamento", direcao: "desc" },
      limite: 5,
      periodo: "mes",
    }),
    fontes
  );
  assert.ok(primeira.contexto.entidadeIds.includes(P_TV));
  const plano = planejarConsultaAnalitica("e desses, quais estão sem estoque?", primeira.contexto);
  assert.equal(plano.ok, true);
  if (!plano.ok) return;
  assert.equal(plano.consulta.reutilizarContexto, true);
  const aplicada = aplicarContextoNaConsulta(plano.consulta, primeira.contexto, empresaA);
  assert.equal(aplicada.periodo, "mes");
  assert.ok(aplicada.filtros.some((filtro) => filtro.campo === "produto_id" && filtro.operador === "in"));
  const segunda = calcularResultadoAnalitico(aplicada, fontes);
  assert.equal(segunda.linhas.length, 1);
  assert.equal(segunda.linhas[0].nome, "Pão");

  const outraEmpresa = aplicarContextoNaConsulta(plano.consulta, primeira.contexto, empresaB);
  assert.equal(outraEmpresa.reutilizarContexto, false);
  assert.equal(
    outraEmpresa.filtros.some((filtro) => filtro.campo === "produto_id"),
    false
  );
});

test("segurança da DSL: SQL, tabela, métrica, join e empresa_id", () => {
  assert.equal(validarConsultaAnalitica({ metricas: ["faturamento"], sql: "select 1" }).ok, false);
  assert.equal(validarConsultaAnalitica({ metricas: ["faturamento"], tabela: "vendas" }).ok, false);
  assert.equal(validarConsultaAnalitica({ metricas: ["lucro_liquido"] }).ok, false);
  assert.equal(
    validarConsultaAnalitica({
      metricas: ["faturamento"],
      filtros: [{ campo: "produto_id", operador: "eq", valor: "SELECT * FROM vendas" }],
    }).ok,
    false
  );
  const join = validarConsultaAnalitica({
    metricas: ["entradas", "faturamento"],
    dimensoes: ["produto"],
  });
  assert.equal(join.ok, false);

  const comEmpresa = validarConsultaAnalitica({
    metricas: ["faturamento"],
    empresa_id: empresaB,
    empresaId: empresaB,
  });
  assert.equal(comEmpresa.ok, true);
  if (comEmpresa.ok) {
    assert.equal("empresa_id" in comEmpresa.consulta, false);
    assert.equal("empresaId" in comEmpresa.consulta, false);
  }

  const limite = consultaOk({ metricas: ["faturamento"], limite: 999 });
  assert.equal(limite.limite, 20);

  assert.ok(!NOMES_METRICA_ANALITICA.includes("ncm" as never));
  assert.ok(!NOMES_METRICA_ANALITICA.includes("classificar_produto_fiscal" as never));
  assert.deepEqual([...JOINS_PERMITIDOS.produto], ["vendas", "estoque"]);
  assert.deepEqual([...JOINS_PERMITIDOS.cliente], ["vendas", "carteira", "clientes"]);
});

test("permissão omite métrica bloqueada e isolamento fica na fonte da empresa", () => {
  const fontes = fontesLoja(empresaA);
  fontes.dominiosNegados = ["carteira"];
  const resultado = calcularResultadoAnalitico(
    consultaOk({
      metricas: ["valor_comprado", "saldo_vencido"],
      dimensoes: ["cliente"],
    }),
    fontes
  );
  assert.ok(resultado.linhas[0].valores.valor_comprado != null);
  assert.equal("saldo_vencido" in resultado.linhas[0].valores, false);

  const semTudo = fontesLoja(empresaA);
  semTudo.dominiosNegados = ["vendas", "estoque", "carteira", "caixa", "fiscal"];
  const bloqueado = calcularResultadoAnalitico(
    consultaOk({ metricas: ["saldo_vencido"] }),
    semTudo
  );
  assert.ok(bloqueado.avisos.some((item) => /Nenhuma métrica/i.test(item)));

  const soA = calcularResultadoAnalitico(
    consultaOk({ metricas: ["faturamento"], dimensoes: ["produto"] }),
    fontesLoja(empresaA)
  );
  assert.equal(soA.contexto.empresaId, empresaA);
  assert.ok(!soA.linhas.some((linha) => linha.id === produtoB));
});

test("fonte: uma tool genérica, limites, híbrido e fiscal especializado", () => {
  assert.ok(NOMES_FERRAMENTAS_IA.includes("consultar_analitico"));
  assert.ok(NOMES_FERRAMENTAS_IA.includes("classificar_produto_fiscal"));
  assert.match(fonte("lib/ia/ferramentas/registro.ts"), /consultar_analitico/);
  assert.doesNotMatch(fonte("lib/ia/ferramentas/registro.ts"), /executar_sql|chamar_rpc|alterar_tabela/);
  assert.match(fonte("lib/ia/executar-assistente.ts"), /MAX_CONSULTAS_ANALITICAS_POR_MENSAGEM/);
  assert.match(fonte("lib/ia/executar-assistente.ts"), /MAX_RODADAS = 4/);
  assert.match(fonte("lib/ia/executar-assistente.ts"), /MAX_CHAMADAS_POR_MENSAGEM = 8/);
  assert.doesNotMatch(fonte("lib/ia/executar-assistente.ts"), /planejarConsultaAnalitica/);
  assert.match(fonte("lib/ia/analitico/fontes.ts"), /\.eq\("empresa_id", ctx\.empresaId\)/);
  assert.match(fonte("lib/ia/analitico/fontes.ts"), /filtrarRegistrosDaEmpresaAtiva/);
  assert.match(fonte("lib/ia/analitico/observabilidade.ts"), /NODE_ENV !== "development"/);
  assert.equal(MAX_CONSULTAS_ANALITICAS_POR_MENSAGEM, 4);
  assert.equal(REGISTRO_METRICAS_ANALITICAS.margem_bruta.aviso?.includes("lucro"), true);
  assert.equal(
    interpretarIntencaoDeterministica("quanto vendi hoje?", { empresaId: empresaA })?.nome,
    "vendas.resumo"
  );
  assert.equal(
    interpretarIntencaoDeterministica("quais produtos vendem bem e estão acabando?", {
      empresaId: empresaA,
    }),
    null
  );
});

test("contexto analítico não cruza empresa e métricas derivadas têm fórmula", () => {
  const contexto: ContextoAnaliticoAssistente = {
    empresaId: empresaA,
    periodo: "mes",
    dimensoes: ["produto"],
    metricas: ["faturamento"],
    entidadeTipo: "produto",
    entidadeIds: [P_REFRI],
  };
  const consulta = consultaOk({
    metricas: ["estoque_atual"],
    dimensoes: ["produto"],
    reutilizarContexto: true,
  });
  const outra = aplicarContextoNaConsulta(consulta, contexto, empresaB);
  assert.equal(outra.reutilizarContexto, false);
  assert.equal(REGISTRO_METRICAS_ANALITICAS.giro_estoque.formula.includes("quantidade_vendida"), true);
  assert.equal(REGISTRO_METRICAS_ANALITICAS.cobertura_estoque_dias.formula.includes("média diária"), true);
  assert.equal(REGISTRO_METRICAS_ANALITICAS.inadimplencia_cliente.formula.includes("saldo_vencido"), true);
  assert.equal(REGISTRO_METRICAS_ANALITICAS.valor_imobilizado.formula.includes("valor_estoque_custo"), true);
});
