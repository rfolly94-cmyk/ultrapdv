import assert from "node:assert/strict";
import { test } from "node:test";

import { bloqueioTefHomologacaoNfceProducao } from "@/lib/fiscal/tef/ambiente-tef-nfce";

import {
  decidirRecuperacao,
  interpretarResultadoConector,
  resultadoPixPayGo,
} from "./regras";
import {
  iniciarOperacao,
  liberarConfirmacao,
  memoriaTefVazia,
  pedirDesfazimento,
  registrarResultado,
  salvarConfigEmpresa,
  vincularVenda,
  type MemoriaTef,
} from "./orquestracao";

const EMPRESA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMPRESA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DISPOSITIVO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NSU_PIX = "E1928374620261011120364LDuT35VP5";

function preparar(empresaId = EMPRESA_A): MemoriaTef {
  const memoria = memoriaTefVazia();
  memoria.plataformaHabilitada = true;
  salvarConfigEmpresa(memoria, empresaId, {
    habilitado: true,
    ambiente: "homologacao",
    estabelecimento: "LOJA",
    pontoCaptura: "117473",
  });
  return memoria;
}

function iniciar(
  memoria: MemoriaTef,
  extra: Partial<Parameters<typeof iniciarOperacao>[1]> = {}
) {
  return iniciarOperacao(memoria, {
    empresaId: extra.empresaId ?? EMPRESA_A,
    dispositivoId: extra.dispositivoId ?? DISPOSITIVO,
    terminalCodigo: extra.terminalCodigo ?? "117473",
    modalidade: "debito",
    valorCentavos: 100,
    identificador: "10fc717b-5e8b-433b-9e24-f5040c8c0076",
    idempotencyKey: "idem-pix",
    ...extra,
  });
}

const pixCompleto = {
  sucessoTransacao: true,
  nsu: NSU_PIX,
  autorizacao: "",
  rede: "PIX C6 BANK",
  finalizacao: "1",
  valor: 1,
  confirmar: true,
  precisaConfirmacao: true,
  transacaoPendenteConfirmacao: true,
  cnpjCredenciadora: "31872495000172",
  cnpjRecebedor: "42741754000142",
};

test("PIX autorizado sem PWINFO_AUTHCODE preserva o NSU e não inventa autorização", () => {
  assert.equal(resultadoPixPayGo({ rede: "PIX C6 BANK" }), true);
  assert.equal(resultadoPixPayGo({ rede: "C6 PAY" }), false);
  const memoria = preparar();
  const inicio = iniciar(memoria);
  assert.equal(inicio.ok, true);
  if (!inicio.ok) {
    return;
  }
  const registrado = registrarResultado(memoria, {
    empresaId: EMPRESA_A,
    operacaoId: inicio.operacaoId,
    provaValida: true,
    resultado: pixCompleto,
  });
  assert.equal(registrado.ok && registrado.status, "autorizada");
  assert.equal(memoria.operacoes[0]?.nsu, NSU_PIX);
  assert.equal(memoria.operacoes[0]?.autorizacao, null);
  assert.equal(memoria.operacoes[0]?.rede, "PIX C6 BANK");
  assert.equal(memoria.operacoes[0]?.finalizacao, "1");
  assert.equal(memoria.operacoes[0]?.cnpjCredenciadora, "31872495000172");
});

