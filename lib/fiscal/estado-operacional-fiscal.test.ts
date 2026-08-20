import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { resolverApresentacaoEmissaoFiscal } from "./apresentacao-emissao";
import { resolverAcoesEmissaoFiscal } from "./acoes-emissao";
import { resolverEstadoOperacionalFiscal } from "./estado-operacional-fiscal";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

test("A) erro_comunicacao + classificacao=erro_envio: NF-e não transmitida, retry SIM, reconciliação NÃO", () => {
  const estado = resolverEstadoOperacionalFiscal({
    modelo: "55",
    status: "erro_comunicacao",
    classificacao: "erro_envio",
    geranetHttpStatus: 422,
  });
  const ui = resolverApresentacaoEmissaoFiscal({
    modelo: "55",
    status: "erro_comunicacao",
    classificacao: "erro_envio",
    geranetHttpStatus: 422,
  });
  const acoes = resolverAcoesEmissaoFiscal({
    emissao: {
      modelo: "55",
      status: "erro_comunicacao",
      classificacao: "erro_envio",
      geranetHttpStatus: 422,
    },
  });

  assert.equal(estado.estado, "erro_envio");
  assert.equal(estado.podeRetry, true);
  assert.equal(estado.podeReconciliar, false);
  assert.equal(estado.podeEditarFiscal, true);
  assert.equal(estado.documentoFiscalAmbiguo, false);
  assert.equal(ui.caso, "nao_transmitida");
  assert.equal(ui.titulo, "NF-e não transmitida");
  assert.equal(ui.acaoPrincipal, "tentar_novamente");
  assert.doesNotMatch(ui.titulo, /reconcilia/i);
  assert.doesNotMatch(ui.texto, /Não retransmita/i);
  assert.equal(acoes.podeRetransmitir, true);
  assert.equal(acoes.podeReconciliar, false);
});

test("B) erro_comunicacao + classificacao=ambigua: reconciliação SIM, retry NÃO, banner não reenvie", () => {
  const estado = resolverEstadoOperacionalFiscal({
    modelo: "55",
    status: "erro_comunicacao",
    classificacao: "ambigua",
  });
  const ui = resolverApresentacaoEmissaoFiscal({
    modelo: "55",
    status: "erro_comunicacao",
    classificacao: "erro_tecnico",
    geranetHttpStatus: 500,
  });

  assert.equal(estado.podeRetry, false);
  assert.equal(estado.podeReconciliar, true);
  assert.equal(ui.caso, "aguardando_reconciliacao");
  assert.equal(ui.acaoPrincipal, "reconciliar");
  assert.match(ui.texto, /Não retransmita/);
  assert.equal(ui.podeRetransmitir, false);
});

test("C) status=aguardando_reconciliacao: reconciliação SIM, retry NÃO", () => {
  const estado = resolverEstadoOperacionalFiscal({
    modelo: "55",
    status: "aguardando_reconciliacao",
  });

  assert.equal(estado.estado, "ambigua");
  assert.equal(estado.podeRetry, false);
  assert.equal(estado.podeReconciliar, true);
  assert.equal(estado.podeEditarFiscal, false);
  assert.equal(estado.documentoFiscalAmbiguo, true);
});

test("consulta Geranet processando altera a descrição sem criar segundo interpretador", () => {
  const estado = resolverEstadoOperacionalFiscal({
    modelo: "55",
    status: "aguardando_reconciliacao",
    classificacao: "ambigua",
    motivo: "Documento ainda está sendo processado.",
    resposta_resumo: {
      classificacao: "ambigua",
      origem_classificacao: "consulta_geranet",
      situacao_remota: "processando",
    },
  });

  assert.equal(estado.titulo, "Emissão pendente de reconciliação");
  assert.match(estado.descricao, /ainda está sendo processado pela Geranet/);
  assert.match(estado.descricao, /Não retransmita este documento/);
  assert.equal(estado.podeRetry, false);
  assert.equal(estado.podeEditarFiscal, false);
});

test("D) rejeitada + cStat conclusivo: rejeitada SEFAZ, retry SIM, reconciliação NÃO", () => {
  const estado = resolverEstadoOperacionalFiscal({
    modelo: "55",
    status: "rejeitada",
    classificacao: "rejeitada",
    cstat: "230",
    motivo: "Rejeição: IE do emitente não cadastrada",
  });
  const ui = resolverApresentacaoEmissaoFiscal({
    modelo: "55",
    status: "rejeitada",
    classificacao: "rejeitada",
    cstat: "230",
    motivo: "Rejeição: IE do emitente não cadastrada",
  });

  assert.equal(estado.estado, "rejeitada_sefaz");
  assert.equal(estado.podeRetry, true);
  assert.equal(estado.podeReconciliar, false);
  assert.equal(estado.podeEditarFiscal, true);
  assert.equal(ui.caso, "rejeitada");
  assert.match(ui.titulo, /rejeitada pela SEFAZ/);
  assert.equal(ui.acaoPrincipal, "tentar_novamente");
});

