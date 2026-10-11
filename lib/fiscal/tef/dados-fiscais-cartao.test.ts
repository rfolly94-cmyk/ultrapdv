import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

import { assinarProvaTef, dadosFiscaisProvaTef, verificarProvaTef } from "@/lib/pdv/tef/prova";
import { registrarResultado, memoriaTefVazia, type OperacaoTef } from "@/lib/pdv/tef/orquestracao";
import { pagamentoEletronicoTemDadosReais, pagamentoPixTefComprovado, validarPagamentosEletronicosParaEmissao } from "@/lib/fiscal/validar-pagamentos-eletronicos";
import {
  bloqueioTefHomologacaoNfceProducao,
  normalizarConsultaAmbienteTef,
} from "@/lib/fiscal/tef/ambiente-tef-nfce";

import {
  avaliarPagamentosFiscaisTef,
  codigoBandeiraFiscal,
  detalhePagamentoGeranet,
  type OperacaoFiscalCartao,
} from "./dados-fiscais-cartao";

const CREDENCIADORA = "01027058000191";
const RECEBEDOR = "42741754000142";

function operacao(parcial: Partial<OperacaoFiscalCartao> = {}): OperacaoFiscalCartao {
  return {
    id: "op-1",
    modalidade: "debito",
    valorCentavos: 100,
    status: "vinculada",
    autorizacao: "A1B2C3",
    bandeiraNome: "Elo Débito",
    cnpjCredenciadora: CREDENCIADORA,
    cnpjRecebedor: RECEBEDOR,
    instituicao: "ELO",
    ...parcial,
  };
}

function pagamento(parcial: {
  codigo_fiscal: string;
  valor: number;
  nome?: string;
  autorizacao?: string;
}) {
  return {
    forma_pagamento_nome: parcial.nome ?? "Cartão",
    codigo_fiscal: parcial.codigo_fiscal,
    valor: parcial.valor,
    autorizacao: parcial.autorizacao ?? null,
  };
}

test("dados completos de débito Elo e crédito Visa viram o grupo card da NFC-e", () => {
  assert.equal(codigoBandeiraFiscal("Elo Débito"), "06");
  assert.equal(codigoBandeiraFiscal("Mastercard"), "02");
  const avaliacao = avaliarPagamentosFiscaisTef({
    pagamentos: [
      pagamento({ codigo_fiscal: "01", valor: 5, nome: "Dinheiro" }),
      pagamento({ codigo_fiscal: "04", valor: 1, nome: "Cartão de Débito" }),
      pagamento({
        codigo_fiscal: "03",
        valor: 2,
        nome: "Cartão de Crédito",
        autorizacao: "VISA01",
      }),
    ],
    operacoes: [
      operacao(),
      operacao({
        id: "op-2",
        modalidade: "credito",
        valorCentavos: 200,
        autorizacao: "VISA01",
        bandeiraNome: "Visa",
        instituicao: "VISA",
      }),
    ],
  });
  assert.equal(avaliacao.erro, null);
  const debito = avaliacao.pagamentos[1];
  const credito = avaliacao.pagamentos[2];
  assert.equal(pagamentoEletronicoTemDadosReais(debito), true);
  assert.equal(credito.bandeira, "01");
  assert.equal(credito.cnpj_credenciadora, CREDENCIADORA);
  assert.equal(credito.cnpj_receb, RECEBEDOR);
  assert.notEqual(credito.cnpj_credenciadora, credito.cnpj_receb);
  const detalhe = detalhePagamentoGeranet(credito, 2, "0");
  assert.equal(detalhe.tipoBandeira, "01");
  assert.equal(detalhe.tipoIntegracao, "1");
  assert.equal(detalhe.cnpjCredenciadora, CREDENCIADORA);
  assert.equal(detalhe.cnpjReceb, RECEBEDOR);
  assert.equal(detalhe.autorizacao, "VISA01");
});

