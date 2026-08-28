import assert from "node:assert/strict";
import { test } from "node:test";

import { ETIQUETA_BALANCA_PADRAO } from "./tipos";
import {
  LAYOUT_AUTOMATICO,
  LAYOUT_MANUAL,
  MODELO_OUTRO_ID,
  MODELOS_BALANCA,
  aplicarSelecaoModelo,
  buscarModelo,
  deveConfirmarTrocaModelo,
  inferirFormatoSalvo,
  lerSelecaoModeloDoFormulario,
  modelosDoFabricante,
  opcoesFormatoModelo,
  resolverLayoutPersistido,
  rotuloFormatoSalvo,
  ajudaFormatoModelo,
  type ModeloBalanca,
} from "./modelos";

const CATALOGO_TESTE: ModeloBalanca[] = [
  {
    id: "toledo-demo",
    fabricante: "toledo",
    nome: "Modelo de teste Toledo",
    layouts: [
      { id: "layout-a", nome: "Layout A" },
      { id: "layout-b", nome: "Layout B" },
    ],
    layoutRecomendado: "layout-a",
    tiposIntegracao: ["arquivo", "pendrive"],
    etiquetaPadrao: {
      prefixo: "2",
      plu: true,
      modo: "peso",
      quantidadeDigitos: 6,
      casasDecimais: 3,
      digitoVerificador: true,
    },
  },
  {
    id: "urano-unico",
    fabricante: "urano",
    nome: "Modelo de teste Urano",
    layouts: [{ id: "u1", nome: "U1" }],
    layoutRecomendado: "u1",
    tiposIntegracao: ["arquivo"],
    etiquetaPadrao: null,
  },
];

const etiquetaManual: typeof ETIQUETA_BALANCA_PADRAO = {
  prefixo: "99",
  plu: false,
  modo: "preco",
  quantidadeDigitos: 5,
  casasDecimais: 2,
  digitoVerificador: true,
};

test("catálogo de produção cadastra somente Prix 4 Uno com MGV7 oficial", () => {
  assert.deepEqual(
    MODELOS_BALANCA.map((item) => item.id),
    ["toledo-prix-4-uno"]
  );
  assert.equal(modelosDoFabricante("urano").length, 0);
  assert.equal(modelosDoFabricante("filizola").length, 0);
  const prix = buscarModelo({
    fabricante: "toledo",
    modeloId: "toledo-prix-4-uno",
  });
  assert.equal(prix?.nome, "Prix 4 Uno");
  assert.equal(prix?.layoutRecomendado, "mgv7");
  assert.equal(opcoesFormatoModelo(prix)[0]?.label, "Automático (MGV7)");
  assert.equal(resolverLayoutPersistido(prix, LAYOUT_AUTOMATICO), "mgv7");
  assert.match(ajudaFormatoModelo(prix), /Itensmgv\.txt/);
});

test("fabricante filtra modelos do catálogo", () => {
  assert.deepEqual(
    modelosDoFabricante("toledo", CATALOGO_TESTE).map((item) => item.id),
    ["toledo-demo"]
  );
  assert.deepEqual(
    modelosDoFabricante("urano", CATALOGO_TESTE).map((item) => item.id),
    ["urano-unico"]
  );
  assert.equal(modelosDoFabricante("filizola", CATALOGO_TESTE).length, 0);
  assert.equal(modelosDoFabricante("outro", CATALOGO_TESTE).length, 0);
});

test("modelo conhecido seleciona o layout recomendado", () => {
  const toledo = buscarModelo(
    { fabricante: "toledo", modeloId: "toledo-demo" },
    CATALOGO_TESTE
  );
  const urano = buscarModelo(
    { fabricante: "urano", modeloId: "urano-unico" },
    CATALOGO_TESTE
  );

  assert.equal(resolverLayoutPersistido(toledo, LAYOUT_AUTOMATICO), "layout-a");
  assert.deepEqual(
    opcoesFormatoModelo(toledo).map((item) => item.label),
    ["Automático (recomendado)", "Layout A", "Layout B"]
  );
  assert.equal(opcoesFormatoModelo(urano)[0]?.label, "Automático (U1)");
  assert.equal(resolverLayoutPersistido(urano, LAYOUT_AUTOMATICO), "u1");
});

