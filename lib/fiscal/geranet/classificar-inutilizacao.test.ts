import assert from "node:assert/strict";
import { test } from "node:test";

import {
  anoFiscalDaEmissao,
  aplicarConsultaInutilizacao,
  classificarRespostaInutilizacao,
  logInutilizacaoCompativel,
  mensagemInutilizacao,
  montarPayloadInutilizacaoGeranet,
  motivoBloqueioInutilizacao,
  podeIniciarInutilizacao,
  reservaAposTentativaAnterior,
  resumoPayloadInutilizacao,
  validarJustificativaInutilizacao,
} from "./classificar-inutilizacao";

const emissaoBase = {
  id: "e1",
  modelo: "65",
  serie: 1,
  numero: 18,
  ambiente: 1,
  status: "aguardando_inutilizacao",
};

test("A. inutilização normal homologada vira inutilizada", () => {
  const situacao = classificarRespostaInutilizacao({
    httpOk: true,
    httpStatus: 200,
    situacao: "sucesso",
    cstat: "102",
    protocolo: "151260000000099",
    mensagem: "Inutilização de número homologado",
  });

  assert.equal(situacao, "inutilizada");
  assert.equal(
    aplicarConsultaInutilizacao({
      emissaoStatus: "aguardando_inutilizacao",
      situacao,
    }),
    "inutilizada"
  );
});

test("B. rejeição não marca inutilizada", () => {
  const situacao = classificarRespostaInutilizacao({
    httpOk: false,
    httpStatus: 422,
    situacao: "erro",
    cstat: "256",
    mensagem: "Rejeição 256: uma NF-e da faixa já está autorizada",
  });

  assert.equal(situacao, "rejeitada");
  assert.equal(
    aplicarConsultaInutilizacao({
      emissaoStatus: "aguardando_inutilizacao",
      situacao,
    }),
    "aguardando_inutilizacao"
  );
  assert.match(
    mensagemInutilizacao(situacao, "256", "faixa autorizada"),
    /Inutilização rejeitada: cStat 256/
  );
});

test("C. timeout/ambíguo não retransmite e não marca inutilizada", () => {
  const situacao = classificarRespostaInutilizacao({
    httpOk: false,
    httpStatus: 0,
    situacao: "",
    mensagem: "Timeout após iniciar transmissão à Geranet.",
  });

  assert.equal(situacao, "processando");
  assert.equal(
    aplicarConsultaInutilizacao({
      emissaoStatus: "aguardando_inutilizacao",
      situacao,
    }),
    "aguardando_inutilizacao"
  );

  const inicio = podeIniciarInutilizacao(emissaoBase, {
    status: "aguardando_reconciliacao",
  });
  assert.equal(inicio.ok, false);
  assert.match(inicio.motivo ?? "", /não reenvie automaticamente/i);
});

test("D. reconciliação do timeout com log de sucesso", () => {
  const situacao = classificarRespostaInutilizacao({
    httpOk: true,
    httpStatus: 200,
    situacao: "sucesso",
    cstat: "102",
    protocolo: "151260000000099",
    mensagem: "Inutilização de número homologado",
  });

  assert.equal(situacao, "inutilizada");
  assert.equal(
    aplicarConsultaInutilizacao({
      emissaoStatus: "aguardando_inutilizacao",
      situacao,
    }),
    "inutilizada"
  );
});

test("E. documento autorizado é bloqueado antes da Geranet", () => {
  const bloqueio = motivoBloqueioInutilizacao({
    ...emissaoBase,
    status: "autorizada",
  });

  assert.match(bloqueio ?? "", /já autorizada/);
  assert.equal(
    podeIniciarInutilizacao(
      { ...emissaoBase, status: "autorizada" },
      null
    ).ok,
    false
  );
});

