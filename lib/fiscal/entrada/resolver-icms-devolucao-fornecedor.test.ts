import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { parseTributosOriginaisNfe } from "./parse-xml-nfe";
import { montarItemDevolucaoFornecedor } from "./montar-item-devolucao";
import { verificarDevolucaoFornecedor } from "./verificar-devolucao";
import {
  resolverIcmsDevolucaoFornecedor,
  valoresProporcionaisDevolucao,
} from "./resolver-icms-devolucao-fornecedor";
import { resolverCfopEfetivo } from "@/lib/fiscal/operacoes/resolver-cfop";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

const xmlCst = `
  <imposto>
    <ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>100.00</vBC><pICMS>18.00</pICMS><vICMS>18.00</vICMS></ICMS00></ICMS>
    <PIS><PISAliq><CST>01</CST><pPIS>1.65</pPIS></PISAliq></PIS>
    <COFINS><COFINSAliq><CST>01</CST><pCOFINS>7.60</pCOFINS></COFINSAliq></COFINS>
  </imposto>
`;

const xmlCst60 = `
  <imposto>
    <ICMS><ICMS60><orig>0</orig><CST>60</CST><vBCSTRet>100.00</vBCSTRet><pST>18.00</pST><vICMSSTRet>18.00</vICMSSTRet></ICMS60></ICMS>
    <PIS><PISAliq><CST>01</CST><pPIS>1.65</pPIS></PISAliq></PIS>
    <COFINS><COFINSAliq><CST>01</CST><pCOFINS>7.60</pCOFINS></COFINSAliq></COFINS>
  </imposto>
`;

const xmlCsosn = `
  <imposto>
    <ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS>
    <PIS><PISOutr><CST>99</CST><pPIS>0.00</pPIS></PISOutr></PIS>
    <COFINS><COFINSOutr><CST>99</CST><pCOFINS>0.00</pCOFINS></COFINSOutr></COFINS>
  </imposto>
`;

const naturezaDev = {
  id: "nat-dev",
  empresa_id: "emp-1",
  tipo_operacao_interno: "devolucao_fornecedor",
  descricao: "Devolução",
  tp_nf: "1",
  fin_nfe: "4",
  padrao: true,
  ativo: true,
};

test("A. XML com CST e sem CSOSN não acusa ausência de CSOSN", () => {
  const tributos = parseTributosOriginaisNfe(xmlCst);
  assert.equal(tributos.cstOriginal, "00");
  assert.equal(tributos.csosnOriginal, "");
  assert.equal(tributos.tipoGrupoIcms, "ICMS00");
  assert.equal(tributos.origem, "0");

  const montado = montarItemDevolucaoFornecedor({
    descricao: "PECAS PARA CELULAR",
    codigo: "1",
    unidade: "UN",
    ncm: "85177099",
    cfop: "6202",
    quantidade: 2,
    valorUnitario: 100,
    dadosFiscaisOriginal: { imposto: { xml: xmlCst } },
    regraIcmsDevolucao: "102",
    codigoRegimeTributario: 1,
    ambiente: "2",
    dataEmissao: new Date("2026-08-17"),
  });
  assert.equal(
    montado.pendencias.some((mensagem) => /não possui CSOSN/i.test(mensagem)),
    false
  );
  assert.equal(montado.item?.icmsCsosn, "102");
  assert.equal(montado.item?.icmsCst, undefined);
  assert.equal(montado.item?.origemProduto, "0");
});

test("B. XML com CSOSN é interpretado no snapshot original", () => {
  const tributos = parseTributosOriginaisNfe(xmlCsosn);
  assert.equal(tributos.csosnOriginal, "102");
  assert.equal(tributos.cstOriginal, "");
  assert.equal(tributos.tipoGrupoIcms, "ICMSSN102");
});

