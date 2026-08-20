import assert from "node:assert/strict";
import { test } from "node:test";

import {
  avaliarEnvioCancelamentoNormal,
  resolverPoliticaCancelamentoFiscal,
} from "./politica-cancelamento";

const justificativa = "Nota emitida com dados incorretos do destinatário.";

function avaliar(
  politica: ReturnType<typeof resolverPoliticaCancelamentoFiscal>,
  extra: Partial<Parameters<typeof avaliarEnvioCancelamentoNormal>[0]> = {}
) {
  return avaliarEnvioCancelamentoNormal({
    statusEmissao: "autorizada",
    statusEventoCancelamento: null,
    politica,
    confirmouNaoCirculacao: true,
    confirmouSemDuplicataEscritural: politica.modelo === "55",
    justificativa,
    ...extra,
  });
}

test("A. NFC-e MT autorizada há 10 minutos: cancelamento permitido", () => {
  const agora = new Date("2026-08-15T23:10:00.000Z");
  const politica = resolverPoliticaCancelamentoFiscal({
    uf: "MT",
    modelo: "65",
    status: "autorizada",
    autorizadoEm: "2026-08-15T23:00:00.000Z",
    agora,
    fusoHorario: "America/Cuiaba",
  });

  assert.equal(politica.permitido, true);
  assert.equal(politica.prazoNormalMinutos, 30);
  assert.equal(politica.codigo, "dentro_do_prazo");
  assert.equal(avaliar(politica).permitirEnvio, true);
});

test("B. NFC-e MT exatamente após 30 minutos: bloqueado antes da Geranet", () => {
  const agora = new Date("2026-08-15T23:30:01.000Z");
  const politica = resolverPoliticaCancelamentoFiscal({
    uf: "MT",
    modelo: "65",
    status: "autorizada",
    autorizadoEm: "2026-08-15T23:00:00.000Z",
    agora,
    fusoHorario: "America/Cuiaba",
  });

  assert.equal(politica.permitido, false);
  assert.equal(politica.codigo, "prazo_encerrado");
  assert.match(politica.motivoBloqueio ?? "", /30 minutos/);
  assert.equal(avaliar(politica).permitirEnvio, false);
});

test("C. NF-e MT autorizada há 10 horas: permitido", () => {
  const agora = new Date("2026-08-16T09:00:00.000Z");
  const politica = resolverPoliticaCancelamentoFiscal({
    uf: "MT",
    modelo: "55",
    status: "autorizada",
    autorizadoEm: "2026-08-15T23:00:00.000Z",
    agora,
    fusoHorario: "America/Cuiaba",
  });

  assert.equal(politica.permitido, true);
  assert.equal(politica.prazoNormalMinutos, 24 * 60);
  assert.equal(avaliar(politica).permitirEnvio, true);
});

test("D. NF-e MT autorizada há mais de 24 horas: bloqueado", () => {
  const agora = new Date("2026-08-16T23:00:01.000Z");
  const politica = resolverPoliticaCancelamentoFiscal({
    uf: "MT",
    modelo: "55",
    status: "autorizada",
    autorizadoEm: "2026-08-15T23:00:00.000Z",
    agora,
    fusoHorario: "America/Cuiaba",
  });

  assert.equal(politica.permitido, false);
  assert.equal(politica.codigo, "prazo_encerrado");
  assert.match(politica.motivoBloqueio ?? "", /24 horas/);
  assert.equal(avaliar(politica).permitirEnvio, false);
});

test("E. tela aberta dentro do prazo, clique depois: servidor bloqueia", () => {
  const autorizadoEm = "2026-08-15T23:00:00.000Z";
  const naTela = resolverPoliticaCancelamentoFiscal({
    uf: "MT",
    modelo: "65",
    status: "autorizada",
    autorizadoEm,
    agora: new Date("2026-08-15T23:20:00.000Z"),
    fusoHorario: "America/Cuiaba",
  });

  assert.equal(naTela.permitido, true);

  const noServidor = resolverPoliticaCancelamentoFiscal({
    uf: "MT",
    modelo: "65",
    status: "autorizada",
    autorizadoEm,
    agora: new Date("2026-08-15T23:31:00.000Z"),
    fusoHorario: "America/Cuiaba",
  });

  const envio = avaliar(noServidor);
  assert.equal(envio.permitirEnvio, false);
  assert.equal(envio.codigo, "prazo_encerrado");
  assert.match(
    envio.motivo ?? "",
    /encerrou antes da confirmação da operação/
  );
});

test("F. sem confirmação de não circulação: não envia", () => {
  const politica = resolverPoliticaCancelamentoFiscal({
    uf: "MT",
    modelo: "65",
    status: "autorizada",
    autorizadoEm: "2026-08-15T23:00:00.000Z",
    agora: new Date("2026-08-15T23:10:00.000Z"),
  });

  const envio = avaliar(politica, { confirmouNaoCirculacao: false });
  assert.equal(envio.permitirEnvio, false);
  assert.equal(envio.codigo, "confirmacao_circulacao_ausente");
});