test("F. aguardando_reconciliacao exige consulta antes de inutilizar", () => {
  const bloqueio = motivoBloqueioInutilizacao({
    ...emissaoBase,
    status: "aguardando_reconciliacao",
  });

  assert.match(
    bloqueio ?? "",
    /consulte a situação fiscal para confirmar que o documento não foi autorizado/i
  );
});

test("G. duplo clique: evento processando bloqueia segunda chamada", () => {
  const segunda = podeIniciarInutilizacao(emissaoBase, {
    status: "processando",
  });

  assert.equal(segunda.ok, false);
  assert.match(segunda.motivo ?? "", /não reenvie automaticamente/i);
});

test("H. após inutilizada a reserva cria nova tentativa", () => {
  assert.equal(reservaAposTentativaAnterior("inutilizada"), "criar_nova");
  assert.equal(
    reservaAposTentativaAnterior("aguardando_inutilizacao"),
    "bloquear"
  );
});

test("I. tentativa ativa continua idempotente", () => {
  assert.equal(reservaAposTentativaAnterior("reservada"), "reusar");
  assert.equal(reservaAposTentativaAnterior("rejeitada"), "reusar");
  assert.equal(reservaAposTentativaAnterior("enviando"), "reusar");
  assert.equal(reservaAposTentativaAnterior(null), "criar_nova");
});

test("payload oficial não inclui dados hardcoded e omite segredo no resumo", () => {
  const payload = montarPayloadInutilizacaoGeranet({
    cnpj: "12.345.678/0001-90",
    serie: 1,
    ano: "2025",
    numero: 18,
    justificativa: "Numeração descartada antes da autorização fiscal.",
    certificadoDigital: "ABC",
    senhaCertificadoDigital: "segredo",
    ambiente: 2,
    modelo: "65",
    ufEmitente: "mt",
  });

  assert.equal(payload.acao, "inutilizarNumeracao");
  assert.equal(payload.modeloDocumento, "nfe");
  assert.equal(payload.cnpj, "12345678000190");
  assert.equal(payload.numeroInicial, "18");
  assert.equal(payload.numeroFinal, "18");
  assert.equal(payload.ano, "2025");
  assert.equal(payload.ufEmitente, "MT");
  assert.equal(payload.ambiente, "2");

  const resumo = resumoPayloadInutilizacao(payload);
  assert.equal(
    "certificadoDigital" in resumo || "senhaCertificadoDigital" in resumo,
    false
  );
});

test("ano fiscal usa a data da reserva, não o ano corrente", () => {
  assert.equal(
    anoFiscalDaEmissao({
      reservadaAt: "2025-12-31T23:30:00.000-04:00",
      createdAt: "2026-01-01T10:00:00.000Z",
      fusoHorario: "America/Cuiaba",
    }),
    "2025"
  );
});

test("justificativa curta é rejeitada no servidor", () => {
  assert.match(
    validarJustificativaInutilizacao("curto") ?? "",
    /15 caracteres/
  );
  assert.equal(
    validarJustificativaInutilizacao(
      "Numeração descartada antes da autorização fiscal."
    ),
    null
  );
});

test("log só casa com o mesmo modelo/série/número/ano/ambiente", () => {
  const log = {
    id: 1,
    endpoint: "nfe/inutilizar-numeracao",
    criado_em: "2026-08-15T20:00:00.000Z",
    http_status: 200,
    sucesso: true,
    situacao: "sucesso",
    mensagem: "ok",
    cstat: "102",
    protocolo: "1",
    xml: null,
    modelo: "65",
    serie: "1",
    ano: "2026",
    numero_inicial: "18",
    numero_final: "18",
    ambiente: "1",
    acao: "inutilizarNumeracao",
  };

  assert.equal(
    logInutilizacaoCompativel(emissaoBase, "2026", log),
    true
  );
  assert.equal(
    logInutilizacaoCompativel(emissaoBase, "2026", {
      ...log,
      numero_inicial: "19",
    }),
    false
  );
});