test("C. sem regra de CFOP bloqueia e não inventa 6202", () => {
  const resultado = resolverCfopEfetivo({
    tipoOperacaoInterno: "devolucao_fornecedor",
    tipoDestino: "interestadual",
    naturezaId: "nat-dev",
    grupoFiscalId: "grp-produtos",
    grupoFiscal: { nome: "Produtos", cfopInterestadual: "6102" },
    regras: [],
    empresaIdAtiva: "emp-1",
    naturezaDescricao: "Devolução",
  });
  assert.equal(resultado.ok, false);
  if (!resultado.ok) {
    assert.match(resultado.mensagem, /CFOP de devolução não configurado/);
    assert.match(resultado.mensagem, /Interestadual/);
    assert.match(resultado.mensagem, /Produtos/);
  }
  assert.doesNotMatch(JSON.stringify(resultado), /6202/);
  assert.doesNotMatch(JSON.stringify(resultado), /6102/);
});

test("D. com CFOP configurado na matriz da mesma empresa resolve", () => {
  const resultado = resolverCfopEfetivo({
    tipoOperacaoInterno: "devolucao_fornecedor",
    tipoDestino: "interestadual",
    naturezaId: "nat-dev",
    grupoFiscalId: "grp-produtos",
    grupoFiscal: { nome: "Produtos" },
    regras: [
      {
        empresaId: "emp-1",
        naturezaId: "nat-dev",
        grupoFiscalId: "grp-produtos",
        tipoDestino: "interestadual",
        cfop: "6202",
        ativo: true,
      },
    ],
    empresaIdAtiva: "emp-1",
    naturezaDescricao: "Devolução",
  });
  assert.equal(resultado.ok, true);
  if (resultado.ok) {
    assert.equal(resultado.cfop, "6202");
    assert.equal(resultado.origem, "regra_natureza");
  }
});

test("E. natureza de outra empresa é bloqueada", () => {
  assert.equal(
    registroPertenceAEmpresaAtiva({ empresa_id: "emp-b" }, "emp-a"),
    false
  );
});

test("F. regra de CFOP de outra empresa é ignorada", () => {
  const resultado = resolverCfopEfetivo({
    tipoOperacaoInterno: "devolucao_fornecedor",
    tipoDestino: "interestadual",
    naturezaId: "nat-dev",
    grupoFiscalId: "grp-produtos",
    regras: [
      {
        empresaId: "emp-b",
        naturezaId: "nat-dev",
        grupoFiscalId: "grp-produtos",
        tipoDestino: "interestadual",
        cfop: "6202",
        ativo: true,
      },
    ],
    empresaIdAtiva: "emp-a",
  });
  assert.equal(resultado.ok, false);
});

test("G. tributação original insuficiente bloqueia com mensagem específica, não CSOSN", () => {
  const tributos = parseTributosOriginaisNfe(xmlCst);
  const resultado = resolverIcmsDevolucaoFornecedor({
    codigoRegimeTributario: 1,
    ambiente: "2",
    dataEmissao: new Date("2026-08-17"),
    tributosOriginais: tributos,
    regraIcmsDevolucao: null,
    icmsCstCsosnGrupo: null,
    grupoFiscalNome: "Produtos",
  });
  assert.equal(resultado.ok, false);
  if (!resultado.ok) {
    assert.match(resultado.mensagem, /Não foi possível determinar a tributação de ICMS/);
    assert.match(resultado.mensagem, /CST 00/);
    assert.match(resultado.mensagem, /Simples Nacional/);
    assert.match(resultado.mensagem, /O grupo fiscal Produtos não possui CSOSN de ICMS configurado/);
    assert.doesNotMatch(resultado.mensagem, /não possui CSOSN da nota/);
    assert.doesNotMatch(resultado.mensagem, /Configure o CSOSN de devolução/);
  }
});

