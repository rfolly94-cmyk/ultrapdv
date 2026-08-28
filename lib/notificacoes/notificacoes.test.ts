import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB, produtoA, produtoB } from "@/lib/multiempresa/cenario";
import { avaliarCaixaNotificacoes } from "./avaliar-caixa";
import { avaliarEstoqueNotificacoes } from "./avaliar-estoque";
import { avaliarFinanceiroNotificacoes } from "./avaliar-financeiro";
import { avaliarFiscalNotificacoes } from "./avaliar-fiscal";
import { avaliarValidadeNotificacoes } from "./avaliar-validade";
import { minimoEstoqueEfetivo, normalizarConfiguracaoNotificacoes } from "./config";
import {
  aplicarAcaoUsuario,
  aplicarFiltroCentral,
  notificacaoContaNoSino,
  notificacaoVisivelNaCentral,
} from "./estado-usuario";
import { actionUrlSegura, chaveNotificacao } from "./rotas";
import { planejarSincronizacaoNotificacoes } from "./sincronizar-plano";
import {
  CONFIGURACAO_NOTIFICACOES_PADRAO,
  type CandidatoNotificacao,
  type NotificacaoCentral,
  type NotificacaoPersistida,
} from "./tipos";

const config = CONFIGURACAO_NOTIFICACOES_PADRAO;

function persistida(
  candidato: CandidatoNotificacao,
  extra?: Partial<NotificacaoPersistida>
): NotificacaoPersistida {
  return {
    id: extra?.id ?? "n1",
    empresaId: extra?.empresaId ?? empresaA,
    tipo: candidato.tipo,
    categoria: candidato.categoria,
    nivel: candidato.nivel,
    titulo: candidato.titulo,
    mensagem: candidato.mensagem,
    entidadeTipo: candidato.entidadeTipo,
    entidadeId: candidato.entidadeId,
    actionUrl: candidato.actionUrl,
    chaveDeduplicacao: candidato.chaveDeduplicacao,
    metadata: candidato.metadata,
    status: extra?.status ?? "ativa",
    createdAt: extra?.createdAt ?? "2026-08-01T10:00:00.000Z",
    updatedAt: extra?.updatedAt ?? "2026-08-01T10:00:00.000Z",
    resolvedAt: extra?.resolvedAt ?? null,
  };
}

test("estoque abaixo do mínimo, zerado e negativo", () => {
  const itens = avaliarEstoqueNotificacoes({
    config,
    itens: [
      {
        produtoId: produtoA,
        nome: "FRONTAL A03",
        ativo: true,
        quantidade: 2,
        estoqueMinimo: 5,
      },
      {
        produtoId: "p-zero",
        nome: "Farinha",
        ativo: true,
        quantidade: 0,
        estoqueMinimo: 5,
      },
      {
        produtoId: "p-neg",
        nome: "Açúcar",
        ativo: true,
        quantidade: -1,
        estoqueMinimo: 0,
      },
    ],
  });

  assert.equal(itens.find((i) => i.tipo === "estoque_baixo")?.mensagem.includes("2"), true);
  assert.equal(itens.find((i) => i.tipo === "estoque_baixo")?.mensagem.includes("5"), true);
  assert.equal(itens.some((i) => i.tipo === "estoque_zerado"), true);
  assert.equal(itens.some((i) => i.tipo === "estoque_negativo"), true);
  assert.equal(
    itens.find((i) => i.tipo === "estoque_baixo")?.chaveDeduplicacao,
    chaveNotificacao("estoque_baixo", produtoA)
  );
});

test("mínimo do produto prevalece sobre o padrão da empresa", () => {
  assert.equal(
    minimoEstoqueEfetivo({ minimoProduto: 5, minimoPadraoEmpresa: 10 }),
    5
  );
  assert.equal(
    minimoEstoqueEfetivo({ minimoProduto: 0, minimoPadraoEmpresa: 8 }),
    8
  );
  const comPadrao = avaliarEstoqueNotificacoes({
    config: { ...config, estoqueMinimoPadrao: 8 },
    itens: [
      {
        produtoId: produtoA,
        nome: "Peito",
        ativo: true,
        quantidade: 3,
        estoqueMinimo: 0,
      },
    ],
  });
  assert.equal(comPadrao[0]?.tipo, "estoque_baixo");
});

