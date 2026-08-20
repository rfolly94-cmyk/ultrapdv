import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { montarItemDevolucaoFornecedor } from "./montar-item-devolucao";
import { parseTributosOriginaisNfe } from "./parse-xml-nfe";
import {
  COLUNAS_GRUPO_FISCAL_DEVOLUCAO,
  grupoFiscalDaEmpresaAtiva,
  grupoFiscalIdParaDevolucaoFornecedor,
  snapshotFiscalDevolucaoCongelado,
} from "./resolver-grupo-fiscal-devolucao";
import { resolverIcmsDevolucaoFornecedor } from "./resolver-icms-devolucao-fornecedor";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

const xmlCst60 = `
  <imposto>
    <ICMS><ICMS60><orig>0</orig><CST>60</CST><vBCSTRet>100.00</vBCSTRet><pST>18.00</pST><vICMSSTRet>18.00</vICMSSTRet></ICMS60></ICMS>
    <PIS><PISAliq><CST>01</CST><pPIS>1.65</pPIS></PISAliq></PIS>
    <COFINS><COFINSAliq><CST>01</CST><pCOFINS>7.60</pCOFINS></COFINSAliq></COFINS>
  </imposto>
`;

const grupoProdutos = {
  id: "e302f9a4-8b9c-4497-b482-d4caa2169f2a",
  empresa_id: "emp-a",
  nome: "Produtos",
  icms_cst_csosn: "500",
};

const grupoAntigo = {
  id: "grupo-a",
  empresa_id: "emp-a",
  nome: "Grupo A",
  icms_cst_csosn: "102",
};

test("snapshot vazio não está congelado", () => {
  assert.equal(snapshotFiscalDevolucaoCongelado({}), false);
  assert.equal(snapshotFiscalDevolucaoCongelado(null), false);
  assert.equal(
    snapshotFiscalDevolucaoCongelado({ icms_resolvido: "500", cfop: "6202" }),
    true
  );
});

test("nova devolução usa o grupo atual do produto, não o grupo nulo do item de entrada", () => {
  const resolucao = grupoFiscalIdParaDevolucaoFornecedor({
    empresaIdAtiva: "emp-a",
    snapshotFiscal: {},
    grupoFiscalIdItemDevolucao: null,
    produtoEmpresaId: "emp-a",
    produtoGrupoFiscalId: grupoProdutos.id,
  });
  assert.equal(resolucao.origem, "produto");
  assert.equal(resolucao.grupoFiscalId, grupoProdutos.id);

  const grupo = grupoFiscalDaEmpresaAtiva(grupoProdutos, "emp-a");
  const icms = resolverIcmsDevolucaoFornecedor({
    codigoRegimeTributario: 1,
    ambiente: "2",
    dataEmissao: new Date("2026-08-17"),
    tributosOriginais: parseTributosOriginaisNfe(xmlCst60),
    icmsCstCsosnGrupo: grupo?.icms_cst_csosn,
    grupoFiscalNome: grupo?.nome,
    produtoNome: "PECAS PARA CELULAR",
    empresaIdAtiva: "emp-a",
    produtoEmpresaId: "emp-a",
    grupoFiscalEmpresaId: grupo?.empresa_id,
  });
  assert.equal(icms.ok, true);
  if (icms.ok) {
    assert.equal(icms.icmsCst, "500");
    assert.equal(icms.origemCodigo, "grupo_fiscal");
    assert.equal(icms.cstOriginal, "60");
  }
});

test("produto que mudou de Grupo A para Produtos usa Produtos na nova devolução", () => {
  const resolucao = grupoFiscalIdParaDevolucaoFornecedor({
    empresaIdAtiva: "emp-a",
    snapshotFiscal: {},
    grupoFiscalIdItemDevolucao: grupoAntigo.id,
    produtoEmpresaId: "emp-a",
    produtoGrupoFiscalId: grupoProdutos.id,
  });
  assert.equal(resolucao.origem, "produto");
  assert.equal(resolucao.grupoFiscalId, grupoProdutos.id);
  assert.notEqual(resolucao.grupoFiscalId, grupoAntigo.id);
});

