import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { perfilUsuarioValido } from "../usuarios/perfis";
import { presetDoPerfil } from "../permissoes/presets";
import { temPermissao } from "../permissoes/tem-permissao";
import {
  ehContador,
  podeAcessarContabilidade,
  podeGerarInventario,
  podeLiberarCompetencia,
  rotaPermitidaContador,
} from "./acesso";
import {
  chaveCompetencia,
  intervaloCompetencia,
  parseCompetencia,
  rotuloCompetencia,
  slugArquivo,
} from "./competencia";
import {
  custoInventario,
  inconsistenciasNumeracao,
  nomeArquivoZip,
  pendenciasDeEmissao,
} from "./regras";
import { montarItensInventario } from "./inventario";
import { criarZip } from "./zip";

test("A. administrador acessa contabilidade da própria empresa", () => {
  assert.equal(podeAcessarContabilidade(presetDoPerfil("administrador")), true);
  assert.equal(ehContador("administrador"), false);
});

test("perfil contador é lowercase e válido no TypeScript", () => {
  assert.equal(perfilUsuarioValido("contador"), true);
  assert.equal(perfilUsuarioValido("CONTADOR"), true);
  assert.equal(perfilUsuarioValido("fiscal"), false);
});

test("B. contador vinculado acessa o módulo", () => {
  assert.equal(podeAcessarContabilidade(presetDoPerfil("contador")), true);
  assert.equal(ehContador("contador"), true);
});

test("C/D. acesso depende da permissão do vínculo, não do nome do perfil", () => {
  assert.equal(podeAcessarContabilidade(presetDoPerfil("vendedor")), false);
  assert.equal(podeAcessarContabilidade(null), false);
});

test("L. contador não opera PDV, estoque, caixa, emissão ou cancelamento", () => {
  assert.equal(rotaPermitidaContador("/contabilidade"), true);
  assert.equal(rotaPermitidaContador("/contabilidade/xmls"), true);
  assert.equal(rotaPermitidaContador("/api/contabilidade/zip"), true);
  assert.equal(
    rotaPermitidaContador("/api/fiscal/emissoes/abc/arquivo"),
    true
  );
  assert.equal(rotaPermitidaContador("/pdv"), false);
  assert.equal(rotaPermitidaContador("/estoque"), false);
  assert.equal(rotaPermitidaContador("/vendas"), false);
  assert.equal(
    rotaPermitidaContador("/api/fiscal/emissoes/abc/cancelar"),
    false
  );
  assert.equal(
    rotaPermitidaContador("/api/fiscal/emissoes/abc/inutilizar"),
    false
  );
  assert.equal(rotaPermitidaContador("/api/fiscal/geranet/nfe-emitir"), false);
  assert.equal(podeLiberarCompetencia(presetDoPerfil("contador")), true);
  assert.equal(podeGerarInventario(presetDoPerfil("contador")), true);
  assert.equal(podeLiberarCompetencia(presetDoPerfil("administrador")), true);
});

test("competência Agosto/2026 usa o mês civil em America/Sao_Paulo", () => {
  const competencia = parseCompetencia("2026-08");
  assert.deepEqual(competencia, { ano: 2026, mes: 8 });
  assert.equal(rotuloCompetencia(competencia), "Agosto/2026");
  assert.equal(chaveCompetencia(competencia), "2026-08");

  const { inicio, fim } = intervaloCompetencia(competencia, "America/Sao_Paulo");
  assert.equal(inicio.toISOString(), "2026-08-01T03:00:00.000Z");
  assert.equal(fim.toISOString(), "2026-09-01T03:00:00.000Z");
});

test("H. emissão aguardando reconciliação vira alerta", () => {
  const pendencias = pendenciasDeEmissao({
    modelo: "65",
    serie: 1,
    numero: 10,
    status: "aguardando_reconciliacao",
  });

  assert.equal(pendencias.length, 1);
  assert.equal(pendencias[0].gravidade, "atencao");
  assert.match(pendencias[0].descricao, /aguardando reconciliação/);
});

