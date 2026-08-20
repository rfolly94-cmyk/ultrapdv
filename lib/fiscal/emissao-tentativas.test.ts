import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  avaliarBloqueioRascunhoFiscal,
  payloadTentativaContemSegredo,
  sanitizarPayloadTentativaFiscal,
  snapshotItensDaTransmissao,
  snapshotItensDoPayload,
  statusBloqueiaRascunhoFiscal,
} from "./emissao-tentativas";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

const migracao = fonte(
  "supabase/migrations/20260818200000_fiscal_emissao_tentativas.sql"
);
const helper = fonte("lib/fiscal/emissao-tentativas.ts");
const emitirVenda = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
const emitirNfce = fonte("app/api/fiscal/geranet/nfce-emitir-venda/route.ts");
const emitirOperacao = fonte(
  "app/api/fiscal/geranet/nfe-emitir-operacao/route.ts"
);
const emitirDevolucao = fonte(
  "app/api/fiscal/geranet/nfe-emitir-devolucao-fornecedor/route.ts"
);
const emitirContingencia = fonte(
  "app/api/fiscal/geranet/nfce-contingencia-venda/route.ts"
);
const emitirNfe = fonte("app/api/fiscal/geranet/nfe-emitir/route.ts");
const emitirNfceAvulso = fonte("app/api/fiscal/geranet/nfce-emitir/route.ts");
const emitirNfe55 = fonte("app/api/fiscal/geranet/nfe55-emitir/route.ts");
const transmitir = fonte("lib/fiscal/contingencia/transmitir-contingencia.ts");
const reconciliar = fonte("lib/fiscal/reconciliar-emissao.ts");
const historico = fonte("components/fiscal/emissao-fiscal-historico.tsx");
const classificar = fonte("lib/fiscal/geranet/classificar-emissao.ts");

const payloadComSegredos = {
  certificadoDigital: "MIIFakePFX",
  senhaCertificadoDigital: "senha-secreta",
  apiKey: "geranet-key",
  csc: "CSC-SECRETO",
  nfe: {
    empresa: {
      codigoSegurancaContribuinte: "123456",
    },
    responsavelTecnico: {
      cnpj: "42741754000142",
      contato: "Suporte",
      email: "suporte@exemplo.com",
      fone: "6533334444",
      idCSRT: "01",
      CSRT: "CSRT-SECRETO-ABC",
    },
    itens: [
      {
        codigo: "P1",
        descricao: "Tela",
        ncm: "85176221",
        cest: "2104700",
        origem: "0",
        cfop: "5102",
        icms: { csosn: "102" },
        pis: { cst: "49" },
        cofins: { cst: "49" },
      },
    ],
  },
};

test("P0: status bloqueante é consultado antes de qualquer write em vendas_itens", () => {
  for (const rota of [emitirVenda, emitirNfce, emitirContingencia]) {
    const posBloqueio = rota.indexOf("avaliarBloqueioRascunhoFiscal");
    const posSnapshot = rota.indexOf("const resultadosSnapshot");
    assert.ok(posBloqueio >= 0, "rota deve validar status antes do rascunho");
    assert.ok(posSnapshot > posBloqueio, "write do rascunho deve vir após o bloqueio");
  }
});

test("status enviando/ambígua/autorizada/contingência/inutilização bloqueiam rascunho", () => {
  for (const status of [
    "enviando",
    "aguardando_reconciliacao",
    "autorizada",
    "aguardando_transmissao_contingencia",
    "transmitindo_contingencia",
    "aguardando_inutilizacao",
  ]) {
    assert.equal(statusBloqueiaRascunhoFiscal(status), true, status);
  }
  assert.equal(statusBloqueiaRascunhoFiscal("rejeitada"), false);
  assert.equal(statusBloqueiaRascunhoFiscal("reservada"), false);
  assert.equal(statusBloqueiaRascunhoFiscal("erro_comunicacao"), false);
});

test("C. aguardando_reconciliacao não segue para write/post", () => {
  const bloqueio = avaliarBloqueioRascunhoFiscal({
    id: "em-1",
    status: "aguardando_reconciliacao",
  });
  assert.equal(bloqueio.tipo, "bloquear");
});

