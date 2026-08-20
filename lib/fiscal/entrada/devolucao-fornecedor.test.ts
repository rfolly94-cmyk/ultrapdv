import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import {
  MENSAGEM_DEVOLUCAO_ENTRADA_NAO_PROCESSADA,
  MENSAGEM_DEVOLUCAO_SALDO_INSUFICIENTE,
} from "./mensagens";
import {
  devolucaoPodeConfirmarSaida,
  devolucaoReservaSaldo,
  saldoDevolvivelItem,
} from "./devolucao-status";
import {
  parseEmitenteNfeEntrada,
  parseTributosOriginaisNfe,
  parseXmlNfeEntrada,
} from "./parse-xml-nfe";
import { verificarDevolucaoFornecedor } from "./verificar-devolucao";
import {
  MENSAGEM_NATUREZA_DEVOLUCAO_FORNECEDOR_INVALIDA,
} from "@/lib/fiscal/operacoes/catalogo";
import { tipoDestinoPorUf, resolverCfopEfetivo } from "@/lib/fiscal/operacoes/resolver-cfop";
import { escolherNaturezaParaDevolucaoFornecedor } from "@/lib/fiscal/operacoes/resolver-natureza";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

const migracao = fonte(
  "supabase/migrations/20260817260000_fiscal_devolucoes_fornecedor.sql"
);
const actions = fonte("app/fiscal/entradas/devolucao-actions.ts");
const emitir = fonte(
  "app/api/fiscal/geranet/nfe-emitir-devolucao-fornecedor/route.ts"
);
const emitirVenda = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
const editorUi = fonte(
  "components/fiscal/entrada/devolucao-fornecedor-detalhe.tsx"
);
const editorComum = fonte("components/fiscal/nfe55/nfe55-editor.tsx");
const migracaoEditor = fonte(
  "supabase/migrations/20260817320000_nfe55_editor_devolucao.sql"
);

const xml = `<?xml version="1.0"?>
<nfeProc>
  <NFe>
    <infNFe Id="NFe35240111222333000155550010000012341000012345">
      <ide><mod>55</mod><serie>1</serie><nNF>12345</nNF></ide>
      <emit>
        <CNPJ>11222333000155</CNPJ>
        <xNome>FORNECEDOR ABC</xNome>
        <IE>123</IE>
        <enderEmit>
          <xLgr>Rua A</xLgr><nro>10</nro><xBairro>Centro</xBairro>
          <cMun>3550308</cMun><xMun>Sao Paulo</xMun><UF>SP</UF>
          <CEP>01001000</CEP>
        </enderEmit>
      </emit>
      <dest><CNPJ>99888777000166</CNPJ></dest>
      <det nItem="1">
        <prod>
          <cProd>TEL</cProd><cEAN>7891234567890</cEAN>
          <xProd>TELA A32</xProd><NCM>85177099</NCM>
          <CFOP>5102</CFOP><uCom>UN</uCom>
          <qCom>10.0000</qCom><vUnCom>100.0000</vUnCom><vProd>1000.00</vProd>
        </prod>
        <imposto>
          <ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS>
          <PIS><PISOutr><CST>99</CST><pPIS>0.00</pPIS></PISOutr></PIS>
          <COFINS><COFINSOutr><CST>99</CST><pCOFINS>0.00</pCOFINS></COFINSOutr></COFINS>
        </imposto>
      </det>
      <total><ICMSTot><vProd>1000.00</vProd><vNF>1000.00</vNF></ICMSTot></total>
    </infNFe>
  </NFe>
</nfeProc>`;

const naturezaDev = {
  id: "nat-dev-forn",
  empresa_id: "emp-1",
  tipo_operacao_interno: "devolucao_fornecedor",
  descricao: "Devolução de compra",
  tp_nf: "1",
  fin_nfe: "4",
  padrao: true,
  ativo: true,
};

test("A. entrada não processada não pode devolver", () => {
  assert.match(migracao, /entrada_concluida/);
  assert.match(actions, /MENSAGEM_DEVOLUCAO_ENTRADA_NAO_PROCESSADA/);
  assert.equal(
    MENSAGEM_DEVOLUCAO_ENTRADA_NAO_PROCESSADA.includes("já processada"),
    true
  );
  const ui = fonte("components/fiscal/entrada/entrada-detalhe.tsx");
  assert.match(ui, /entrada_concluida/);
  assert.match(ui, /\/devolver/);
});

