import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import {
  crescimentoMensal,
  diasCalendarioAte,
  distribuicaoPorPlano,
  empresasQuePrecisamAtencao,
  montarDashboardMaster,
  planoMaisUtilizado,
  rotuloTrialRestante,
  somarMrrContratado,
  valorMrrAssinatura,
} from "@/lib/master/dashboard-calculo";

const AGORA = new Date("2026-08-21T16:22:00-03:00");
const PLANO_PRO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const PLANO_BASICO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const PLANO_PREMIUM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const EMPRESA_C = "33333333-3333-4333-8333-333333333333";
const EMPRESA_D = "44444444-4444-4444-8444-444444444444";
const EMPRESA_E = "55555555-5555-4555-8555-555555555555";

test("MRR usa valor_mensal_contratado e ignora preço novo do catálogo", () => {
  assert.equal(
    valorMrrAssinatura({
      status: "ativa",
      valorMensalContratado: 167,
      valorCatalogo: 197,
    }),
    167
  );
  assert.equal(
    somarMrrContratado([
      {
        empresaId: empresaA,
        planoId: PLANO_PRO,
        planoNome: "Pro",
        status: "ativa",
        vencimentoEm: "2026-09-21",
        valorMensalContratado: 167,
        valorCatalogo: 197,
      },
      {
        empresaId: empresaB,
        planoId: PLANO_PRO,
        planoNome: "Pro",
        status: "ativa",
        vencimentoEm: "2026-09-21",
        valorMensalContratado: 197,
        valorCatalogo: 197,
      },
    ]),
    364
  );
});

test("trial gratuito não gera MRR indevido", () => {
  assert.equal(
    valorMrrAssinatura({
      status: "trial",
      valorMensalContratado: 0,
      valorCatalogo: 97,
    }),
    0
  );
  assert.equal(
    valorMrrAssinatura({
      status: "trial",
      valorMensalContratado: null,
      valorCatalogo: 97,
    }),
    0
  );
  assert.equal(
    valorMrrAssinatura({
      status: "trial",
      valorMensalContratado: 97,
      valorCatalogo: 97,
    }),
    97
  );
});

test("empresa suspensa entra no contador correto e não soma MRR", () => {
  const painel = montarDashboardMaster({
    agora: AGORA,
    empresas: [
      { id: empresaA, nome: "Ativa", cadastro: "2026-08-01T10:00:00-03:00" },
      { id: empresaB, nome: "Suspensa", cadastro: "2026-07-01T10:00:00-03:00" },
    ],
    assinaturas: [
      {
        empresaId: empresaA,
        planoId: PLANO_PRO,
        planoNome: "Pro",
        status: "ativa",
        vencimentoEm: "2026-09-01",
        valorMensalContratado: 197,
        valorCatalogo: 197,
      },
      {
        empresaId: empresaB,
        planoId: PLANO_PRO,
        planoNome: "Pro",
        status: "suspensa",
        vencimentoEm: "2026-09-01",
        valorMensalContratado: 197,
        valorCatalogo: 197,
      },
    ],
  });
  assert.equal(painel.ativas, 1);
  assert.equal(painel.suspensas, 1);
  assert.equal(painel.mrrContratado, 197);
  assert.equal(painel.assinaturasAtivas, 1);
});

test("empresa sem assinatura é tratada sem quebrar", () => {
  const painel = montarDashboardMaster({
    agora: AGORA,
    empresas: [
      { id: empresaA, nome: "Com plano", cadastro: "2026-08-02T10:00:00-03:00" },
      { id: empresaB, nome: "Sem assinatura", cadastro: "2026-08-03T10:00:00-03:00" },
    ],
    assinaturas: [
      {
        empresaId: empresaA,
        planoId: PLANO_BASICO,
        planoNome: "Básico",
        status: "ativa",
        vencimentoEm: null,
        valorMensalContratado: 97,
        valorCatalogo: 97,
      },
    ],
  });
  assert.equal(painel.semAssinatura, 1);
  assert.equal(painel.empresas, 2);
  const sem = painel.distribuicao.find((item) => item.nome === "Sem assinatura");
  assert.equal(sem?.quantidade, 1);
  assert.ok(painel.atencao.some((item) => item.empresaId === empresaB));
});

test("plano mais utilizado e distribuição por plano são calculados", () => {
  const empresas = [
    { id: empresaA, nome: "A", cadastro: "2026-01-01T10:00:00-03:00" },
    { id: empresaB, nome: "B", cadastro: "2026-01-02T10:00:00-03:00" },
    { id: EMPRESA_C, nome: "C", cadastro: "2026-01-03T10:00:00-03:00" },
    { id: EMPRESA_D, nome: "D", cadastro: "2026-01-04T10:00:00-03:00" },
  ];
  const assinaturas = [
    {
      empresaId: empresaA,
      planoId: PLANO_PRO,
      planoNome: "Pro",
      status: "ativa",
      vencimentoEm: null,
      valorMensalContratado: 197,
      valorCatalogo: 297,
    },
    {
      empresaId: empresaB,
      planoId: PLANO_PRO,
      planoNome: "Pro",
      status: "suspensa",
      vencimentoEm: null,
      valorMensalContratado: 197,
      valorCatalogo: 297,
    },
    {
      empresaId: EMPRESA_C,
      planoId: PLANO_BASICO,
      planoNome: "Básico",
      status: "trial",
      vencimentoEm: "2026-08-28",
      valorMensalContratado: 0,
      valorCatalogo: 97,
    },
    {
      empresaId: EMPRESA_D,
      planoId: PLANO_PREMIUM,
      planoNome: "Premium",
      status: "ativa",
      vencimentoEm: null,
      valorMensalContratado: 297,
      valorCatalogo: 350,
    },
  ];
  const dist = distribuicaoPorPlano(empresas, assinaturas);
  const lider = planoMaisUtilizado(dist);
  assert.equal(lider?.nome, "Pro");
  assert.equal(lider?.quantidade, 2);
  assert.equal(dist.find((item) => item.nome === "Pro")?.quantidade, 2);
  assert.equal(dist.find((item) => item.nome === "Básico")?.quantidade, 1);
  assert.equal(dist.find((item) => item.nome === "Premium")?.quantidade, 1);
});

