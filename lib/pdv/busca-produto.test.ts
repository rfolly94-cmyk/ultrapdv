import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "../multiempresa/fonte";
import { deveRenderizarLogoCentro } from "./preferencias";
import {
  MENSAGEM_PRODUTO_CODIGO_NAO_ENCONTRADO,
  decidirAcaoEnterBuscaPdv,
  detectorScannerVazio,
  encontrarProdutoPorCodigoExato,
  pareceCodigoProduto,
  pareceLeituraScanner,
  quantidadeAposAdicionarPdv,
  registrarTeclaBusca,
} from "./busca-produto";

const refrigerante = {
  id: "p1",
  codigo: "REF01",
  codigo_barras: "7891234567890",
  nome: "Refrigerante 2L",
};
const frango = {
  id: "p2",
  codigo: "FRA10",
  codigo_barras: "7890000000011",
  nome: "Frango resfriado",
};
const produtos = [refrigerante, frango];

const logoBase = {
  mostrarLogoCentro: true,
  logoUrl: "https://cdn.example/a/logo.png",
};

test("cenário A: tela vazia sem busca mostra logo/empty state", () => {
  assert.equal(
    deveRenderizarLogoCentro({
      ...logoBase,
      carrinhoVazio: true,
      buscaAtiva: false,
      resultadosAbertos: false,
      buscaCarregando: false,
    }),
    true
  );
});

test("cenário B: digitou termo — logo some", () => {
  assert.equal(
    deveRenderizarLogoCentro({
      ...logoBase,
      carrinhoVazio: true,
      buscaAtiva: true,
      resultadosAbertos: true,
    }),
    false
  );
});

test("logo some com itens no carrinho mesmo sem busca", () => {
  assert.equal(
    deveRenderizarLogoCentro({
      ...logoBase,
      carrinhoVazio: false,
      buscaAtiva: false,
    }),
    false
  );
});

test("cenário C: busca textual manual não adiciona no Enter se houver vários resultados", () => {
  const acao = decidirAcaoEnterBuscaPdv({
    termo: "fr",
    produtos,
    produtosFiltrados: produtos.filter((item) =>
      item.nome.toLowerCase().includes("fr")
    ),
    leituraScanner: false,
  });
  assert.equal(acao.tipo, "ignorar");
  assert.equal(pareceCodigoProduto("fr"), false);
  assert.equal(pareceCodigoProduto("frango"), false);
  assert.equal(pareceCodigoProduto("7891234567890"), true);
});

test("busca textual com um resultado no Enter adiciona o único item", () => {
  const acao = decidirAcaoEnterBuscaPdv({
    termo: "frango",
    produtos,
    produtosFiltrados: [frango],
    leituraScanner: false,
  });
  assert.equal(acao.tipo, "adicionar");
  if (acao.tipo === "adicionar") {
    assert.equal(acao.produto.id, frango.id);
  }
});

test("cenário D/G: código de barras ou código interno exato adiciona direto", () => {
  const porBarras = decidirAcaoEnterBuscaPdv({
    termo: "7891234567890",
    produtos,
    produtosFiltrados: [refrigerante],
    leituraScanner: true,
  });
  assert.equal(porBarras.tipo, "adicionar");
  if (porBarras.tipo === "adicionar") {
    assert.equal(porBarras.produto.id, refrigerante.id);
  }

  const porCodigo = decidirAcaoEnterBuscaPdv({
    termo: "ref01",
    produtos,
    produtosFiltrados: [refrigerante],
    leituraScanner: false,
  });
  assert.equal(porCodigo.tipo, "adicionar");
  if (porCodigo.tipo === "adicionar") {
    assert.equal(porCodigo.produto.id, refrigerante.id);
  }

  assert.equal(
    encontrarProdutoPorCodigoExato(produtos, " 7891234567890 ")?.id,
    refrigerante.id
  );
});