test("devolução já preparada mantém o snapshot e não recalcula pelo grupo atual", () => {
  const resolucao = grupoFiscalIdParaDevolucaoFornecedor({
    empresaIdAtiva: "emp-a",
    snapshotFiscal: {
      icms_resolvido: "102",
      cfop: "6202",
      grupo_fiscal_id: grupoAntigo.id,
    },
    grupoFiscalIdItemDevolucao: grupoAntigo.id,
    produtoEmpresaId: "emp-a",
    produtoGrupoFiscalId: grupoProdutos.id,
  });
  assert.equal(resolucao.origem, "snapshot");
  assert.equal(resolucao.grupoFiscalId, grupoAntigo.id);

  const icms = resolverIcmsDevolucaoFornecedor({
    codigoRegimeTributario: 1,
    ambiente: "2",
    dataEmissao: new Date("2026-08-17"),
    tributosOriginais: parseTributosOriginaisNfe(xmlCst60),
    regraIcmsDevolucao: "102",
    icmsCstCsosnGrupo: grupoProdutos.icms_cst_csosn,
    grupoFiscalNome: grupoAntigo.nome,
    empresaIdAtiva: "emp-a",
    produtoEmpresaId: "emp-a",
    grupoFiscalEmpresaId: grupoAntigo.empresa_id,
  });
  assert.equal(icms.ok, true);
  if (icms.ok) {
    assert.equal(icms.icmsCst, "102");
    assert.equal(icms.origemCodigo, "override");
  }
});

test("empresa B não usa o grupo Produtos da empresa A", () => {
  const resolucao = grupoFiscalIdParaDevolucaoFornecedor({
    empresaIdAtiva: "emp-b",
    produtoEmpresaId: "emp-a",
    produtoGrupoFiscalId: grupoProdutos.id,
  });
  assert.equal(resolucao.grupoFiscalId, null);
  assert.equal(grupoFiscalDaEmpresaAtiva(grupoProdutos, "emp-b"), null);

  const grupoB = {
    ...grupoProdutos,
    id: "grupo-produtos-b",
    empresa_id: "emp-b",
    icms_cst_csosn: "102",
  };
  const daEmpresaB = grupoFiscalDaEmpresaAtiva(grupoB, "emp-b");
  assert.equal(daEmpresaB?.id, "grupo-produtos-b");
  assert.equal(daEmpresaB?.icms_cst_csosn, "102");
});

test("mensagem não usa o fallback grupo fiscal quando o produto tem grupo Produtos", () => {
  const montado = montarItemDevolucaoFornecedor({
    descricao: "PECAS PARA CELULAR",
    codigo: "5208",
    unidade: "UN",
    ncm: "85299020",
    cfop: "6202",
    quantidade: 1,
    valorUnitario: 10,
    dadosFiscaisOriginal: { imposto: { xml: xmlCst60 } },
    icmsCstCsosnGrupo: "500",
    grupoFiscalNome: "Produtos",
    empresaIdAtiva: "emp-a",
    produtoEmpresaId: "emp-a",
    grupoFiscalEmpresaId: "emp-a",
    codigoRegimeTributario: 1,
    ambiente: "2",
    dataEmissao: new Date("2026-08-17"),
  });
  assert.equal(montado.item?.icmsCsosn, "500");
  assert.equal(montado.item?.icmsCst, undefined);
  assert.equal(
    montado.pendencias.some((mensagem) => /Grupo fiscal: grupo fiscal/.test(mensagem)),
    false
  );
});

test("select da devolução não consulta coluna inexistente de CSOSN duplicado", () => {
  assert.equal(
    COLUNAS_GRUPO_FISCAL_DEVOLUCAO.includes("icms_cst_csosn_devolucao_fornecedor"),
    false
  );
  assert.match(COLUNAS_GRUPO_FISCAL_DEVOLUCAO, /icms_cst_csosn/);
  const actions = fonte("app/fiscal/entradas/devolucao-actions.ts");
  const emitir = fonte(
    "app/api/fiscal/geranet/nfe-emitir-devolucao-fornecedor/route.ts"
  );
  assert.doesNotMatch(actions, /icms_cst_csosn_devolucao_fornecedor/);
  assert.doesNotMatch(emitir, /icms_cst_csosn_devolucao_fornecedor/);
  assert.match(actions, /grupoFiscalIdParaDevolucaoFornecedor/);
  assert.match(emitir, /grupoFiscalIdParaDevolucaoFornecedor/);
});