test("B/C. saldo devolvível parcial e excesso", () => {
  const reservas = [
    { quantidade: 2, status: "concluida" },
  ];
  assert.equal(
    saldoDevolvivelItem({
      quantidadeEntradaEfetivada: 10,
      reservas,
    }),
    8
  );
  assert.equal(
    saldoDevolvivelItem({
      quantidadeEntradaEfetivada: 10,
      reservas: [
        { quantidade: 8, status: "aguardando_saida" },
      ],
    }),
    2
  );
  assert.ok(
    3 >
      saldoDevolvivelItem({
        quantidadeEntradaEfetivada: 10,
        reservas: [{ quantidade: 8, status: "autorizada" }],
      })
  );
  assert.match(migracao, /excede o saldo devolvível/);
  assert.match(actions, /MENSAGEM_DEVOLUCAO_SALDO_INSUFICIENTE/);
  assert.equal(devolucaoReservaSaldo("rascunho"), true);
  assert.equal(devolucaoReservaSaldo("cancelada"), false);
  assert.equal(MENSAGEM_DEVOLUCAO_SALDO_INSUFICIENTE.includes("excede"), true);
});

test("D. natureza venda é bloqueada", () => {
  const resultado = escolherNaturezaParaDevolucaoFornecedor({
    empresaIdAtiva: "emp-1",
    naturezaId: "nat-venda",
    naturezas: [
      {
        ...naturezaDev,
        id: "nat-venda",
        tipo_operacao_interno: "venda",
        descricao: "Venda",
        fin_nfe: "1",
      },
    ],
  });
  assert.equal(resultado.ok, false);
  if (!resultado.ok) {
    assert.equal(resultado.mensagem, MENSAGEM_NATUREZA_DEVOLUCAO_FORNECEDOR_INVALIDA);
  }
  assert.match(migracao, /devolucao_fornecedor/);
  assert.match(migracao, /só pode usar natureza do tipo devolucao_fornecedor/);
});

test("E. natureza de outra empresa é bloqueada", () => {
  const resultado = escolherNaturezaParaDevolucaoFornecedor({
    empresaIdAtiva: "emp-a",
    naturezaId: "nat-dev-forn",
    naturezas: [{ ...naturezaDev, empresa_id: "emp-b" }],
  });
  assert.equal(resultado.ok, false);
  assert.equal(
    registroPertenceAEmpresaAtiva({ empresa_id: "emp-b" }, "emp-a"),
    false
  );
});

test("F. sem regra de CFOP bloqueia e não inventa 5202", () => {
  const resultado = resolverCfopEfetivo({
    tipoOperacaoInterno: "devolucao_fornecedor",
    tipoDestino: "interna",
    naturezaId: "nat-dev-forn",
    grupoFiscalId: "grp-1",
    grupoFiscal: { nome: "Geral", cfopInterno: "5102" },
    regras: [],
    empresaIdAtiva: "emp-1",
    naturezaDescricao: "Devolução de compra",
  });
  assert.equal(resultado.ok, false);
  if (!resultado.ok) {
    assert.match(resultado.mensagem, /CFOP de devolução não configurado/);
    assert.match(resultado.mensagem, /Devolução de compra/);
    assert.match(resultado.mensagem, /Geral/);
    assert.match(resultado.mensagem, /Interna/);
  }
  assert.doesNotMatch(JSON.stringify(resultado), /5202|6202/);
});

test("G. referência usa a chave da NF-e de entrada original", () => {
  const nfe = parseXmlNfeEntrada(xml);
  assert.equal(nfe.chaveAcesso.length, 44);
  assert.match(emitir, /notaFiscalReferencia/);
  assert.match(emitir, /chave_documento_origem/);
  assert.match(migracao, /chave_documento_origem text not null/);
  assert.doesNotMatch(actions, /chaveAcesso:\s*input/);
});

test("H. rascunho não movimenta estoque", () => {
  const criar = actions.slice(
    actions.indexOf("export async function criarDevolucaoFornecedor"),
    actions.indexOf("export async function salvarNaturezaDevolucaoFornecedor")
  );
  assert.doesNotMatch(criar, /estoque_atual/);
  assert.doesNotMatch(criar, /rpc_confirmar_saida/);
  assert.match(criar, /O estoque ainda não foi movimentado/);
});

test("I. autorização não confirma saída", () => {
  assert.match(emitir, /O estoque ainda não foi movimentado/);
  assert.doesNotMatch(emitir, /rpc_confirmar_saida_devolucao_fornecedor/);
  assert.match(emitir, /aguardando_saida/);
});