test("estoque volta ao normal e o plano resolve a notificação", () => {
  const problema = avaliarEstoqueNotificacoes({
    config,
    itens: [
      {
        produtoId: produtoA,
        nome: "Peito",
        ativo: true,
        quantidade: 1,
        estoqueMinimo: 5,
      },
    ],
  });
  const existente = persistida(problema[0]!);
  const normal = avaliarEstoqueNotificacoes({
    config,
    itens: [
      {
        produtoId: produtoA,
        nome: "Peito",
        ativo: true,
        quantidade: 12,
        estoqueMinimo: 5,
      },
    ],
  });
  const plano = planejarSincronizacaoNotificacoes({
    existentes: [existente],
    candidatos: normal,
    tiposAvaliados: ["estoque_baixo"],
  });
  assert.equal(plano.upsert.length, 0);
  assert.deepEqual(plano.resolverIds, [existente.id]);
});

test("mesmo problema não duplica e atualiza a existente", () => {
  const primeiro = avaliarEstoqueNotificacoes({
    config,
    itens: [
      {
        produtoId: produtoA,
        nome: "Peito",
        ativo: true,
        quantidade: 2,
        estoqueMinimo: 5,
      },
    ],
  });
  const segundo = avaliarEstoqueNotificacoes({
    config,
    itens: [
      {
        produtoId: produtoA,
        nome: "Peito",
        ativo: true,
        quantidade: 1,
        estoqueMinimo: 5,
      },
    ],
  });
  const plano = planejarSincronizacaoNotificacoes({
    existentes: [persistida(primeiro[0]!)],
    candidatos: segundo,
    tiposAvaliados: ["estoque_baixo"],
  });
  assert.equal(plano.upsert.length, 1);
  assert.equal(plano.upsert[0]?.chaveDeduplicacao, primeiro[0]?.chaveDeduplicacao);
  assert.equal(plano.resolverIds.length, 0);
  assert.match(plano.upsert[0]?.mensagem ?? "", /1/);

  const mesmo = planejarSincronizacaoNotificacoes({
    existentes: [persistida(segundo[0]!)],
    candidatos: segundo,
    tiposAvaliados: ["estoque_baixo"],
  });
  assert.equal(mesmo.upsert.length, 0);
});

test("validade vencendo e vencido", () => {
  const hoje = "2026-08-27";
  const itens = avaliarValidadeNotificacoes({
    config,
    referencia: hoje,
    lotes: [
      {
        loteId: "lote-1",
        produtoId: produtoA,
        nomeProduto: "Iogurte",
        codigoLote: "L1",
        dataValidade: "2026-09-10",
        quantidade: 4,
      },
      {
        loteId: "lote-2",
        produtoId: produtoA,
        nomeProduto: "Iogurte",
        codigoLote: "L2",
        dataValidade: "2026-08-01",
        quantidade: 2,
      },
    ],
  });
  assert.equal(itens.some((i) => i.tipo === "lote_vencendo"), true);
  assert.equal(itens.some((i) => i.tipo === "lote_vencido"), true);
});

test("fiscal rejeitada e aguardando reconciliação", () => {
  const itens = avaliarFiscalNotificacoes({
    config,
    emissoes: [
      {
        id: "e1",
        modelo: "65",
        numero: 10,
        status: "rejeitada",
        origemTipo: "venda",
        origemId: "venda-1",
      },
      {
        id: "e2",
        modelo: "55",
        numero: 3,
        status: "aguardando_reconciliacao",
        origemTipo: "venda",
        origemId: "venda-2",
      },
    ],
    certificado: null,
  });
  assert.equal(itens.find((i) => i.tipo === "fiscal_rejeitada")?.actionUrl, "/vendas/venda-1");
  assert.equal(
    itens.find((i) => i.tipo === "fiscal_aguardando_reconciliacao")?.actionUrl,
    "/vendas/venda-2"
  );
});

test("nova base fiscal notifica revisão sem alterar produtos", () => {
  const itens = avaliarFiscalNotificacoes({
    config,
    emissoes: [],
    certificado: null,
    impactosBase: [{ versaoId: "ver-1", quantidade: 18 }],
  });
  assert.equal(itens[0]?.tipo, "fiscal_revisao_base");
  assert.match(itens[0]?.mensagem ?? "", /18 produto/);
  assert.equal(itens[0]?.chaveDeduplicacao, "fiscal_revisao_base:ver-1");
});

test("caixa aberto do dia anterior", () => {
  const itens = avaliarCaixaNotificacoes({
    config,
    agora: new Date("2026-08-27T15:00:00-03:00"),
    caixa: {
      id: "caixa-1",
      status: "aberto",
      abertoEm: "2026-08-26T10:00:00-03:00",
    },
  });
  assert.equal(itens[0]?.tipo, "caixa_aberto_anterior");
  assert.equal(itens[0]?.actionUrl, "/caixa");
});

