import assert from "node:assert/strict";
import { test } from "node:test";

import {
  POLITICA_PIX_ESTATICO_TPAG_20,
  pagamentoEletronicoTemDadosReais,
  validarPagamentosEletronicosParaEmissao,
} from "./validar-pagamentos-eletronicos";

function pagamento(parcial: {
  codigo_fiscal: string;
  valor: number;
  forma_pagamento_nome?: string;
  bandeira?: string | null;
  autorizacao?: string | null;
  tipo_integracao?: string | null;
  cnpj_credenciadora?: string | null;
  cnpj_receb?: string | null;
}) {
  return {
    forma_pagamento_nome: parcial.forma_pagamento_nome ?? null,
    codigo_fiscal: parcial.codigo_fiscal,
    valor: parcial.valor,
    bandeira: parcial.bandeira ?? null,
    autorizacao: parcial.autorizacao ?? null,
    tipo_integracao: parcial.tipo_integracao ?? null,
    cnpj_credenciadora: parcial.cnpj_credenciadora ?? null,
    cnpj_receb: parcial.cnpj_receb ?? null,
  };
}

test("1. venda R$20 paga R$20 dinheiro passa prontidão", () => {
  const erro = validarPagamentosEletronicosParaEmissao({
    modelo: "65",
    pagamentos: [
      pagamento({
        codigo_fiscal: "01",
        valor: 20,
        forma_pagamento_nome: "Dinheiro",
      }),
    ],
  });

  assert.equal(erro, null);
});

test("2. dinheiro 10 + débito 10 sem integração bloqueia antes de reservar", () => {
  const erro = validarPagamentosEletronicosParaEmissao({
    modelo: "65",
    pagamentos: [
      pagamento({
        codigo_fiscal: "01",
        valor: 10,
        forma_pagamento_nome: "Dinheiro",
      }),
      pagamento({
        codigo_fiscal: "04",
        valor: 10,
        forma_pagamento_nome: "Cartão de Débito",
      }),
    ],
  });

  assert.ok(erro);
  assert.match(erro, /Pagamento eletrônico sem integração fiscal/);
  assert.match(erro, /Cartão de Débito/);
  assert.match(erro, /NFC-e/);
  assert.match(erro, /Nenhum número fiscal foi reservado/);
  assert.match(erro, /Cartão de Débito — R\$\s*10,00/);
});

test("3. cartão crédito sem dados bloqueia", () => {
  const erro = validarPagamentosEletronicosParaEmissao({
    modelo: "55",
    pagamentos: [
      pagamento({
        codigo_fiscal: "03",
        valor: 20,
        forma_pagamento_nome: "Cartão de Crédito",
      }),
    ],
  });

  assert.ok(erro);
  assert.match(erro, /Cartão de Crédito/);
  assert.match(erro, /NF-e/);
});

test("4. PIX dinâmico sem dados bloqueia", () => {
  const erro = validarPagamentosEletronicosParaEmissao({
    modelo: "65",
    pagamentos: [
      pagamento({
        codigo_fiscal: "17",
        valor: 20,
        forma_pagamento_nome: "PIX Dinâmico",
      }),
    ],
  });

  assert.ok(erro);
  assert.match(erro, /PIX Dinâmico/);
});

test("PIX estático tPag 20 não herda a regra do 17", () => {
  assert.equal(POLITICA_PIX_ESTATICO_TPAG_20, "nao_exigir_vinculacao_ainda");

  const erro = validarPagamentosEletronicosParaEmissao({
    modelo: "65",
    pagamentos: [
      pagamento({
        codigo_fiscal: "20",
        valor: 20,
        forma_pagamento_nome: "PIX Estático",
      }),
    ],
  });

  assert.equal(erro, null);
});

test("bandeira e autorização sozinhas não bastam", () => {
  assert.equal(
    pagamentoEletronicoTemDadosReais({
      codigo_fiscal: "04",
      bandeira: "Visa",
      autorizacao: "123456",
    }),
    false
  );

  const erro = validarPagamentosEletronicosParaEmissao({
    modelo: "65",
    pagamentos: [
      pagamento({
        codigo_fiscal: "04",
        valor: 2,
        forma_pagamento_nome: "Cartão de Débito",
        bandeira: "Visa",
        autorizacao: "123456",
      }),
    ],
  });

  assert.ok(erro);
});

test("só passa se a transação real integrada estiver completa", () => {
  const erro = validarPagamentosEletronicosParaEmissao({
    modelo: "65",
    pagamentos: [
      pagamento({
        codigo_fiscal: "04",
        valor: 2,
        forma_pagamento_nome: "Cartão de Débito",
        tipo_integracao: "1",
        cnpj_credenciadora: "12345678000199",
        bandeira: "Visa",
        autorizacao: "NSU999",
        cnpj_receb: "42741754000142",
      }),
    ],
  });

  assert.equal(erro, null);
});