test("G. NF-e sem confirmação de Duplicata Escritural: não envia", () => {
  const politica = resolverPoliticaCancelamentoFiscal({
    uf: "MT",
    modelo: "55",
    status: "autorizada",
    autorizadoEm: "2026-08-15T23:00:00.000Z",
    agora: new Date("2026-08-16T01:00:00.000Z"),
  });

  const envio = avaliar(politica, {
    confirmouSemDuplicataEscritural: false,
  });
  assert.equal(envio.permitirEnvio, false);
  assert.equal(envio.codigo, "confirmacao_duplicata_ausente");
});

test("H. já cancelada: não chama Geranet", () => {
  const politica = resolverPoliticaCancelamentoFiscal({
    uf: "MT",
    modelo: "65",
    status: "cancelada",
    autorizadoEm: "2026-08-15T23:00:00.000Z",
    agora: new Date("2026-08-15T23:10:00.000Z"),
  });

  assert.equal(politica.codigo, "ja_cancelada");
  const envio = avaliar(politica, { statusEmissao: "cancelada" });
  assert.equal(envio.permitirEnvio, false);
  assert.equal(envio.motivo, "Documento já cancelado.");
});

test("I. timeout anterior: orienta reconciliar e não reenvia", () => {
  const politica = resolverPoliticaCancelamentoFiscal({
    uf: "MT",
    modelo: "65",
    status: "autorizada",
    autorizadoEm: "2026-08-15T23:00:00.000Z",
    agora: new Date("2026-08-15T23:10:00.000Z"),
  });

  const envio = avaliar(politica, {
    statusEventoCancelamento: "aguardando_reconciliacao",
  });

  assert.equal(envio.permitirEnvio, false);
  assert.equal(envio.codigo, "aguardando_reconciliacao");
  assert.match(envio.motivo ?? "", /Consulte a situação antes de reenviar/);
});

test("J. outra UF não aplica automaticamente a política MT", () => {
  const agora = new Date("2026-08-16T23:00:01.000Z");
  const politica = resolverPoliticaCancelamentoFiscal({
    uf: "SP",
    modelo: "65",
    status: "autorizada",
    autorizadoEm: "2026-08-15T23:00:00.000Z",
    agora,
    fusoHorario: "America/Sao_Paulo",
  });

  assert.equal(politica.codigo, "politica_nao_configurada");
  assert.equal(politica.permitido, true);
  assert.equal(politica.prazoNormalMinutos, null);
  assert.equal(avaliar(politica).permitirEnvio, true);
});

test("K. timezone MT: autorização no fim do dia e limite no dia seguinte", () => {
  // 15/08/2026 23:50 em America/Cuiaba (UTC-4) = 16/08 03:50Z
  const autorizadoEm = "2026-08-16T03:50:00.000Z";
  const dentro = resolverPoliticaCancelamentoFiscal({
    uf: "MT",
    modelo: "65",
    status: "autorizada",
    autorizadoEm,
    agora: new Date("2026-08-16T04:10:00.000Z"),
    fusoHorario: "America/Cuiaba",
  });

  assert.equal(dentro.permitido, true);
  assert.equal(dentro.autorizadoEmTexto, "15/08/2026 às 23:50");
  assert.equal(dentro.limiteEmTexto, "16/08/2026 às 00:20");

  const depois = resolverPoliticaCancelamentoFiscal({
    uf: "MT",
    modelo: "65",
    status: "autorizada",
    autorizadoEm,
    agora: new Date("2026-08-16T04:21:00.000Z"),
    fusoHorario: "America/Cuiaba",
  });

  assert.equal(depois.permitido, false);
  assert.equal(depois.codigo, "prazo_encerrado");
});

test("sem data de autorização em MT não marca prazo vencido", () => {
  const politica = resolverPoliticaCancelamentoFiscal({
    uf: "MT",
    modelo: "65",
    status: "autorizada",
    autorizadoEm: null,
    agora: new Date("2026-08-15T23:10:00.000Z"),
  });

  assert.equal(politica.codigo, "data_autorizacao_ausente");
  assert.equal(politica.permitido, false);
  assert.doesNotMatch(politica.motivoBloqueio ?? "", /encerrado/);
});

test("no limite exato ainda permite, sem margem inventada", () => {
  const politica = resolverPoliticaCancelamentoFiscal({
    uf: "MT",
    modelo: "65",
    status: "autorizada",
    autorizadoEm: "2026-08-15T23:00:00.000Z",
    agora: new Date("2026-08-15T23:30:00.000Z"),
  });

  assert.equal(politica.permitido, true);
  assert.equal(politica.codigo, "proximo_do_fim");
});