test("bandeira, credenciadora ou autorização ausentes bloqueiam sem completar", () => {
  const semBandeira = avaliarPagamentosFiscaisTef({
    pagamentos: [pagamento({ codigo_fiscal: "04", valor: 1, nome: "Cartão de Débito" })],
    operacoes: [operacao({ bandeiraNome: "CIELO" })],
  });
  assert.match(semBandeira.erro ?? "", /bandeira do cartão/);
  assert.match(semBandeira.erro ?? "", /Nenhuma nova cobrança foi feita/);
  assert.equal(codigoBandeiraFiscal("CIELO"), null);
  assert.equal(codigoBandeiraFiscal("Rede"), null);

  const semCnpj = avaliarPagamentosFiscaisTef({
    pagamentos: [pagamento({ codigo_fiscal: "04", valor: 1, nome: "Cartão de Débito" })],
    operacoes: [operacao({ cnpjCredenciadora: "" })],
  });
  assert.match(semCnpj.erro ?? "", /CNPJ da credenciadora/);

  const semAutorizacao = avaliarPagamentosFiscaisTef({
    pagamentos: [pagamento({ codigo_fiscal: "04", valor: 1, nome: "Cartão de Débito" })],
    operacoes: [operacao({ autorizacao: "" })],
  });
  assert.match(semAutorizacao.erro ?? "", /código de autorização/);
  assert.equal(semAutorizacao.pagamentos[0].autorizacao ?? null, null);
});

test("dois cartões do mesmo valor não trocam bandeira nem autorização", () => {
  const avaliacao = avaliarPagamentosFiscaisTef({
    pagamentos: [
      pagamento({
        codigo_fiscal: "04",
        valor: 1,
        nome: "Cartão de Débito",
        autorizacao: "ELO1",
      }),
      pagamento({
        codigo_fiscal: "04",
        valor: 1,
        nome: "Cartão de Débito",
        autorizacao: "VISA1",
      }),
    ],
    operacoes: [
      operacao({ id: "elo", autorizacao: "ELO1", bandeiraNome: "Elo" }),
      operacao({ id: "visa", autorizacao: "VISA1", bandeiraNome: "Visa" }),
    ],
  });
  assert.equal(avaliacao.erro, null);
  assert.equal(avaliacao.pagamentos[0].bandeira, "06");
  assert.equal(avaliacao.pagamentos[0].autorizacao, "ELO1");
  assert.equal(avaliacao.pagamentos[1].bandeira, "01");
  assert.equal(avaliacao.pagamentos[1].autorizacao, "VISA1");
});

test("cartões iguais sem autorização distinta não são associados por tentativa", () => {
  const avaliacao = avaliarPagamentosFiscaisTef({
    pagamentos: [
      pagamento({ codigo_fiscal: "04", valor: 1, nome: "Cartão de Débito" }),
      pagamento({ codigo_fiscal: "04", valor: 1, nome: "Cartão de Débito" }),
    ],
    operacoes: [
      operacao({ id: "a", autorizacao: "ELO1", bandeiraNome: "Elo" }),
      operacao({ id: "b", autorizacao: "VISA1", bandeiraNome: "Visa" }),
    ],
  });
  assert.match(avaliacao.erro ?? "", /não ficou vinculado a uma única transação TEF/);
});

test("a rede PayGo não vira bandeira e o NSU não vira autorização", () => {
  const fiscais = dadosFiscaisProvaTef({
    rede: "CIELO",
    bandeira: "CIELO",
    nomeCartao: "",
    nomeBandeiraPadrao: "",
    cnpjCredenciadora: "01.027.058/0001-91",
    cnpjRecebedor: "42.741.754/0001-42",
    instituicao: "CREDITO A VISTA",
  });
  assert.equal(fiscais.bandeira, "");
  assert.equal(fiscais.cnpjCredenciadora, CREDENCIADORA);
  assert.equal(fiscais.cnpjRecebedor, RECEBEDOR);
  assert.equal(codigoBandeiraFiscal(fiscais.bandeira), null);

  const comBandeira = dadosFiscaisProvaTef({
    rede: "CIELO",
    bandeira: "CIELO",
    nomeBandeiraPadrao: "Mastercard",
    nomeCartao: "MAESTRO",
  });
  assert.equal(comBandeira.bandeira, "Mastercard");
  assert.equal(codigoBandeiraFiscal(comBandeira.bandeira), "02");
  assert.equal(codigoBandeiraFiscal("CIELO"), null);
  assert.equal(codigoBandeiraFiscal("C6 PAY"), null);
  assert.equal(codigoBandeiraFiscal("HIPERCARD"), "07");
  assert.equal(codigoBandeiraFiscal("HIPER"), "17");
});

