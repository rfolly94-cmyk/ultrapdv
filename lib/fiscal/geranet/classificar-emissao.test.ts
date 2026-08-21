import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classificarLogEmitir,
  decidirStatusLocal,
  EmissaoParaConsulta,
  LogGeranetResumo,
  montarAtualizacaoEmissao,
} from "./classificar-consulta";
import {
  classificarRespostaEmitir,
  deveReclassificarComoRejeitada,
  ehErroTecnicoAmbiguo,
  ehRejeicaoFiscalConclusiva,
  ehRejeicaoFiscalReal,
  emissaoBloqueiaRetransmissao,
  emissaoPodeReconciliar,
  emissaoPodeRetentarEnvio,
  emissaoRejeicaoTecnicaRecuperavel,
  evidenciaSemTransmissaoRemota,
  acoesEmissaoFiscal,
  acoesEmissaoFiscalNfce65,
  ehFalhaNfeConsulta4,
  MENSAGEM_BLOQUEIO_RETRANSMISSAO,
  MENSAGEM_FALHA_TECNICA_CONSULTA,
  MENSAGEM_NFCE65_AGUARDANDO_RECONCILIACAO,
  MENSAGEM_BLOQUEIO_AGUARDANDO_RECONCILIACAO,
  mensagemResultadoRemotoNaoConclusivo,
  extraBloqueioRetransmissaoFiscal,
  nfce65DeveApenasReconciliar,
  persistirClassificacaoNaoAutorizada,
} from "./classificar-emissao";

const MENSAGEM_NFECONSULTA4 = [
  "Erro Interno: -2",
  "Erro HTTP: 500",
  "URL: https://nfce.sefaz.mt.gov.br/nfcews/services/NfeConsulta4",
  "Network subsystem is unusable",
].join("\n");

function emissao(
  parcial: Partial<EmissaoParaConsulta> = {}
): EmissaoParaConsulta {
  return {
    id: "e1",
    modelo: "65",
    serie: 1,
    numero: 11,
    ambiente: 1,
    status: "aguardando_reconciliacao",
    codigo_numerico: "12345678",
    origem_id: "venda-1",
    ...parcial,
  };
}

function log(parcial: Partial<LogGeranetResumo> = {}): LogGeranetResumo {
  return {
    id: 10,
    endpoint: "nfe/emitir",
    criado_em: "2026-08-15T20:00:00.000Z",
    http_status: 200,
    sucesso: true,
    chave: "51260812345678000155650010000000111234567890",
    protocolo: "151260000000001",
    cstat: "100",
    numero: "11",
    situacao: "sucesso",
    mensagem: "Autorizado o uso da NF-e",
    xml: "3c786d6c",
    pdf: "25504446",
    modelo: "65",
    serie: "1",
    ambiente: "1",
    codigo_numerico: "12345678",
    numero_venda: "venda-1",
    contingencia: "nao",
    ...parcial,
  };
}

test("A. HTTP 422 + cStat null + NfeConsulta4 → aguardando_reconciliacao, sem retransmitir", () => {
  const evidencia = {
    httpOk: false,
    httpStatus: 422,
    situacao: "erro",
    cstat: null,
    mensagem: MENSAGEM_NFECONSULTA4,
    chave: null,
    protocolo: null,
  };
  const situacao = classificarRespostaEmitir(evidencia);
  const persistencia = persistirClassificacaoNaoAutorizada("aguardando_reconciliacao");
  const acoes = acoesEmissaoFiscal({
    status: persistencia.status,
    geranet_http_status: 422,
    geranet_situacao: "erro",
    motivo: MENSAGEM_NFECONSULTA4,
  });

  assert.equal(situacao, "aguardando_reconciliacao");
  assert.equal(evidenciaSemTransmissaoRemota(evidencia), false);
  assert.equal(ehRejeicaoFiscalReal({ cstat: null, mensagem: MENSAGEM_NFECONSULTA4 }), false);
  assert.equal(persistencia.status, "aguardando_reconciliacao");
  assert.equal(persistencia.retransmitir, false);
  assert.equal(acoes.podeConsultarNovamente, true);
  assert.equal(acoes.podeRetransmitir, false);
});

