import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classificarFormaCaixa,
  efeitoFisicoMovimento,
} from "@/lib/caixa/formas";
import {
  MENSAGEM_CAIXA_FECHADO_FINALIZAR,
  MENSAGEM_CAIXA_FECHADO_NFE_VENDA,
  MENSAGEM_CAIXA_FECHADO_SEM_PERMISSAO,
} from "@/lib/caixa/mensagens";
import { nfeVendaNovaExigeCaixa, vendaIdNfeMaterializada } from "@/lib/caixa/nfe-venda";
import { totaisDoLivro } from "@/lib/caixa/saldo";
import { fonte } from "@/lib/multiempresa/fonte";
import { presetDoPerfil } from "@/lib/permissoes/presets";
import { temPermissao } from "@/lib/permissoes/tem-permissao";

const FASE1 = "supabase/migrations/20260824100000_caixa_modulo.sql";
const MIGRATION = "supabase/migrations/20260824120000_caixa_venda_pdv.sql";
const TROCO = "supabase/migrations/20260825120000_caixa_snapshot_troco.sql";
const FISICO = "supabase/migrations/20260825130000_caixa_afeta_fisico.sql";
const FASE2B = "supabase/migrations/20260825140000_caixa_carteira_estornos.sql";
const FASE3 = "supabase/migrations/20260825150000_caixa_fechamento_conferencia.sql";

function linhaVenda(params: {
  entrada: number;
  saida?: number;
  forma_tipo?: string;
  forma_codigo?: string;
  forma_nome?: string;
  permite_troco_snapshot?: boolean;
  afeta_caixa_fisico_snapshot?: boolean;
}) {
  return {
    tipo: "venda" as const,
    entrada: params.entrada,
    saida: params.saida ?? 0,
    forma_tipo: params.forma_tipo ?? null,
    forma_codigo: params.forma_codigo ?? null,
    forma_nome: params.forma_nome ?? null,
    permite_troco_snapshot: params.permite_troco_snapshot ?? false,
    afeta_caixa_fisico_snapshot: params.afeta_caixa_fisico_snapshot ?? false,
  };
}

function semCaixa(arquivo: string) {
  const sql = fonte(arquivo);
  assert.doesNotMatch(sql, /caixa_movimentacoes/);
  assert.doesNotMatch(sql, /rpc_movimentar_caixa/);
  assert.doesNotMatch(sql, /rpc_finalizar_venda_com_caixa/);
  assert.doesNotMatch(sql, /rpc_finalizar_venda\(/);
}

test("natureza real: só venda comercial nova com recebimento exige Caixa", () => {
  assert.equal(
    nfeVendaNovaExigeCaixa({ tipoOperacaoInterno: "venda" }),
    true
  );
  assert.equal(
    nfeVendaNovaExigeCaixa({
      tipoOperacaoInterno: "venda",
      vinculaVenda: true,
    }),
    true
  );
  assert.equal(
    nfeVendaNovaExigeCaixa({
      tipoOperacaoInterno: "venda",
      vinculaVenda: false,
    }),
    true
  );
  assert.equal(
    nfeVendaNovaExigeCaixa({
      tipoOperacaoInterno: "venda",
      vendaId: "venda-pdv-existente",
    }),
    false
  );
  assert.equal(
    nfeVendaNovaExigeCaixa({
      tipoOperacaoInterno: "transferencia",
      vinculaVenda: false,
    }),
    false
  );
  assert.equal(
    nfeVendaNovaExigeCaixa({
      tipoOperacaoInterno: "bonificacao",
      vinculaVenda: false,
    }),
    false
  );
  assert.equal(
    nfeVendaNovaExigeCaixa({
      tipoOperacaoInterno: "devolucao_fornecedor",
    }),
    false
  );
  assert.equal(
    nfeVendaNovaExigeCaixa({
      tipoOperacaoInterno: "ajuste",
    }),
    false
  );
  assert.equal(
    nfeVendaNovaExigeCaixa({
      tipoOperacaoInterno: "Venda",
    }),
    true
  );
  assert.equal(
    nfeVendaNovaExigeCaixa({
      tipoOperacaoInterno: "Venda de Mercadoria",
    }),
    false
  );
  const seed = fonte("supabase/migrations/20260817200000_fiscal_naturezas_operacao.sql");
  assert.match(seed, /\('venda', 'Venda', false, true, true, true\)/);
});

test("1. Nova NF-e Venda em dinheiro entra no Caixa", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 0, saida: 0 },
    linhaVenda({
      entrada: 100,
      forma_tipo: "DINHEIRO",
      forma_codigo: "01",
      forma_nome: "Dinheiro",
      permite_troco_snapshot: true,
      afeta_caixa_fisico_snapshot: true,
    }),
  ]);
  assert.equal(totais.vendasTotal, 100);
  assert.equal(totais.vendasDinheiro, 100);
  assert.equal(totais.saldoAtual, 100);
  assert.equal(classificarFormaCaixa({ tipo: "DINHEIRO", codigo: "01" }), "dinheiro");
  assert.equal(
    efeitoFisicoMovimento({
      tipo: "venda",
      entrada: 100,
      saida: 0,
      afeta_caixa_fisico_snapshot: true,
    }),
    100
  );
});