test("crescimento mensal agrupa empresas no fuso de São Paulo", () => {
  const pontos = crescimentoMensal(
    [
      { id: empresaA, nome: "A", cadastro: "2026-06-15T10:00:00-03:00" },
      { id: empresaB, nome: "B", cadastro: "2026-08-01T10:00:00-03:00" },
      { id: EMPRESA_C, nome: "C", cadastro: "2026-08-20T23:30:00-03:00" },
    ],
    AGORA,
    6
  );
  assert.equal(pontos.length, 6);
  assert.equal(pontos.at(-1)?.chave, "2026-08");
  assert.equal(pontos.find((item) => item.chave === "2026-08")?.valor, 2);
  assert.equal(pontos.find((item) => item.chave === "2026-06")?.valor, 1);
  assert.equal(pontos.find((item) => item.chave === "2026-07")?.valor, 0);
});

test("alerta de trial próximo do fim usa data do servidor", () => {
  assert.equal(diasCalendarioAte("2026-08-22", AGORA), 1);
  assert.equal(rotuloTrialRestante(1), "Teste termina amanhã");
  assert.equal(rotuloTrialRestante(0), "Teste termina hoje");
  assert.equal(rotuloTrialRestante(4), "Teste termina em 4 dias");

  const alertas = empresasQuePrecisamAtencao(
    [
      { id: empresaA, nome: "Loja ABC", cadastro: "2026-08-10T10:00:00-03:00" },
      { id: empresaB, nome: "Empresa XYZ", cadastro: "2026-01-01T10:00:00-03:00" },
      { id: EMPRESA_C, nome: "Longe", cadastro: "2026-08-01T10:00:00-03:00" },
      { id: EMPRESA_E, nome: "Vencida", cadastro: "2026-01-02T10:00:00-03:00" },
    ],
    [
      {
        empresaId: empresaA,
        planoId: PLANO_BASICO,
        planoNome: "Básico",
        status: "trial",
        vencimentoEm: "2026-08-22",
        valorMensalContratado: 0,
        valorCatalogo: 97,
      },
      {
        empresaId: empresaB,
        planoId: PLANO_PRO,
        planoNome: "Pro",
        status: "suspensa",
        vencimentoEm: "2026-09-01",
        valorMensalContratado: 197,
        valorCatalogo: 197,
      },
      {
        empresaId: EMPRESA_C,
        planoId: PLANO_PRO,
        planoNome: "Pro",
        status: "trial",
        vencimentoEm: "2026-09-21",
        valorMensalContratado: 0,
        valorCatalogo: 197,
      },
      {
        empresaId: EMPRESA_E,
        planoId: PLANO_PRO,
        planoNome: "Pro",
        status: "ativa",
        vencimentoEm: "2026-08-01",
        valorMensalContratado: 197,
        valorCatalogo: 197,
      },
    ],
    AGORA
  );

  assert.equal(alertas[0]?.empresaId, empresaB);
  assert.match(alertas[0]?.motivo ?? "", /suspensa/i);
  assert.ok(alertas.some((item) => item.motivo === "Teste termina amanhã"));
  assert.ok(alertas.some((item) => item.motivo === "Assinatura vencida"));
  assert.equal(
    alertas.some((item) => item.empresaId === EMPRESA_C),
    false
  );
});

test("usuário comum não acessa dashboard Master", () => {
  assert.match(fonte("app/master/layout.tsx"), /exigirMaster/);
  assert.match(fonte("lib/master/dashboard.ts"), /exigirMaster/);
  assert.match(fonte("lib/master/dashboard.ts"), /createAdminClient|admin/);
  assert.doesNotMatch(
    fonte("components/master/dashboard-master-painel.tsx"),
    /createAdminClient/
  );
});

test("dashboard reutiliza auditoria e não expõe JSON cru nem segredos", () => {
  const ui = fonte("components/master/dashboard-master-painel.tsx");
  const loader = fonte("lib/master/dashboard.ts");
  assert.match(loader, /plataforma_auditoria/);
  assert.match(ui, /Atividade Master/);
  assert.doesNotMatch(ui, /JSON\.stringify/);
  assert.doesNotMatch(loader, /certificado|csc|service_role|geranet/i);
  assert.doesNotMatch(ui, /Receita recebida|Faturamento recebido/);
  assert.match(ui, /MRR contratado/);
  assert.match(ui, /status=suspensa/);
  assert.match(ui, /status=trial/);
});
