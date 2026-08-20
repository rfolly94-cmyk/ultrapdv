import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classificarLogEmitir,
  decidirStatusLocal,
  EmissaoParaConsulta,
  instanteDentroDaJanelaTransmissao,
  logCompativelComEmissao,
  logDentroDaJanelaTransmissao,
  LogGeranetResumo,
  mensagemConsulta,
  montarAtualizacaoEmissao,
  sanitizarConsultaGeranet,
} from "./classificar-consulta";

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

test("A. aguardando_reconciliacao + Geranet autorizada vira autorizada com chave/protocolo/xml/pdf", () => {
  const atual = emissao();
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
  assert.equal(resultado.patch.chave_acesso, encontrado.chave);
  assert.equal(resultado.patch.protocolo, encontrado.protocolo);
  assert.equal(resultado.patch.cstat, "100");
  assert.equal(resultado.patch.xml_hex, "3c786d6c");
  assert.equal(resultado.patch.pdf_hex, "25504446");
  assert.equal(resultado.patch.geranet_log_id, 10);
  assert.ok(resultado.patch.autorizada_at);
  assert.match(resultado.mensagem, /NFC-e reconciliada: autorizada/);
});

test("B. reconciliação com rejeição grava cStat e motivo, sem novo número", () => {
  const atual = emissao();
  const encontrado = log({
    sucesso: false,
    situacao: "erro",
    http_status: 422,
    chave: null,
    protocolo: null,
    cstat: "869",
    mensagem: "Rejeição 869: Valor do troco incompatível",
    xml: "3c72656a",
    pdf: null,
  });
  const situacao = classificarLogEmitir(encontrado, atual);
  const resultado = montarAtualizacaoEmissao({
    emissao: atual,
    situacao,
    log: encontrado,
    origem: "manual",
  });

  assert.equal(situacao, "rejeitada");
  assert.equal(resultado.status_local, "rejeitada");
  assert.equal(resultado.patch.cstat, "869");
  assert.match(String(resultado.patch.motivo), /869/);
  assert.equal(resultado.patch.xml_hex, "3c72656a");
  assert.equal(resultado.patch.chave_acesso, undefined);
  assert.match(resultado.mensagem, /rejeitada — cStat 869/);
});

test("C. ainda processando permanece pendente e não autoriza nem rejeita", () => {
  const atual = emissao();
  const encontrado = log({
    sucesso: null,
    situacao: "",
    http_status: 202,
    chave: null,
    protocolo: null,
    cstat: null,
    mensagem: "Em processamento",
    xml: null,
    pdf: null,
    contingencia: "nao",
  });
  const situacao = classificarLogEmitir(encontrado, atual);
  const resultado = montarAtualizacaoEmissao({
    emissao: atual,
    situacao,
    log: encontrado,
    origem: "manual",
  });

  assert.equal(situacao, "processando");
  assert.equal(resultado.status_local, "aguardando_reconciliacao");
  assert.equal(resultado.patch.autorizada_at, undefined);
  assert.equal(resultado.mensagem, "Documento ainda está sendo processado.");
  assert.equal(
    (resultado.patch.resposta_resumo as { classificacao?: string }).classificacao,
    "ambigua"
  );
  assert.equal(
    (resultado.patch.resposta_resumo as { situacao_remota?: string })
      .situacao_remota,
    "processando"
  );
});

test("D. documento não encontrado permanece seguro, sem emitir", () => {
  const atual = emissao();
  const resultado = montarAtualizacaoEmissao({
    emissao: atual,
    situacao: "nao_encontrada",
    log: null,
    origem: "cron",
  });

  assert.equal(resultado.status_local, "aguardando_reconciliacao");
  assert.equal(resultado.patch.status, "aguardando_reconciliacao");
  assert.equal(
    resultado.mensagem,
    "Documento ainda não localizado na Geranet. Tente consultar novamente antes de retransmitir."
  );
  assert.equal(
    (resultado.patch.resposta_resumo as { consulta: { origem: string } })
      .consulta.origem,
    "cron"
  );
});

