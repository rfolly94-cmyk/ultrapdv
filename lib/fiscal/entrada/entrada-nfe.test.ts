import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  registroPertenceAEmpresaAtiva,
} from "@/lib/empresa/assert-registro-empresa-ativa";
import {
  MENSAGEM_DESTINATARIO_DIVERGENTE,
  MENSAGEM_DOCUMENTO_OUTRA_EMPRESA,
  MENSAGEM_ENTRADA_JA_PROCESSADA,
  MENSAGEM_NFE_JA_IMPORTADA,
  MENSAGEM_PRODUTO_OUTRA_EMPRESA,
} from "./mensagens";
import {
  destinatarioConfereComEmpresa,
  parseXmlNfeEntrada,
} from "./parse-xml-nfe";
import {
  ncmDivergente,
  saldoDevolvivel,
  statusAposItens,
} from "./status";
import { sugerirProdutoEntrada } from "./sugerir-produto";

const CHAVE =
  "35240111222333000155550010000012341000012345";

function xmlNfe(params?: {
  chave?: string;
  dest?: string;
  ean?: string;
  cProd?: string;
  xProd?: string;
  ncm?: string;
  qtd?: string;
}) {
  const chave = params?.chave ?? CHAVE;
  const dest = params?.dest ?? "99888777000166";
  const ean = params?.ean ?? "7891234567890";
  const cProd = params?.cProd ?? "TEL-A32";
  const xProd = params?.xProd ?? "TELA SAMSUNG A32";
  const ncm = params?.ncm ?? "85177099";
  const qtd = params?.qtd ?? "10.0000";

  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe${chave}">
      <ide>
        <mod>55</mod>
        <serie>1</serie>
        <nNF>12345</nNF>
        <dhEmi>2026-08-17T10:00:00-03:00</dhEmi>
      </ide>
      <emit>
        <CNPJ>11222333000155</CNPJ>
        <xNome>FORNECEDOR ABC LTDA</xNome>
        <IE>123456789</IE>
      </emit>
      <dest>
        <CNPJ>${dest}</CNPJ>
      </dest>
      <det nItem="1">
        <prod>
          <cProd>${cProd}</cProd>
          <cEAN>${ean}</cEAN>
          <xProd>${xProd}</xProd>
          <NCM>${ncm}</NCM>
          <CEST>0100100</CEST>
          <CFOP>5102</CFOP>
          <uCom>UN</uCom>
          <qCom>${qtd}</qCom>
          <vUnCom>100.0000</vUnCom>
          <vProd>1000.00</vProd>
          <vDesc>0.00</vDesc>
          <vFrete>0.00</vFrete>
        </prod>
        <imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS></imposto>
      </det>
      <total>
        <ICMSTot>
          <vProd>1000.00</vProd>
          <vNF>1000.00</vNF>
        </ICMSTot>
      </total>
    </infNFe>
  </NFe>
  <protNFe>
    <infProt>
      <chNFe>${chave}</chNFe>
      <nProt>135260000000001</nProt>
    </infProt>
  </protNFe>
</nfeProc>`;
}

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

const migracao = fonte(
  "supabase/migrations/20260817250000_fiscal_documentos_entrada.sql"
);
const actions = fonte("app/fiscal/entradas/actions.ts");

test("A. XML válido cria documento parseado e não descreve movimento de estoque na importação", () => {
  const nfe = parseXmlNfeEntrada(xmlNfe());
  assert.equal(nfe.chaveAcesso, CHAVE);
  assert.equal(nfe.modelo, "55");
  assert.equal(nfe.serie, "1");
  assert.equal(nfe.numero, "12345");
  assert.equal(nfe.cnpjEmitente, "11222333000155");
  assert.equal(nfe.razaoSocialEmitente, "FORNECEDOR ABC LTDA");
  assert.equal(nfe.ieEmitente, "123456789");
  assert.equal(nfe.cnpjDestinatario, "99888777000166");
  assert.equal(nfe.valorTotal, 1000);
  assert.equal(nfe.protocolo, "135260000000001");
  assert.equal(nfe.itens.length, 1);
  assert.equal(nfe.itens[0].codigoFornecedor, "TEL-A32");
  assert.equal(nfe.itens[0].descricao, "TELA SAMSUNG A32");
  assert.equal(nfe.itens[0].ean, "7891234567890");
  assert.equal(nfe.itens[0].ncm, "85177099");
  assert.equal(nfe.itens[0].cest, "0100100");
  assert.equal(nfe.itens[0].cfop, "5102");
  assert.equal(nfe.itens[0].quantidade, 10);
  assert.equal(nfe.itens[0].valorUnitario, 100);
  assert.ok(nfe.itens[0].dadosFiscais.NCM);

  assert.match(migracao, /rpc_importar_documento_entrada/);
  assert.match(migracao, /Não movimenta estoque/);
  assert.doesNotMatch(
    migracao.split("rpc_importar_documento_entrada")[1].split("rpc_confirmar_entrada_nfe")[0] ?? "",
    /estoque_atual/
  );
  assert.match(actions, /O estoque ainda não foi movimentado/);
});

test("B. mesma chave na mesma empresa não duplica", () => {
  assert.match(migracao, /uq_fiscal_documentos_entrada_chave/);
  assert.match(migracao, /unique \(empresa_id, chave_acesso\)|on public\.fiscal_documentos_entrada \(empresa_id, chave_acesso\)/);
  assert.match(migracao, /ja_existia/);
  assert.match(actions, /MENSAGEM_NFE_JA_IMPORTADA/);
  assert.equal(
    MENSAGEM_NFE_JA_IMPORTADA,
    "Esta NF-e já foi importada para esta empresa."
  );
});

test("C. vinculação não chama RPC de estoque", () => {
  const trechoVincular = actions.slice(
    actions.indexOf("export async function vincularItemEntrada"),
    actions.indexOf("export async function criarProdutoEVincularItem")
  );
  assert.doesNotMatch(trechoVincular, /rpc_confirmar_entrada_nfe/);
  assert.doesNotMatch(trechoVincular, /estoque_atual/);
  assert.doesNotMatch(trechoVincular, /produtos_fiscal/);
  assert.match(trechoVincular, /O estoque ainda não foi movimentado/);
});

test("D/J. confirmar entrada usa estoque_atual e estoque_movimentacoes da fundação", () => {
  const rpc = migracao.slice(
    migracao.indexOf("rpc_confirmar_entrada_nfe")
  );
  assert.match(rpc, /insert into public\.estoque_atual/);
  assert.match(rpc, /update public\.estoque_atual/);
  assert.match(rpc, /insert into public\.estoque_movimentacoes/);
  assert.match(rpc, /tipo,\s*origem/);
  assert.match(rpc, /'ENTRADA'/);
  assert.match(rpc, /'NFE_ENTRADA'/);
  assert.match(rpc, /documento_entrada_id/);
  assert.match(rpc, /documento_entrada_item_id/);
  assert.doesNotMatch(rpc, /filial_id/);
  assert.match(actions, /rpc_confirmar_entrada_nfe/);
});

test("E. segunda confirmação é bloqueada", () => {
  assert.match(migracao, /Esta NF-e já teve a entrada de estoque processada/);
  assert.match(migracao, /uq_estoque_mov_entrada_item/);
  assert.equal(
    MENSAGEM_ENTRADA_JA_PROCESSADA,
    "Esta NF-e já teve a entrada de estoque processada."
  );
});

test("F. duas abas: FOR UPDATE + unique do item", () => {
  assert.match(migracao, /for update/);
  assert.match(migracao, /uq_estoque_mov_entrada_item/);
  assert.match(
    fonte("components/fiscal/entrada/entrada-detalhe.tsx"),
    /confirmando\.current/
  );
});

test("G. multiempresa: RLS e filtro da empresa ativa", () => {
  assert.match(migracao, /tem_acesso_empresa\(empresa_id\)/);
  assert.match(migracao, /tem_acesso_empresa\(p_empresa_id\)/);
  assert.match(actions, /\.eq\("empresa_id", empresaId\)/);
  assert.match(actions, /principal.*true/);
  assert.equal(
    registroPertenceAEmpresaAtiva(
      { empresa_id: "emp-a" },
      "emp-b"
    ),
    false
  );
  assert.equal(
    registroPertenceAEmpresaAtiva(
      { empresa_id: "emp-a" },
      "emp-a"
    ),
    true
  );
  assert.equal(MENSAGEM_DOCUMENTO_OUTRA_EMPRESA.includes("empresa ativa"), true);
});

test("H. produto de outra empresa é bloqueado", () => {
  assert.match(actions, /MENSAGEM_PRODUTO_OUTRA_EMPRESA/);
  assert.match(migracao, /Produto do item % não pertence à empresa ativa/);
  assert.equal(
    MENSAGEM_PRODUTO_OUTRA_EMPRESA,
    "O produto não pertence à empresa ativa."
  );
});

test("I. falha em um item faz rollback da transação da RPC", () => {
  const rpc = migracao.slice(
    migracao.indexOf("create or replace function public.rpc_confirmar_entrada_nfe")
  );
  assert.match(rpc, /language plpgsql/);
  assert.match(rpc, /raise exception 'Produto do item/);
  assert.doesNotMatch(rpc, /exception when others then/);
});

test("destinatário da NF-e deve ser o CNPJ da empresa ativa", () => {
  assert.equal(
    destinatarioConfereComEmpresa("99888777000166", "99888777000166"),
    true
  );
  assert.equal(
    destinatarioConfereComEmpresa("11222333000155", "99888777000166"),
    false
  );
  assert.match(actions, /MENSAGEM_DESTINATARIO_DIVERGENTE/);
  assert.equal(
    MENSAGEM_DESTINATARIO_DIVERGENTE,
    "A NF-e não é destinada ao CNPJ da empresa ativa."
  );
});

test("sugestão usa EAN, depois código, depois descrição, sem auto-vínculo de baixa confiança", () => {
  const produtos = [
    {
      id: "p1",
      empresa_id: "emp-1",
      codigo: "TEL-A32",
      codigo_barras: "7891234567890",
      nome: "Fronta A32 4G",
    },
    {
      id: "p2",
      empresa_id: "emp-2",
      codigo: "TEL-A32",
      codigo_barras: "7891234567890",
      nome: "Produto outra empresa",
    },
  ];

  const porEan = sugerirProdutoEntrada(
    { ean: "7891234567890", codigoFornecedor: "X", descricao: "Y" },
    produtos,
    "emp-1"
  );
  assert.equal(porEan?.produto.id, "p1");
  assert.equal(porEan?.confianca, "alta");

  const porCodigo = sugerirProdutoEntrada(
    { ean: "", codigoFornecedor: "TEL-A32", descricao: "Y" },
    produtos,
    "emp-1"
  );
  assert.equal(porCodigo?.confianca, "media");

  const porNome = sugerirProdutoEntrada(
    { ean: "", codigoFornecedor: "", descricao: "Fronta A32 4G" },
    produtos,
    "emp-1"
  );
  assert.equal(porNome?.confianca, "baixa");

  const ui = fonte("components/fiscal/entrada/entrada-detalhe.tsx");
  assert.match(ui, /Cadastrar novo produto/);
  assert.match(ui, /Vínculo salvo/);
  assert.equal(
    sugerirProdutoEntrada(
      { ean: "7891234567890" },
      produtos,
      "emp-2"
    )?.produto.id,
    "p2"
  );
});

test("status e conferência: quantidade recebida e divergência de NCM", () => {
  assert.equal(
    statusAposItens([
      { produto_id: null, quantidade_xml: 10, quantidade_recebida: 10 },
    ]),
    "aguardando_vinculacao"
  );
  assert.equal(
    statusAposItens([
      { produto_id: "p1", quantidade_xml: 10, quantidade_recebida: 10 },
    ]),
    "pronta_para_entrada"
  );
  assert.equal(
    statusAposItens([
      { produto_id: "p1", quantidade_xml: 10, quantidade_recebida: 8 },
    ]),
    "aguardando_conferencia"
  );
  assert.equal(ncmDivergente("85177099", "85171200"), true);
  assert.equal(ncmDivergente("85177099", "85177099"), false);
  assert.equal(
    saldoDevolvivel({
      quantidadeEntradaEfetivada: 10,
      quantidadeJaDevolvida: 0,
    }),
    10
  );
  assert.equal(
    saldoDevolvivel({
      quantidadeEntradaEfetivada: 10,
      quantidadeJaDevolvida: 3,
    }),
    7
  );
});

test("cadastro fiscal de saída não é copiado da NF-e de entrada", () => {
  const criar = actions.slice(
    actions.indexOf("export async function criarProdutoEVincularItem")
  );
  assert.match(criar, /produtos_fiscal/);
  assert.match(criar, /ncm/);
  assert.doesNotMatch(criar, /csosn|cst_pis|cst_cofins|cfop_venda/);
  assert.doesNotMatch(migracao, /update public\.produtos_fiscal/);
  assert.doesNotMatch(migracao, /update public\.produtos /);
});

test("Geranet DF-e recebido permanece em desenvolvimento", () => {
  const lista = fonte("components/fiscal/entrada/entradas-lista.tsx");
  assert.match(lista, /Buscar documentos recebidos/);
  assert.match(lista, /disabled/);
  assert.match(
    fonte("lib/fiscal/geranet/consultar-emissao.ts"),
    /consultar-notas é distribuição DF-e/
  );
});

test("evento XML não é importado como NF-e", () => {
  assert.throws(
    () =>
      parseXmlNfeEntrada(
        `<?xml version="1.0"?><procEventoNFe><infEvento>cancelamento</infEvento></procEventoNFe>`
      ),
    /evento/
  );
});

test("menu Fiscal operacional não mistura configuração", () => {
  const tabs = fonte("components/fiscal/fiscal-module-tabs.tsx");
  assert.match(tabs, /Documentos fiscais/);
  assert.match(tabs, /Notas de entrada/);
  assert.match(tabs, /\/fiscal\/entradas/);
  assert.doesNotMatch(tabs, /Naturezas/);
  assert.doesNotMatch(tabs, /Nova NF-e/);
  assert.doesNotMatch(tabs, /\/configuracoes\/fiscal/);
});

test("RPCs de entrada não deixam status ambíguo no PL/pgSQL", () => {
  const hotfix = fonte(
    "supabase/migrations/20260817270000_fix_status_ambiguo_entrada.sql"
  );
  assert.match(hotfix, /#variable_conflict use_column/);
  assert.match(hotfix, /update public\.fiscal_documentos_entrada as d/);
  assert.match(hotfix, /and d\.status is distinct from 'entrada_concluida'/);
  assert.match(migracao, /#variable_conflict use_column/);
});
