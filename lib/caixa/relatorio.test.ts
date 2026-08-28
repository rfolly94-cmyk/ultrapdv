import assert from "node:assert/strict";
import { test } from "node:test";

import { linhasRelatorioCaixaPdf, nomeArquivoRelatorioCaixa, urlPdfRelatorioCaixa } from "@/lib/caixa/relatorio";
import { totaisDoLivro } from "@/lib/caixa/saldo";
import { fonte } from "@/lib/multiempresa/fonte";
import type { RelatorioCaixaDados } from "@/lib/caixa/relatorio";

const FASE4 = "supabase/migrations/20260825160000_caixa_reabertura_relatorio.sql";

function caixaBase(parcial: Partial<RelatorioCaixaDados> = {}): RelatorioCaixaDados {
  const movimentos = parcial.movimentos ?? [
    {
      id: "m1",
      caixa_id: "c1",
      tipo: "abertura" as const,
      origem_tipo: "sessao",
      origem_id: "c1",
      forma_pagamento_id: "din",
      forma_nome: "Dinheiro",
      forma_tipo: "DINHEIRO",
      forma_codigo: "01",
      permite_troco_snapshot: true,
      afeta_caixa_fisico_snapshot: true,
      venda_id: null,
      venda_numero: null,
      cliente_nome: null,
      entrada: 100,
      saida: 0,
      valor_liquido: 100,
      descricao: "Abertura",
      usuario_id: "u1",
      usuario_nome: "Ana",
      estorno_de_id: null,
      created_at: "2026-08-25T08:00:00.000Z",
    },
    {
      id: "m2",
      caixa_id: "c1",
      tipo: "venda" as const,
      origem_tipo: "venda",
      origem_id: "p1",
      forma_pagamento_id: "din",
      forma_nome: "Dinheiro",
      forma_tipo: "DINHEIRO",
      forma_codigo: "01",
      permite_troco_snapshot: true,
      afeta_caixa_fisico_snapshot: true,
      venda_id: "v1",
      venda_numero: 12,
      cliente_nome: "Cliente A",
      entrada: 50,
      saida: 10,
      valor_liquido: 40,
      descricao: null,
      usuario_id: "u1",
      usuario_nome: "Ana",
      estorno_de_id: null,
      created_at: "2026-08-25T09:00:00.000Z",
    },
    {
      id: "m3",
      caixa_id: "c1",
      tipo: "recebimento_carteira" as const,
      origem_tipo: "recebimento_carteira",
      origem_id: "r1",
      forma_pagamento_id: "pix",
      forma_nome: "PIX",
      forma_tipo: "PIX",
      forma_codigo: "17",
      permite_troco_snapshot: false,
      afeta_caixa_fisico_snapshot: false,
      venda_id: null,
      venda_numero: null,
      cliente_nome: "Cliente B",
      entrada: 80,
      saida: 0,
      valor_liquido: 80,
      descricao: "Recebimento Carteira",
      usuario_id: "u1",
      usuario_nome: "Ana",
      estorno_de_id: null,
      created_at: "2026-08-25T10:00:00.000Z",
    },
    {
      id: "m4",
      caixa_id: "c1",
      tipo: "suprimento" as const,
      origem_tipo: "operador",
      origem_id: null,
      forma_pagamento_id: "din",
      forma_nome: "Dinheiro",
      forma_tipo: "DINHEIRO",
      forma_codigo: "01",
      permite_troco_snapshot: true,
      afeta_caixa_fisico_snapshot: true,
      venda_id: null,
      venda_numero: null,
      cliente_nome: null,
      entrada: 20,
      saida: 0,
      valor_liquido: 20,
      descricao: "Suprimento",
      usuario_id: "u1",
      usuario_nome: "Ana",
      estorno_de_id: null,
      created_at: "2026-08-25T11:00:00.000Z",
    },
    {
      id: "m5",
      caixa_id: "c1",
      tipo: "sangria" as const,
      origem_tipo: "operador",
      origem_id: null,
      forma_pagamento_id: "din",
      forma_nome: "Dinheiro",
      forma_tipo: "DINHEIRO",
      forma_codigo: "01",
      permite_troco_snapshot: true,
      afeta_caixa_fisico_snapshot: true,
      venda_id: null,
      venda_numero: null,
      cliente_nome: null,
      entrada: 0,
      saida: 15,
      valor_liquido: -15,
      descricao: "Sangria",
      usuario_id: "u1",
      usuario_nome: "Ana",
      estorno_de_id: null,
      created_at: "2026-08-25T12:00:00.000Z",
    },
    {
      id: "m6",
      caixa_id: "c1",
      tipo: "estorno_recebimento" as const,
      origem_tipo: "estorno_recebimento",
      origem_id: "e1",
      forma_pagamento_id: "pix",
      forma_nome: "PIX",
      forma_tipo: "PIX",
      forma_codigo: "17",
      permite_troco_snapshot: false,
      afeta_caixa_fisico_snapshot: false,
      venda_id: null,
      venda_numero: null,
      cliente_nome: "Cliente B",
      entrada: 0,
      saida: 80,
      valor_liquido: -80,
      descricao: "Estorno",
      usuario_id: "u2",
      usuario_nome: "Rafael",
      estorno_de_id: "r1",
      created_at: "2026-08-25T13:00:00.000Z",
    },
  ];
  const totais = totaisDoLivro(movimentos);
  return {
    id: "c1",
    empresa_id: "emp-a",
    filial_id: null,
    numero: 7,
    usuario_abertura_id: "u1",
    usuario_abertura_nome: "Ana",
    usuario_fechamento_id: null,
    usuario_fechamento_nome: null,
    saldo_inicial: 100,
    dinheiro_contado: null,
    diferenca: null,
    aberto_em: "2026-08-25T08:00:00.000Z",
    fechado_em: null,
    status: "aberto",
    observacao_abertura: null,
    observacao_fechamento: null,
    reaberto: false,
    reaberturas: [],
    ciclos_fechamento: [],
    eventos_gaveta: [],
    movimentos,
    conferencia: [],
    ...totais,
    ...parcial,
  };
}