test("C6 PAY com Mastercard Débito usa o CNPJ da tabela ACBr e não o do estabelecimento", () => {
  assert.equal(codigoBandeiraFiscal("MASTERCARD DEBITO"), "02");
  const avaliacao = avaliarPagamentosFiscaisTef({
    pagamentos: [pagamento({ codigo_fiscal: "04", valor: 1, nome: "Cartão de Débito" })],
    operacoes: [
      operacao({
        status: "confirmada",
        autorizacao: "369404",
        bandeiraNome: "MASTERCARD DEBITO",
        cnpjCredenciadora: null,
        cnpjRecebedor: RECEBEDOR,
        instituicao: "DEBITO A VISTA",
        rede: "C6 PAY",
      }),
    ],
  });
  assert.equal(avaliacao.erro, null);
  assert.equal(avaliacao.pagamentos[0].cnpj_credenciadora, "31872495000172");
  assert.equal(avaliacao.pagamentos[0].cnpj_receb, RECEBEDOR);
  assert.equal(avaliacao.pagamentos[0].bandeira, "02");
  assert.equal(avaliacao.pagamentos[0].autorizacao, "369404");

  const semTabela = avaliarPagamentosFiscaisTef({
    pagamentos: [pagamento({ codigo_fiscal: "04", valor: 1, nome: "Cartão de Débito" })],
    operacoes: [
      operacao({
        bandeiraNome: "MASTERCARD DEBITO",
        cnpjCredenciadora: null,
        rede: "REDE DESCONHECIDA",
      }),
    ],
  });
  assert.match(semTabela.erro ?? "", /CNPJ da credenciadora/);
  assert.doesNotMatch(semTabela.erro ?? "", /bandeira do cartão/);
});

test("prova trocada na recuperação não grava os dados fiscais", () => {
  const chave = generateKeyPairSync("ed25519");
  const publica = chave.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privada = chave.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const memoria = memoriaTefVazia();
  const operacaoMemoria: OperacaoTef = {
    id: "op-1",
    empresaId: "empresa",
    terminalId: "terminal",
    identificador: "id-1",
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    modalidade: "debito",
    valorCentavos: 100,
    status: "iniciada",
    nsu: null,
    autorizacao: null,
    rede: null,
    finalizacao: null,
    vendaId: null,
    teste: false,
    desafio: "a".repeat(64),
    usuarioId: "usuario",
    segredoVinculoHash: "hash",
    vendaIdempotencyKey: "",
  };
  memoria.operacoes.push(operacaoMemoria);
  const campos = {
    acao: "pagamento" as const,
    desafio: operacaoMemoria.desafio,
    identificador: operacaoMemoria.identificador,
    valorCentavos: 100,
    nsu: "998877",
    autorizacao: "A1B2C3",
    rede: "CIELO",
    finalizacao: "FIN01",
    sucesso: true,
    codigo: "",
    bandeira: "Elo",
    cnpjCredenciadora: CREDENCIADORA,
    cnpjRecebedor: RECEBEDOR,
    instituicao: "ELO",
  };
  const prova = assinarProvaTef(privada, campos);
  assert.equal(verificarProvaTef(publica, campos, prova), true);
  assert.equal(
    verificarProvaTef(publica, { ...campos, cnpjCredenciadora: "00000000000000" }, prova),
    false
  );

  const aceito = registrarResultado(memoria, {
    empresaId: "empresa",
    operacaoId: "op-1",
    resultado: {
      sucessoTransacao: true,
      nsu: "998877",
      autorizacao: "A1B2C3",
      rede: "CIELO",
      finalizacao: "FIN01",
      confirmar: true,
      precisaConfirmacao: true,
      transacaoPendenteConfirmacao: true,
      valor: 1,
      nomeBandeiraPadrao: "Elo",
      cnpjCredenciadora: CREDENCIADORA,
      cnpjRecebedor: RECEBEDOR,
      instituicao: "ELO",
    },
    provaValida: true,
  });
  assert.equal(aceito.ok, true);
  assert.equal(operacaoMemoria.status, "autorizada");
  assert.equal(operacaoMemoria.bandeiraNome, "Elo");
  assert.equal(operacaoMemoria.cnpjCredenciadora, CREDENCIADORA);
  assert.equal(operacaoMemoria.cnpjRecebedor, RECEBEDOR);
  assert.equal(operacaoMemoria.autorizacao, "A1B2C3");
  assert.notEqual(operacaoMemoria.autorizacao, operacaoMemoria.nsu);
  operacaoMemoria.status = "iniciada";
  operacaoMemoria.bandeiraNome = null;
  operacaoMemoria.cnpjCredenciadora = null;
  operacaoMemoria.cnpjRecebedor = null;
  operacaoMemoria.autorizacao = null;
  operacaoMemoria.nsu = null;

  const recusado = registrarResultado(memoria, {
    empresaId: "empresa",
    operacaoId: "op-1",
    resultado: {
      sucessoTransacao: true,
      nsu: "998877",
      autorizacao: "A1B2C3",
      rede: "CIELO",
      finalizacao: "FIN01",
      confirmar: true,
      precisaConfirmacao: true,
      transacaoPendenteConfirmacao: true,
      valor: 1,
      nomeBandeiraPadrao: "Elo",
      cnpjCredenciadora: "00000000000000",
      cnpjRecebedor: RECEBEDOR,
    },
    provaValida: false,
  });
  assert.equal(recusado.ok, true);
  if (recusado.ok) {
    assert.equal(operacaoMemoria.status, "desconhecida");
    assert.equal(operacaoMemoria.bandeiraNome ?? null, null);
    assert.equal(operacaoMemoria.cnpjCredenciadora ?? null, null);
  }
});

