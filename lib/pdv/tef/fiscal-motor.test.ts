import assert from "node:assert/strict";
import test from "node:test";

import { avaliarPagamentosFiscaisTef, detalhePagamentoGeranet } from "@/lib/fiscal/tef/dados-fiscais-cartao";
import { validarPagamentosEletronicosParaEmissao } from "@/lib/fiscal/validar-pagamentos-eletronicos";

import { dadosFiscaisDoMotor, recebedorFiscal } from "./fiscal-motor";

test("dados fiscais do motor não usam rede, PAN nem comprovante", () => {
  const fiscal = dadosFiscaisDoMotor({
    autorizacao: "A1B2C3",
    bandeiraNome: "Visa Electron",
    rede: "CIELO",
    instituicao: "PRODUTO",
    cnpjCredenciadora: null,
    cnpjRecebedor: null,
    comprovante: "VIA DO CLIENTE",
  });
  assert.ok(fiscal);
  assert.equal(fiscal.autorizacao, "A1B2C3");
  assert.equal(fiscal.bandeiraNome, "Visa Electron");
  assert.equal(fiscal.cnpjCredenciadora, "01027058000191");
  assert.equal(fiscal.cnpjRecebedor, null);
  assert.equal(Object.hasOwn(fiscal, "comprovante"), false);
  assert.equal(recebedorFiscal(fiscal, "11.222.333/0001-81"), "11222333000181");

  const redeComoBandeira = dadosFiscaisDoMotor({
    autorizacao: "4111111111111111",
    bandeiraNome: "CIELO",
    rede: "CIELO",
  });
  assert.equal(redeComoBandeira?.autorizacao ?? null, null);
  assert.equal(redeComoBandeira?.bandeiraNome ?? null, null);
});

test("transação completa libera a NFC-e e transação incompleta não reserva número", () => {
  const fiscal = dadosFiscaisDoMotor({
    autorizacao: "A1B2C3",
    bandeiraNome: "Maestro",
    rede: "CIELO",
    cnpjRecebedor: "11222333000181",
  });
  assert.ok(fiscal);
  const avaliacao = avaliarPagamentosFiscaisTef({
    pagamentos: [{
      forma_pagamento_nome: "Cartão de Débito",
      codigo_fiscal: "04",
      valor: 1,
    }],
    operacoes: [{
      id: "op-1",
      modalidade: "debito",
      valorCentavos: 100,
      status: "confirmada",
      autorizacao: fiscal.autorizacao,
      bandeiraNome: fiscal.bandeiraNome,
      cnpjCredenciadora: fiscal.cnpjCredenciadora,
      cnpjRecebedor: recebedorFiscal(fiscal, null),
      instituicao: fiscal.instituicao,
      rede: fiscal.rede,
    }],
  });
  assert.equal(avaliacao.erro, null);
  assert.equal(
    validarPagamentosEletronicosParaEmissao({ modelo: "65", pagamentos: avaliacao.pagamentos }),
    null
  );
  const detalhe = detalhePagamentoGeranet(avaliacao.pagamentos[0], 1, "0");
  assert.equal(detalhe.tipoIntegracao, "1");
  assert.equal(detalhe.tipoBandeira, "02");
  assert.equal(detalhe.autorizacao, "A1B2C3");
  assert.notEqual(detalhe.cnpjCredenciadora, detalhe.cnpjReceb);

  const incompleta = avaliarPagamentosFiscaisTef({
    pagamentos: [{ forma_pagamento_nome: "Cartão de Débito", codigo_fiscal: "04", valor: 1 }],
    operacoes: [{
      id: "op-2",
      modalidade: "debito",
      valorCentavos: 100,
      status: "confirmada",
      autorizacao: null,
      bandeiraNome: null,
      cnpjCredenciadora: fiscal.cnpjCredenciadora,
      cnpjRecebedor: "11222333000181",
      instituicao: null,
      rede: "CIELO",
    }],
  });
  assert.match(incompleta.erro ?? "", /código de autorização/);
  assert.match(incompleta.erro ?? "", /bandeira do cartão/);
  assert.match(incompleta.erro ?? "", /Nenhuma nova cobrança foi feita/);
});