test("A2. HTTP 200 + NfeConsulta4 sem cStat/protocolo → aguardando_reconciliacao", () => {
  assert.equal(
    classificarRespostaEmitir({
      httpOk: true,
      httpStatus: 200,
      situacao: "erro",
      cstat: null,
      mensagem: MENSAGEM_NFECONSULTA4,
      chave: null,
      protocolo: null,
    }),
    "aguardando_reconciliacao"
  );
});

test("A3. HTTP 422 genérico após REQUEST_INICIADA (caso NF-e 112) → aguardando_reconciliacao", () => {
  const evidencia = {
    httpOk: false,
    httpStatus: 422,
    situacao: "erro",
    cstat: null,
    mensagem:
      "Não foi possível processar a solicitação. Confira os dados informados e tente novamente.",
    chave: null,
    protocolo: null,
    transmissaoIniciada: true,
  };

  assert.equal(classificarRespostaEmitir(evidencia), "aguardando_reconciliacao");
  assert.equal(evidenciaSemTransmissaoRemota(evidencia), false);
  const persistencia = persistirClassificacaoNaoAutorizada(
    "aguardando_reconciliacao"
  );
  assert.equal(persistencia.status, "aguardando_reconciliacao");
  assert.equal(persistencia.retransmitir, false);
  assert.equal(
    acoesEmissaoFiscal({
      status: persistencia.status,
      classificacao: persistencia.classificacaoResumo,
      geranet_http_status: 422,
      motivo: evidencia.mensagem,
    }).podeRetransmitir,
    false
  );
});

test("B. HTTP 503 + cStat null → aguardando_reconciliacao", () => {
  assert.equal(
    classificarRespostaEmitir({
      httpOk: false,
      httpStatus: 503,
      situacao: "erro",
      cstat: null,
      mensagem: "Service Unavailable",
    }),
    "aguardando_reconciliacao"
  );
});

test("C. timeout depois do POST → aguardando_reconciliacao", () => {
  assert.equal(
    classificarRespostaEmitir({
      httpOk: false,
      httpStatus: 0,
      situacao: null,
      cstat: null,
      mensagem: "timeout depois do POST",
    }),
    "aguardando_reconciliacao"
  );
  assert.equal(
    ehErroTecnicoAmbiguo({
      httpStatus: 0,
      cstat: null,
      mensagem: "timeout depois do POST",
    }),
    true
  );
  assert.equal(
    persistirClassificacaoNaoAutorizada("aguardando_reconciliacao").retransmitir,
    false
  );
});

test("C2. HTTP 422 + Rejeicao SEFAZ sem cStat → rejeitada, não erro_comunicacao", () => {
  const evidencia = {
    httpOk: false,
    httpStatus: 422,
    situacao: "erro",
    cstat: null,
    mensagem:
      "Rejeicao: Operacao com nao contribuinte deve indicar operacao com consumidor final",
    chave: null,
    protocolo: null,
  };
  const persistencia = persistirClassificacaoNaoAutorizada("rejeitada");

  assert.equal(ehRejeicaoFiscalReal(evidencia), false);
  assert.equal(ehRejeicaoFiscalConclusiva(evidencia), true);
  assert.equal(classificarRespostaEmitir(evidencia), "rejeitada");
  assert.equal(evidenciaSemTransmissaoRemota(evidencia), false);
  assert.equal(persistencia.status, "rejeitada");
  assert.equal(persistencia.retransmitir, false);
  assert.equal(
    acoesEmissaoFiscal({
      status: "rejeitada",
      geranet_http_status: 422,
      geranet_situacao: "erro",
      motivo: evidencia.mensagem,
    }).podeRetransmitir,
    true
  );
  assert.equal(
    deveReclassificarComoRejeitada({
      status: "erro_comunicacao",
      geranet_http_status: 422,
      geranet_situacao: "erro",
      motivo: evidencia.mensagem,
      cstat: null,
    }),
    true
  );
  assert.equal(
    deveReclassificarComoRejeitada({
      status: "erro_comunicacao",
      geranet_http_status: 0,
      motivo: "timeout depois do POST",
    }),
    false
  );
});

