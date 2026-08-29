import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "path";
import { test } from "node:test";

import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import {
  hrefOrigemEmissaoFiscal,
  resolverAcoesEmissaoFiscal,
} from "@/lib/fiscal/acoes-emissao";
import {
  MENSAGEM_NATUREZA_BONIFICACAO_INVALIDA,
  MENSAGEM_NATUREZA_TRANSFERENCIA_INVALIDA,
  MENSAGEM_TRANSFERENCIA_DESTINO_CLIENTE,
  MENSAGEM_TRANSFERENCIA_DESTINO_INELEGIVEL,
} from "./catalogo";
import {
  destinoTransferenciaElegivel,
  validarDestinoNaoEhClienteComum,
} from "./elegibilidade-transferencia";
import { resolverCfopEfetivo } from "./resolver-cfop";
import { escolherNaturezaParaTipoOperacao } from "./resolver-natureza";
import {
  bloqueioCancelamentoOperacaoFiscal,
  MENSAGEM_CANCELAMENTO_OPERACAO_COM_SAIDA,
} from "./status-operacao";
import { classificarOperacaoNfe } from "./validar-operacao-nfe";
import { verificarOperacaoFiscal } from "./verificar-operacao";
import { MENSAGEM_NAO_CONTRIBUINTE_CONSUMIDOR_FINAL } from "@/lib/fiscal/destinatario/resolver-destinatario-fiscal";
import {
  avisoNaturezaNestaTela,
  tipoOperacaoEmitivelNestaTela,
} from "@/lib/fiscal/nfe55/defaults-natureza";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

const migracao = fonte(
  "supabase/migrations/20260817340000_fiscal_operacoes_nfe.sql"
);
const migracaoVenda = fonte(
  "supabase/migrations/20260818010000_fiscal_operacoes_venda_rascunho.sql"
);
const actions = fonte("app/fiscal/nfe/operacoes-actions.ts");
const emitir = fonte("app/api/fiscal/geranet/nfe-emitir-operacao/route.ts");
const emitirVenda = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
const emitirDevolucao = fonte(
  "app/api/fiscal/geranet/nfe-emitir-devolucao-fornecedor/route.ts"
);
const wizard = fonte("app/fiscal/nfe/nfe-emissao-pagina.tsx");
const editor = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");
const editorComum = fonte("components/fiscal/nfe55/nfe55-editor.tsx");
const lista = fonte("components/fiscal/fiscal-documentos-lista.tsx");
const paginaFiscal = fonte("app/fiscal/page.tsx");
const cancelar = fonte("app/api/fiscal/emissoes/[id]/cancelar/route.ts");

const naturezaBonificacao = {
  id: "nat-bonif",
  empresa_id: "emp-1",
  tipo_operacao_interno: "bonificacao",
  descricao: "Bonificação",
  tp_nf: "1",
  fin_nfe: "1",
  padrao: true,
  ativo: true,
};

const naturezaVenda = {
  ...naturezaBonificacao,
  id: "nat-venda",
  tipo_operacao_interno: "venda",
  descricao: "Venda de mercadoria",
};

const itemOk = {
  id: "item-1",
  descricao: "Tela A32",
  produtoId: "prod-1",
  produtoEmpresaId: "emp-1",
  grupoFiscalId: "gf-1",
  grupoFiscalEmpresaId: "emp-1",
  grupoFiscalNome: "Produtos",
  icmsCstCsosn: "102",
  ncm: "85177099",
  quantidade: 2,
  valorUnitario: 10,
  estoqueDisponivel: 20,
};

const regrasBonificacao = [
  {
    empresaId: "emp-1",
    naturezaId: "nat-bonif",
    grupoFiscalId: "gf-1",
    tipoDestino: "interestadual" as const,
    cfop: "5910",
    ativo: true,
  },
];