test("F. autorizada devolve documento existente sem nova tentativa", () => {
  const bloqueio = avaliarBloqueioRascunhoFiscal({
    id: "em-1",
    status: "autorizada",
    chave_acesso: "3524",
  });
  assert.equal(bloqueio.tipo, "autorizada");
});

test("I. payload sanitizado omite certificado, senha, API key e CSC", () => {
  const limpo = sanitizarPayloadTentativaFiscal(payloadComSegredos);
  assert.equal(payloadTentativaContemSegredo(limpo), false);
  const json = JSON.stringify(limpo);
  assert.doesNotMatch(json, /MIIFakePFX/);
  assert.doesNotMatch(json, /senha-secreta/);
  assert.doesNotMatch(json, /geranet-key/);
  assert.doesNotMatch(json, /CSC-SECRETO/);
  assert.doesNotMatch(json, /certificadoDigital/);
  assert.doesNotMatch(json, /senhaCertificadoDigital/);
  assert.doesNotMatch(json, /"csc"/);
  assert.doesNotMatch(json, /CSRT-SECRETO-ABC/);
  assert.doesNotMatch(json, /"CSRT"/);
});

test("A/B. snapshot da tentativa é autossuficiente e não depende de produto vivo", () => {
  const snap = snapshotItensDaTransmissao(payloadComSegredos.nfe.itens);
  assert.equal(snap[0].cest, "2104700");
  assert.equal(snap[0].ncm, "85176221");
  assert.equal(snap[0].cfop, "5102");
  assert.equal(snap[0].icms.csosn, "102");
  const doPayload = snapshotItensDoPayload(payloadComSegredos);
  assert.equal(doPayload[0].cest, "2104700");
});

test("schema: tentativa pertence à mesma empresa da emissão e é única por número", () => {
  assert.match(migracao, /fiscal_emissoes_id_empresa_unique/);
  assert.match(migracao, /unique \(id, empresa_id\)/);
  assert.match(
    migracao,
    /foreign key \(emissao_id, empresa_id\)/
  );
  assert.match(migracao, /references public\.fiscal_emissoes \(id, empresa_id\)/);
  assert.match(migracao, /fiscal_emissao_tentativas_unica/);
  assert.match(migracao, /unique \(empresa_id, emissao_id, tentativa\)/);
  assert.match(migracao, /Sem backfill: emissões antigas ficam sem tentativa histórica/);
});

test("RLS: authenticated só SELECT; writes via service_role; sem anon", () => {
  assert.match(migracao, /enable row level security/);
  assert.match(migracao, /usuario_visualiza_fiscal_emissao_tentativas/);
  assert.match(migracao, /tem_acesso_empresa\(empresa_id\)/);
  assert.match(migracao, /revoke all[\s\S]*from public, anon, authenticated/i);
  assert.match(migracao, /grant select[\s\S]*to authenticated/i);
  assert.match(migracao, /grant all[\s\S]*to service_role/i);
  assert.match(
    migracao,
    /revoke all[\s\S]*rpc_iniciar_tentativa_emissao_fiscal[\s\S]*from public, anon, authenticated/i
  );
});

test("claim atômico incrementa tentativas e não usa MAX+1 no app", () => {
  assert.match(migracao, /tentativas = coalesce\(e\.tentativas, 0\) \+ 1/);
  assert.match(migracao, /pg_advisory_xact_lock/);
  assert.match(helper, /rpc_iniciar_tentativa_emissao_fiscal/);
  assert.doesNotMatch(helper, /MAX\(tentativa\)/);
  assert.doesNotMatch(emitirVenda, /MAX\(tentativa\)/);
});

test("claim de retransmissão aceita só erro_envio da mesma empresa", () => {
  const claimErro = fonte(
    "supabase/migrations/20260818210000_claim_tentativa_erro_comunicacao.sql"
  );
  assert.match(claimErro, /v_status = 'reservada'/);
  assert.match(claimErro, /v_status = 'rejeitada'/);
  assert.match(claimErro, /v_classificacao = 'erro_envio'/);
  assert.match(claimErro, /p_empresa_id/);
  assert.match(claimErro, /e\.empresa_id = p_empresa_id/);
  assert.doesNotMatch(claimErro, /distinct from 'erro_comunicacao'/);
  assert.match(
    claimErro,
    /revoke all[\s\S]*rpc_iniciar_tentativa_emissao_fiscal[\s\S]*from public, anon, authenticated/i
  );
  assert.match(
    claimErro,
    /grant execute[\s\S]*rpc_iniciar_tentativa_emissao_fiscal[\s\S]*to service_role/
  );
  assert.doesNotMatch(claimErro, /MAX\(tentativa\)/);
});