test("D. cStat 230 → rejeitada", () => {
  assert.equal(ehRejeicaoFiscalReal({ cstat: "230" }), true);
  assert.equal(
    classificarRespostaEmitir({
      httpOk: false,
      httpStatus: 422,
      situacao: "erro",
      cstat: "230",
      mensagem: "Rejeição: IE do emitente não cadastrada",
    }),
    "rejeitada"
  );
});

test("E. rejeição fiscal de pagamento com cStat válido → rejeitada", () => {
  assert.equal(
    classificarRespostaEmitir({
      httpOk: false,
      httpStatus: 422,
      situacao: "erro",
      cstat: "869",
      mensagem: "Rejeição 869: Valor do troco incompatível",
    }),
    "rejeitada"
  );
  assert.equal(
    classificarLogEmitir(
      log({
        sucesso: false,
        situacao: "erro",
        http_status: 422,
        chave: null,
        protocolo: null,
        cstat: "869",
        mensagem: "Rejeição 869: Valor do troco incompatível",
      }),
      emissao()
    ),
    "rejeitada"
  );
});

test("F. emissão marcada rejeitada, cStat null, erro NfeConsulta4 → permitir reconciliação", () => {
  const atual = {
    status: "rejeitada",
    cstat: null,
    motivo: MENSAGEM_NFECONSULTA4,
    geranet_http_status: 200,
    erro_comunicacao: MENSAGEM_NFECONSULTA4,
  };

  assert.equal(emissaoRejeicaoTecnicaRecuperavel(atual), true);
  assert.equal(emissaoPodeReconciliar(atual), true);
  assert.equal(
    emissaoPodeReconciliar({
      status: "rejeitada",
      cstat: "230",
      motivo: "Rejeição: IE do emitente não cadastrada",
    }),
    false
  );
});

test("G. reconciliação encontra autorização → autorizada sem chamar /nfe/emitir", () => {
  const atual = emissao({
    status: "rejeitada",
    cstat: null,
    motivo: MENSAGEM_NFECONSULTA4,
    geranet_http_status: 200,
    erro_comunicacao: MENSAGEM_NFECONSULTA4,
  });
  const encontrado = log();
  const situacao = classificarLogEmitir(encontrado, atual);
  const resultado = montarAtualizacaoEmissao({
    emissao: atual,
    situacao,
    log: encontrado,
    origem: "manual",
  });

  assert.equal(situacao, "autorizada");
  assert.equal(resultado.status_local, "autorizada");
  assert.equal(resultado.patch.status, "autorizada");
  assert.match(resultado.mensagem, /NFC-e reconciliada: autorizada/);
  assert.equal(
    JSON.stringify(resultado.patch).includes("/nfe/emitir"),
    false
  );
});

test("H. reconciliação não encontra resultado → aguardando_reconciliacao", () => {
  const atual = emissao({
    status: "rejeitada",
    cstat: null,
    motivo: MENSAGEM_NFECONSULTA4,
    geranet_http_status: 200,
    erro_comunicacao: MENSAGEM_NFECONSULTA4,
  });

  assert.equal(
    decidirStatusLocal("rejeitada", "nao_encontrada", {
      cstat: null,
      motivo: MENSAGEM_NFECONSULTA4,
    }),
    "aguardando_reconciliacao"
  );

  const resultado = montarAtualizacaoEmissao({
    emissao: atual,
    situacao: "nao_encontrada",
    log: null,
    origem: "manual",
  });

  assert.equal(resultado.status_local, "aguardando_reconciliacao");
  assert.equal(resultado.patch.status, "aguardando_reconciliacao");
  const resumo = resultado.patch.resposta_resumo as {
    historico?: Array<{ nota?: string; tipo?: string }>;
  };
  assert.ok(
    resumo.historico?.some(
      (item) =>
        item.nota === MENSAGEM_FALHA_TECNICA_CONSULTA ||
        item.tipo === "erro_tecnico_original"
    )
  );
});