const empresa = {
  razaoSocial: "Empresa A Ltda",
  nomeFantasia: "Empresa A",
  cnpj: "12345678000199",
  logoUrl: null,
  filialNome: null,
};

test("27. PDF de Caixa aberto", () => {
  const linhas = linhasRelatorioCaixaPdf({ empresa, caixa: caixaBase() });
  const texto = linhas.join("\n");
  assert.match(texto, /Caixa #7/);
  assert.match(texto, /Status: aberto/);
  assert.match(fonte("app/api/impressao/caixa/[id]/route.ts"), /papel: "a4"/);
});

test("28. PDF de Caixa fechado", () => {
  const linhas = linhasRelatorioCaixaPdf({
    empresa,
    caixa: caixaBase({
      status: "fechado",
      fechado_em: "2026-08-25T18:00:00.000Z",
      usuario_fechamento_id: "u2",
      usuario_fechamento_nome: "João",
      dinheiro_contado: 145,
      diferenca: -10,
      conferencia: [
        {
          chave: "din",
          forma_pagamento_id: "din",
          forma_nome_snapshot: "Dinheiro",
          forma_tipo_snapshot: "DINHEIRO",
          forma_codigo_snapshot: "01",
          afeta_caixa_fisico_snapshot: true,
          valor_esperado: 155,
          valor_informado: 145,
          diferenca: -10,
        },
      ],
    }),
  });
  const texto = linhas.join("\n");
  assert.match(texto, /Status: fechado/);
  assert.match(texto, /Dinheiro contado/);
  assert.match(texto, /Diferenca/);
});

test("29. PDF de Caixa reaberto", () => {
  const linhas = linhasRelatorioCaixaPdf({
    empresa,
    caixa: caixaBase({
      reaberto: true,
      reaberturas: [
        {
          id: "r1",
          fechamento_id: "f1",
          reaberto_em: "2026-08-25T18:20:00.000Z",
          reaberto_por_id: "u2",
          reaberto_por_nome: "Rafael",
          motivo: "recebimento esquecido",
        },
      ],
      ciclos_fechamento: [
        {
          id: "f1",
          versao: 1,
          fechado_em: "2026-08-25T18:00:00.000Z",
          fechado_por_id: "u1",
          fechado_por_nome: "João",
          dinheiro_contado: 990,
          dinheiro_fisico_esperado: 1000,
          diferenca: -10,
          observacao: null,
          fechamento_cego: false,
          meios: [],
        },
      ],
    }),
  });
  const texto = linhas.join("\n");
  assert.match(texto, /REABERTO/);
  assert.match(texto, /Historico de fechamentos e reaberturas/);
  assert.match(texto, /recebimento esquecido/);
});

test("30-38. relatório mostra totais, formas, troco, esperado e contado", () => {
  const caixa = caixaBase({
    status: "fechado",
    fechado_em: "2026-08-25T18:00:00.000Z",
    usuario_fechamento_nome: "João",
    dinheiro_contado: 145,
    diferenca: 0,
    conferencia: [
      {
        chave: "din",
        forma_pagamento_id: "din",
        forma_nome_snapshot: "Dinheiro",
        forma_tipo_snapshot: "DINHEIRO",
        forma_codigo_snapshot: "01",
        afeta_caixa_fisico_snapshot: true,
        valor_esperado: 145,
        valor_informado: 145,
        diferenca: 0,
      },
      {
        chave: "pix",
        forma_pagamento_id: "pix",
        forma_nome_snapshot: "PIX",
        forma_tipo_snapshot: "PIX",
        forma_codigo_snapshot: "17",
        afeta_caixa_fisico_snapshot: false,
        valor_esperado: 0,
        valor_informado: 0,
        diferenca: 0,
      },
    ],
  });
  const texto = linhasRelatorioCaixaPdf({ empresa, caixa }).join("\n");
  assert.match(texto, /Saldo inicial/);
  assert.match(texto, /Total de vendas/);
  assert.match(texto, /Carteira/);
  assert.match(texto, /Suprimentos/);
  assert.match(texto, /Sangrias/);
  assert.match(texto, /Estornos/);
  assert.match(texto, /Dinheiro:/);
  assert.match(texto, /PIX:/);
  assert.match(texto, /Troco/);
  assert.match(texto, /Dinheiro fisico esperado/);
  assert.match(texto, /Dinheiro contado/);
  assert.match(texto, /Venda #12/);
});

test("39. mostra histórico de reabertura", () => {
  const texto = linhasRelatorioCaixaPdf({
    empresa,
    caixa: caixaBase({
      reaberto: true,
      reaberturas: [
        {
          id: "r1",
          fechamento_id: "f1",
          reaberto_em: "2026-08-25T18:20:00.000Z",
          reaberto_por_id: "u2",
          reaberto_por_nome: "Rafael",
          motivo: "lançamento esquecido",
        },
      ],
      ciclos_fechamento: [
        {
          id: "f1",
          versao: 1,
          fechado_em: "2026-08-25T18:00:00.000Z",
          fechado_por_id: "u1",
          fechado_por_nome: "João",
          dinheiro_contado: 990,
          dinheiro_fisico_esperado: 1000,
          diferenca: -10,
          observacao: null,
          fechamento_cego: false,
          meios: [],
        },
        {
          id: "f2",
          versao: 2,
          fechado_em: "2026-08-25T18:30:00.000Z",
          fechado_por_id: "u2",
          fechado_por_nome: "Rafael",
          dinheiro_contado: 1050,
          dinheiro_fisico_esperado: 1050,
          diferenca: 0,
          observacao: null,
          fechamento_cego: false,
          meios: [],
        },
      ],
    }),
  }).join("\n");
  assert.match(texto, /Fechado em/);
  assert.match(texto, /Reaberto em/);
  assert.match(texto, /lançamento esquecido/);
});

test("40. alteração posterior da forma não muda relatório histórico", () => {
  const carregar = fonte("lib/caixa/carregar.ts");
  assert.match(carregar, /forma_nome_snapshot/);
  assert.doesNotMatch(
    carregar.slice(carregar.indexOf("caixa_fechamentos_meios")),
    /from\("formas_pagamento"\)/
  );
  const linhas = linhasRelatorioCaixaPdf({
    empresa,
    caixa: caixaBase({
      status: "fechado",
      conferencia: [
        {
          chave: "antiga",
          forma_pagamento_id: "x",
          forma_nome_snapshot: "Nome antigo da forma",
          forma_tipo_snapshot: "PIX",
          forma_codigo_snapshot: "17",
          afeta_caixa_fisico_snapshot: false,
          valor_esperado: 10,
          valor_informado: 10,
          diferenca: 0,
        },
      ],
    }),
  });
  assert.match(linhas.join("\n"), /PIX:/);
});

test("41. Empresa B não baixa PDF da Empresa A", () => {
  const rota = fonte("app/api/impressao/caixa/[id]/route.ts");
  assert.match(rota, /buscarVinculoEmpresaAtiva/);
  assert.match(rota, /carregarDetalheCaixa/);
  assert.match(rota, /caixa\.empresa_id !== empresaId/);
  assert.match(rota, /exigirOperacaoCaixa/);
  assert.doesNotMatch(rota, /searchParams\.get\("empresa_id"\)/);
});

test("42-43. impressão usa impressora selecionada e Conector indisponível é amigável", () => {
  const ui = fonte("components/caixa/caixa-relatorio-acoes.tsx");
  assert.match(ui, /impressora=\{impressora \|\| null\}/);
  assert.match(ui, /configDoTipo\(configs\.configs, "danfe_nfe"\)/);
  assert.match(ui, /lastPrinter/);
  assert.match(ui, /MENSAGEM_CONECTOR_AUSENTE/);
  assert.match(ui, /BotaoImprimirConector/);
  assert.doesNotMatch(ui, /impressoraNome:\s*"/);
});

test("44-46. gerar PDF e imprimir não alteram o Caixa", () => {
  const rota = fonte("app/api/impressao/caixa/[id]/route.ts");
  assert.doesNotMatch(rota, /rpc_movimentar_caixa|rpc_abrir_caixa|rpc_reabrir_caixa|rpc_confirmar_fechamento/);
  const ui = fonte("components/caixa/caixa-relatorio-acoes.tsx");
  assert.doesNotMatch(ui, /reabrirCaixa|movimentarCaixa|confirmarFechamentoCaixa/);
  assert.match(fonte(FASE4), /caixa_reaberturas/);
});

test("nome do arquivo e URL do PDF", () => {
  assert.equal(
    nomeArquivoRelatorioCaixa({
      numero: 7,
      aberto_em: "2026-08-25T08:00:00.000Z",
    }),
    "caixa-7-20260825.pdf"
  );
  assert.equal(urlPdfRelatorioCaixa("abc", true), "/api/impressao/caixa/abc?download=1");
});

test("cabeçalho usa dados da empresa autorizada", () => {
  const texto = linhasRelatorioCaixaPdf({ empresa, caixa: caixaBase() }).join("\n");
  assert.match(texto, /Empresa A Ltda/);
  assert.match(texto, /CNPJ: 12345678000199/);
  assert.match(fonte("lib/caixa/relatorio-servidor.ts"), /razao_social, nome_fantasia, cnpj/);
});