test("cenário E: mesmo produto bipado 3 vezes soma quantidade", () => {
  let qtd = 0;
  qtd = quantidadeAposAdicionarPdv(qtd, 1);
  qtd = quantidadeAposAdicionarPdv(qtd, 1);
  qtd = quantidadeAposAdicionarPdv(qtd, 1);
  assert.equal(qtd, 3);
});

test("cenário F: código inexistente não adiciona e usa mensagem curta", () => {
  const acao = decidirAcaoEnterBuscaPdv({
    termo: "0000000000000",
    produtos,
    produtosFiltrados: [],
    leituraScanner: true,
  });
  assert.equal(acao.tipo, "nao-encontrado");
  assert.equal(
    MENSAGEM_PRODUTO_CODIGO_NAO_ENCONTRADO,
    "Produto não encontrado para o código informado."
  );
});

test("bip de código inexistente limpa a busca e devolve o foco; pesquisa textual não", () => {
  const shell = fonte("components/pdv/pdv-shell.tsx");
  const handler = shell.slice(
    shell.indexOf("function aoPressionarBusca"),
    shell.indexOf("function aplicarDesconto")
  );
  const antesNaoEncontrado = handler.slice(
    0,
    handler.indexOf('acao.tipo === "nao-encontrado"')
  );
  const naoEncontrado = handler.slice(
    handler.indexOf('acao.tipo === "nao-encontrado"')
  );

  assert.match(naoEncontrado, /setToastPdv\(MENSAGEM_PRODUTO_CODIGO_NAO_ENCONTRADO\)/);
  assert.match(naoEncontrado, /setBusca\(""\)/);
  assert.match(naoEncontrado, /buscaRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(antesNaoEncontrado, /setBusca\(""\)/);
  assert.doesNotMatch(handler, /acao\.tipo === "ignorar"/);

  const textual = decidirAcaoEnterBuscaPdv({
    termo: "frontal a32",
    produtos,
    produtosFiltrados: [],
    leituraScanner: false,
  });
  assert.equal(textual.tipo, "ignorar");
});

test("scanner rápido não escolhe o único resultado textual", () => {
  const acao = decidirAcaoEnterBuscaPdv({
    termo: "000999",
    produtos,
    produtosFiltrados: [frango],
    leituraScanner: true,
  });
  assert.equal(acao.tipo, "nao-encontrado");
});

test("detecção de scanner: rajada rápida + Enter", () => {
  let estado = detectorScannerVazio();
  let agora = 1000;
  for (const char of "7891234567890") {
    agora += 20;
    estado = registrarTeclaBusca(estado, char, agora);
  }
  assert.equal(pareceLeituraScanner(estado, agora + 10), true);
});

test("detecção de scanner: digitação humana lenta não conta como bip", () => {
  let estado = detectorScannerVazio();
  let agora = 1000;
  for (const char of "7891") {
    agora += 180;
    estado = registrarTeclaBusca(estado, char, agora);
  }
  assert.equal(pareceLeituraScanner(estado, agora + 10), false);
});

test("atalhos F2 F3 F5 Esc e fluxo de busca continuam no PDV", () => {
  const shell = fonte("components/pdv/pdv-shell.tsx");
  assert.match(shell, /event.key === "F2"/);
  assert.match(shell, /event.key === "F3"/);
  assert.match(shell, /event.key === "F5"/);
  assert.match(shell, /event.key === "Escape"/);
  assert.match(shell, /decidirAcaoEnterBuscaPdv/);
  assert.match(shell, /pdv-busca-resultados/);
  assert.match(shell, /buscaAtiva: Boolean\(busca.trim\(\)\)/);
  assert.match(shell, /buscaRef.current\?\.focus\(\)/);
  assert.match(shell, /acao\.tipo === "adicionar"/);
  assert.match(shell, /adicionarProduto\(acao\.produto/);
  assert.doesNotMatch(shell, /PrintTo/);
});