test("conciliação bloqueia só a retransmissão desta emissão, não a da venda seguinte", () => {
  assert.equal(
    emissaoBloqueiaRetransmissao({ status: "aguardando_reconciliacao" }),
    true
  );
  assert.equal(
    emissaoBloqueiaRetransmissao({ status: "enviando" }),
    true
  );
  assert.equal(
    emissaoBloqueiaRetransmissao({ status: "reservada" }),
    false
  );
  assert.equal(
    emissaoBloqueiaRetransmissao({ status: "autorizada" }),
    false
  );
  assert.equal(
    emissaoBloqueiaRetransmissao({ status: "erro_comunicacao" }),
    true
  );
  assert.equal(emissaoPodeRetentarEnvio({ status: "erro_comunicacao" }), false);
  assert.equal(
    emissaoPodeRetentarEnvio({
      status: "erro_comunicacao",
      classificacao: "erro_envio",
    }),
    true
  );
  assert.equal(
    emissaoBloqueiaRetransmissao({
      status: "erro_comunicacao",
      classificacao: "erro_envio",
    }),
    false
  );
  assert.equal(
    emissaoPodeRetentarEnvio({
      status: "aguardando_reconciliacao",
      geranet_http_status: 422,
      geranet_situacao: "erro",
      cstat: null,
      protocolo: null,
      motivo: MENSAGEM_NFECONSULTA4,
    }),
    false
  );
  assert.equal(
    emissaoBloqueiaRetransmissao({
      status: "aguardando_reconciliacao",
      geranet_http_status: 422,
      geranet_situacao: "erro",
      cstat: null,
      protocolo: null,
      motivo: MENSAGEM_NFECONSULTA4,
    }),
    true
  );
  assert.equal(
    emissaoPodeRetentarEnvio({
      status: "erro_comunicacao",
      geranet_http_status: 422,
      motivo: MENSAGEM_NFECONSULTA4,
    }),
    false
  );
  assert.equal(
    emissaoPodeRetentarEnvio({
      status: "aguardando_reconciliacao",
      geranet_http_status: 503,
      geranet_situacao: "erro",
    }),
    false
  );
});

test("duplicidade 204 sem protocolo volta para reconciliação da mesma emissão", () => {
  assert.equal(
    classificarRespostaEmitir({
      httpOk: false,
      httpStatus: 422,
      situacao: "erro",
      cstat: "204",
      mensagem: "Rejeição 204: Duplicidade de NF-e",
      chave: "51260812345678000155650010000000111234567890",
      protocolo: null,
    }),
    "aguardando_reconciliacao"
  );
  assert.equal(
    persistirClassificacaoNaoAutorizada("aguardando_reconciliacao").retransmitir,
    false
  );
});

test("duplicidade 204 com chave e protocolo recupera autorização", () => {
  assert.equal(
    classificarRespostaEmitir({
      httpOk: false,
      httpStatus: 422,
      situacao: "erro",
      cstat: "204",
      mensagem: "Rejeição 204: Duplicidade de NF-e",
      chave: "51260812345678000155650010000000111234567890",
      protocolo: "151260000000001",
    }),
    "autorizada"
  );
});

test("autorizada exige chave, protocolo e evidência inequívoca", () => {
  assert.equal(
    classificarRespostaEmitir({
      httpOk: true,
      httpStatus: 200,
      situacao: "sucesso",
      cstat: "100",
      mensagem: "Autorizado o uso da NF-e",
      chave: "51260812345678000155650010000000111234567890",
      protocolo: "151260000000001",
    }),
    "autorizada"
  );
});

test("mensagem técnica sem cStat nunca é rejeição fiscal real", () => {
  assert.equal(
    ehRejeicaoFiscalReal({
      cstat: null,
      mensagem: "Rejeição genérica sem código",
      situacao: "erro",
    }),
    false
  );
  assert.equal(
    classificarLogEmitir(
      log({
        sucesso: false,
        situacao: "erro",
        http_status: 200,
        chave: null,
        protocolo: null,
        cstat: null,
        mensagem: MENSAGEM_NFECONSULTA4,
      }),
      emissao()
    ),
    "processando"
  );
  assert.equal(
    classificarLogEmitir(
      log({
        sucesso: false,
        situacao: "erro",
        http_status: 422,
        chave: null,
        protocolo: null,
        cstat: null,
        mensagem:
          "Rejeicao: Operacao com nao contribuinte deve indicar operacao com consumidor final",
      }),
      emissao()
    ),
    "rejeitada"
  );
});