test("A. criar bonificação não cria venda, financeiro nem estoque", () => {
  assert.match(actions, /from\("fiscal_operacoes"\)/);
  const criar = actions.slice(
    actions.indexOf("export async function criarOperacaoFiscal"),
    actions.indexOf("export async function salvarDestinatarioBonificacao")
  );
  assert.doesNotMatch(criar, /from\("vendas"\)/);
  assert.doesNotMatch(criar, /finalizarVendaPdv/);
  assert.doesNotMatch(actions, /from\("pagamentos"\)/);
  assert.doesNotMatch(actions, /from\("caixa/);
  assert.doesNotMatch(actions, /contas_receber|carteira/);
  assert.match(criar, /status: "rascunho"/);
  assert.doesNotMatch(criar, /estoque_atual|estoque_movimentacoes|rpc_confirmar_saida/);
  assert.match(wizard, /NfeEmissaoForm/);
  assert.match(editor, /criarOperacaoFiscal/);
  assert.match(editor, /Salvar como rascunho/);
  assert.match(editor, /Natureza sem financeiro/);
});

test("B. emitir e autorizar não movimenta estoque", () => {
  assert.match(emitir, /status: "aguardando_saida"/);
  assert.match(emitir, /O estoque ainda não foi movimentado/);
  assert.doesNotMatch(emitir, /rpc_confirmar_saida_operacao_fiscal/);
  assert.doesNotMatch(emitir, /estoque_atual/);
  assert.doesNotMatch(emitir, /estoque_movimentacoes/);
  assert.match(actions, /Verificação fiscal concluída. O estoque ainda não foi movimentado/);
});

test("C. confirmar saída reduz estoque uma vez via RPC transacional", () => {
  assert.match(migracao, /rpc_confirmar_saida_operacao_fiscal/);
  assert.match(migracao, /'BONIFICACAO_SAIDA'/);
  assert.match(migracao, /v_atual := v_anterior - v_item.quantidade/);
  assert.match(migracao, /for update/);
  assert.match(actions, /rpc_confirmar_saida_operacao_fiscal/);
  assert.match(editor, /Confirmar saída da mercadoria/);
  const migracaoSaidaNegativa = fonte(
    "supabase/migrations/20260828120000_nfe_saida_estoque_negativo.sql"
  );
  assert.match(migracaoSaidaNegativa, /rpc_confirmar_saida_operacao_fiscal/);
  assert.match(migracaoSaidaNegativa, /v_atual := v_anterior - v_item.quantidade/);
  assert.doesNotMatch(
    migracaoSaidaNegativa,
    /Estoque insuficiente para confirmar a saída/
  );
});

test("D. duplo clique de saída é idempotente", () => {
  assert.match(migracao, /uq_estoque_mov_operacao_item_saida/);
  assert.match(migracao, /saida_estoque_processada_at is not null/);
  assert.match(migracao, /return query/);
  assert.match(editor, /saindo = useRef\(false\)/);
  assert.match(actions, /Saída já processada/);
});

test("E. produto de outra empresa é bloqueado", () => {
  const verificacao = verificarOperacaoFiscal({
    empresaIdAtiva: "emp-1",
    tipoOperacaoInterno: "bonificacao",
    natureza: naturezaBonificacao,
    ufEmpresa: "MT",
    ufDestinatario: "SP",
    destinatarioTipo: "cliente",
    destinatarioId: "cli-1",
    itens: [{ ...itemOk, produtoEmpresaId: "emp-2" }],
    regrasCfop: regrasBonificacao,
    codigoRegimeTributario: 1,
    ambiente: "2",
    perfilIpi: null,
  });
  assert.equal(verificacao.ok, false);
  assert.ok(
    verificacao.pendencias.some((item) => item.codigo === "produto_empresa")
  );
  assert.match(actions, /Produto não pertence à empresa ativa/);
  assert.match(migracao, /Produto da operação não pertence à empresa ativa/);
  assert.equal(
    registroPertenceAEmpresaAtiva({ empresa_id: "emp-2" }, "emp-1"),
    false
  );
});

test("F. natureza de venda não serve para bonificação", () => {
  const escolhida = escolherNaturezaParaTipoOperacao({
    empresaIdAtiva: "emp-1",
    tipoOperacaoInterno: "bonificacao",
    naturezaId: naturezaVenda.id,
    naturezas: [naturezaVenda],
  });
  assert.equal(escolhida.ok, false);
  if (!escolhida.ok) {
    assert.equal(escolhida.mensagem, MENSAGEM_NATUREZA_BONIFICACAO_INVALIDA);
  }
  const verificacao = verificarOperacaoFiscal({
    empresaIdAtiva: "emp-1",
    tipoOperacaoInterno: "bonificacao",
    natureza: naturezaVenda,
    ufEmpresa: "MT",
    ufDestinatario: "SP",
    destinatarioTipo: "cliente",
    destinatarioId: "cli-1",
    itens: [itemOk],
    regrasCfop: regrasBonificacao,
    codigoRegimeTributario: 1,
    ambiente: "2",
    perfilIpi: null,
  });
  assert.equal(verificacao.ok, false);
  assert.ok(
    verificacao.pendencias.some((item) => item.codigo === "natureza_tipo")
  );
  assert.match(migracao, /A natureza selecionada não pertence a esta operação/);
});

test("G. bonificação sem regra de CFOP bloqueia e não herda CFOP de venda", () => {
  const resultado = resolverCfopEfetivo({
    tipoOperacaoInterno: "bonificacao",
    tipoDestino: "interestadual",
    naturezaId: "nat-bonif",
    grupoFiscalId: "gf-1",
    empresaIdAtiva: "emp-1",
    naturezaDescricao: "Bonificação",
    grupoFiscal: {
      nome: "Produtos",
      cfopInterno: "5102",
      cfopInterestadual: "6102",
    },
    regras: [],
  });
  assert.equal(resultado.ok, false);
  if (!resultado.ok) {
    assert.match(resultado.mensagem, /Não existe regra de CFOP configurada/);
    assert.match(resultado.mensagem, /Natureza: Bonificação/);
    assert.match(resultado.mensagem, /Grupo fiscal: Produtos/);
    assert.match(resultado.mensagem, /Destino: Interestadual/);
    assert.doesNotMatch(resultado.mensagem, /5102|6102/);
  }
  assert.doesNotMatch(migracao, /5102|5910|5551|5152/);
});

test("Transferência A. origem e destino elegíveis pelo vínculo explícito", () => {
  assert.equal(
    destinoTransferenciaElegivel({
      empresaOrigemId: "emp-1",
      destinoEmpresaId: "emp-2",
      vinculos: [
        {
          id: "v1",
          empresa_origem_id: "emp-1",
          empresa_destino_id: "emp-2",
          ativo: true,
        },
      ],
    }),
    true
  );
  assert.match(migracao, /fiscal_vinculos_transferencia/);
  assert.match(migracao, /rpc_vincular_estabelecimento_transferencia/);
  assert.doesNotMatch(migracao, /substring\(.*cnpj/i);
});

test("Transferência B. cliente comum não é destino", () => {
  assert.equal(validarDestinoNaoEhClienteComum("cliente"), false);
  const verificacao = verificarOperacaoFiscal({
    empresaIdAtiva: "emp-1",
    tipoOperacaoInterno: "transferencia",
    natureza: {
      ...naturezaBonificacao,
      tipo_operacao_interno: "transferencia",
      descricao: "Transferência",
    },
    ufEmpresa: "MT",
    ufDestinatario: "MT",
    destinatarioTipo: "cliente",
    destinatarioId: "cli-1",
    itens: [itemOk],
    regrasCfop: [],
    codigoRegimeTributario: 1,
    ambiente: "2",
    perfilIpi: null,
  });
  assert.equal(verificacao.ok, false);
  assert.ok(
    verificacao.pendencias.some(
      (item) => item.mensagem === MENSAGEM_TRANSFERENCIA_DESTINO_CLIENTE
    )
  );
  assert.equal(
    destinoTransferenciaElegivel({
      empresaOrigemId: "emp-1",
      destinoEmpresaId: "emp-2",
      vinculos: [],
    }),
    false
  );
  assert.equal(
    MENSAGEM_TRANSFERENCIA_DESTINO_INELEGIVEL,
    "Não foi possível confirmar que o estabelecimento de destino é elegível para transferência."
  );
  const escolhida = escolherNaturezaParaTipoOperacao({
    empresaIdAtiva: "emp-1",
    tipoOperacaoInterno: "transferencia",
    naturezaId: naturezaVenda.id,
    naturezas: [naturezaVenda],
  });
  assert.equal(escolhida.ok, false);
  if (!escolhida.ok) {
    assert.equal(escolhida.mensagem, MENSAGEM_NATUREZA_TRANSFERENCIA_INVALIDA);
  }
});

test("Venda na Nova NF-e trata destinatário como cliente e não como transferência", () => {
  const semDestinatario = verificarOperacaoFiscal({
    empresaIdAtiva: "emp-1",
    tipoOperacaoInterno: "venda",
    natureza: naturezaVenda,
    ufEmpresa: "MT",
    ufDestinatario: "MT",
    destinatarioTipo: "cliente",
    destinatarioId: null,
    itens: [itemOk],
    regrasCfop: [
      {
        empresaId: "emp-1",
        naturezaId: "nat-venda",
        grupoFiscalId: "gf-1",
        tipoDestino: "interna",
        cfop: "5102",
        ativo: true,
      },
    ],
    codigoRegimeTributario: 1,
    ambiente: "2",
    perfilIpi: null,
  });
  assert.equal(semDestinatario.ok, false);
  assert.ok(
    semDestinatario.pendencias.some((item) => item.codigo === "destinatario")
  );
  assert.equal(
    semDestinatario.pendencias.some(
      (item) => item.mensagem === MENSAGEM_TRANSFERENCIA_DESTINO_CLIENTE
    ),
    false
  );
});

test("A. validar NF-e alerta 9+0 sem bloquear a prontidão", () => {
  const verificacao = verificarOperacaoFiscal({
    empresaIdAtiva: "emp-1",
    tipoOperacaoInterno: "venda",
    natureza: naturezaVenda,
    ufEmpresa: "MT",
    ufDestinatario: "MT",
    destinatarioTipo: "cliente",
    destinatarioId: "cli-1",
    itens: [itemOk],
    regrasCfop: [
      {
        empresaId: "emp-1",
        naturezaId: "nat-venda",
        grupoFiscalId: "gf-1",
        tipoDestino: "interna",
        cfop: "5102",
        ativo: true,
      },
    ],
    codigoRegimeTributario: 1,
    ambiente: "2",
    perfilIpi: null,
    modeloDocumento: "55",
    indicadorIeDestinatario: "9",
    consumidorFinal: false,
  });
  assert.equal(
    verificacao.pendencias.some((item) => item.codigo === "consumidor_final"),
    false
  );
  assert.ok(
    verificacao.alertas.some(
      (item) => item === MENSAGEM_NAO_CONTRIBUINTE_CONSUMIDOR_FINAL
    )
  );
});

test("B. validar NF-e permite não contribuinte com consumidor final", () => {
  const verificacao = verificarOperacaoFiscal({
    empresaIdAtiva: "emp-1",
    tipoOperacaoInterno: "venda",
    natureza: naturezaVenda,
    ufEmpresa: "MT",
    ufDestinatario: "MT",
    destinatarioTipo: "cliente",
    destinatarioId: "cli-1",
    itens: [itemOk],
    regrasCfop: [
      {
        empresaId: "emp-1",
        naturezaId: "nat-venda",
        grupoFiscalId: "gf-1",
        tipoDestino: "interna",
        cfop: "5102",
        ativo: true,
      },
    ],
    codigoRegimeTributario: 1,
    ambiente: "2",
    perfilIpi: null,
    modeloDocumento: "55",
    indicadorIeDestinatario: "9",
    consumidorFinal: true,
  });
  assert.equal(
    verificacao.pendencias.some((item) => item.codigo === "consumidor_final"),
    false
  );
  assert.equal(
    verificacao.pendencias.some(
      (item) => item.mensagem === MENSAGEM_NAO_CONTRIBUINTE_CONSUMIDOR_FINAL
    ),
    false
  );
});

test("Transferência C/D. rascunho e autorização não mexem estoque", () => {
  assert.match(actions, /O estoque não foi movimentado/);
  assert.doesNotMatch(emitir, /TRANSFERENCIA_SAIDA|TRANSFERENCIA_ENTRADA/);
  assert.match(emitir, /aguardando_saida/);
});

test("Transferência E. confirmar saída marca em trânsito", () => {
  assert.match(migracao, /'TRANSFERENCIA_SAIDA'/);
  assert.match(migracao, /v_status_final := 'em_transito'/);
  assert.match(editor, /Em trânsito|em_transito/);
});

test("Transferência F. confirmar recebimento entra no destino", () => {
  assert.match(migracao, /rpc_confirmar_recebimento_transferencia/);
  assert.match(migracao, /'TRANSFERENCIA_ENTRADA'/);
  assert.match(migracao, /status = 'concluida'/);
  assert.match(actions, /rpc_confirmar_recebimento_transferencia/);
  assert.match(editor, /Confirmar recebimento/);
});

test("Transferência G/H. saída e recebimento não duplicam", () => {
  assert.match(migracao, /uq_estoque_mov_operacao_item_saida/);
  assert.match(migracao, /uq_estoque_mov_operacao_item_entrada/);
  assert.match(migracao, /recebimento_processado_at is not null/);
  assert.match(editor, /recebendo = useRef\(false\)/);
  assert.match(actions, /Recebimento já processado/);
});

test("Transferência I. estoque e configuração não cruzam empresa", () => {
  assert.match(migracao, /and e.empresa_id = p_empresa_id/);
  assert.match(migracao, /p.empresa_id = p_empresa_id/);
  assert.match(migracao, /fiscal_operacoes_assert_mesma_empresa/);
  assert.match(emitir, /registroPertenceAEmpresaAtiva/);
  assert.match(actions, /\.eq\("empresa_id", empresaId\)/);
});

test("ciclo fiscal comum da NF-e 55 é reutilizado", () => {
  assert.match(editorComum, /Documentos referenciados/);
  assert.match(editorComum, /Transporte e volumes/);
  assert.match(editor, /Documentos referenciados/);
  assert.match(editor, /EmissaoFiscalAcoes/);
  assert.match(editor, /EmissaoFiscalHistorico/);
  assert.match(editor, /TransporteVendaForm/);
  assert.match(editor, /nfe-emitir-operacao/);
  assert.doesNotMatch(editor, /emissor-bonificacao|emissor-transferencia/);
  const acoes = resolverAcoesEmissaoFiscal({
    emissao: {
      modelo: "55",
      status: "autorizada",
      cstat: "100",
      protocolo: "1",
      chaveAcesso: "35240111222333000155550010000000291000000001",
    },
  });
  assert.equal(acoes.podeBaixarPdf, true);
  assert.equal(acoes.podeBaixarXml, true);
  assert.equal(acoes.podeCancelar, true);
  assert.equal(acoes.podeCartaCorrecao, true);
  assert.equal(acoes.podeConsultar, true);
  assert.equal(
    hrefOrigemEmissaoFiscal("operacao_fiscal", "op-1"),
    "/fiscal/nfe/op-1/editar"
  );
});

test("cancelamento após saída é bloqueado sem estorno silencioso", () => {
  assert.equal(
    bloqueioCancelamentoOperacaoFiscal({
      saidaEstoqueProcessadaAt: "2026-08-17T19:00:00Z",
    }),
    MENSAGEM_CANCELAMENTO_OPERACAO_COM_SAIDA
  );
  assert.equal(
    bloqueioCancelamentoOperacaoFiscal({ status: "em_transito" }),
    MENSAGEM_CANCELAMENTO_OPERACAO_COM_SAIDA
  );
  assert.equal(bloqueioCancelamentoOperacaoFiscal({ status: "aguardando_saida" }), null);
  assert.match(cancelar, /bloqueioCancelamentoOperacaoFiscal/);
  assert.match(cancelar, /operacao_fiscal/);
  assert.doesNotMatch(cancelar, /estoque_atual/);
  assert.doesNotMatch(cancelar, /rpc_confirmar_saida_operacao_fiscal/);
});

test("listagem comum mostra tipo e filtro de operação", () => {
  assert.match(paginaFiscal, /origem_tipo === "operacao_fiscal"/);
  assert.match(paginaFiscal, /from\("fiscal_operacoes"\)/);
  assert.match(lista, /Bonificação/);
  assert.match(lista, /Transferência/);
  assert.match(lista, /Todos os tipos/);
  assert.match(lista, /tipoOperacao/);
});

test("anti-retransmissão da operação herda o mesmo motor e não altera venda/devolução", () => {
  assert.match(emitir, /claimTentativaEmissaoFiscal/);
  assert.match(emitir, /mensagemBloqueioEmissao/);
  assert.match(emitir, /persistenciaFalhaComunicacaoEmitir/);
  assert.match(emitir, /p_origem_tipo:\s*"operacao_fiscal"/);
  assert.match(emitir, /tipo: "90"/);
  const corpoEmitir = emitir.slice(emitir.indexOf("export async function POST"));
  assert.ok(
    corpoEmitir.indexOf("montarPayloadNfeGeranet") <
      corpoEmitir.indexOf("claimTentativaEmissaoFiscal")
  );
  assert.match(emitirVenda, /claimTentativaEmissaoFiscal/);
  assert.match(emitirVenda, /p_origem_tipo:\s*"venda"/);
  assert.doesNotMatch(emitirVenda, /operacao_fiscal/);
  assert.match(emitirDevolucao, /claimTentativaEmissaoFiscal/);
  assert.match(emitirDevolucao, /p_origem_tipo:\s*"devolucao_fornecedor"/);
  assert.doesNotMatch(emitirDevolucao, /operacao_fiscal/);
});

test("Nova NF-e emite venda pelo motor do PDV e não avisa PDV", () => {
  assert.equal(tipoOperacaoEmitivelNestaTela("bonificacao"), true);
  assert.equal(tipoOperacaoEmitivelNestaTela("transferencia"), true);
  assert.equal(tipoOperacaoEmitivelNestaTela("venda"), true);
  assert.equal(avisoNaturezaNestaTela("bonificacao"), null);
  assert.equal(avisoNaturezaNestaTela("venda"), null);
  assert.match(editor, /avisoNaturezaNestaTela/);
  assert.match(editor, /nfe-aviso/);
  assert.doesNotMatch(editor, /setErro\(mensagemNaturezaNaoEmitivelNestaTela/);
  assert.doesNotMatch(editor, /Vendas devem ser emitidas a partir do PDV/);
  assert.doesNotMatch(editor, /Venda continua no PDV/);
  assert.match(actions, /executarFinalizacaoVendaPdv/);
  assert.match(actions, /prepararVendaParaEmissaoNfe/);
  assert.match(actions, /exigirCaixaAberto:/);
  assert.match(actions, /nfeVendaNovaExigeCaixa/);
  assert.match(editor, /nfe-emitir-venda/);
  assert.doesNotMatch(editor, /nfce-emitir-venda/);
  assert.doesNotMatch(editor, /Esta venda será emitida como NFC-e/);
  assert.doesNotMatch(editor, /Marcado: a nota será NFC-e/);
  assert.match(editor, />\s*Emitir\s*</);
  assert.match(editor, /55 — NF-e/);
  assert.match(editor, /NfePagamentoVenda/);
  assert.match(editor, /tipoPessoaEdit/);
  assert.match(editor, /consumidorFinalEdit/);
  assert.match(editor, /nfe-busca-item/);
  assert.match(editor, /preservarStatusEmissao/);
  assert.match(editor, /resolverDestinoAposEmissaoVenda/);
  assert.match(editor, /router\.push\(destino\.href\)/);
  assert.match(editor, /setValidadaLocalmente/);
  assert.match(editor, /validarNfe\(\)/);
  assert.match(actions, /preservarStatusEmissao/);
  assert.match(actions, /revalidatePath\("\/vendas"\)/);
  const listaVendas = fonte("components/vendas/vendas-lista.tsx");
  assert.match(listaVendas, /resolverRotaEdicaoVenda/);
  assert.match(listaVendas, /Imprimir comprovante de venda/);
  assert.match(listaVendas, /\/pdv\/imprimir\/recibo\//);
  assert.doesNotMatch(listaVendas, /href=\{`\/pdv\/editar\/\$\{venda\.id\}`\}/);
  const emitirVendaOp = actions.slice(
    actions.indexOf("export async function prepararVendaParaEmissaoNfe")
  );
  assert.match(emitirVendaOp, /from\("vendas"\)/);
  assert.match(emitirVendaOp, /idempotencyKey: String\(operacao.id\)/);
  assert.doesNotMatch(emitirVendaOp, /nfe-emitir-operacao/);
  assert.doesNotMatch(emitirVendaOp, /rpc_confirmar_saida_operacao_fiscal/);
  assert.match(actions, /Estoque da venda já foi baixado pelo PDV/);
  assert.match(emitirVendaOp, /if \(!vendaId\)/);
  assert.match(emitirVendaOp, /executarFinalizacaoVendaPdv/);
  assert.match(emitirVendaOp, /recusarEdicaoDocumentoFiscal/);
  assert.doesNotMatch(
    editor,
    /Cabeçalho fiscal salvo\. A venda comercial, o estoque e o pagamento não foram alterados/
  );
  assert.match(editor, /salvarPagamentosOperacaoVenda/);
  assert.match(editor, /NF-e não autorizada/);
  assert.match(editor, /origemConsumidorFinal/);
  assert.match(editor, /consumidorFinalOrigem/);
  assert.match(editor, /resolverDestinatarioFiscalNfe/);
  assert.match(editor, /resolverDestinatarioFiscalDaOrigem/);
  assert.doesNotMatch(editor, /defaultConsumidorFinalVisivel/);
  assert.doesNotMatch(actions, /Esta venda será emitida como NFC-e/);
  assert.match(editor, /verificarOperacaoFiscalAction/);
  assert.match(emitirVenda, /resolverDestinatarioFiscalDaOrigem/);
  assert.match(emitirVenda, /lerSnapshotDestinatarioFiscal/);
  assert.match(emitirVenda, /from\("fiscal_operacoes"\)/);
  const identidadeFn = actions.slice(
    actions.indexOf("export async function atualizarIdentidadeDestinatarioOperacao"),
    actions.indexOf("export async function salvarPagamentosOperacaoVenda")
  );
  assert.match(identidadeFn, /snapshotDestinatarioParaPersistir/);
  assert.doesNotMatch(
    identidadeFn,
    /tipo_pessoa: input.tipoPessoa,\s*consumidor_final: input.consumidorFinal/
  );
  assert.match(actions, /salvarCadastroDestinatarioOperacao/);
  assert.match(editor, /salvarCadastroDestinatarioOperacao/);
  assert.match(editor, /useBuscaCep/);
  assert.match(editor, /Consultando CEP/);
  assert.match(editor, /Código IBGE/);
  assert.match(editor, /Dados incompletos podem ser preenchidos/);
  const cadastroFn = actions.slice(
    actions.indexOf("export async function salvarCadastroDestinatarioOperacao"),
    actions.indexOf("export async function salvarPagamentosOperacaoVenda")
  );
  assert.match(cadastroFn, /from\("clientes"\)/);
  assert.match(cadastroFn, /eq\("empresa_id", empresaId\)/);
  assert.match(cadastroFn, /codigo_municipio_ibge/);
  assert.match(cadastroFn, /inscricao_estadual/);
  assert.match(cadastroFn, /contribuinte_icms/);
  assert.match(cadastroFn, /indicador_ie_destinatario/);
  assert.doesNotMatch(cadastroFn, /consumidor_final:/);
  assert.ok(
    emitirVenda.indexOf("resolverDestinatarioFiscalDaOrigem") <
      emitirVenda.indexOf("rpc_reservar_emissao_fiscal")
  );
  assert.match(migracaoVenda, /tipo_operacao_interno in \('bonificacao', 'transferencia', 'venda'\)/);
  assert.match(migracaoVenda, /venda_id uuid/);
  assert.doesNotMatch(migracaoVenda, /create or replace function public\.rpc_finalizar_venda/i);
});

test("Nova NF-e não habilita rascunho de remessa, retorno, complementar ou ajuste", () => {
  assert.match(editor, /Natureza da operação/);
  assert.match(editor, /avisoNaturezaNestaTela/);
  assert.doesNotMatch(editor, /criarOperacaoFiscal\(\{ tipo: "remessa"/);
  assert.doesNotMatch(editor, /tipo: "remessa"|tipo: "retorno"|tipo: "ajuste"/);
  for (const codigo of ["remessa", "retorno", "complementar", "ajuste"] as const) {
    const status = classificarOperacaoNfe({ codigo });
    assert.equal(status.podeChegarEmitir, false);
  }
  assert.equal(
    classificarOperacaoNfe({ codigo: "bonificacao" }).podeChegarEmitir,
    true
  );
  assert.equal(
    classificarOperacaoNfe({ codigo: "transferencia" }).podeChegarEmitir,
    true
  );
  assert.equal(
    classificarOperacaoNfe({
      codigo: "venda",
      natureza: naturezaVenda,
      empresaIdAtiva: "emp-1",
    }).podeChegarEmitir,
    true
  );
});

test("Cabeçalho fiscal: rascunho edita série/número/datas; transmissão congela", () => {
  const carregarForm = fonte("lib/fiscal/nfe55/carregar-formulario-nfe.ts");
  assert.match(editor, /podeEditarDocumentoFiscal/);
  assert.match(editor, /podeEditarNumeracaoFiscal/);
  assert.match(editor, /podeEditarCabecalho/);
  assert.doesNotMatch(editor, /podeEditarCabecalho = emitivel &&/);
  assert.match(editor, /salvarCabecalhoFiscalOperacao/);
  assert.match(editor, /Numeração automática/);
  assert.match(editor, /Sugestão do próximo número/);
  assert.match(editor, /\(previsto\)/);
  assert.match(editor, /label="Emitente"/);
  assert.doesNotMatch(editor, /Loja \/ Filial/);
  assert.match(editor, /Definido pela empresa emitente/);
  assert.match(editor, /NF-e modelo 55/);
  assert.match(editor, /Controlada pelo lifecycle fiscal/);
  assert.match(actions, /export async function salvarCabecalhoFiscalOperacao/);
  assert.match(actions, /podeEditarDocumentoFiscal/);
  assert.match(actions, /podeEditarNumeracaoFiscal/);
  assert.match(actions, /numeroNfeEmConflito/);
  assert.match(actions, /escolherNumeracaoNfe55/);
  assert.match(actions, /MENSAGEM_NATUREZA_INCOMPATIVEL_VENDA_PDV/);
  assert.match(actions, /eq\("principal", true\)/);
  assert.match(actions, /eq\("ativo", true\)/);
  assert.doesNotMatch(
    actions,
    /A venda comercial já foi finalizada\. A natureza desta NF-e não pode mais ser trocada/
  );
  const cabecalhoFn = actions.slice(
    actions.indexOf("export async function salvarCabecalhoFiscalOperacao"),
    actions.indexOf("export async function adicionarItemOperacaoFiscal")
  );
  assert.match(cabecalhoFn, /eq\("empresa_id", empresaId\)/);
  assert.match(cabecalhoFn, /registroPertenceAEmpresaAtiva/);
  assert.match(cabecalhoFn, /auditoria_cabecalho/);
  assert.match(cabecalhoFn, /statusAposEdicaoDocumentoFiscal/);
  assert.match(cabecalhoFn, /from\("fiscal_numeracoes"\)/);
  assert.match(cabecalhoFn, /eq\("modelo", "55"\)/);
  assert.doesNotMatch(cabecalhoFn, /from\("vendas"\)/);
  assert.doesNotMatch(cabecalhoFn, /from\("estoque_atual"\)/);
  assert.doesNotMatch(cabecalhoFn, /from\("pagamentos_venda"\)/);
  assert.doesNotMatch(cabecalhoFn, /from\("contas_receber"\)/);
  assert.match(editor, /operacao\.vendaId/);
  assert.match(editor, /const podeEditar = edicaoDocumento\.permitido && emitivel/);
  assert.doesNotMatch(editor, /podeEditar && !operacao\.vendaId/);
  assert.match(editor, /NF-e não autorizada/);
  assert.match(emitirVenda, /resolverPayloadCabecalhoNfe/);
  assert.match(emitir, /resolverPayloadCabecalhoNfe/);
  assert.match(emitirVenda, /escolherNumeracaoNfe55/);
  assert.match(emitir, /escolherNumeracaoNfe55/);
  assert.match(emitirVenda, /argsNumeroManualReservaNfe/);
  assert.match(emitir, /argsNumeroManualReservaNfe/);
  assert.match(emitirVenda, /cabecalhoNfe\.dataSaida/);
  assert.match(emitirVenda, /cabecalhoNfe\.dataEmissao/);
  assert.match(emitirVenda, /cabecalhoNfe\.indicadorPresenca/);
  assert.match(emitirVenda, /cabecalhoNfe\.indicativoIntermediador/);
  assert.match(emitir, /cabecalhoNfe\.indicativoIntermediador/);
  assert.match(carregarForm, /lerCabecalhoFiscalDoSnapshot/);
  assert.match(carregarForm, /seriesNfe/);
  const rpcNumero = fonte(
    "supabase/migrations/20260819100000_rpc_reservar_emissao_numero_manual.sql"
  );
  assert.match(rpcNumero, /p_numero bigint default null/);
  assert.match(rpcNumero, /grant execute/);
  assert.match(rpcNumero, /to service_role/);
});

test("Informações complementares: Validar e Emitir leem o mesmo infCpl do snapshot", () => {
  const verificarFn = actions.slice(
    actions.indexOf("export async function verificarOperacaoFiscalAction"),
    actions.indexOf("export async function confirmarSaidaOperacaoFiscal")
  );
  assert.match(verificarFn, /textoUsuarioInfCplNfe/);
  assert.match(emitirVenda, /montarInformacaoComplementarNfe/);
  assert.match(emitirVenda, /textoUsuarioInfCplNfe/);
  assert.match(emitir, /textoUsuarioInfCplNfe/);
  assert.match(editor, /informacaoComplementarUsuario: infoUsuario/);
  assert.match(editor, /persistirCabecalhoSeSujo/);
  const emitirVendaInfCpl = emitirVenda.slice(
    emitirVenda.lastIndexOf("informacaoComplementar:")
  );
  assert.match(emitirVendaInfCpl, /montarInformacaoComplementarNfe/);
  assert.doesNotMatch(
    emitirVendaInfCpl.slice(0, 400),
    /informacaoComplementar:\s*fiscal\s*\.informacao_complementar_padrao/
  );
});