test("carteira vencida agrupa por cliente", () => {
  const itens = avaliarFinanceiroNotificacoes({
    config,
    hojeIso: "2026-08-27",
    titulos: [
      {
        clienteId: "c1",
        nomeCliente: "Maria",
        status: "ABERTO",
        valorAberto: 50,
        vencimento: "2026-08-20",
      },
      {
        clienteId: "c1",
        nomeCliente: "Maria",
        status: "PARCIAL",
        valorAberto: 20,
        vencimento: "2026-08-21",
      },
    ],
  });
  assert.equal(itens.length, 1);
  assert.equal(itens[0]?.chaveDeduplicacao, "carteira_vencida:c1");
});

test("usuário A lê sem marcar como lida para B", () => {
  const agora = new Date("2026-08-27T12:00:00.000Z");
  const estadoA = aplicarAcaoUsuario({
    estado: { lidaEm: null, dispensadaEm: null, adiadaAte: null },
    acao: "lida",
    agora,
  });
  const estadoB = { lidaEm: null, dispensadaEm: null, adiadaAte: null };
  const n = persistida(
    avaliarEstoqueNotificacoes({
      config,
      itens: [
        {
          produtoId: produtoA,
          nome: "X",
          ativo: true,
          quantidade: 1,
          estoqueMinimo: 5,
        },
      ],
    })[0]!
  );
  assert.equal(notificacaoContaNoSino(n, estadoA, agora), false);
  assert.equal(notificacaoContaNoSino(n, estadoB, agora), true);
});

test("dispensa de A não dispensa para B e adiada não entra no contador", () => {
  const agora = new Date("2026-08-27T12:00:00.000Z");
  const n = persistida(
    avaliarEstoqueNotificacoes({
      config,
      itens: [
        {
          produtoId: produtoA,
          nome: "X",
          ativo: true,
          quantidade: 1,
          estoqueMinimo: 5,
        },
      ],
    })[0]!
  );
  const dispensadaA = aplicarAcaoUsuario({
    estado: { lidaEm: null, dispensadaEm: null, adiadaAte: null },
    acao: "dispensar",
    agora,
  });
  const adiadaA = aplicarAcaoUsuario({
    estado: { lidaEm: null, dispensadaEm: null, adiadaAte: null },
    acao: "adiar",
    adiar: "1h",
    agora,
  });
  const estadoB = { lidaEm: null, dispensadaEm: null, adiadaAte: null };
  assert.equal(notificacaoContaNoSino(n, dispensadaA, agora), false);
  assert.equal(notificacaoContaNoSino(n, estadoB, agora), true);
  assert.equal(notificacaoContaNoSino(n, adiadaA, agora), false);
  assert.equal(
    notificacaoContaNoSino(n, adiadaA, new Date("2026-08-27T14:00:00.000Z")),
    true
  );
  assert.equal(
    notificacaoVisivelNaCentral(n, dispensadaA, agora, "todas"),
    false
  );
});

test("filtro Importantes e action_url rejeita destino arbitrário", () => {
  const item: NotificacaoCentral = {
    ...persistida({
      tipo: "estoque_negativo",
      categoria: "estoque",
      nivel: "critico",
      titulo: "Estoque negativo",
      mensagem: "x",
      entidadeTipo: "produto",
      entidadeId: produtoA,
      actionUrl: "/produtos?editar=1",
      chaveDeduplicacao: "estoque_negativo:p",
      metadata: {},
    }),
    lida: false,
    dispensada: false,
    adiada: false,
    adiadaAte: null,
  };
  assert.equal(aplicarFiltroCentral(item, "importantes"), true);
  assert.equal(aplicarFiltroCentral(item, "financeiro"), false);
  assert.equal(actionUrlSegura("https://evil.example"), null);
  assert.equal(actionUrlSegura("//evil"), null);
  assert.equal(actionUrlSegura("/produtos?editar=1"), "/produtos?editar=1");
});

test("configuração tem defaults seguros", () => {
  const vazia = normalizarConfiguracaoNotificacoes(null);
  assert.equal(vazia.antecedenciaValidadeDias, 30);
  assert.equal(vazia.antecedenciaCertificadoDias, 30);
  assert.equal(vazia.estoqueBaixo, true);
  assert.notEqual(empresaA, empresaB);
  assert.notEqual(produtoA, produtoB);
});