test("A. NfeConsulta4 explícito: conciliação, sem retry e com consulta", () => {
  const evidencia = {
    httpOk: false,
    httpStatus: 422,
    situacao: "erro",
    cstat: null,
    mensagem: MENSAGEM_NFECONSULTA4,
    chave: null,
    protocolo: null,
  };
  const situacao = classificarRespostaEmitir(evidencia);
  assert.equal(situacao, "aguardando_reconciliacao");
  const persistencia = persistirClassificacaoNaoAutorizada(
    "aguardando_reconciliacao"
  );
  const acoes = acoesEmissaoFiscalNfce65({
    status: persistencia.status,
    geranet_http_status: 422,
    geranet_situacao: "erro",
    motivo: MENSAGEM_NFECONSULTA4,
  });

  assert.equal(ehFalhaNfeConsulta4(evidencia), true);
  assert.equal(persistencia.status, "aguardando_reconciliacao");
  assert.equal(persistencia.retransmitir, false);
  assert.equal(acoes.podeRetransmitir, false);
  assert.equal(acoes.podeConsultarNovamente, true);
});

test("B. mesma venda em conciliação não reabre reserva nem retransmite", () => {
  const conciliacao = {
    status: "aguardando_reconciliacao",
    geranet_http_status: 422,
    motivo: MENSAGEM_NFECONSULTA4,
  };
  const erroConsulta4 = {
    status: "erro_comunicacao",
    geranet_http_status: 422,
    motivo: MENSAGEM_NFECONSULTA4,
  };

  assert.equal(nfce65DeveApenasReconciliar(conciliacao), true);
  assert.equal(nfce65DeveApenasReconciliar(erroConsulta4), true);
  assert.equal(acoesEmissaoFiscalNfce65(conciliacao).podeRetransmitir, false);
  assert.equal(
    emissaoPodeRetentarEnvio(conciliacao) &&
      !nfce65DeveApenasReconciliar(conciliacao),
    false
  );
  assert.equal(
    emissaoPodeRetentarEnvio(erroConsulta4) &&
      !nfce65DeveApenasReconciliar(erroConsulta4),
    false
  );
  assert.match(
    MENSAGEM_BLOQUEIO_RETRANSMISSAO,
    /Segurança contra retransmissão/
  );
  assert.match(
    MENSAGEM_BLOQUEIO_RETRANSMISSAO,
    /não retransmita/i
  );
  assert.equal(
    MENSAGEM_NFCE65_AGUARDANDO_RECONCILIACAO,
    MENSAGEM_BLOQUEIO_RETRANSMISSAO
  );
});

test("DNS/ENOTFOUND local continua erro_comunicacao retransmitível na mesma emissão", () => {
  const evidencia = {
    httpOk: false,
    httpStatus: null,
    situacao: null,
    cstat: null,
    mensagem: "getaddrinfo ENOTFOUND nfe.geranet.net",
    chave: null,
    protocolo: null,
  };

  assert.equal(ehFalhaNfeConsulta4(evidencia), false);
  assert.equal(
    nfce65DeveApenasReconciliar({
      status: "erro_comunicacao",
      erro_comunicacao: "getaddrinfo ENOTFOUND nfe.geranet.net",
    }),
    false
  );
  assert.equal(
    emissaoPodeRetentarEnvio({
      status: "erro_comunicacao",
      classificacao: "erro_envio",
      erro_comunicacao: "getaddrinfo ENOTFOUND nfe.geranet.net",
    }),
    true
  );
});

test("G. NF-e 55: erro_envio persistido (falha antes do POST) continua retransmitível na mesma emissão", () => {
  assert.equal(
    acoesEmissaoFiscal({
      status: "erro_comunicacao",
      classificacao: "erro_envio",
      geranet_http_status: null,
      motivo: "getaddrinfo ENOTFOUND nfe.geranet.net",
    }).podeRetransmitir,
    true
  );
  assert.equal(
    emissaoPodeRetentarEnvio({
      status: "aguardando_reconciliacao",
      geranet_http_status: 422,
      geranet_situacao: "erro",
      motivo:
        "Não foi possível processar a solicitação. Confira os dados informados e tente novamente.",
    }),
    false
  );
});

