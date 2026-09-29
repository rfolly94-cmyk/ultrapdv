import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { avaliarPagamentosPdv } from "./pagamentos-teto";
import {
  aplicarDigitoMonetarioPdv,
  aplicarValorFormaPdv,
  centavosParaInputPdv,
  formaAposNavegacaoPdv,
  pagamentosAberturaPdv,
  textoParaCentavosPdv,
} from "./distribuicao-pagamento-pdv";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");

const formas = [
  {
    id: "dinheiro",
    codigo: "DINHEIRO",
    nome: "Dinheiro",
    tipo: "DINHEIRO",
    permite_troco: true,
    permite_fiado: false,
  },
  {
    id: "pix",
    codigo: "PIX",
    nome: "PIX",
    tipo: "PIX",
    permite_troco: false,
    permite_fiado: false,
  },
  {
    id: "debito",
    codigo: "CARTAO_DEBITO",
    nome: "Cartão de Débito",
    tipo: "CARTAO_DEBITO",
    permite_troco: false,
    permite_fiado: false,
  },
  {
    id: "credito",
    codigo: "CARTAO_CREDITO",
    nome: "Cartão de Crédito",
    tipo: "CARTAO_CREDITO",
    permite_troco: false,
    permite_fiado: false,
  },
];

function centavos(texto: string) {
  return textoParaCentavosPdv(texto);
}

function valor(pagamentos: { formaPagamentoId: string; valorTexto: string }[], id: string) {
  return centavos(
    pagamentos.find((pagamento) => pagamento.formaPagamentoId === id)?.valorTexto ?? "0"
  );
}

function digitar(
  estado: ReturnType<typeof pagamentosAberturaPdv>,
  formaId: string,
  texto: string
) {
  return aplicarValorFormaPdv({
    formas,
    pagamentos: estado.pagamentos,
    totalCentavos: 12500,
    dinheiroAutomatico: estado.dinheiroAutomatico,
    formaPagamentoId: formaId,
    valorTexto: texto,
  });
}

test("ao abrir, dinheiro recebe o total e as outras formas ficam zeradas", () => {
  const abertura = pagamentosAberturaPdv({ formas, totalCentavos: 12500 });
  assert.equal(abertura.dinheiroAutomatico, true);
  assert.equal(abertura.formaSelecionadaId, "dinheiro");
  assert.equal(valor(abertura.pagamentos, "dinheiro"), 12500);
  assert.equal(valor(abertura.pagamentos, "pix"), 0);
  assert.equal(valor(abertura.pagamentos, "debito"), 0);
  assert.equal(valor(abertura.pagamentos, "credito"), 0);
});

test("1. PIX 25 deixa dinheiro em 100", () => {
  const abertura = pagamentosAberturaPdv({ formas, totalCentavos: 12500 });
  const pix = digitar(abertura, "pix", "25");
  assert.equal(valor(pix.pagamentos, "pix"), 2500);
  assert.equal(valor(pix.pagamentos, "dinheiro"), 10000);
  assert.equal(pix.dinheiroAutomatico, true);
});

test("2. PIX 50 e débito 25 deixam dinheiro em 50", () => {
  let estado = pagamentosAberturaPdv({ formas, totalCentavos: 12500 });
  estado = { ...estado, ...digitar(estado, "pix", "50,00") };
  assert.equal(valor(estado.pagamentos, "dinheiro"), 7500);
  estado = { ...estado, ...digitar(estado, "debito", "25,00") };
  assert.equal(valor(estado.pagamentos, "dinheiro"), 5000);
  assert.equal(valor(estado.pagamentos, "pix"), 5000);
  assert.equal(valor(estado.pagamentos, "debito"), 2500);
  assert.equal(
    valor(estado.pagamentos, "dinheiro") +
      valor(estado.pagamentos, "pix") +
      valor(estado.pagamentos, "debito"),
    12500
  );
});

test("3. PIX integral zera dinheiro e fecha o restante", () => {
  const abertura = pagamentosAberturaPdv({ formas, totalCentavos: 12500 });
  const pix = digitar(abertura, "pix", "125,00");
  assert.equal(valor(pix.pagamentos, "dinheiro"), 0);
  assert.equal(valor(pix.pagamentos, "pix"), 12500);
  const avaliacao = avaliarPagamentosPdv({
    totalVendaCentavos: 12500,
    pagamentos: [
      { valorCentavos: 12500, permiteTroco: false },
    ],
  });
  assert.equal(avaliacao.restanteCentavos, 0);
  assert.equal(avaliacao.bloqueado, false);
});