test("H. numeração e status pendente alimentam a auditoria", () => {
  const avisos = inconsistenciasNumeracao([
    { modelo: "65", serie: 1, numero: 1, status: "autorizada" },
    { modelo: "65", serie: 1, numero: 3, status: "autorizada" },
    { modelo: "65", serie: 1, numero: 3, status: "autorizada" },
  ]);

  assert.ok(avisos.some((item) => item.includes("duplicado")));
  assert.ok(avisos.some((item) => item.includes("intervalo")));
});

test("I/J. snapshot de inventário copia quantidade e custo e não depende do estoque futuro", () => {
  const itens = montarItensInventario(
    [
      {
        id: "p1",
        codigo: "001",
        nome: "Película",
        unidade_medida: "UN",
        preco_custo: 10,
        produtos_fiscal: { ncm: "39269090" },
      },
    ],
    [{ produto_id: "p1", quantidade: 5, custo_medio: 8 }]
  );

  assert.equal(itens[0].quantidade, 5);
  assert.equal(itens[0].custo_unitario, 8);
  assert.equal(itens[0].valor_total, 40);
  assert.equal(itens[0].custo_disponivel, true);

  const depois = montarItensInventario(
    [
      {
        id: "p1",
        codigo: "001",
        nome: "Película",
        unidade_medida: "UN",
        preco_custo: 10,
        produtos_fiscal: { ncm: "39269090" },
      },
    ],
    [{ produto_id: "p1", quantidade: 1, custo_medio: 99 }]
  );

  assert.equal(itens[0].quantidade, 5);
  assert.equal(itens[0].custo_unitario, 8);
  assert.equal(depois[0].quantidade, 1);
});

test("custo ausente não inventa valor", () => {
  const custo = custoInventario(0, 0);
  assert.equal(custo.disponivel, false);
  assert.equal(custo.valor, null);
});

test("G. nome do ZIP usa empresa + competência", () => {
  assert.equal(
    nomeArquivoZip(slugArquivo("Ultra Cell"), "2026-08"),
    "ultra-cell-2026-08-movimento-fiscal.zip"
  );
});

test("F. recuperação de XML ausente usa obterDocumentoFiscal e nunca /nfe/emitir", () => {
  const fonte = readFileSync(
    fileURLToPath(new URL("./zip-competencia.ts", import.meta.url)),
    "utf8"
  );

  assert.match(fonte, /obterDocumentoFiscal/);
  assert.doesNotMatch(fonte, /nfe\/emitir|nfce-emitir|nfe55-emitir/);
});

test("K. fechamento e inventário seguem a matriz de permissões", () => {
  assert.equal(podeLiberarCompetencia(presetDoPerfil("administrador")), true);
  assert.equal(podeLiberarCompetencia(presetDoPerfil("gerente")), true);
  assert.equal(podeLiberarCompetencia(presetDoPerfil("contador")), true);
  assert.equal(podeLiberarCompetencia(presetDoPerfil("vendedor")), false);
  assert.equal(
    temPermissao(presetDoPerfil("caixa"), "contabilidade", "fechamento"),
    false
  );
  assert.equal(podeGerarInventario(presetDoPerfil("gerente")), true);
  assert.equal(podeGerarInventario(presetDoPerfil("caixa")), false);
});

test("ZIP gerado é arquivo PK e não inclui certificado", () => {
  const buffer = criarZip([
    { nome: "XML/NFE/chave.xml", conteudo: Buffer.from("<nfe/>") },
    {
      nome: "RELATORIOS/xmls-pendentes.txt",
      conteudo: Buffer.from("ok"),
    },
  ]);

  assert.equal(buffer.subarray(0, 2).toString(), "PK");
  assert.equal(buffer.includes(Buffer.from("certificado")), false);
  assert.equal(buffer.includes(Buffer.from("API Key")), false);
});