test("cartão sem código de autorização não é aceito e guarda os identificadores", () => {
  const interpretado = interpretarResultadoConector(
    {
      sucessoTransacao: true,
      nsu: "862914",
      autorizacao: "",
      rede: "C6 PAY",
      finalizacao: "3",
      valor: 1,
      confirmar: true,
    },
    { valorCentavos: 100, identificador: "op-cartao" },
    true
  );
  assert.equal(interpretado.status, "desconhecida");
  assert.equal(interpretado.autorizacao, null);
  assert.equal(interpretado.nsu, "862914");
  const memoria = preparar();
  const inicio = iniciar(memoria, { idempotencyKey: "idem-cartao", identificador: "op-cartao" });
  assert.equal(inicio.ok, true);
  if (!inicio.ok) {
    return;
  }
  registrarResultado(memoria, {
    empresaId: EMPRESA_A,
    operacaoId: inicio.operacaoId,
    provaValida: true,
    resultado: {
      sucessoTransacao: true,
      nsu: "862914",
      rede: "C6 PAY",
      finalizacao: "3",
      valor: 1,
      confirmar: true,
    },
  });
  const operacao = memoria.operacoes[0];
  assert.equal(operacao?.status, "desconhecida");
  assert.equal(operacao?.nsu, "862914");
  assert.equal(operacao?.rede, "C6 PAY");
  assert.equal(operacao?.finalizacao, "3");
  const desfazer = pedirDesfazimento(memoria, {
    empresaId: EMPRESA_A,
    operacaoId: inicio.operacaoId,
  });
  assert.equal(desfazer.ok && desfazer.executar, "desfazer");
  if (desfazer.ok && desfazer.executar === "desfazer") {
    assert.equal(desfazer.nsu, "862914");
    assert.equal(desfazer.autorizacao, null);
  }
});

test("PIX com NSU e finalização válidos só confirma depois da venda", () => {
  const memoria = preparar();
  const inicio = iniciar(memoria);
  assert.equal(inicio.ok, true);
  if (!inicio.ok) {
    return;
  }
  registrarResultado(memoria, {
    empresaId: EMPRESA_A,
    operacaoId: inicio.operacaoId,
    provaValida: true,
    resultado: pixCompleto,
  });
  assert.equal(
    liberarConfirmacao(memoria, {
      empresaId: EMPRESA_A,
      operacaoId: inicio.operacaoId,
      vendaId: "venda-pix",
    }).ok,
    false
  );
  const semVenda = pedirDesfazimento(memoria, {
    empresaId: EMPRESA_A,
    operacaoId: inicio.operacaoId,
  });
  assert.equal(semVenda.ok && semVenda.executar, "desfazer");
  memoria.operacoes[0]!.status = "autorizada";
  memoria.vendas.push({
    id: "venda-pix",
    empresaId: EMPRESA_A,
    idempotencyKey: "idem-venda",
  });
  assert.equal(
    vincularVenda(memoria, {
      empresaId: EMPRESA_A,
      operacaoId: inicio.operacaoId,
      vendaId: "venda-pix",
    }).ok,
    true
  );
  const liberada = liberarConfirmacao(memoria, {
    empresaId: EMPRESA_A,
    operacaoId: inicio.operacaoId,
    vendaId: "venda-pix",
  });
  assert.equal(liberada.ok, true);
  if (liberada.ok) {
    assert.equal(liberada.nsu, NSU_PIX);
    assert.equal(liberada.finalizacao, "1");
    assert.equal(liberada.autorizacao, null);
  }
});

test("PIX sem identificadores suficientes fica desconhecido e não é desfeito às cegas", () => {
  const memoria = preparar();
  const inicio = iniciar(memoria, { idempotencyKey: "idem-incompleto" });
  assert.equal(inicio.ok, true);
  if (!inicio.ok) {
    return;
  }
  registrarResultado(memoria, {
    empresaId: EMPRESA_A,
    operacaoId: inicio.operacaoId,
    provaValida: true,
    resultado: {
      sucessoTransacao: true,
      rede: "PIX C6 BANK",
      nsu: NSU_PIX,
      valor: 1,
      confirmar: true,
    },
  });
  const operacao = memoria.operacoes[0];
  assert.equal(operacao?.status, "desconhecida");
  assert.equal(operacao?.nsu, NSU_PIX);
  assert.equal(operacao?.finalizacao, null);
  const recuperacao = decidirRecuperacao({
    empresaId: EMPRESA_A,
    operacao: structuredClone(operacao) ?? null,
    existeVenda: false,
  });
  assert.equal(recuperacao.acao, "reconciliar");
  assert.equal(recuperacao.confirmar, false);
  const pedido = pedirDesfazimento(structuredClone(memoria), {
    empresaId: EMPRESA_A,
    operacaoId: inicio.operacaoId,
  });
  assert.equal(pedido.ok, true);
  if (pedido.ok) {
    assert.equal(pedido.executar, "nenhum");
  }
});