test("modelo desconhecido não inventa layout", () => {
  assert.equal(buscarModelo({ fabricante: "toledo", modeloId: MODELO_OUTRO_ID }, CATALOGO_TESTE), null);
  assert.equal(
    buscarModelo({ fabricante: "toledo", nome: "Modelo inexistente" }, CATALOGO_TESTE),
    null
  );
  assert.equal(resolverLayoutPersistido(null, LAYOUT_AUTOMATICO), null);
  assert.deepEqual(opcoesFormatoModelo(null), [
    { value: LAYOUT_MANUAL, label: "Manual / não identificado" },
  ]);
  assert.equal(
    inferirFormatoSalvo({ modelo: null, formato: LAYOUT_AUTOMATICO }),
    LAYOUT_MANUAL
  );
  assert.equal(
    rotuloFormatoSalvo({ fabricante: "toledo", modeloNome: "Outro" }, CATALOGO_TESTE),
    "Manual / não identificado"
  );
});

test("troca de modelo não apaga configuração manual silenciosamente", () => {
  const toledo = buscarModelo(
    { fabricante: "toledo", modeloId: "toledo-demo" },
    CATALOGO_TESTE
  );
  const etiquetaNova = toledo?.etiquetaPadrao;
  assert.ok(etiquetaNova);

  assert.equal(
    deveConfirmarTrocaModelo({
      etiquetaAtual: etiquetaManual,
      etiquetaNova,
      etiquetaManual: true,
    }),
    true
  );
  assert.equal(
    deveConfirmarTrocaModelo({
      etiquetaAtual: etiquetaManual,
      etiquetaNova,
      etiquetaManual: false,
    }),
    false
  );

  const semSubstituir = aplicarSelecaoModelo({
    modelo: toledo,
    etiquetaAtual: etiquetaManual,
    etiquetaManual: true,
    substituirAvancado: false,
  });
  assert.equal(semSubstituir.exigeConfirmacao, true);
  assert.deepEqual(semSubstituir.etiqueta, etiquetaManual);
  assert.equal(semSubstituir.layout, "layout-a");
  assert.equal(semSubstituir.formato, LAYOUT_AUTOMATICO);

  const comSubstituir = aplicarSelecaoModelo({
    modelo: toledo,
    etiquetaAtual: etiquetaManual,
    etiquetaManual: true,
    substituirAvancado: true,
  });
  assert.deepEqual(comSubstituir.etiqueta, etiquetaNova);
  assert.equal(comSubstituir.etiquetaManual, false);
});

test("formulario resolve layout pelo mapa e ignora layout digitado", () => {
  const formData = new FormData();
  formData.set("modelo_id", "toledo-demo");
  formData.set("modelo", "ignorar este nome");
  formData.set("formato", LAYOUT_AUTOMATICO);
  formData.set("layout", "mgv6-inventado");

  const selecao = lerSelecaoModeloDoFormulario(
    formData,
    "toledo",
    CATALOGO_TESTE
  );
  assert.equal(selecao.layout, "layout-a");
  assert.equal(selecao.modeloNome, "Modelo de teste Toledo");
  assert.equal(selecao.formato, LAYOUT_AUTOMATICO);

  const outro = new FormData();
  outro.set("modelo_id", MODELO_OUTRO_ID);
  outro.set("modelo", "Prix 4");
  outro.set("formato", LAYOUT_AUTOMATICO);
  outro.set("layout", "mgv6");
  const desconhecido = lerSelecaoModeloDoFormulario(outro, "toledo", CATALOGO_TESTE);
  assert.equal(desconhecido.layout, null);
  assert.equal(desconhecido.formato, LAYOUT_MANUAL);
  assert.equal(desconhecido.modeloNome, "Prix 4");
});
