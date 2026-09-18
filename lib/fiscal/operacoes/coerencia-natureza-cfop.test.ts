import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { nfeVendaNovaExigeCaixa } from "@/lib/caixa/nfe-venda";
import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import {
  FLUXO_MATRIZ_SUPORTA_EXTERIOR,
  MENSAGEM_FIN_NFE_5_6_NAO_SUPORTADA,
  TEXTO_AJUDA_CFOP_SAIDA,
  TEXTO_AJUDA_REGRAS_CFOP,
  cfopCatalogadoComoDevolucaoOuRetorno,
  cfopCompativelComTpNf,
  cfopsParaMatriz,
  tipoExigeDocumentoFiscalReferenciado,
  validarCfopNaMatrizNatureza,
  validarCoerenciaNatureza,
  validarDocumentoFiscalReferenciado,
} from "./coerencia-natureza-cfop";
import { ehFinNfeSuportada } from "./catalogo";
import { resolverCfopEfetivo } from "./resolver-cfop";
import { naturezaEstaCompleta } from "./resolver-natureza";
import { classificarOperacaoNfe } from "./validar-operacao-nfe";
import { verificarOperacaoFiscal } from "./verificar-operacao";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

const naturezaVenda = {
  id: "nat-venda",
  empresa_id: "emp-1",
  tipo_operacao_interno: "venda",
  descricao: "Venda de mercadoria",
  tp_nf: "1",
  fin_nfe: "1",
  padrao: true,
  ativo: true,
};

const itemBase = {
  id: "item-1",
  descricao: "Produto A",
  produtoId: "prod-1",
  produtoEmpresaId: "emp-1",
  grupoFiscalId: "gf-1",
  grupoFiscalEmpresaId: "emp-1",
  grupoFiscalNome: "Mercadorias",
  icmsCstCsosn: "102",
  ncm: "85177099",
  quantidade: 1,
  valorUnitario: 10,
};

test("venda + tpNF 1 + finNFe 1 é válida", () => {
  const coerencia = validarCoerenciaNatureza({
    tipoOperacaoInterno: "venda",
    tpNf: "1",
    finNfe: "1",
  });
  assert.equal(coerencia.ok, true);
  assert.equal(naturezaEstaCompleta(naturezaVenda, "emp-1"), true);
  const status = classificarOperacaoNfe({
    codigo: "venda",
    natureza: naturezaVenda,
    empresaIdAtiva: "emp-1",
  });
  assert.equal(status.podeChegarEmitir, true);
});

test("saída aceita estruturalmente CFOP 5xxx e 6xxx", () => {
  assert.equal(cfopCompativelComTpNf("5102", "1"), true);
  assert.equal(cfopCompativelComTpNf("6102", "1"), true);
  assert.equal(
    validarCfopNaMatrizNatureza({
      cfop: "5102",
      tpNf: "1",
      tipoDestino: "interna",
      tipoOperacaoInterno: "venda",
      finNfe: "1",
    }).ok,
    true
  );
  assert.equal(
    validarCfopNaMatrizNatureza({
      cfop: "6102",
      tpNf: "1",
      tipoDestino: "interestadual",
      tipoOperacaoInterno: "venda",
      finNfe: "1",
    }).ok,
    true
  );
});

test("saída + CFOP 7xxx só seria permitido se o fluxo de exterior existisse", () => {
  assert.equal(FLUXO_MATRIZ_SUPORTA_EXTERIOR, false);
  assert.equal(cfopCompativelComTpNf("7102", "1"), true);
  const resultado = validarCfopNaMatrizNatureza({
    cfop: "7102",
    tpNf: "1",
    tipoDestino: "interna",
    tipoOperacaoInterno: "venda",
    finNfe: "1",
  });
  assert.equal(resultado.ok, false);
  if (!resultado.ok) {
    assert.match(resultado.mensagem, /exterior/i);
  }
});