test("J/K. saída atômica e idempotente", () => {
  assert.match(migracao, /rpc_confirmar_saida_devolucao_fornecedor/);
  assert.match(migracao, /for update/);
  assert.match(migracao, /uq_estoque_mov_devolucao_fornecedor_item/);
  assert.match(migracao, /DEVOLUCAO_FORNECEDOR/);
  assert.match(migracao, /estoque_atual/);
  assert.match(migracao, /estoque_movimentacoes/);
  assert.equal(devolucaoPodeConfirmarSaida("aguardando_saida"), true);
  assert.equal(devolucaoPodeConfirmarSaida("rascunho"), false);
  const ui = fonte("components/fiscal/entrada/devolucao-fornecedor-detalhe.tsx");
  assert.match(ui, /saindo\.current/);
});

test("L. timeout vai para reconciliação e não retransmite", () => {
  assert.match(emitir, /claimTentativaEmissaoFiscal/);
  assert.match(emitir, /persistenciaFalhaComunicacaoEmitir/);
  assert.match(emitir, /aguardando_reconciliacao/);
  assert.match(emitir, /MENSAGEM_BLOQUEIO_RETRANSMISSAO/);
  assert.match(emitir, /podeRetransmitir: persistencia.retransmitir/);
  assert.match(emitir, /\/api\/v1\/nfe\/emitir/);
});

test("M. reconciliação autorizada permite confirmar saída", () => {
  const pagina = fonte("app/fiscal/entradas/devolucoes/[id]/page.tsx");
  assert.match(pagina, /autorizada/);
  assert.match(pagina, /aguardando_saida/);
  assert.match(
    fonte("components/fiscal/entrada/devolucao-fornecedor-detalhe.tsx"),
    /EmissaoFiscalAcoes/
  );
  assert.match(
    fonte("components/fiscal/emissao-fiscal-acoes.tsx"),
    /ReconciliarEmissaoFiscal/
  );
  assert.match(
    fonte("app/api/fiscal/emissoes/[id]/reconciliar/route.ts"),
    /reconciliarEmissaoFiscal/
  );
});

test("não cria venda falsa e não altera emissão de venda", () => {
  assert.match(migracao, /origem_tipo=devolucao_fornecedor/);
  assert.match(emitir, /p_origem_tipo:\s*"devolucao_fornecedor"/);
  assert.doesNotMatch(emitir, /from\("vendas"\)/);
  assert.match(emitirVenda, /p_origem_tipo:\s*"venda"/);
  assert.match(emitirVenda, /tipo_operacao_interno:\s*"venda"/);
});

test("UF interna vs interestadual reutiliza função única", () => {
  assert.equal(tipoDestinoPorUf("MT", "MT"), "interna");
  assert.equal(tipoDestinoPorUf("MT", "SP"), "interestadual");
  assert.equal(tipoDestinoPorUf("MT", ""), null);
});