test("2. Nova NF-e Venda em PIX: livro registra, gaveta não muda", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 80, saida: 0 },
    linhaVenda({
      entrada: 100,
      forma_tipo: "PIX",
      forma_codigo: "17",
      forma_nome: "PIX",
      afeta_caixa_fisico_snapshot: false,
    }),
  ]);
  assert.equal(totais.vendasTotal, 100);
  assert.equal(totais.vendasPix, 100);
  assert.equal(totais.saldoAtual, 80);
  assert.equal(
    efeitoFisicoMovimento({
      tipo: "venda",
      entrada: 100,
      saida: 0,
      afeta_caixa_fisico_snapshot: false,
    }),
    0
  );
});

test("3. Nova NF-e Venda em débito", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 50, saida: 0 },
    linhaVenda({
      entrada: 80,
      forma_tipo: "CARTAO_DEBITO",
      forma_codigo: "04",
      forma_nome: "Débito",
      afeta_caixa_fisico_snapshot: false,
    }),
  ]);
  assert.equal(totais.vendasDebito, 80);
  assert.equal(totais.saldoAtual, 50);
});

test("4. Nova NF-e Venda em crédito", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 50, saida: 0 },
    linhaVenda({
      entrada: 90,
      forma_tipo: "CARTAO_CREDITO",
      forma_codigo: "03",
      forma_nome: "Crédito",
      afeta_caixa_fisico_snapshot: false,
    }),
  ]);
  assert.equal(totais.vendasCredito, 90);
  assert.equal(totais.saldoAtual, 50);
});

test("5. Pagamento misto fecha venda e Caixa", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 0, saida: 0 },
    linhaVenda({
      entrada: 50,
      forma_tipo: "DINHEIRO",
      permite_troco_snapshot: true,
      afeta_caixa_fisico_snapshot: true,
    }),
    linhaVenda({
      entrada: 100,
      forma_tipo: "PIX",
      afeta_caixa_fisico_snapshot: false,
    }),
    linhaVenda({
      entrada: 50,
      forma_tipo: "CARTAO_CREDITO",
      afeta_caixa_fisico_snapshot: false,
    }),
  ]);
  assert.equal(totais.vendasTotal, 200);
  assert.equal(totais.vendasDinheiro, 50);
  assert.equal(totais.vendasPix, 100);
  assert.equal(totais.vendasCredito, 50);
  assert.equal(totais.saldoAtual, 50);
});

test("6. Dinheiro com troco na mesma ocorrência, sem sangria", () => {
  const movimento = linhaVenda({
    entrada: 120,
    saida: 20,
    forma_tipo: "DINHEIRO",
    permite_troco_snapshot: true,
    afeta_caixa_fisico_snapshot: true,
  });
  const totais = totaisDoLivro([{ tipo: "abertura", entrada: 0, saida: 0 }, movimento]);
  assert.equal(totais.vendasTotal, 100);
  assert.equal(totais.saldoAtual, 100);
  assert.equal(
    efeitoFisicoMovimento({
      tipo: "venda",
      entrada: 120,
      saida: 20,
      afeta_caixa_fisico_snapshot: true,
    }),
    100
  );
  assert.match(fonte(TROCO), /Troco nunca é sangria/);
  assert.match(fonte(FISICO), /permite_troco_snapshot/);
});

test("7. Pagamento misto com troco", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 0, saida: 0 },
    linhaVenda({
      entrada: 70,
      saida: 20,
      forma_tipo: "DINHEIRO",
      permite_troco_snapshot: true,
      afeta_caixa_fisico_snapshot: true,
    }),
    linhaVenda({
      entrada: 50,
      forma_tipo: "PIX",
      afeta_caixa_fisico_snapshot: false,
    }),
  ]);
  assert.equal(totais.vendasTotal, 100);
  assert.equal(totais.saldoAtual, 50);
});