test("saída + CFOP 1xxx é bloqueado", () => {
  const resultado = validarCfopNaMatrizNatureza({
    cfop: "1102",
    tpNf: "1",
    tipoDestino: "interna",
    tipoOperacaoInterno: "venda",
    finNfe: "1",
  });
  assert.equal(resultado.ok, false);
  if (!resultado.ok) {
    assert.match(resultado.mensagem, /entrada/);
  }
  const resolvido = resolverCfopEfetivo({
    tipoOperacaoInterno: "venda",
    tipoDestino: "interna",
    naturezaId: "nat-venda",
    grupoFiscalId: "gf-1",
    empresaIdAtiva: "emp-1",
    tpNf: "1",
    finNfe: "1",
    regras: [
      {
        empresaId: "emp-1",
        naturezaId: "nat-venda",
        grupoFiscalId: "gf-1",
        tipoDestino: "interna",
        cfop: "1102",
        ativo: true,
      },
    ],
  });
  assert.equal(resolvido.ok, false);
});

test("entrada + CFOP 5xxx é bloqueado", () => {
  const resultado = validarCfopNaMatrizNatureza({
    cfop: "5102",
    tpNf: "0",
    tipoDestino: "interna",
    tipoOperacaoInterno: "devolucao_venda",
    finNfe: "4",
  });
  assert.equal(resultado.ok, false);
  if (!resultado.ok) {
    assert.match(resultado.mensagem, /saída/);
  }
});

test("venda normal + CFOP exclusivo de devolução é bloqueado", () => {
  assert.equal(cfopCatalogadoComoDevolucaoOuRetorno("5202"), true);
  assert.equal(cfopCatalogadoComoDevolucaoOuRetorno("5102"), false);
  const naMatriz = validarCfopNaMatrizNatureza({
    cfop: "5202",
    tpNf: "1",
    tipoDestino: "interna",
    tipoOperacaoInterno: "venda",
    finNfe: "1",
  });
  assert.equal(naMatriz.ok, false);
  if (!naMatriz.ok) {
    assert.match(naMatriz.mensagem, /devolução\/retorno/i);
  }
  assert.equal(
    cfopsParaMatriz({
      tpNf: "1",
      tipoDestino: "interna",
      tipoOperacaoInterno: "venda",
      finNfe: "1",
    }).some((item) => item.codigo === "5202"),
    false
  );
  assert.equal(
    cfopsParaMatriz({
      tpNf: "1",
      tipoDestino: "interna",
      tipoOperacaoInterno: "venda",
      finNfe: "1",
    }).some((item) => item.codigo === "5102"),
    true
  );
});

test("devolução + finNFe diferente de 4 é bloqueada", () => {
  const compra = validarCoerenciaNatureza({
    tipoOperacaoInterno: "devolucao_fornecedor",
    tpNf: "1",
    finNfe: "1",
  });
  assert.equal(compra.ok, false);
  if (!compra.ok) {
    assert.match(compra.mensagem, /Devolução\/Retorno \(4\)/);
  }
  const venda = validarCoerenciaNatureza({
    tipoOperacaoInterno: "devolucao_venda",
    tpNf: "0",
    finNfe: "1",
  });
  assert.equal(venda.ok, false);
  assert.equal(
    naturezaEstaCompleta(
      {
        ...naturezaVenda,
        tipo_operacao_interno: "devolucao_fornecedor",
        fin_nfe: "1",
      },
      "emp-1"
    ),
    false
  );
});

test("devolução sem documento referenciado é bloqueada", () => {
  assert.equal(
    tipoExigeDocumentoFiscalReferenciado("devolucao_fornecedor"),
    true
  );
  assert.equal(tipoExigeDocumentoFiscalReferenciado("venda"), false);
  const semChave = validarDocumentoFiscalReferenciado({
    tipoOperacaoInterno: "devolucao_fornecedor",
    chaveDocumentoOrigem: "",
  });
  assert.equal(semChave.ok, false);
  const comChave = validarDocumentoFiscalReferenciado({
    tipoOperacaoInterno: "devolucao_fornecedor",
    chaveDocumentoOrigem: "35240111222333000155550010000012341000012345",
  });
  assert.equal(comChave.ok, true);
  assert.equal(
    tipoExigeDocumentoFiscalReferenciado("complementar"),
    true
  );
  assert.equal(tipoExigeDocumentoFiscalReferenciado("ajuste"), false);
});