test("CASO A. HTTP 200 + cStat 100 → autorizada", () => {
  assert.equal(
    classificarRespostaEmitir({
      httpOk: true,
      httpStatus: 200,
      situacao: "sucesso",
      cstat: "100",
      mensagem: "Autorizado o uso da NF-e",
      chave: "51260812345678000155650010000000111234567890",
      protocolo: "151260000000001",
      transmissaoIniciada: true,
    }),
    "autorizada"
  );
});

test("CASO B. HTTP 422 + cStat rejeição conclusiva → rejeitada", () => {
  const evidencia = {
    httpOk: false,
    httpStatus: 422,
    situacao: "erro",
    cstat: "230",
    mensagem: "Rejeição: IE do emitente não cadastrada",
    chave: null,
    protocolo: null,
    transmissaoIniciada: true,
  };
  assert.equal(classificarRespostaEmitir(evidencia), "rejeitada");
  assert.equal(
    persistirClassificacaoNaoAutorizada("rejeitada").status,
    "rejeitada"
  );
  assert.notEqual(
    classificarRespostaEmitir(evidencia),
    "aguardando_reconciliacao"
  );
});

test("CASO C. HTTP 422 genérico da NF-e 112 → aguardando_reconciliacao, sem retry", () => {
  const evidencia = {
    httpOk: false,
    httpStatus: 422,
    situacao: "erro",
    cstat: null,
    mensagem:
      "Não foi possível processar a solicitação. Confira os dados informados e tente novamente.",
    chave: null,
    protocolo: null,
    transmissaoIniciada: true,
  };
  const situacao = classificarRespostaEmitir(evidencia);
  const persistencia = persistirClassificacaoNaoAutorizada(situacao === "erro_envio" ? "erro_envio" : situacao === "rejeitada" ? "rejeitada" : "aguardando_reconciliacao");
  assert.equal(situacao, "aguardando_reconciliacao");
  assert.equal(persistencia.retransmitir, false);
  assert.match(
    mensagemResultadoRemotoNaoConclusivo("55"),
    /Não foi possível confirmar o estado fiscal desta NF-e/
  );
  assert.match(persistencia.mensagemPadrao, /reconcilia/i);
});

test("CASO D. timeout depois de REQUEST_INICIADA → aguardando_reconciliacao", () => {
  assert.equal(
    classificarRespostaEmitir({
      httpOk: false,
      httpStatus: 0,
      situacao: null,
      cstat: null,
      mensagem: "Timeout após iniciar transmissão à Geranet.",
      chave: null,
      protocolo: null,
      transmissaoIniciada: true,
    }),
    "aguardando_reconciliacao"
  );
  assert.equal(
    persistirClassificacaoNaoAutorizada("aguardando_reconciliacao").retransmitir,
    false
  );
});

test("CASO E. erro local antes de REQUEST_INICIADA → erro_envio, sem reconciliação", () => {
  const evidencia = {
    httpOk: false,
    httpStatus: null,
    situacao: null,
    cstat: null,
    mensagem: "API Key da Geranet não informada.",
    chave: null,
    protocolo: null,
    transmissaoIniciada: false,
  };
  assert.equal(evidenciaSemTransmissaoRemota(evidencia), true);
  assert.equal(classificarRespostaEmitir(evidencia), "erro_envio");
  const persistencia = persistirClassificacaoNaoAutorizada("erro_envio");
  assert.equal(persistencia.status, "erro_comunicacao");
  assert.equal(persistencia.retransmitir, true);
});

test("CASO F. duplo clique: claim/bloqueio ocorre antes de chamarGeranet", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const emitirVenda = readFileSync(
    join(process.cwd(), "app/api/fiscal/geranet/nfe-emitir-venda/route.ts"),
    "utf8"
  );
  const posBloqueioRascunho = emitirVenda.indexOf("avaliarBloqueioRascunhoFiscal");
  const posBloqueio = emitirVenda.indexOf("emissaoBloqueiaRetransmissao");
  const posClaim = emitirVenda.indexOf("claimTentativaEmissaoFiscal");
  const posGeranet = emitirVenda.indexOf("await chamarGeranet");
  assert.ok(posBloqueioRascunho >= 0);
  assert.ok(posBloqueio >= 0);
  assert.ok(posClaim >= 0);
  assert.ok(posGeranet > posBloqueioRascunho);
  assert.ok(posGeranet > posBloqueio);
  assert.ok(posGeranet > posClaim);
  assert.match(emitirVenda, /mensagemBloqueioEmissao/);
  assert.match(emitirVenda, /extraBloqueioRetransmissaoFiscal/);
});