test("pendência bloqueia outra cobrança no terminal e não atravessa empresa", () => {
  const memoria = preparar();
  salvarConfigEmpresa(memoria, EMPRESA_B, {
    habilitado: true,
    ambiente: "homologacao",
    estabelecimento: "OUTRA",
    pontoCaptura: "200",
  });
  const inicio = iniciar(memoria);
  assert.equal(inicio.ok, true);
  if (!inicio.ok) {
    return;
  }
  registrarResultado(memoria, {
    empresaId: EMPRESA_A,
    operacaoId: inicio.operacaoId,
    provaValida: true,
    resultado: { sucessoTransacao: true, rede: "PIX C6 BANK", valor: 1 },
  });
  const repetida = iniciar(memoria, { idempotencyKey: "idem-nova", identificador: "outra" });
  assert.equal(repetida.ok, false);
  if (!repetida.ok) {
    assert.equal(repetida.codigo, "TERMINAL_OCUPADO");
  }
  const outraEmpresa = iniciar(memoria, {
    empresaId: EMPRESA_B,
    dispositivoId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    terminalCodigo: "200",
    idempotencyKey: "idem-b",
    identificador: "op-b",
  });
  assert.equal(outraEmpresa.ok, true);
  const cruzado = pedirDesfazimento(memoria, {
    empresaId: EMPRESA_B,
    operacaoId: inicio.operacaoId,
  });
  assert.equal(cruzado.ok, false);
});

test("recuperação após reinício usa os identificadores originais e não confirma sem venda", () => {
  const memoria = preparar();
  const inicio = iniciar(memoria);
  assert.equal(inicio.ok, true);
  if (!inicio.ok) {
    return;
  }
  registrarResultado(memoria, {
    empresaId: EMPRESA_A,
    operacaoId: inicio.operacaoId,
    provaValida: true,
    resultado: pixCompleto,
  });
  const reidratada = structuredClone(memoria);
  const recuperacao = decidirRecuperacao({
    empresaId: EMPRESA_A,
    operacao: reidratada.operacoes[0] ?? null,
    existeVenda: false,
  });
  assert.equal(recuperacao.acao, "desfazer");
  assert.equal(recuperacao.confirmar, false);
  const desfazer = pedirDesfazimento(reidratada, {
    empresaId: EMPRESA_A,
    operacaoId: inicio.operacaoId,
  });
  assert.equal(desfazer.ok && desfazer.executar, "desfazer");
  if (desfazer.ok && desfazer.executar === "desfazer") {
    assert.equal(desfazer.rede, "PIX C6 BANK");
    assert.equal(desfazer.nsu, NSU_PIX);
    assert.equal(desfazer.finalizacao, "1");
  }
});

test("TEF de homologação não financia NFC-e de produção", () => {
  assert.equal(
    bloqueioTefHomologacaoNfceProducao({
      ambienteFiscal: 1,
      ambienteTef: "homologacao",
      possuiTransacaoTef: true,
    }),
    "O TEF está em homologação e não pode financiar uma NFC-e de produção."
  );
  assert.equal(
    bloqueioTefHomologacaoNfceProducao({
      ambienteFiscal: 1,
      ambienteTef: "producao",
      possuiTransacaoTef: true,
    }),
    null
  );
  assert.equal(
    bloqueioTefHomologacaoNfceProducao({
      ambienteFiscal: 2,
      ambienteTef: "homologacao",
      possuiTransacaoTef: true,
    }),
    null
  );
  assert.equal(
    bloqueioTefHomologacaoNfceProducao({
      ambienteFiscal: 1,
      ambienteTef: "homologacao",
      possuiTransacaoTef: false,
    }),
    null
  );
});
