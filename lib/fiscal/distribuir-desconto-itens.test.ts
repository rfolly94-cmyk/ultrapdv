import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DistribuicaoDescontoFiscalError,
  conferirSomaItensFiscaisComVenda,
  distribuirDescontoItens,
  mapaDescontoFiscalPorItem,
  paraCentavos,
  valorTotalItemGeranetEmCentavos,
  valorTotalNotaGeranet,
} from "./distribuir-desconto-itens";

function item(
  id: string,
  valor: number,
  desconto = 0,
  quantidade = 1
) {
  return {
    id,
    quantidade,
    valorUnitario: valor,
    desconto,
  };
}

function totaisFiscais(
  itens: ReturnType<typeof distribuirDescontoItens>["itens"],
  origem: Array<ReturnType<typeof item>>
) {
  return origem.map((comercial, indice) => {
    const fiscal = itens[indice];

    return {
      quantidade: String(comercial.quantidade),
      valorUnitario: comercial.valorUnitario.toFixed(8),
      desconto: fiscal.descontoFiscal.toFixed(8),
      frete: "0.00000000",
      seguro: "0.00000000",
      outro: "0.00000000",
      valorTotal: (
        paraCentavos(
          comercial.quantidade * comercial.valorUnitario
        ) / 100
      ).toFixed(2),
    };
  });
}

test("1. um item R$100 sem desconto → total 100", () => {
  const origem = [item("a", 100)];
  const resultado = distribuirDescontoItens({
    descontoVenda: 0,
    itens: origem,
  });

  assert.equal(resultado.descontoGeral, 0);
  assert.equal(resultado.itens[0].descontoFiscal, 0);
  assert.equal(
    conferirSomaItensFiscaisComVenda({
      itensFiscais: totaisFiscais(resultado.itens, origem),
      valorTotalVenda: 100,
    }),
    null
  );
});

test("2. um item R$100 + desconto geral R$10 → desconto 10 e total 90", () => {
  const origem = [item("a", 100)];
  const resultado = distribuirDescontoItens({
    descontoVenda: 10,
    itens: origem,
  });

  assert.equal(resultado.itens[0].descontoItem, 0);
  assert.equal(resultado.itens[0].descontoGeralRateado, 10);
  assert.equal(resultado.itens[0].descontoFiscal, 10);
  assert.equal(
    conferirSomaItensFiscaisComVenda({
      itensFiscais: totaisFiscais(resultado.itens, origem),
      valorTotalVenda: 90,
    }),
    null
  );
});

test("3. dois itens 100 + 50, desconto geral 15 → 10 + 5 e total 135", () => {
  const origem = [item("a", 100), item("b", 50)];
  const resultado = distribuirDescontoItens({
    descontoVenda: 15,
    itens: origem,
  });

  assert.equal(resultado.itens[0].descontoFiscal, 10);
  assert.equal(resultado.itens[1].descontoFiscal, 5);
  assert.equal(
    resultado.itens.reduce(
      (total, atual) => total + paraCentavos(atual.descontoFiscal),
      0
    ),
    1500
  );
  assert.equal(
    conferirSomaItensFiscaisComVenda({
      itensFiscais: totaisFiscais(resultado.itens, origem),
      valorTotalVenda: 135,
    }),
    null
  );
});

test("4. residual de centavos fecha no último item elegível", () => {
  const origem = [item("a", 10), item("b", 10), item("c", 10)];
  const resultado = distribuirDescontoItens({
    descontoVenda: 0.1,
    itens: origem,
  });

  const descontos = resultado.itens.map((atual) =>
    paraCentavos(atual.descontoFiscal)
  );

  assert.equal(
    descontos.reduce((total, atual) => total + atual, 0),
    10
  );
  assert.equal(descontos[0], 3);
  assert.equal(descontos[1], 3);
  assert.equal(descontos[2], 4);
  assert.equal(
    conferirSomaItensFiscaisComVenda({
      itensFiscais: totaisFiscais(resultado.itens, origem),
      valorTotalVenda: 29.9,
    }),
    null
  );
});