test("CASO G. empresa B não reconcilia emissão da empresa A", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const reconciliar = readFileSync(
    join(process.cwd(), "lib/fiscal/reconciliar-emissao.ts"),
    "utf8"
  );
  const rota = readFileSync(
    join(process.cwd(), "app/api/fiscal/emissoes/[id]/reconciliar/route.ts"),
    "utf8"
  );
  assert.match(reconciliar, /\.eq\("id", emissaoId\)/);
  assert.match(reconciliar, /\.eq\("empresa_id", empresaId\)/);
  assert.match(rota, /usuarios_empresas/);
  assert.match(rota, /principal/);
  assert.match(rota, /ativo/);
  assert.match(rota, /vinculo\.empresa_id/);
  const extra = extraBloqueioRetransmissaoFiscal({
    id: "em-a",
    status: "aguardando_reconciliacao",
  });
  assert.equal(extra.podeRetransmitir, false);
  assert.equal(extra.requer_reconciliacao, true);
  assert.match(
    MENSAGEM_BLOQUEIO_AGUARDANDO_RECONCILIACAO,
    /Reconcilie o documento antes de qualquer nova tentativa/
  );
});

test("HTTP 422 + cStat 539 é rejeição determinística, não processando e não retransmite", () => {
  const evidencia = {
    httpOk: false,
    httpStatus: 422,
    situacao: "erro",
    cstat: "539",
    mensagem: "Duplicidade de NF-e com diferença na Chave de Acesso",
    chave: null,
    protocolo: null,
  };
  const situacao = classificarRespostaEmitir(evidencia);
  const persistencia = persistirClassificacaoNaoAutorizada("rejeitada");
  const acoes = acoesEmissaoFiscal({
    status: "aguardando_reconciliacao",
    modelo: "65",
    cstat: "539",
    motivo: evidencia.mensagem,
    geranet_http_status: 422,
    geranet_situacao: "erro",
  });

  assert.equal(situacao, "rejeitada");
  assert.equal(ehRejeicaoFiscalReal(evidencia), true);
  assert.equal(ehRejeicaoFiscalConclusiva(evidencia), true);
  assert.equal(persistencia.retransmitir, false);
  assert.equal(acoes.podeRetransmitir, false);
  assert.equal(acoes.podeConsultarNovamente, true);
  assert.equal(
    classificarRespostaEmitir({
      ...evidencia,
      cstat: null,
    }),
    "rejeitada"
  );

  assert.equal(
    classificarLogEmitir(
      log({
        http_status: 422,
        sucesso: false,
        situacao: "erro",
        cstat: null,
        mensagem: "Duplicidade de NF-e com diferença na Chave de Acesso",
        chave: null,
        protocolo: null,
      }),
      emissao({ status: "aguardando_reconciliacao", numero: 26 })
    ),
    "rejeitada"
  );
  assert.equal(
    decidirStatusLocal("aguardando_reconciliacao", "nao_encontrada", {
      cstat: "539",
      motivo: "Duplicidade de NF-e com diferença na Chave de Acesso",
    }),
    "rejeitada"
  );
  assert.equal(
    decidirStatusLocal("aguardando_reconciliacao", "falha_consulta", {
      cstat: null,
      motivo: "timeout depois do POST",
    }),
    "aguardando_reconciliacao"
  );

  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { join } = require("node:path") as typeof import("node:path");
  const uiReconciliar = readFileSync(
    join(process.cwd(), "components/vendas/reconciliar-emissao-fiscal.tsx"),
    "utf8"
  );
  const reconciliarEmissao = readFileSync(
    join(process.cwd(), "lib/fiscal/reconciliar-emissao.ts"),
    "utf8"
  );
  assert.match(uiReconciliar, /Reconciliar agora/);
  assert.doesNotMatch(uiReconciliar, /Acompanhar reconciliação/);
  assert.doesNotMatch(reconciliarEmissao, /\/api\/v1\/nfe\/emitir/);
  assert.match(reconciliarEmissao, /consultarEmissaoGeranet/);
});