test("tributos da devolução saem do XML original, não da venda", () => {
  const tributos = parseTributosOriginaisNfe(`
    <imposto>
      <ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS>
      <PIS><PISOutr><CST>99</CST><pPIS>0.00</pPIS></PISOutr></PIS>
      <COFINS><COFINSOutr><CST>99</CST><pCOFINS>0.00</pCOFINS></COFINSOutr></COFINS>
    </imposto>
  `);
  assert.equal(tributos.origem, "0");
  assert.equal(tributos.icmsCstCsosn, "102");
  assert.equal(tributos.pisCst, "99");
  assert.equal(tributos.pendencias.length, 0);
  assert.match(emitir, /montarItemDevolucaoFornecedor/);
  assert.doesNotMatch(emitir, /montarItemGeranet\(/);
});

test("verificação bloqueia sem endereço/CFOP/natureza", () => {
  const emitente = parseEmitenteNfeEntrada(xml);
  assert.equal(emitente.uf, "SP");
  const resultado = verificarDevolucaoFornecedor({
    empresaIdAtiva: "emp-1",
    natureza: naturezaDev,
    chaveOrigem: "35240111222333000155550010000012341000012345",
    ufEmpresa: "SP",
    emitente,
    itens: [
      {
        id: "i1",
        descricao: "Tela",
        quantidade: 2,
        ncm: "85177099",
        valorUnitario: 100,
        codigoProduto: "1",
        grupoFiscalId: "g1",
        dadosFiscaisOriginal: {
          imposto: {
            xml: "<ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS><PIS><CST>99</CST></PIS><COFINS><CST>99</CST></COFINS>",
          },
        },
      },
    ],
    regrasCfop: [],
    codigoRegimeTributario: 1,
    ambiente: "2",
    dataEmissao: new Date("2026-08-17"),
  });
  assert.equal(resultado.ok, false);
  assert.ok(resultado.pendencias.some((item) => /CFOP/i.test(item.mensagem)));
});

test("A/B. editor comum abre com origem da entrada e permite outras do mesmo fornecedor", () => {
  assert.match(editorComum, /Nfe55Editor/);
  assert.match(editorUi, /Nfe55Editor/);
  assert.match(editorUi, /AdicionarItensEntradaDevolucao/);
  assert.match(editorUi, /Documentos referenciados|documentosReferenciados/);
  assert.match(actions, /listarEntradasElegiveisDevolucao/);
  assert.match(actions, /adicionarItensDevolucaoFornecedor/);
  assert.match(actions, /\.eq\("cnpj_emitente"/);
  assert.match(actions, /\.eq\("empresa_id", empresaId\)/);
  assert.match(emitir, /notaFiscalReferencia/);
  assert.match(emitir, /documentoFiscalReferenciado/);
  assert.match(editorUi, /Buscar qualquer produto do cadastro|produto solto/);
});

test("C. outro fornecedor é bloqueado no backend e no banco", () => {
  assert.match(actions, /MENSAGEM_DEVOLUCAO_OUTRO_FORNECEDOR/);
  assert.match(migracaoEditor, /outro fornecedor nesta devolução/);
  assert.match(migracaoEditor, /trg_fiscal_dev_forn_itens_mesmo_fornecedor/);
});

test("D. entradas de outra empresa não entram na devolução", () => {
  assert.match(actions, /listarEntradasElegiveisDevolucao/);
  const listar = actions.slice(
    actions.indexOf("export async function listarEntradasElegiveisDevolucao")
  );
  assert.match(listar, /\.eq\("empresa_id", empresaId\)/);
  assert.match(listar, /registroPertenceAEmpresaAtiva/);
  assert.doesNotMatch(
    fonte("components/fiscal/nfe55/adicionar-itens-entrada.tsx"),
    /from\("produtos"\)/
  );
});

test("E. saldo insuficiente continua bloqueado ao adicionar item", () => {
  const adicionar = actions.slice(
    actions.indexOf("export async function adicionarItensDevolucaoFornecedor")
  );
  assert.match(adicionar, /MENSAGEM_DEVOLUCAO_SALDO_INSUFICIENTE/);
  assert.match(adicionar, /saldoDevolvivelItem/);
});

test("F/G/H. transporte reutiliza o form comum e o mapper Geranet", () => {
  assert.match(editorUi, /TransporteVendaForm/);
  assert.match(editorUi, /salvarTransporteDevolucaoFornecedor/);
  assert.match(editorUi, /onSalvar/);
  assert.match(emitir, /mapearTransporteParaGeranet/);
  assert.match(emitir, /frete: transporteMapeado\.modFrete/);
  const form = fonte("components/vendas/transporte-venda-form.tsx");
  assert.match(form, /9 - Sem ocorrência de transporte/);
  assert.match(form, /\/api\/vendas\/\$\{vendaId\}\/transporte/);
});

test("I/J. infos e snapshot congelam transporte e referências na verificação", () => {
  assert.match(actions, /informacao_complementar_usuario/);
  assert.match(actions, /documentos_referenciados/);
  assert.match(actions, /transporte: devolucao\.dados_transporte/);
  assert.match(emitir, /montarInformacaoComplementarNfe/);
  assert.match(emitir, /snapshot\.transporte \?\? devolucao\.dados_transporte/);
});

test("K. venda continua no endpoint próprio, sem virar devolução", () => {
  assert.match(emitirVenda, /p_origem_tipo:\s*"venda"/);
  assert.doesNotMatch(emitirVenda, /devolucao_fornecedor/);
  const form = fonte("components/vendas/transporte-venda-form.tsx");
  assert.match(form, /\/api\/vendas\/\$\{vendaId\}\/transporte/);
});

test("L. anti-retransmissão da devolução permanece intacta", () => {
  assert.match(emitir, /claimTentativaEmissaoFiscal/);
  assert.match(emitir, /MENSAGEM_BLOQUEIO_RETRANSMISSAO/);
  assert.match(emitir, /aguardando_reconciliacao/);
  assert.match(emitir, /podeRetransmitir: persistencia.retransmitir/);
});