test("resposta sem CNPJ da credenciadora completa C6 PAY pela tabela e preserva a prova vazia", () => {
  const memoria = memoriaTefVazia();
  const operacaoMemoria: OperacaoTef = {
    id: "op-c6",
    empresaId: "empresa",
    terminalId: "terminal",
    identificador: "id-c6",
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
    modalidade: "debito",
    valorCentavos: 100,
    status: "iniciada",
    nsu: null,
    autorizacao: null,
    rede: null,
    finalizacao: null,
    vendaId: null,
    teste: false,
    desafio: "b".repeat(64),
    usuarioId: "usuario",
    segredoVinculoHash: "hash",
    vendaIdempotencyKey: "",
  };
  memoria.operacoes.push(operacaoMemoria);
  const campos = {
    acao: "pagamento" as const,
    desafio: operacaoMemoria.desafio,
    identificador: operacaoMemoria.identificador,
    valorCentavos: 100,
    nsu: "862914",
    autorizacao: "369404",
    rede: "C6 PAY",
    finalizacao: "3",
    sucesso: true,
    codigo: "",
    bandeira: "MASTERCARD DEBITO",
    cnpjCredenciadora: "",
    cnpjRecebedor: RECEBEDOR,
    instituicao: "DEBITO A VISTA",
  };
  const chave = generateKeyPairSync("ed25519");
  const prova = assinarProvaTef(
    chave.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    campos
  );
  assert.equal(
    verificarProvaTef(
      chave.publicKey.export({ type: "spki", format: "pem" }).toString(),
      campos,
      prova
    ),
    true
  );
  const aceito = registrarResultado(memoria, {
    empresaId: "empresa",
    operacaoId: "op-c6",
    resultado: {
      sucessoTransacao: true,
      nsu: "862914",
      autorizacao: "369404",
      rede: "C6 PAY",
      finalizacao: "3",
      confirmar: true,
      precisaConfirmacao: true,
      transacaoPendenteConfirmacao: true,
      valor: 1,
      nomeBandeiraPadrao: "MASTERCARD DEBITO",
      cnpjCredenciadora: "",
      cnpjRecebedor: RECEBEDOR,
      instituicao: "DEBITO A VISTA",
    },
    provaValida: true,
  });
  assert.equal(aceito.ok, true);
  assert.equal(operacaoMemoria.cnpjCredenciadora, "31872495000172");
  assert.notEqual(operacaoMemoria.cnpjCredenciadora, RECEBEDOR);
  assert.equal(operacaoMemoria.cnpjRecebedor, RECEBEDOR);
  assert.equal(operacaoMemoria.bandeiraNome, "MASTERCARD DEBITO");
});

test("dinheiro e PIX não recebem grupo de cartão", () => {
  const dinheiro = detalhePagamentoGeranet(
    { codigo_fiscal: "01", tipo_integracao: "1", bandeira: "01", autorizacao: "X" },
    10,
    "0"
  );
  assert.equal(dinheiro.tipoIntegracao, undefined);
  assert.equal(dinheiro.cnpjCredenciadora, undefined);
});