test("8. Venda fiada não gera entrada no Caixa", () => {
  const sql = fonte(MIGRATION);
  assert.match(sql, /permite_fiado/);
  assert.match(sql, /CONTINUE;/);
  const totais = totaisDoLivro([{ tipo: "abertura", entrada: 40, saida: 0 }]);
  assert.equal(totais.vendasTotal, 0);
  assert.equal(totais.saldoAtual, 40);
});

test("9-13. venda existente, reemissão, retry, reconciliação e consulta não duplicam Caixa", () => {
  const preparar = fonte("app/fiscal/nfe/operacoes-actions.ts");
  const bloco = preparar.slice(
    preparar.indexOf("export async function prepararVendaParaEmissaoNfe")
  );
  assert.match(bloco, /if \(!vendaId\)/);
  assert.ok(
    bloco.indexOf("exigirCaixaAberto:") > bloco.indexOf("if (!vendaId)") &&
      bloco.indexOf("exigirCaixaAberto:") < bloco.indexOf('from("vendas")')
  );
  assert.match(bloco, /idempotencyKey: String\(operacao.id\)/);
  assert.match(fonte("app/pdv/actions.ts"), /rpc_finalizar_venda_com_caixa/);
  assert.match(fonte(MIGRATION), /origem_id/);
  assert.match(fonte(MIGRATION), /vendas_pagamentos/);
  assert.match(fonte(MIGRATION), /ON CONFLICT \(empresa_id, origem_tipo, origem_id\)/);

  const emitirVenda = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  assert.match(emitirVenda, /venda_id/);
  assert.doesNotMatch(emitirVenda, /prepararVendaParaEmissaoNfe/);
  assert.doesNotMatch(emitirVenda, /executarFinalizacaoVendaPdv/);
  semCaixa("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  semCaixa("lib/fiscal/reconciliar-emissao.ts");
  semCaixa("app/api/fiscal/emissoes/[id]/reconciliar/route.ts");
  semCaixa("lib/fiscal/geranet/consultar-emissao.ts");
});

test("14-17. caixa fechado bloqueia Nova NF-e Venda; abrir usa rpc_abrir_caixa", () => {
  assert.equal(MENSAGEM_CAIXA_FECHADO_NFE_VENDA, "Abra o caixa antes de realizar esta venda.");
  const form = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");
  const carregar = fonte("lib/fiscal/nfe55/carregar-formulario-nfe.ts");
  const preparar = fonte("app/fiscal/nfe/operacoes-actions.ts");
  const abrir = fonte("app/caixa/actions.ts");
  const bloqueio = fonte("components/pdv/pdv-caixa-fechado.tsx");
  const pdv = fonte("app/pdv/actions.ts");

  assert.match(carregar, /buscarCaixaAbertoEmpresa/);
  assert.match(carregar, /podeAbrirCaixa/);
  assert.match(carregar, /temPermissao\(/);
  assert.match(carregar, /"caixa"/);
  assert.match(carregar, /"abrir"/);
  assert.doesNotMatch(carregar, /rpc_abrir_caixa/);

  assert.match(form, /PdvCaixaFechado/);
  assert.match(form, /variante="overlay"/);
  assert.match(form, /MENSAGEM_CAIXA_FECHADO_NFE_VENDA/);
  assert.match(form, /Caixa aberto/);
  assert.match(form, /data-nfe-caixa-aberto/);
  assert.match(form, /nfeVendaNovaExigeCaixa/);
  assert.match(form, /vendaNovaSemCaixa/);
  assert.match(form, /data-nfe-caixa-bloqueado/);
  assert.doesNotMatch(form, /rpc_abrir_caixa/);

  assert.match(bloqueio, /Caixa fechado/);
  assert.match(bloqueio, /Abrir Caixa/);
  assert.match(bloqueio, /abrirCaixa/);
  assert.match(bloqueio, /Saldo inicial em dinheiro/);
  assert.match(bloqueio, /Observação \(opcional\)/);
  assert.match(bloqueio, /MENSAGEM_CAIXA_FECHADO_SEM_PERMISSAO/);
  assert.doesNotMatch(bloqueio, /onClose|Cancelar/);

  assert.equal(temPermissao(presetDoPerfil("caixa"), "caixa", "abrir"), true);
  assert.equal(temPermissao(presetDoPerfil("vendedor"), "caixa", "abrir"), false);
  assert.equal(
    MENSAGEM_CAIXA_FECHADO_SEM_PERMISSAO,
    "É necessário solicitar a abertura do caixa a um responsável."
  );

  assert.match(abrir, /rpc_abrir_caixa/);
  assert.match(abrir, /revalidatePath\("\/fiscal"\)/);
  assert.doesNotMatch(preparar, /rpc_abrir_caixa/);

  assert.match(preparar, /exigirCaixaAberto:/);
  assert.match(preparar, /MENSAGEM_CAIXA_FECHADO_NFE_VENDA/);
  assert.match(preparar, /codigo === "CAIXA_FECHADO"/);
  assert.ok(
    pdv.indexOf("if (opcoes?.exigirCaixaAberto)") <
      pdv.indexOf("rpc_finalizar_venda_com_caixa")
  );
  assert.equal(
    MENSAGEM_CAIXA_FECHADO_FINALIZAR,
    "O caixa foi fechado. Abra um caixa para continuar."
  );
});

test("18-20. transferência, bonificação e devolução não exigem Caixa", () => {
  const form = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");
  const preparar = fonte("app/fiscal/nfe/operacoes-actions.ts");
  const emitirOp = fonte("app/api/fiscal/geranet/nfe-emitir-operacao/route.ts");
  const emitirDev = fonte(
    "app/api/fiscal/geranet/nfe-emitir-devolucao-fornecedor/route.ts"
  );

  assert.match(form, /if \(tipoAtual === "venda"\)/);
  assert.match(form, /nfe-emitir-operacao/);
  assert.doesNotMatch(emitirOp, /prepararVendaParaEmissaoNfe/);
  assert.doesNotMatch(emitirOp, /executarFinalizacaoVendaPdv/);
  semCaixa("app/api/fiscal/geranet/nfe-emitir-operacao/route.ts");
  semCaixa("app/api/fiscal/geranet/nfe-emitir-devolucao-fornecedor/route.ts");

  const criar = preparar.slice(
    preparar.indexOf("export async function criarOperacaoFiscal"),
    preparar.indexOf("export async function salvarDestinatarioBonificacao")
  );
  assert.doesNotMatch(criar, /exigirCaixaAberto/);
  assert.doesNotMatch(criar, /executarFinalizacaoVendaPdv/);
  assert.doesNotMatch(emitirDev, /nfeVendaNovaExigeCaixa/);
});

test("21-22. rejeição e cancelamento fiscal não inventam movimento de Caixa", () => {
  semCaixa("app/api/fiscal/emissoes/[id]/cancelar/route.ts");
  semCaixa("app/api/fiscal/emissoes/[id]/inutilizar/route.ts");
  semCaixa("app/api/fiscal/emissoes/[id]/carta-correcao/route.ts");
  const fase2b = fonte(FASE2B);
  assert.match(fase2b, /recebimento_carteira|estorno_recebimento/);
  assert.doesNotMatch(fase2b, /cancelamento fiscal|cstat|SEFAZ/i);
});

test("23. isolamento multiempresa na materialização da venda NF-e", () => {
  const preparar = fonte("app/fiscal/nfe/operacoes-actions.ts");
  const bloco = preparar.slice(
    preparar.indexOf("export async function prepararVendaParaEmissaoNfe")
  );
  assert.match(bloco, /eq\("empresa_id", empresaId\)/);
  assert.match(bloco, /registroPertenceAEmpresaAtiva/);
  assert.match(preparar, /principal", true/);
  const pdv = fonte("app/pdv/actions.ts");
  assert.match(pdv, /p_empresa_id:\s+vinculo\.empresa_id/);
  const sessao = fonte("lib/caixa/sessao-aberta.ts");
  assert.match(sessao, /\.eq\("empresa_id", id\)/);
  assert.match(sessao, /registroPertenceAEmpresaAtiva/);
});

test("24-26. PDV web, Carteira e Fases 2A/2B/3 do Caixa permanecem no wrapper oficial", () => {
  const pdvPage = fonte("app/pdv/page.tsx");
  const pdvActions = fonte("app/pdv/actions.ts");
  const api = fonte("app/api/pdv/finalizar/route.ts");
  assert.match(pdvPage, /caixaAberto=/);
  assert.match(pdvActions, /exigirCaixaAberto:\s*true/);
  assert.match(pdvActions, /rpc_finalizar_venda_com_caixa/);
  assert.match(api, /executarFinalizacaoVendaPdv\(corpo\)/);
  assert.doesNotMatch(api, /executarFinalizacaoVendaPdv\(corpo,/);

  const receber = fonte("app/api/clientes/[id]/carteira/receber/route.ts");
  const estornar = fonte(
    "app/api/clientes/[id]/carteira/estornar-recebimento/route.ts"
  );
  assert.match(receber, /rpc_receber_carteira_com_caixa/);
  assert.match(estornar, /rpc_estornar_recebimento_carteira_com_caixa/);

  assert.match(fonte(FISICO), /afeta_caixa_fisico_snapshot/);
  assert.match(fonte(FASE2B), /recebimento_carteira/);
  assert.match(fonte(FASE3), /rpc_iniciar_fechamento_caixa|rpc_confirmar_fechamento_caixa/);
  assert.match(fonte(FASE1), /rpc_abrir_caixa/);
  assert.doesNotMatch(
    fonte("app/fiscal/nfe/operacoes-actions.ts"),
    /rpc_finalizar_venda_com_caixa/
  );
});

test("rascunho Editar NF-e: guard não depende da URL Nova NF-e", () => {
  const form = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");
  const carregar = fonte("lib/fiscal/nfe55/carregar-formulario-nfe.ts");
  const pagina = fonte("app/fiscal/nfe/nfe-emissao-pagina.tsx");
  const nova = fonte("app/fiscal/nfe/nova/page.tsx");
  const editar = fonte("app/fiscal/nfe/[id]/editar/page.tsx");
  const preparar = fonte("app/fiscal/nfe/operacoes-actions.ts");
  const verificar = preparar.slice(
    preparar.indexOf("export async function verificarOperacaoFiscalAction"),
    preparar.indexOf("export async function confirmarSaidaOperacaoFiscal") !== -1
      ? preparar.indexOf("export async function confirmarSaidaOperacaoFiscal")
      : preparar.indexOf("export async function prepararVendaParaEmissaoNfe")
  );

  assert.match(nova, /NfeEmissaoPagina/);
  assert.match(editar, /NfeEmissaoPagina operacaoId=\{id\}/);
  assert.match(pagina, /carregarFormularioNfeEmissao/);
  assert.match(pagina, /caixaAberto=\{formulario\.caixaAberto === true\}/);
  assert.doesNotMatch(pagina, /Nova NF-e.*caixaAberto|operacaoId \? null/);
  assert.match(carregar, /buscarCaixaAbertoEmpresa/);
  assert.match(carregar, /vendaId: operacao\?\.venda_id/);
  assert.match(carregar, /vinculaVenda: tipo\.vincula_venda === true/);
  assert.doesNotMatch(carregar, /Boolean\(tipo\.vincula_venda\)/);

  assert.equal(
    nfeVendaNovaExigeCaixa({ tipoOperacaoInterno: "" }),
    false
  );
  assert.equal(
    nfeVendaNovaExigeCaixa({
      tipoOperacaoInterno: "venda",
      vendaId: null,
    }),
    true
  );
  assert.equal(vendaIdNfeMaterializada(null), false);
  assert.equal(vendaIdNfeMaterializada("  "), false);

  assert.match(form, /vendaNovaSemCaixa/);
  assert.match(form, /operacao\.vendaId/);
  assert.match(form, /operacao\.tipo/);
  assert.match(form, /data-nfe-caixa-bloqueado=\{vendaNovaSemCaixa/);
  assert.match(form, /disabled=\{pending \|\| !podeEmitir \|\| vendaNovaSemCaixa\}/);
  assert.match(form, /if \(vendaNovaSemCaixa\)/);
  assert.match(form, /setCaixaLiberadoLocal\(true\)/);
  assert.match(form, /onAberto=/);
  assert.match(fonte("components/pdv/pdv-caixa-fechado.tsx"), /onAberto\?\.\(\)/);

  assert.match(form, /tipoAtual === "transferencia"|destTipo === "estabelecimento"/);
  assert.equal(
    nfeVendaNovaExigeCaixa({ tipoOperacaoInterno: "transferencia" }),
    false
  );
  assert.equal(
    nfeVendaNovaExigeCaixa({ tipoOperacaoInterno: "bonificacao" }),
    false
  );

  const blocoPreparar = preparar.slice(
    preparar.indexOf("export async function prepararVendaParaEmissaoNfe")
  );
  assert.match(blocoPreparar, /fiscal_tipos_operacao/);
  assert.match(blocoPreparar, /exigirCaixaAberto: exigeCaixa/);
  assert.match(blocoPreparar, /MENSAGEM_CAIXA_FECHADO_NFE_VENDA/);
  assert.match(blocoPreparar, /vendaIdNfeMaterializada/);
  assert.match(blocoPreparar, /if \(!vendaId\)/);

  assert.doesNotMatch(verificar, /executarFinalizacaoVendaPdv/);
  assert.doesNotMatch(verificar, /rpc_finalizar_venda/);
  const persistir = form.slice(form.indexOf("async function persistirRascunho"));
  assert.doesNotMatch(
    persistir.slice(0, persistir.indexOf("function acionarValidar")),
    /prepararVendaParaEmissaoNfe/
  );
});