test("H. devolução parcial usa quantidade × unitário, não o total original", () => {
  const proporcional = valoresProporcionaisDevolucao({
    quantidadeOriginal: 10,
    quantidadeDevolucao: 2,
    valorUnitario: 100,
  });
  assert.equal(proporcional.ok, true);
  if (proporcional.ok) {
    assert.equal(proporcional.fator, 0.2);
    assert.equal(proporcional.valorBrutoItem, 200);
  }

  const montado = montarItemDevolucaoFornecedor({
    descricao: "PECAS",
    codigo: "1",
    unidade: "UN",
    ncm: "85177099",
    cfop: "6202",
    quantidade: 2,
    valorUnitario: 100,
    quantidadeOriginal: 10,
    dadosFiscaisOriginal: { imposto: { xml: xmlCst } },
    regraIcmsDevolucao: "102",
    codigoRegimeTributario: 1,
    ambiente: "2",
    dataEmissao: new Date("2026-08-17"),
  });
  assert.equal(montado.item?.valorTotal, "200.00");
  assert.equal(montado.item?.quantidade, (2).toFixed(8));
});

test("I. snapshot da verificação é o que a emissão reutiliza", () => {
  const actions = fonte("app/fiscal/entradas/devolucao-actions.ts");
  const emitir = fonte(
    "app/api/fiscal/geranet/nfe-emitir-devolucao-fornecedor/route.ts"
  );
  assert.match(actions, /icms_resolvido/);
  assert.match(actions, /cst_original/);
  assert.match(actions, /csosn_original/);
  assert.match(emitir, /snapshot_fiscal/);
  assert.match(emitir, /icms_resolvido/);
  assert.doesNotMatch(emitir, /montarItemGeranet\(/);
});

test("J. anti-retransmissão da devolução permanece intacta", () => {
  const emitir = fonte(
    "app/api/fiscal/geranet/nfe-emitir-devolucao-fornecedor/route.ts"
  );
  assert.match(emitir, /claimTentativaEmissaoFiscal/);
  assert.match(emitir, /aguardando_reconciliacao/);
  assert.match(emitir, /MENSAGEM_BLOQUEIO_RETRANSMISSAO/);
  assert.match(emitir, /podeRetransmitir: persistencia.retransmitir/);
});

test("verificação com CST original não gera erro de CSOSN e não duplica CFOP", () => {
  const resultado = verificarDevolucaoFornecedor({
    empresaIdAtiva: "emp-1",
    natureza: naturezaDev,
    chaveOrigem: "35240111222333000155550010000012341000012345",
    ufEmpresa: "MT",
    emitente: {
      cnpj: "11222333000155",
      razaoSocial: "FORN",
      ie: "123",
      logradouro: "Rua A",
      numero: "10",
      complemento: "",
      bairro: "Centro",
      municipio: "Cuiaba",
      codigoMunicipio: "5103403",
      uf: "SP",
      cep: "78000000",
      telefone: "",
    },
    itens: [
      {
        id: "i1",
        descricao: "PECAS PARA CELULAR",
        quantidade: 2,
        ncm: "85177099",
        valorUnitario: 100,
        codigoProduto: "1",
        grupoFiscalId: "g1",
        grupoFiscalNome: "Produtos",
        icmsCstCsosnGrupo: "500",
        dadosFiscaisOriginal: { imposto: { xml: xmlCst } },
      },
    ],
    regrasCfop: [],
    codigoRegimeTributario: 1,
    ambiente: "2",
    dataEmissao: new Date("2026-08-17"),
  });
  assert.equal(resultado.ok, false);
  const mensagens = resultado.pendencias.map((item) => item.mensagem).join("\n");
  assert.match(mensagens, /CFOP de devolução não configurado/);
  assert.doesNotMatch(mensagens, /não possui CSOSN/);
  assert.doesNotMatch(mensagens, /Não foi possível determinar a tributação de ICMS/);
  assert.doesNotMatch(mensagens, /Configure o CSOSN de devolução/);
  assert.equal(
    resultado.pendencias.filter((item) =>
      /CFOP da devolução não foi resolvido pela matriz/.test(item.mensagem)
    ).length,
    0
  );
});

const emitenteSp = {
  cnpj: "11222333000155",
  razaoSocial: "FORN",
  ie: "123",
  logradouro: "Rua A",
  numero: "10",
  complemento: "",
  bairro: "Centro",
  municipio: "Sao Paulo",
  codigoMunicipio: "3550308",
  uf: "SP",
  cep: "01001000",
  telefone: "",
};

function resolverCst60Simples(
  extra: Partial<Parameters<typeof resolverIcmsDevolucaoFornecedor>[0]> = {}
) {
  return resolverIcmsDevolucaoFornecedor({
    codigoRegimeTributario: 1,
    ambiente: "2",
    dataEmissao: new Date("2026-08-17"),
    tributosOriginais: parseTributosOriginaisNfe(xmlCst60),
    grupoFiscalNome: "Produtos",
    empresaIdAtiva: "emp-1",
    produtoEmpresaId: "emp-1",
    grupoFiscalEmpresaId: "emp-1",
    ...extra,
  });
}

test("A. Simples + grupo Produtos CSOSN 500 + XML CST 60 resolve 500 do grupo", () => {
  const tributos = parseTributosOriginaisNfe(xmlCst60);
  assert.equal(tributos.cstOriginal, "60");
  assert.equal(tributos.csosnOriginal, "");
  assert.equal(tributos.tipoGrupoIcms, "ICMS60");

  const resultado = resolverCst60Simples({
    regraIcmsDevolucao: null,
    icmsCstCsosnGrupo: "500",
  });
  assert.equal(resultado.ok, true);
  if (resultado.ok) {
    assert.equal(resultado.icmsCst, "500");
    assert.equal(resultado.origemCodigo, "grupo_fiscal");
    assert.equal(resultado.usaCsosn, true);
    assert.equal(resultado.cstOriginal, "60");
    assert.equal(resultado.csosnOriginal, "");
    assert.equal(resultado.origem, "0");
  }

  const montado = montarItemDevolucaoFornecedor({
    descricao: "PECAS PARA CELULAR",
    codigo: "1",
    unidade: "UN",
    ncm: "85177099",
    cfop: "6202",
    quantidade: 2,
    valorUnitario: 100,
    dadosFiscaisOriginal: { imposto: { xml: xmlCst60 } },
    icmsCstCsosnGrupo: "500",
    grupoFiscalNome: "Produtos",
    empresaIdAtiva: "emp-1",
    produtoEmpresaId: "emp-1",
    grupoFiscalEmpresaId: "emp-1",
    codigoRegimeTributario: 1,
    ambiente: "2",
    dataEmissao: new Date("2026-08-17"),
  });
  assert.equal(montado.item?.icmsCsosn, "500");
  assert.equal(montado.item?.icmsCst, undefined);
  assert.equal(
    montado.pendencias.some((mensagem) =>
      /Configure o CSOSN de devolução|Não foi possível determinar a tributação de ICMS/.test(
        mensagem
      )
    ),
    false
  );
});

test("override específico de devolução prevalece sobre o ICMS do grupo", () => {
  const resultado = resolverCst60Simples({
    regraIcmsDevolucao: "102",
    icmsCstCsosnGrupo: "500",
  });
  assert.equal(resultado.ok, true);
  if (resultado.ok) {
    assert.equal(resultado.icmsCst, "102");
    assert.equal(resultado.origemCodigo, "override");
  }
});

test("B. ICMS do grupo resolvido e ausência de CFOP bloqueia só o CFOP", () => {
  const resultado = verificarDevolucaoFornecedor({
    empresaIdAtiva: "emp-1",
    natureza: naturezaDev,
    chaveOrigem: "35240111222333000155550010000012341000012345",
    ufEmpresa: "MT",
    emitente: emitenteSp,
    itens: [
      {
        id: "i1",
        descricao: "PECAS PARA CELULAR",
        quantidade: 2,
        ncm: "85177099",
        valorUnitario: 100,
        codigoProduto: "1",
        grupoFiscalId: "g-produtos",
        grupoFiscalNome: "Produtos",
        icmsCstCsosnGrupo: "500",
        produtoEmpresaId: "emp-1",
        grupoFiscalEmpresaId: "emp-1",
        dadosFiscaisOriginal: { imposto: { xml: xmlCst60 } },
      },
    ],
    regrasCfop: [],
    codigoRegimeTributario: 1,
    ambiente: "2",
    dataEmissao: new Date("2026-08-17"),
  });
  assert.equal(resultado.ok, false);
  const mensagens = resultado.pendencias.map((item) => item.mensagem).join("\n");
  assert.match(mensagens, /CFOP de devolução não configurado/);
  assert.match(mensagens, /Natureza: Devolução/);
  assert.match(mensagens, /Grupo fiscal: Produtos/);
  assert.match(mensagens, /Destino: Interestadual/);
  assert.doesNotMatch(mensagens, /Não foi possível determinar a tributação de ICMS/);
  assert.doesNotMatch(mensagens, /Configure o CSOSN de devolução/);
  assert.doesNotMatch(mensagens, /6102/);
});

test("C. com regra CFOP na matriz, ICMS 500 do grupo e CFOP resolvem juntos", () => {
  const resultado = verificarDevolucaoFornecedor({
    empresaIdAtiva: "emp-1",
    natureza: naturezaDev,
    chaveOrigem: "35240111222333000155550010000012341000012345",
    ufEmpresa: "MT",
    emitente: emitenteSp,
    itens: [
      {
        id: "i1",
        descricao: "PECAS PARA CELULAR",
        quantidade: 2,
        ncm: "85177099",
        valorUnitario: 100,
        codigoProduto: "1",
        grupoFiscalId: "g-produtos",
        grupoFiscalNome: "Produtos",
        icmsCstCsosnGrupo: "500",
        produtoEmpresaId: "emp-1",
        grupoFiscalEmpresaId: "emp-1",
        dadosFiscaisOriginal: { imposto: { xml: xmlCst60 } },
      },
    ],
    regrasCfop: [
      {
        empresaId: "emp-1",
        naturezaId: "nat-dev",
        grupoFiscalId: "g-produtos",
        tipoDestino: "interestadual",
        cfop: "6202",
        ativo: true,
      },
    ],
    codigoRegimeTributario: 1,
    ambiente: "2",
    dataEmissao: new Date("2026-08-17"),
  });
  const mensagens = resultado.pendencias.map((item) => item.mensagem).join("\n");
  assert.doesNotMatch(mensagens, /Não foi possível determinar a tributação de ICMS/);
  assert.doesNotMatch(mensagens, /CFOP de devolução não configurado/);
  assert.equal(resultado.itens[0]?.cfop, "6202");
  assert.equal(resultado.ok, true);
});

test("D. produto de outro grupo usa o ICMS daquele grupo, não o de Produtos", () => {
  const pecas = resolverCst60Simples({
    icmsCstCsosnGrupo: "102",
    grupoFiscalNome: "Peças",
  });
  const produtos = resolverCst60Simples({
    icmsCstCsosnGrupo: "500",
    grupoFiscalNome: "Produtos",
  });
  assert.equal(pecas.ok, true);
  assert.equal(produtos.ok, true);
  if (pecas.ok && produtos.ok) {
    assert.equal(pecas.icmsCst, "102");
    assert.equal(produtos.icmsCst, "500");
  }
});

test("E. grupo ou produto de outra empresa é bloqueado", () => {
  const grupoOutra = resolverCst60Simples({
    icmsCstCsosnGrupo: "500",
    grupoFiscalEmpresaId: "emp-b",
  });
  assert.equal(grupoOutra.ok, false);
  if (!grupoOutra.ok) {
    assert.match(grupoOutra.mensagem, /não pertence à empresa ativa/);
  }

  const produtoOutra = resolverCst60Simples({
    icmsCstCsosnGrupo: "500",
    produtoEmpresaId: "emp-b",
  });
  assert.equal(produtoOutra.ok, false);
  assert.equal(
    registroPertenceAEmpresaAtiva({ empresa_id: "emp-b" }, "emp-1"),
    false
  );
});

test("F. grupo sem CST/CSOSN bloqueia com mensagem clara", () => {
  const resultado = resolverCst60Simples({
    regraIcmsDevolucao: null,
    icmsCstCsosnGrupo: null,
  });
  assert.equal(resultado.ok, false);
  if (!resultado.ok) {
    assert.match(resultado.mensagem, /O grupo fiscal Produtos não possui CSOSN de ICMS configurado/);
    assert.match(resultado.mensagem, /CST 60/);
    assert.match(resultado.mensagem, /Simples Nacional/);
    assert.doesNotMatch(resultado.mensagem, /Configure o CSOSN de devolução/);
  }
});

test("G. código incompatível com CRT bloqueia e não converte CST em CSOSN", () => {
  const simplesComCst = resolverCst60Simples({
    icmsCstCsosnGrupo: "060",
  });
  assert.equal(simplesComCst.ok, false);
  if (!simplesComCst.ok) {
    assert.match(simplesComCst.mensagem, /O grupo fiscal Produtos possui ICMS 060 configurado/);
    assert.match(simplesComCst.mensagem, /Simples Nacional/);
    assert.match(simplesComCst.mensagem, /Revise a configuração fiscal do grupo/);
  }

  const normalComCsosn = resolverIcmsDevolucaoFornecedor({
    codigoRegimeTributario: 3,
    ambiente: "2",
    dataEmissao: new Date("2026-08-17"),
    tributosOriginais: parseTributosOriginaisNfe(xmlCst60),
    icmsCstCsosnGrupo: "500",
    grupoFiscalNome: "Produtos",
    empresaIdAtiva: "emp-1",
    produtoEmpresaId: "emp-1",
    grupoFiscalEmpresaId: "emp-1",
  });
  assert.equal(normalComCsosn.ok, false);
  if (!normalComCsosn.ok) {
    assert.match(normalComCsosn.mensagem, /possui ICMS 500 configurado/);
    assert.match(normalComCsosn.mensagem, /Regime Normal/);
  }
});

test("não hardcodar CST 60 da nota original para CSOSN 500", () => {
  const resolver = fonte("lib/fiscal/entrada/resolver-icms-devolucao-fornecedor.ts");
  assert.doesNotMatch(resolver, /cstOriginal\s*===\s*["']60["']/);
  assert.doesNotMatch(resolver, /=== ["']60["'][\s\S]{0,120}["']500["']/);

  const semGrupo = resolverCst60Simples({ icmsCstCsosnGrupo: null });
  assert.equal(semGrupo.ok, false);

  const outroGrupo = resolverCst60Simples({
    icmsCstCsosnGrupo: "102",
    grupoFiscalNome: "Outro",
  });
  assert.equal(outroGrupo.ok, true);
  if (outroGrupo.ok) {
    assert.equal(outroGrupo.icmsCst, "102");
  }
});

test("actions e emissão herdam icms_cst_csosn do grupo atual do produto", () => {
  const actions = fonte("app/fiscal/entradas/devolucao-actions.ts");
  const emitir = fonte(
    "app/api/fiscal/geranet/nfe-emitir-devolucao-fornecedor/route.ts"
  );
  assert.match(actions, /icmsCstCsosnGrupo: grupo\?\.icms_cst_csosn/);
  assert.match(emitir, /icmsCstCsosnGrupo: grupo\?\.icms_cst_csosn/);
  assert.match(actions, /produtoGrupoFiscalId: produto\?\.grupo_fiscal_id/);
  assert.match(emitir, /produtoGrupoFiscalId: produto\?\.grupo_fiscal_id/);
  assert.match(actions, /COLUNAS_GRUPO_FISCAL_DEVOLUCAO/);
  assert.match(emitir, /COLUNAS_GRUPO_FISCAL_DEVOLUCAO/);
  assert.doesNotMatch(actions, /icms_cst_csosn_devolucao_fornecedor/);
  assert.doesNotMatch(emitir, /icms_cst_csosn_devolucao_fornecedor/);
  assert.match(actions, /registroPertenceAEmpresaAtiva\(grupo, empresaId\)/);
  assert.match(emitir, /registroPertenceAEmpresaAtiva\(grupo, empresaId\)/);
});