test("PIX C6 na forma débito vira tPag 17 sem grupo de cartão", () => {
  const avaliacao = avaliarPagamentosFiscaisTef({
    pagamentos: [
      pagamento({ codigo_fiscal: "01", valor: 5, nome: "Dinheiro" }),
      pagamento({ codigo_fiscal: "04", valor: 1, nome: "Cartão de Débito" }),
      pagamento({
        codigo_fiscal: "03",
        valor: 2,
        nome: "Cartão de Crédito",
        autorizacao: "VISA01",
      }),
    ],
    operacoes: [
      operacao({
        id: "op-pix",
        autorizacao: null,
        bandeiraNome: null,
        cnpjCredenciadora: null,
        instituicao: null,
        rede: "PIX C6 BANK",
        nsu: "E1928374620261011120364LDuT35VP5",
      }),
      operacao({
        id: "op-credito",
        modalidade: "credito",
        valorCentavos: 200,
        autorizacao: "VISA01",
        bandeiraNome: "Visa",
        instituicao: "VISA",
        rede: "VISA",
        nsu: "862914",
      }),
    ],
  });
  assert.equal(avaliacao.erro, null);
  const pix = avaliacao.pagamentos[1];
  const credito = avaliacao.pagamentos[2];
  assert.equal(pix.codigo_fiscal, "17");
  assert.equal(pix.pix_tef_comprovado, true);
  assert.equal(pix.nsu, "E1928374620261011120364LDuT35VP5");
  assert.equal(pix.bandeira ?? null, null);
  assert.equal(pix.autorizacao ?? null, null);
  assert.equal(pix.cnpj_credenciadora ?? null, null);
  assert.equal(pagamentoPixTefComprovado(pix), true);
  assert.equal(
    validarPagamentosEletronicosParaEmissao({ modelo: "65", pagamentos: [pix] }),
    null
  );
  const detalhePix = detalhePagamentoGeranet(pix, 1, "0");
  assert.equal(detalhePix.tipo, "17");
  assert.equal(detalhePix.tipoBandeira, undefined);
  assert.equal(detalhePix.autorizacao, undefined);
  assert.equal(detalhePix.cnpjCredenciadora, undefined);
  assert.equal(detalhePix.tipoIntegracao, undefined);
  assert.equal(credito.codigo_fiscal, "03");
  assert.equal(credito.autorizacao, "VISA01");
  assert.equal(credito.bandeira, "01");
  const detalheCredito = detalhePagamentoGeranet(credito, 2, "0");
  assert.equal(detalheCredito.tipo, "03");
  assert.equal(detalheCredito.autorizacao, "VISA01");
});

test("débito real continua no grupo card e PIX sem NSU não vira cartão", () => {
  const debito = avaliarPagamentosFiscaisTef({
    pagamentos: [pagamento({ codigo_fiscal: "04", valor: 1, nome: "Cartão de Débito" })],
    operacoes: [operacao({ rede: "MASTERCARD DEBITO", nsu: "766596" })],
  });
  assert.equal(debito.erro, null);
  assert.equal(debito.pagamentos[0].codigo_fiscal, "04");
  assert.equal(debito.pagamentos[0].autorizacao, "A1B2C3");

  const semNsu = avaliarPagamentosFiscaisTef({
    pagamentos: [pagamento({ codigo_fiscal: "04", valor: 1, nome: "Cartão de Débito" })],
    operacoes: [
      operacao({
        autorizacao: null,
        bandeiraNome: null,
        cnpjCredenciadora: null,
        rede: "PIX C6 BANK",
        nsu: "",
      }),
    ],
  });
  assert.match(semNsu.erro ?? "", /NSU do PIX/);
  assert.equal(semNsu.pagamentos[0].codigo_fiscal, "04");
  assert.equal(semNsu.pagamentos[0].pix_tef_comprovado ?? false, false);
});

test("venda persistida com TEF de homologação não financia NFC-e de produção", () => {
  assert.ok(
    bloqueioTefHomologacaoNfceProducao({
      ambienteFiscal: 1,
      ambienteTef: "homologacao",
      possuiTransacaoTef: true,
    })
  );
  const falha = normalizarConsultaAmbienteTef({
    erro: true,
    quantidade: 0,
    ambienteTef: "producao",
  });
  assert.equal(falha.consultaInconclusiva, true);
  assert.equal(
    bloqueioTefHomologacaoNfceProducao({
      ambienteFiscal: 1,
      ambienteTef: falha.ambienteTef,
      possuiTransacaoTef: falha.quantidade > 0,
      consultaInconclusiva: falha.consultaInconclusiva,
    }),
    "Não foi possível confirmar o ambiente do TEF. A NFC-e de produção não foi emitida."
  );
});
