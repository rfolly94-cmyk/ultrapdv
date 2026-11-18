import assert from "node:assert/strict";
import test from "node:test";
import { dataDdmmaa, descreverCampo, exibirReais, prepararValorCaptura, repasseCentavos, semMascara, tituloCaptura, valorDaVenda, type CapturaBiblioteca, type VendaOriginal } from "./captura-administrativa.ts";

const base: CapturaBiblioteca = {
  promptBiblioteca: "",
  mascara: "",
  tiposEntrada: 1,
  tamanhoMinimo: 0,
  tamanhoMaximo: 0,
  valorMinimo: 0,
  valorMaximo: 0,
  validacaoDado: 0,
  aceitaNulo: false,
  valorInicial: "",
  teclasAtalho: false,
  mensagemValidacao: "",
  mensagemConfirmacao: "",
  mensagemDadoMaior: "",
  mensagemDadoMenor: "",
  itemInicial: 0,
  mensagemPrevia: "",
  tipoEntradaCodigoBarras: 0,
  sugestaoJournal: false,
};

test("campo sem título usa o tipo e o identificador nativos", () => {
  assert.equal(tituloCaptura(2, 0x57, base, ""), "Data da transação original");
  assert.equal(tituloCaptura(2, 0x99, base, ""), "Entrada digitada 0x99");
  assert.equal(tituloCaptura(17, 0xf6, base, ""), "Senha técnica");
  assert.equal(tituloCaptura(17, 0xf5, base, ""), "Senha do lojista");
});

test("data da venda original segue o dicionário DDMMAA", () => {
  assert.equal(dataDdmmaa("18/11/2026").valor, "181126");
  assert.equal(dataDdmmaa("05/11/2026").valor, "051126");
  assert.equal(dataDdmmaa("11/05/2026").valor, "110526");
  assert.equal(dataDdmmaa("01/02/2026").valor, "010226");
  assert.equal(dataDdmmaa("29/02/2024").valor, "290224");
  assert.equal(dataDdmmaa("31/02/2026").ok, false);
  assert.equal(dataDdmmaa("29/02/2026").ok, false);
  const enviado = prepararValorCaptura("18/11/2026", 2, 0x57, { ...base, validacaoDado: 5 });
  assert.equal(enviado.valor, "181126");
  assert.notEqual(enviado.valor, "111826");
  assert.notEqual(enviado.valor, "20261118");
  assert.notEqual(enviado.valor, "18112026");
  assert.notEqual(enviado.valor, "18/11/2026");
  assert.equal(prepararValorCaptura("12/2026", 2, 0x57, { ...base, validacaoDado: 4 }).ok, false);
  assert.equal(prepararValorCaptura("000123", 2, 0x58, base).valor, "000123");
  assert.equal(prepararValorCaptura("R$ 2,00", 2, 0x60, base).valor, "200");
  assert.equal(prepararValorCaptura("2", 2, 0x60, base).valor, "200");
  assert.equal(prepararValorCaptura("0,02", 2, 0x60, base).valor, "2");
  assert.equal(prepararValorCaptura("R$ 0,02", 2, 0x60, base).valor, "2");
  assert.equal(prepararValorCaptura("R$ 12.345,67", 2, 0x60, base).valor, "1234567");
  assert.equal(prepararValorCaptura("12.345,67", 2, 0x49, base).valor, "1234567");
  assert.equal(repasseCentavos(prepararValorCaptura("R$ 2,00", 2, 0x60, base).valor), "200");
  assert.equal(repasseCentavos("200"), "200");
  assert.equal(prepararValorCaptura(exibirReais(200), 2, 0x60, base).valor, "200");
  assert.equal(prepararValorCaptura(exibirReais(2), 2, 0x60, base).valor, "2");
  assert.equal(prepararValorCaptura(exibirReais(1234567), 2, 0x60, base).valor, "1234567");
  assert.equal(dataDdmmaa("18112026").valor, "181126");
  assert.notEqual(dataDdmmaa("18112026").valor, "18112026");
  assert.equal(prepararValorCaptura("52", 2, 0x78, base).valor, "52");
  assert.equal(prepararValorCaptura("00052", 2, 0x78, base).valor, "00052");
  assert.equal(tituloCaptura(2, 0x78, base, ""), "Referência local (REF)");
  assert.match(descreverCampo(0x78, 2, base).origem, /REF no comprovante/);
  const venda: VendaOriginal = { chave: "venda-52", valorCentavos: 200, data: "18/11/2026", referencia: "00052", requisicao: "0000000010", texto: "18/11/2026 · R$ 2,00 · REF 00052" };
  assert.equal(valorDaVenda(venda, 0x60), "2,00");
  assert.equal(valorDaVenda(venda, 0x57), "18/11/2026");
  assert.equal(valorDaVenda(venda, 0x78), "00052");
  assert.equal(prepararValorCaptura(valorDaVenda(venda, 0x60), 2, 0x60, base).valor, "200");
  assert.equal(prepararValorCaptura(valorDaVenda(venda, 0x57), 2, 0x57, base).valor, "181126");
  assert.equal(prepararValorCaptura(valorDaVenda(venda, 0x78), 2, 0x78, base).valor, "00052");
  assert.equal(tituloCaptura(17, 0xf6, base, ""), "Senha técnica");
  assert.equal(tituloCaptura(17, 0xf5, base, ""), "Senha do lojista");
  assert.equal(tituloCaptura(2, 0x58, base, ""), "NSU da transação original");
  assert.equal(tituloCaptura(2, 0x72, base, ""), "Número da solicitação original");
});

test("valor fora da faixa usa a mensagem da biblioteca", () => {
  const resultado = prepararValorCaptura("1", 2, null, { ...base, valorMinimo: 10, mensagemDadoMenor: "Valor menor" });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.erro, "Valor menor");
});

test("tipo de entrada zero envia o valor inicial", () => {
  const resultado = prepararValorCaptura("999", 2, null, { ...base, tiposEntrada: 0, valorInicial: "200001" });
  assert.equal(resultado.valor, "200001");
});