test("devolução de compra exige CFOP de devolução na própria matriz", () => {
  const ok = validarCfopNaMatrizNatureza({
    cfop: "5202",
    tpNf: "1",
    tipoDestino: "interna",
    tipoOperacaoInterno: "devolucao_fornecedor",
    finNfe: "4",
  });
  assert.equal(ok.ok, true);
  const vendaCfop = validarCfopNaMatrizNatureza({
    cfop: "5102",
    tpNf: "1",
    tipoDestino: "interna",
    tipoOperacaoInterno: "devolucao_fornecedor",
    finNfe: "4",
  });
  assert.equal(vendaCfop.ok, false);
  const resolvido = resolverCfopEfetivo({
    tipoOperacaoInterno: "devolucao_fornecedor",
    tipoDestino: "interna",
    naturezaId: "nat-dev-compra",
    grupoFiscalId: "gf-1",
    empresaIdAtiva: "emp-1",
    tpNf: "1",
    finNfe: "4",
    grupoFiscal: { cfopInterno: "5102", cfopInterestadual: "6102" },
    regras: [],
  });
  assert.equal(resolvido.ok, false);
});

test("CFOP pode variar entre itens da mesma NF-e", () => {
  const verificacao = verificarOperacaoFiscal({
    empresaIdAtiva: "emp-1",
    tipoOperacaoInterno: "venda",
    natureza: naturezaVenda,
    ufEmpresa: "MT",
    ufDestinatario: "MT",
    destinatarioTipo: "cliente",
    destinatarioId: "cli-1",
    itens: [
      itemBase,
      {
        ...itemBase,
        id: "item-2",
        descricao: "Produto B",
        grupoFiscalId: "gf-2",
        grupoFiscalNome: "Ativo",
      },
    ],
    regrasCfop: [
      {
        empresaId: "emp-1",
        naturezaId: "nat-venda",
        grupoFiscalId: "gf-1",
        tipoDestino: "interna",
        cfop: "5102",
        ativo: true,
      },
      {
        empresaId: "emp-1",
        naturezaId: "nat-venda",
        grupoFiscalId: "gf-2",
        tipoDestino: "interna",
        cfop: "5551",
        ativo: true,
      },
    ],
    codigoRegimeTributario: 1,
    ambiente: "2",
    perfilIpi: "NAO_CONTRIBUINTE",
    modeloDocumento: "55",
  });
  assert.equal(verificacao.itens[0]?.cfop, "5102");
  assert.equal(verificacao.itens[1]?.cfop, "5551");
  assert.notEqual(verificacao.itens[0]?.cfop, verificacao.itens[1]?.cfop);
  assert.equal(
    verificacao.pendencias.some((item) => item.codigo === "cfop"),
    false
  );
});

test("empresa A não resolve regra de CFOP da empresa B", () => {
  const resolvido = resolverCfopEfetivo({
    tipoOperacaoInterno: "venda",
    tipoDestino: "interna",
    naturezaId: "nat-venda",
    grupoFiscalId: "gf-1",
    empresaIdAtiva: "emp-1",
    tpNf: "1",
    finNfe: "1",
    regras: [
      {
        empresaId: "emp-2",
        naturezaId: "nat-venda",
        grupoFiscalId: "gf-1",
        tipoDestino: "interna",
        cfop: "5551",
        ativo: true,
      },
    ],
  });
  assert.equal(resolvido.ok, false);
  assert.equal(
    registroPertenceAEmpresaAtiva({ empresa_id: "emp-2" }, "emp-1"),
    false
  );
});

test("venda exige caixa; devolução e remessa não exigem só por serem saída", () => {
  assert.equal(nfeVendaNovaExigeCaixa({ tipoOperacaoInterno: "venda" }), true);
  assert.equal(
    nfeVendaNovaExigeCaixa({ tipoOperacaoInterno: "devolucao_fornecedor" }),
    false
  );
  assert.equal(
    nfeVendaNovaExigeCaixa({ tipoOperacaoInterno: "remessa" }),
    false
  );
});