test("4. PIX 100 e crédito 25 zeram dinheiro", () => {
  let estado = pagamentosAberturaPdv({ formas, totalCentavos: 12500 });
  estado = { ...estado, ...digitar(estado, "pix", "100,00") };
  estado = { ...estado, ...digitar(estado, "credito", "25,00") };
  assert.equal(valor(estado.pagamentos, "dinheiro"), 0);
  assert.equal(valor(estado.pagamentos, "pix"), 10000);
  assert.equal(valor(estado.pagamentos, "credito"), 2500);
});

test("editar dinheiro manualmente preserva as outras formas", () => {
  let estado = pagamentosAberturaPdv({ formas, totalCentavos: 12500 });
  estado = { ...estado, ...digitar(estado, "pix", "50,00") };
  estado = { ...estado, ...digitar(estado, "dinheiro", "10,00") };
  assert.equal(estado.dinheiroAutomatico, false);
  estado = { ...estado, ...digitar(estado, "debito", "20,00") };
  assert.equal(valor(estado.pagamentos, "dinheiro"), 1000);
  assert.equal(valor(estado.pagamentos, "pix"), 5000);
  assert.equal(valor(estado.pagamentos, "debito"), 2000);
  const avaliacao = avaliarPagamentosPdv({
    totalVendaCentavos: 12500,
    pagamentos: estado.pagamentos
      .map((pagamento) => ({
        valorCentavos: centavos(pagamento.valorTexto),
        permiteTroco: pagamento.formaPagamentoId === "dinheiro",
      }))
      .filter((pagamento) => pagamento.valorCentavos > 0),
  });
  assert.equal(avaliacao.totalInformadoCentavos, 8000);
  assert.equal(avaliacao.restanteCentavos, 4500);
  assert.equal(avaliacao.bloqueado, false);
});

test("reiniciar pagamentos volta o dinheiro para o modo automático", () => {
  const reinicio = pagamentosAberturaPdv({ formas, totalCentavos: 12500 });
  assert.equal(reinicio.dinheiroAutomatico, true);
  assert.equal(valor(reinicio.pagamentos, "dinheiro"), 12500);
  assert.equal(valor(reinicio.pagamentos, "pix"), 0);
});

test("dinheiro automático não fica negativo quando as outras formas passam do total", () => {
  const abertura = pagamentosAberturaPdv({ formas, totalCentavos: 12500 });
  const pix = digitar(abertura, "pix", "200,00");
  assert.equal(valor(pix.pagamentos, "dinheiro"), 0);
  assert.equal(centavosParaInputPdv(valor(pix.pagamentos, "dinheiro")), "0,00");
  const avaliacao = avaliarPagamentosPdv({
    totalVendaCentavos: 12500,
    pagamentos: [{ valorCentavos: 20000, permiteTroco: false }],
  });
  assert.equal(avaliacao.bloqueado, true);
  assert.ok((avaliacao.mensagem ?? "").includes("ultrapassa"));
});

test("5. Tab e setas percorrem as formas na ordem visual", () => {
  const ids = formas.map((forma) => forma.id);
  assert.deepEqual(
    [
      formaAposNavegacaoPdv(ids, "dinheiro", "proxima"),
      formaAposNavegacaoPdv(ids, "pix", "proxima"),
      formaAposNavegacaoPdv(ids, "debito", "proxima"),
      formaAposNavegacaoPdv(ids, "credito", "proxima"),
    ],
    ["pix", "debito", "credito", "dinheiro"]
  );
  assert.equal(formaAposNavegacaoPdv(ids, "pix", "anterior"), "dinheiro");
  assert.equal(formaAposNavegacaoPdv(ids, "dinheiro", "anterior"), "credito");
});

test("6. o primeiro dígito substitui o valor e o seguinte compõe 50,00", () => {
  const primeiro = aplicarDigitoMonetarioPdv("0,00", "5", true);
  assert.equal(primeiro.texto, "5");
  assert.equal(primeiro.substituir, false);
  assert.equal(textoParaCentavosPdv(primeiro.texto), 500);
  const segundo = aplicarDigitoMonetarioPdv(primeiro.texto, "0", primeiro.substituir);
  assert.equal(segundo.texto, "50");
  assert.equal(textoParaCentavosPdv(segundo.texto), 5000);
});

test("7. F2 no pagamento continua concluindo a venda", () => {
  const shell = readFileSync(
    join(raiz, "components/pdv/pdv-shell.tsx"),
    "utf8"
  );
  assert.match(shell, /event\.key === "F2"/);
  assert.match(shell, /if \(modalPagamento\) \{[\s\S]*?finalizar\(\);/);
  assert.match(shell, /event\.key === "F3"/);
  assert.match(shell, /event\.key === "Escape"/);
  assert.match(shell, /data-pagamento-formas/);
  assert.match(shell, /dinheiroAutomatico/);
  assert.match(shell, /formaAposNavegacaoPdv/);
  assert.doesNotMatch(
    shell.slice(shell.indexOf("data-pagamento-formas")),
    /usarRestante\(forma\.id\)/
  );
});