test("5. desconto próprio + desconto geral sem duplicar", () => {
  const origem = [item("a", 100, 10), item("b", 50)];
  const resultado = distribuirDescontoItens({
    descontoVenda: 25,
    itens: origem,
  });

  assert.equal(resultado.descontoItensExistente, 10);
  assert.equal(resultado.descontoGeral, 15);
  assert.equal(resultado.itens[0].descontoItem, 10);
  assert.ok(resultado.itens[0].descontoGeralRateado > 0);
  assert.equal(
    paraCentavos(resultado.itens[0].descontoFiscal),
    10_00 + paraCentavos(resultado.itens[0].descontoGeralRateado)
  );
  assert.equal(
    resultado.itens.reduce(
      (total, atual) => total + paraCentavos(atual.descontoFiscal),
      0
    ),
    2500
  );
  assert.equal(
    conferirSomaItensFiscaisComVenda({
      itensFiscais: totaisFiscais(resultado.itens, origem),
      valorTotalVenda: 125,
    }),
    null
  );
});

test("8. venda sem desconto produz os mesmos descontos individuais", () => {
  const origem = [item("a", 80, 5), item("b", 40)];
  const resultado = distribuirDescontoItens({
    descontoVenda: 5,
    itens: origem,
  });

  assert.equal(resultado.descontoGeral, 0);
  assert.equal(resultado.itens[0].descontoFiscal, 5);
  assert.equal(resultado.itens[1].descontoFiscal, 0);
  assert.equal(resultado.itens[0].descontoGeralRateado, 0);
});

test("bloqueia desconto que tornaria item negativo", () => {
  assert.throws(
    () =>
      distribuirDescontoItens({
        descontoVenda: 50,
        itens: [item("a", 10), item("b", 10)],
      }),
    DistribuicaoDescontoFiscalError
  );
});

test("venda 31: bruto 35, desconto geral 33, líquido 2", () => {
  const origem = [item("dock", 35)];
  const resultado = distribuirDescontoItens({
    descontoVenda: 33,
    itens: origem,
  });

  assert.equal(paraCentavos(resultado.itens[0].valorBruto), 3500);
  assert.equal(paraCentavos(resultado.itens[0].descontoFiscal), 3300);
  assert.equal(
    valorTotalItemGeranetEmCentavos({
      quantidade: 1,
      valorUnitario: 35,
      desconto: resultado.itens[0].descontoFiscal,
    }),
    200
  );
  assert.equal(
    conferirSomaItensFiscaisComVenda({
      itensFiscais: totaisFiscais(resultado.itens, origem),
      valorTotalVenda: 2,
    }),
    null
  );
});

test("venda 33: nfe.valorTotal é 15, item.valorTotal continua bruto", () => {
  const origem = [item("dock", 35)];
  const resultado = distribuirDescontoItens({
    descontoVenda: 20,
    itens: origem,
  });
  const fiscais = totaisFiscais(resultado.itens, origem);

  assert.equal(fiscais[0].valorTotal, "35.00");
  assert.equal(fiscais[0].desconto, "20.00000000");
  assert.equal(valorTotalNotaGeranet(fiscais), "15.00");
  assert.equal(
    conferirSomaItensFiscaisComVenda({
      itensFiscais: fiscais,
      valorTotalVenda: 15,
    }),
    null
  );
});

test("exemplo A: produto 35 desconto 15, nfe.valorTotal 20", () => {
  const origem = [item("dock", 35)];
  const resultado = distribuirDescontoItens({
    descontoVenda: 15,
    itens: origem,
  });

  assert.equal(
    valorTotalNotaGeranet(totaisFiscais(resultado.itens, origem)),
    "20.00"
  );
});

test("mapa por item é a fonte única para NF-e e NFC-e", () => {
  const resultado = distribuirDescontoItens({
    descontoVenda: 15,
    itens: [item("a", 100), item("b", 50)],
  });
  const mapa = mapaDescontoFiscalPorItem(resultado);

  assert.equal(mapa.get("a"), 10);
  assert.equal(mapa.get("b"), 5);
});