test("E) autorizada: retry NÃO, reconciliação NÃO, edição fiscal bloqueada", () => {
  const estado = resolverEstadoOperacionalFiscal({
    modelo: "55",
    status: "autorizada",
    classificacao: "autorizada",
    cstat: "100",
    protocolo: "1",
    chaveAcesso: "35240111222333000155550010000000291000000001",
  });

  assert.equal(estado.estado, "autorizada");
  assert.equal(estado.podeRetry, false);
  assert.equal(estado.podeReconciliar, false);
  assert.equal(estado.podeEditarFiscal, false);
  assert.equal(estado.documentoFiscalSensivel, true);
});

test("F) erro_comunicacao sem classificação: retry NÃO, diagnóstico, sem inventar reconciliação", () => {
  const estado = resolverEstadoOperacionalFiscal({
    modelo: "55",
    status: "erro_comunicacao",
    geranetHttpStatus: 422,
    motivo: "mensagem genérica qualquer",
  });
  const ui = resolverApresentacaoEmissaoFiscal({
    modelo: "55",
    status: "erro_comunicacao",
    geranetHttpStatus: 422,
    motivo: "mensagem genérica qualquer",
  });

  assert.equal(estado.estado, "nao_classificada");
  assert.equal(estado.podeRetry, false);
  assert.equal(estado.podeReconciliar, false);
  assert.equal(estado.requerDiagnostico, true);
  assert.equal(ui.caso, "nao_classificada");
  assert.equal(ui.acaoPrincipal, "consultar_diagnostico");
  assert.doesNotMatch(ui.texto, /Não retransmita/);
  assert.doesNotMatch(ui.titulo, /não transmitida/i);
});

test("G) Empresa A erro_envio e Empresa B ambígua permanecem independentes; claim nunca cruza empresa", () => {
  const empresaA = resolverEstadoOperacionalFiscal({
    modelo: "55",
    status: "erro_comunicacao",
    classificacao: "erro_envio",
  });
  const empresaB = resolverEstadoOperacionalFiscal({
    modelo: "55",
    status: "erro_comunicacao",
    classificacao: "erro_tecnico",
  });

  assert.equal(empresaA.podeRetry, true);
  assert.equal(empresaA.podeReconciliar, false);
  assert.equal(empresaB.podeRetry, false);
  assert.equal(empresaB.podeReconciliar, true);

  const claim = fonte("lib/fiscal/emissao-tentativas.ts");
  const rpc = fonte(
    "supabase/migrations/20260818210000_claim_tentativa_erro_comunicacao.sql"
  );
  const reconciliar = fonte("app/api/fiscal/emissoes/[id]/reconciliar/route.ts");
  const transporte = fonte("app/api/vendas/[id]/transporte/route.ts");

  assert.match(claim, /\.eq\("empresa_id", empresaId\)/);
  assert.match(claim, /resolverEstadoOperacionalDeEmissaoPersistida/);
  assert.match(claim, /status !== "reservada" && !estado\.podeRetry/);
  assert.match(rpc, /e\.empresa_id = p_empresa_id/);
  assert.match(rpc, /resposta_resumo->>'classificacao'/);
  assert.match(rpc, /v_classificacao = 'erro_envio'/);
  assert.doesNotMatch(
    rpc,
    /v_status is distinct from 'erro_comunicacao'/
  );
  assert.match(reconciliar, /usuarios_empresas/);
  assert.match(reconciliar, /principal/);
  assert.match(reconciliar, /vinculo\.empresa_id/);
  assert.match(transporte, /resolverEstadoOperacionalDeEmissaoPersistida/);
  assert.match(transporte, /empresa_id/);
});

test("HTTP 422 sozinho não vira rejeição nem erro_envio", () => {
  const estado = resolverEstadoOperacionalFiscal({
    modelo: "55",
    status: "erro_comunicacao",
    geranetHttpStatus: 422,
  });
  assert.equal(estado.estado, "nao_classificada");
  assert.equal(estado.podeRetry, false);
  assert.equal(estado.podeReconciliar, false);

  const rejeitada = resolverEstadoOperacionalFiscal({
    modelo: "55",
    status: "erro_comunicacao",
    geranetHttpStatus: 422,
    cstat: "225",
    motivo: "Rejeição 225: Falha no schema XML",
  });
  assert.equal(rejeitada.estado, "rejeitada_sefaz");
  assert.equal(rejeitada.podeRetry, true);
});