test("NfeConsulta4 HTTP 500 permanece em reconciliação e não autoriza retransmissão", () => {
  const atual = emissao();
  const encontrado = log({
    sucesso: false,
    situacao: "erro",
    http_status: 422,
    chave: null,
    protocolo: null,
    cstat: null,
    mensagem: [
      "Erro Interno: -2",
      "Erro HTTP: 500",
      "URL: https://nfce.sefaz.mt.gov.br/nfcews/services/NfeConsulta4",
      "Network subsystem is unusable",
    ].join("\n"),
    xml: null,
    pdf: null,
  });
  const situacao = classificarLogEmitir(encontrado, atual);
  const resultado = montarAtualizacaoEmissao({
    emissao: atual,
    situacao,
    log: encontrado,
    origem: "manual",
  });

  assert.equal(situacao, "processando");
  assert.equal(resultado.status_local, "aguardando_reconciliacao");
  assert.match(resultado.mensagem, /Não foi possível consultar a situação da NFC-e na SEFAZ-MT/);
  assert.match(resultado.mensagem, /Tente consultar novamente antes de retransmitir/);
});

test("E. consultar nota já autorizada não altera status nem cria autorização nova", () => {
  const atual = emissao({
    status: "autorizada",
    chave_acesso: "51260812345678000155650010000000111234567890",
    protocolo: "151260000000001",
    autorizada_at: "2026-08-14T10:00:00.000Z",
    xml_hex: "xml-ja-salvo",
    pdf_hex: "pdf-ja-salvo",
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
  assert.equal(resultado.patch.autorizada_at, undefined);
  assert.equal(resultado.patch.xml_hex, undefined);
  assert.equal(resultado.patch.pdf_hex, undefined);
  assert.equal(decidirStatusLocal("autorizada", "rejeitada"), "autorizada");
});

test("duplicidade 204 com chave é autorização, não rejeição", () => {
  const atual = emissao();
  const encontrado = log({
    sucesso: false,
    situacao: "erro",
    cstat: "204",
    mensagem: "Rejeição 204: Duplicidade de NF-e",
  });

  assert.equal(classificarLogEmitir(encontrado, atual), "autorizada");
});

test("log incompatível não casa série/número diferentes", () => {
  assert.equal(
    logCompativelComEmissao(emissao(), log({ numero: "99", chave: null })),
    false
  );
});

test("numeroVenda comercial não é rejeitado só porque origem_id é UUID", () => {
  const atual = emissao({
    origem_id: "acda53f9-0998-4832-8499-6a81fca2537e",
    numero_venda: "45",
    numero: 20,
    codigo_numerico: "97376245",
    chave_acesso: null,
  });
  const encontrado = log({
    chave: null,
    protocolo: null,
    cstat: null,
    sucesso: false,
    situacao: "erro",
    http_status: 422,
    numero: "20",
    codigo_numerico: "97376245",
    numero_venda: "45",
  });

  assert.equal(logCompativelComEmissao(atual, encontrado), true);
});

test("cNF igual casa o log mesmo se numeroVenda não for o UUID da venda", () => {
  const atual = emissao({
    origem_id: "acda53f9-0998-4832-8499-6a81fca2537e",
    numero: 20,
    codigo_numerico: "97376245",
    chave_acesso: null,
  });
  const encontrado = log({
    chave: null,
    numero: "20",
    codigo_numerico: "97376245",
    numero_venda: "45",
  });

  assert.equal(logCompativelComEmissao(atual, encontrado), true);
});

test("D. reconciliação autorizada da NFC-e 65 vira autorizada sem reemitir", () => {
  const atual = emissao({
    status: "aguardando_reconciliacao",
    motivo: [
      "Erro Interno: -2",
      "Erro HTTP: 500",
      "URL: https://nfce.sefaz.mt.gov.br/nfcews/services/NfeConsulta4",
      "Network subsystem is unusable",
    ].join("\n"),
  });
  const encontrado = log();
  const resultado = montarAtualizacaoEmissao({
    emissao: atual,
    situacao: classificarLogEmitir(encontrado, atual),
    log: encontrado,
    origem: "manual",
  });

  assert.equal(resultado.status_local, "autorizada");
  assert.equal(resultado.patch.status, "autorizada");
  assert.equal(
    JSON.stringify(resultado.patch).includes("/nfe/emitir"),
    false
  );
});

test("E. NfeConsulta4 na reconciliação permanece aguardando_reconciliacao", () => {
  const motivo = [
    "Erro Interno: -2",
    "Erro HTTP: 500",
    "URL: https://nfce.sefaz.mt.gov.br/nfcews/services/NfeConsulta4",
    "Network subsystem is unusable",
  ].join("\n");
  const atual = emissao({
    status: "aguardando_reconciliacao",
    motivo,
    erro_comunicacao: motivo,
  });
  const encontrado = log({
    sucesso: false,
    situacao: "erro",
    http_status: 422,
    chave: null,
    protocolo: null,
    cstat: null,
    mensagem: motivo,
    xml: null,
    pdf: null,
  });
  const resultado = montarAtualizacaoEmissao({
    emissao: atual,
    situacao: classificarLogEmitir(encontrado, atual),
    log: encontrado,
    origem: "manual",
  });

  assert.equal(resultado.status_local, "aguardando_reconciliacao");
  assert.equal(
    decidirStatusLocal("erro_comunicacao", "processando", {
      motivo,
      modelo: "65",
    }),
    "aguardando_reconciliacao"
  );
});

test("G. NF-e 55 em erro_comunicacao + NfeConsulta4 permanece erro_comunicacao (falha de consulta, não processamento remoto)", () => {
  const motivo = [
    "Erro Interno: -2",
    "NfeConsulta4",
    "Network subsystem is unusable",
  ].join("\n");

  assert.equal(
    decidirStatusLocal("erro_comunicacao", "processando", {
      motivo,
      modelo: "55",
    }),
    "erro_comunicacao"
  );
});

test("mensagem e sanitização não vazam segredo", () => {
  assert.equal(
    mensagemConsulta("55", "autorizada", "100", null),
    "NF-e reconciliada: autorizada."
  );

  const limpo = sanitizarConsultaGeranet({
    certificadoDigital: "ABC",
    senhaCertificadoDigital: "123",
    xml: "a".repeat(500),
    cstat: "100",
  }) as Record<string, unknown>;

  assert.equal(limpo.certificadoDigital, "[REDACTED]");
  assert.equal(limpo.senhaCertificadoDigital, "[REDACTED]");
  assert.equal(limpo.xml, "[presente]");
  assert.equal(limpo.cstat, "100");

  const payloadString = sanitizarConsultaGeranet(
    JSON.stringify({
      certificadoDigital: "ABC",
      senhaCertificadoDigital: "123",
      cstat: "100",
    })
  ) as Record<string, unknown>;
  assert.equal(payloadString.certificadoDigital, "[REDACTED]");
  assert.equal(payloadString.senhaCertificadoDigital, "[REDACTED]");
  assert.equal(payloadString.cstat, "100");
});

test("janela de horário da transmissão original casa o log próximo de enviada_at", () => {
  const enviada = "2026-08-17T19:00:00.000Z";
  assert.equal(
    instanteDentroDaJanelaTransmissao(enviada, "2026-08-17T19:02:00.000Z"),
    true
  );
  assert.equal(
    instanteDentroDaJanelaTransmissao(enviada, "2026-08-16T12:00:00.000Z"),
    false
  );
  assert.equal(
    logDentroDaJanelaTransmissao(
      { enviada_at: enviada, chave_acesso: null },
      { criado_em: "2026-08-16T12:00:00.000Z", chave: null }
    ),
    false
  );
});

test("chave de 44 dígitos casa o log mesmo fora da janela de horário", () => {
  const chave = "51260812345678000155650010000000111234567890";
  assert.equal(
    logDentroDaJanelaTransmissao(
      {
        enviada_at: "2026-08-17T19:00:00.000Z",
        chave_acesso: chave,
      },
      {
        criado_em: "2026-08-10T12:00:00.000Z",
        chave,
      }
    ),
    true
  );
});

test("log de outro número na mesma janela não casa a emissão", () => {
  const atual = emissao({
    numero: 11,
    enviada_at: "2026-08-17T19:00:00.000Z",
  });
  const outro = log({
    numero: "99",
    codigo_numerico: "99999999",
    chave: null,
    criado_em: "2026-08-17T19:01:00.000Z",
  });

  assert.equal(logCompativelComEmissao(atual, outro), false);
});