test("finNFe 5 e 6 continuam fora do schema, do XML e da interface", () => {
  assert.equal(ehFinNfeSuportada("5"), false);
  assert.equal(ehFinNfeSuportada("6"), false);
  const credito = validarCoerenciaNatureza({
    tipoOperacaoInterno: "nota_credito",
    tpNf: "1",
    finNfe: "1",
  });
  assert.equal(credito.ok, false);
  if (!credito.ok) {
    assert.equal(credito.mensagem, MENSAGEM_FIN_NFE_5_6_NAO_SUPORTADA);
  }
  const check = fonte(
    "supabase/migrations/20260817200000_fiscal_naturezas_operacao.sql"
  );
  assert.match(check, /fin_nfe in \('1', '2', '3', '4'\)/);
  const xml = fonte("lib/fiscal/geranet/montar-payload-nfe.ts");
  assert.match(
    xml.slice(
      xml.indexOf("export type FinalidadeNfe"),
      xml.indexOf("export type ModalidadeFreteNfe")
    ),
    /"1"|"2"|"3"|"4"/
  );
  assert.doesNotMatch(
    xml.slice(
      xml.indexOf("export type FinalidadeNfe"),
      xml.indexOf("export type ModalidadeFreteNfe")
    ),
    /"5"|"6"/
  );
  const form = fonte(
    "app/configuracoes/fiscal/naturezas/natureza-operacao-form.tsx"
  );
  assert.doesNotMatch(form, /value="5"|value="6"/);
});

test("textos da matriz de CFOP deixam de sugerir devolução em venda", () => {
  assert.match(TEXTO_AJUDA_REGRAS_CFOP, /natureza define o contexto/);
  assert.match(TEXTO_AJUDA_CFOP_SAIDA, /5xxx em operações internas/);
  assert.doesNotMatch(TEXTO_AJUDA_CFOP_SAIDA, /devolução ao fornecedor/);
  const form = fonte(
    "app/configuracoes/fiscal/naturezas/natureza-operacao-form.tsx"
  );
  const campos = fonte(
    "app/configuracoes/fiscal/naturezas/natureza-cfop-regras-campos.tsx"
  );
  const actions = fonte("app/configuracoes/fiscal/naturezas/actions.ts");
  assert.doesNotMatch(form, /inclusive devolução ao fornecedor/);
  assert.doesNotMatch(campos, /inclusive devolução ao fornecedor/);
  assert.match(actions, /validarCfopNaMatrizNatureza/);
  assert.match(actions, /validarCoerenciaNatureza/);
  assert.match(actions, /\.eq\("empresa_id", empresaId\)/);
  assert.doesNotMatch(actions, /insert\(\{[\s\S]*Venda de Produção/);
});

test("cadastros personalizados de venda continuam válidos se a identidade fiscal estiver coerente", () => {
  const personalizada = {
    ...naturezaVenda,
    id: "nat-ativo",
    descricao: "Venda de ativo imobilizado",
    padrao: false,
  };
  assert.equal(naturezaEstaCompleta(personalizada, "emp-1"), true);
  const resolvido = resolverCfopEfetivo({
    tipoOperacaoInterno: "venda",
    tipoDestino: "interna",
    naturezaId: "nat-ativo",
    grupoFiscalId: "gf-1",
    empresaIdAtiva: "emp-1",
    naturezaPadrao: false,
    tpNf: "1",
    finNfe: "1",
    regras: [
      {
        empresaId: "emp-1",
        naturezaId: "nat-ativo",
        grupoFiscalId: "gf-1",
        tipoDestino: "interna",
        cfop: "5551",
        ativo: true,
      },
    ],
  });
  assert.equal(resolvido.ok, true);
  if (resolvido.ok) {
    assert.equal(resolvido.cfop, "5551");
  }
});