test("imutabilidade após finalizada_at", () => {
  assert.match(migracao, /fiscal_emissao_tentativas_proteger_imutabilidade/);
  assert.match(migracao, /já finalizada não pode ser alterada/);
  assert.match(migracao, /Campos históricos da tentativa fiscal não podem ser alterados/);
});

test("resposta da tentativa persiste diagnóstico sanitizado, não só o resumo", () => {
  assert.match(helper, /montarDiagnosticoRespostaGeranet/);
  assert.match(helper, /hexDocumentoFiscalPersistivel/);
  assert.match(helper, /resposta_sanitizada: diagnostico/);
});

test("todos os POSTs reais arquivam tentativa", () => {
  for (const rota of [
    emitirVenda,
    emitirNfce,
    emitirOperacao,
    emitirDevolucao,
    emitirContingencia,
    emitirNfe,
    emitirNfceAvulso,
    emitirNfe55,
  ]) {
    assert.match(rota, /claimTentativaEmissaoFiscal/);
    assert.match(rota, /registrarRespostaTentativaFiscal/);
  }
  assert.match(transmitir, /anexarTentativaTransmissaoContingencia/);
  assert.match(transmitir, /registrarRespostaTentativaFiscal/);
});

test("D. reconciliação referencia a tentativa e não reescreve resposta inicial", () => {
  assert.match(reconciliar, /fiscal_emissao_tentativas/);
  assert.match(reconciliar, /tentativa_id/);
  assert.match(reconciliar, /consulta_status/);
  assert.doesNotMatch(reconciliar, /from\("fiscal_emissao_tentativas"\)[\s\S]*\.update/);
  assert.doesNotMatch(reconciliar, /payload_sanitizado/);
});

test("classificador, numeração e Geranet não foram reescritos", () => {
  assert.match(classificar, /export function classificarRespostaEmitir/);
  assert.match(emitirVenda, /rpc_reservar_emissao_fiscal/);
  assert.match(emitirVenda, /p_chave_idempotencia/);
  assert.doesNotMatch(migracao, /classificar-emissao/);
});

test("J/K/L. retry fiscal não cria venda, estoque nem pagamento", () => {
  const corpo = emitirVenda.slice(emitirVenda.indexOf("claimTentativaEmissaoFiscal"));
  assert.doesNotMatch(corpo, /\.from\(\s*"vendas"\s*\)\s*\.insert/);
  assert.doesNotMatch(corpo, /estoque_atual/);
  assert.doesNotMatch(corpo, /rpc_confirmar_saida/);
  assert.doesNotMatch(corpo, /\.from\(\s*"vendas_pagamentos"\s*\)\s*\.insert/);
});

test("UI resume tentativas sem dump de payload", () => {
  assert.match(historico, /Tentativas fiscais/);
  assert.match(historico, /rotuloClassificacaoTentativa/);
  assert.doesNotMatch(historico, /payload_sanitizado/);
  assert.match(
    historico,
    /Esta emissão possui uma transmissão anterior realizada antes da implantação do histórico detalhado/
  );
  assert.match(historico, /tentativas.length === 0/);
  assert.match(historico, /tentativas.map/);
});

test("M. claim concorrente fica no lock da RPC", () => {
  assert.match(migracao, /for update/);
  assert.match(migracao, /and e\.status = v_status/);
});

test("G/H. multiempresa na FK e no SELECT", () => {
  assert.match(migracao, /tem_acesso_empresa\(empresa_id\)/);
  assert.match(helper, /\.eq\("empresa_id", empresaId\)/);
  assert.match(helper, /\.eq\("chave_idempotencia", chaveIdempotencia\)/);
});
