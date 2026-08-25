import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CONTROLE_CAIXA_ATIVO_PADRAO,
  controleCaixaAtivoDoRegistro,
  deveUsarLivroCaixa,
  rpcEstornarCarteiraPorControle,
  rpcReceberCarteiraPorControle,
  sessaoCaixaLiberadaParaOperar,
} from "@/lib/caixa/controle";
import {
  MENSAGEM_CONTROLE_CAIXA_ATIVADO,
  MENSAGEM_CONTROLE_CAIXA_BLOQUEIA_DESATIVAR,
  MENSAGEM_CONTROLE_CAIXA_DESATIVADO,
  MENSAGEM_CONTROLE_CAIXA_DESATIVADO_DETALHE,
  MENSAGEM_CONTROLE_CAIXA_DESATIVADO_OPERACAO,
} from "@/lib/caixa/mensagens";
import { nfeVendaNovaExigeCaixa } from "@/lib/caixa/nfe-venda";
import { fonte } from "@/lib/multiempresa/fonte";
import { resolverExigenciaRota } from "@/lib/permissoes/rotas";

const MIGRATION = "supabase/migrations/20260825170000_caixa_controle_ativo.sql";

test("1. empresa nova/default: controle ativo; registro ausente ou inválido não desliga", () => {
  assert.equal(CONTROLE_CAIXA_ATIVO_PADRAO, true);
  assert.equal(controleCaixaAtivoDoRegistro(undefined), true);
  assert.equal(controleCaixaAtivoDoRegistro(null), true);
  assert.equal(controleCaixaAtivoDoRegistro(true), true);
  assert.equal(controleCaixaAtivoDoRegistro("false"), true);
  assert.equal(controleCaixaAtivoDoRegistro(false), false);

  const sql = fonte(MIGRATION);
  assert.match(sql, /controle_caixa_ativo boolean NOT NULL DEFAULT true/);
  assert.match(sql, /ALTER TABLE public\.caixa_configuracoes/);
  assert.doesNotMatch(sql, /CREATE TABLE public\.caixa_configuracoes/);
});

test("helper canônico e decisão explícita do livro", () => {
  assert.equal(
    deveUsarLivroCaixa({ controleAtivo: true, fluxoExigeCaixa: true }),
    true
  );
  assert.equal(
    deveUsarLivroCaixa({ controleAtivo: false, fluxoExigeCaixa: true }),
    false
  );
  assert.equal(
    deveUsarLivroCaixa({ controleAtivo: true, fluxoExigeCaixa: false }),
    false
  );
  assert.equal(
    sessaoCaixaLiberadaParaOperar({ controleAtivo: false, caixaAberto: false }),
    true
  );
  assert.equal(
    sessaoCaixaLiberadaParaOperar({ controleAtivo: true, caixaAberto: false }),
    false
  );
  assert.equal(
    sessaoCaixaLiberadaParaOperar({ controleAtivo: true, caixaAberto: true }),
    true
  );
  assert.equal(
    rpcReceberCarteiraPorControle(true),
    "rpc_receber_carteira_com_caixa"
  );
  assert.equal(
    rpcReceberCarteiraPorControle(false),
    "rpc_receber_carteira_cliente"
  );
  assert.equal(
    rpcEstornarCarteiraPorControle(true),
    "rpc_estornar_recebimento_carteira_com_caixa"
  );
  assert.equal(
    rpcEstornarCarteiraPorControle(false),
    "rpc_estornar_recebimento_carteira"
  );

  const helper = fonte("lib/caixa/controle-servidor.ts");
  assert.match(helper, /export async function controleCaixaAtivo/);
  assert.match(helper, /registroPertenceAEmpresaAtiva/);
  assert.doesNotMatch(helper, /p_empresa_id|body\.empresa_id/);
});

test("2-6. PDV web: ativo exige sessão; desativado finaliza sem livro", () => {
  const page = fonte("app/pdv/page.tsx");
  const actions = fonte("app/pdv/actions.ts");
  const api = fonte("app/api/pdv/finalizar/route.ts");

  assert.match(page, /sessaoCaixaLiberadaParaOperar/);
  assert.match(page, /controleCaixaAtivo\(/);
  assert.match(actions, /exigirCaixaAberto:\s*true/);
  assert.match(actions, /fluxoExigeCaixa = opcoes\?\.exigirCaixaAberto === true/);
  assert.match(actions, /controleCaixaAtivo/);
  assert.match(actions, /deveUsarLivroCaixa/);
  assert.match(actions, /rpcFinalizacao = usarLivroCaixa/);
  assert.match(actions, /rpc_finalizar_venda_com_caixa/);
  assert.match(actions, /"rpc_finalizar_venda"/);
  assert.ok(actions.indexOf("usarLivroCaixa") < actions.indexOf("supabase.rpc"));
  assert.doesNotMatch(
    actions,
    /rpc_finalizar_venda_com_caixa[\s\S]{0,80}catch[\s\S]{0,200}rpc_finalizar_venda/
  );

  assert.match(api, /executarFinalizacaoVendaPdv\(corpo\)/);
  assert.doesNotMatch(api, /executarFinalizacaoVendaPdv\(corpo,/);
  assert.doesNotMatch(api, /controleCaixaAtivo|exigirCaixaAberto/);
});

test("7-9. Carteira escolhe wrapper ou RPC comercial antes da chamada", () => {
  const receber = fonte("app/api/clientes/[id]/carteira/receber/route.ts");
  const estornar = fonte(
    "app/api/clientes/[id]/carteira/estornar-recebimento/route.ts"
  );
  const actions = fonte("app/clientes/[id]/carteira/actions.ts");

  for (const fonteCarteira of [receber, estornar, actions]) {
    assert.match(fonteCarteira, /controleCaixaAtivo\(/);
    assert.doesNotMatch(fonteCarteira, /catch[\s\S]{0,120}rpc_receber_carteira_com_caixa/);
    assert.doesNotMatch(fonteCarteira, /empresa_id:\s*body|p_empresa_id:\s*input\.empresa/);
  }
  assert.match(receber, /rpcReceberCarteiraPorControle/);
  assert.match(estornar, /rpcEstornarCarteiraPorControle/);
  assert.match(actions, /rpcReceberCarteiraPorControle/);
  assert.match(actions, /rpcEstornarCarteiraPorControle/);
});

test("10-12. NF-e venda nova consulta o mesmo helper; venda existente não duplica", () => {
  const preparar = fonte("app/fiscal/nfe/operacoes-actions.ts");
  const form = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");
  const carregar = fonte("lib/fiscal/nfe55/carregar-formulario-nfe.ts");
  const bloco = preparar.slice(
    preparar.indexOf("export async function prepararVendaParaEmissaoNfe")
  );

  assert.equal(
    nfeVendaNovaExigeCaixa({
      tipoOperacaoInterno: "venda",
      vendaId: "venda-existente",
    }),
    false
  );
  assert.equal(
    deveUsarLivroCaixa({
      controleAtivo: false,
      fluxoExigeCaixa: nfeVendaNovaExigeCaixa({
        tipoOperacaoInterno: "venda",
        vendaId: null,
      }),
    }),
    false
  );
  assert.equal(
    deveUsarLivroCaixa({
      controleAtivo: true,
      fluxoExigeCaixa: nfeVendaNovaExigeCaixa({
        tipoOperacaoInterno: "venda",
        vendaId: null,
      }),
    }),
    true
  );

  assert.match(bloco, /controleCaixaAtivo\(/);
  assert.match(bloco, /deveUsarLivroCaixa/);
  assert.match(bloco, /if \(!vendaId\)/);
  assert.match(form, /controleCaixaAtivo !== false &&/);
  assert.match(carregar, /controleCaixaAtivo\(/);
  assert.match(carregar, /sessaoCaixaLiberadaParaOperar/);
  assert.doesNotMatch(preparar, /rpc_finalizar_venda_com_caixa/);
});

test("13-14 e 20. desativar com Caixa aberto é recusado no servidor e na RPC", () => {
  const sql = fonte(MIGRATION);
  const action = fonte("app/configuracoes/caixa/actions.ts");
  assert.equal(
    MENSAGEM_CONTROLE_CAIXA_BLOQUEIA_DESATIVAR,
    "Não é possível desativar o controle de Caixa enquanto houver um Caixa aberto. Feche a sessão atual primeiro."
  );
  assert.match(sql, /IF v_ativo IS FALSE AND EXISTS/);
  assert.match(sql, /status = 'aberto'/);
  assert.match(sql, /filial_id IS NULL/);
  assert.match(sql, /RAISE EXCEPTION 'Não é possível desativar o controle de Caixa enquanto houver um Caixa aberto/);
  assert.match(action, /buscarCaixaAbertoEmpresa/);
  assert.match(action, /MENSAGEM_CONTROLE_CAIXA_BLOQUEIA_DESATIVAR/);
  assert.match(action, /rpc_definir_controle_caixa/);
  assert.match(action, /acao: "editar_empresa"/);
  assert.doesNotMatch(action, /input\.empresaId|p_empresa_id/);
  assert.match(action, /principal", true/);
});

test("15-16. desativar não apaga histórico; ativar não importa vendas antigas", () => {
  const sql = fonte(MIGRATION);
  assert.doesNotMatch(sql, /DELETE FROM public\.caixas/);
  assert.doesNotMatch(sql, /DELETE FROM public\.caixa_movimentacoes/);
  assert.doesNotMatch(sql, /DELETE FROM public\.caixa_fechamentos/);
  assert.doesNotMatch(sql, /UPDATE public\.caixa_movimentacoes/);
  assert.doesNotMatch(sql, /rpc_abrir_caixa/);
  assert.doesNotMatch(sql, /rpc_finalizar_venda/);
  assert.match(fonte("app/configuracoes/caixa/actions.ts"), /MENSAGEM_CONTROLE_CAIXA_ATIVADO/);
  assert.equal(
    MENSAGEM_CONTROLE_CAIXA_ATIVADO,
    "Controle de Caixa ativado. Abra um Caixa antes de realizar novas vendas."
  );
});

test("17-19. reativar volta a exigir sessão; isolamento por empresa ativa; permissão", () => {
  const pdv = fonte("app/pdv/actions.ts");
  const helper = fonte("lib/caixa/controle-servidor.ts");
  const form = fonte("app/configuracoes/caixa/caixa-controle-form.tsx");
  assert.match(pdv, /buscarCaixaAbertoEmpresa/);
  assert.match(helper, /\.eq\("empresa_id", id\)/);
  assert.match(form, /podeEditar/);
  assert.match(form, /disabled=\{!podeEditar \|\| pending\}/);
  assert.match(form, /Desativar controle de Caixa\?/);
  assert.match(
    form,
    /Novas vendas e recebimentos deixarão de fazer parte do fechamento de Caixa/
  );
  assert.deepEqual(resolverExigenciaRota("/configuracoes/caixa"), {
    tipo: "permissao",
    modulo: "configuracoes",
    acao: "acessar",
  });
});

test("21. módulo Caixa permanece acessível sem abrir sessão nova", () => {
  const workspace = fonte("components/caixa/caixa-workspace.tsx");
  const actions = fonte("app/caixa/actions.ts");
  const page = fonte("app/caixa/page.tsx");
  assert.match(page, /carregarPainelCaixa/);
  assert.match(workspace, /MENSAGEM_CONTROLE_CAIXA_DESATIVADO/);
  assert.match(workspace, /MENSAGEM_CONTROLE_CAIXA_DESATIVADO_DETALHE/);
  assert.match(workspace, /data-caixa-controle-desativado/);
  assert.match(workspace, /painel\.anteriores/);
  assert.match(workspace, /CaixaRelatorioAcoes/);
  assert.match(workspace, /painel\.controleAtivo && podeAbrir/);
  assert.match(actions, /recusarSessaoCaixaSeControleDesativado/);
  assert.match(actions, /origem: "abrirCaixa"/);
  assert.match(actions, /origem: "movimentarCaixa"/);
  assert.match(actions, /origem: "reabrirCaixa"/);
  assert.equal(
    MENSAGEM_CONTROLE_CAIXA_DESATIVADO,
    "Controle de Caixa desativado"
  );
  assert.equal(
    MENSAGEM_CONTROLE_CAIXA_DESATIVADO_DETALHE,
    "As vendas e recebimentos atuais não estão sendo vinculados a uma sessão de Caixa."
  );
  assert.equal(
    MENSAGEM_CONTROLE_CAIXA_DESATIVADO_OPERACAO,
    "O controle de Caixa está desativado. Não é possível abrir ou movimentar uma sessão."
  );
});

test("22. Caixa mobile não ganha exigência nesta tarefa", () => {
  const api = fonte("app/api/pdv/finalizar/route.ts");
  assert.match(api, /executarFinalizacaoVendaPdv\(corpo\)/);
  assert.doesNotMatch(api, /exigirCaixaAberto:\s*true/);
  assert.doesNotMatch(api, /controleCaixaAtivo/);
});

test("RPC de configuração não aceita empresa_id do cliente", () => {
  const sql = fonte(MIGRATION);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.rpc_definir_controle_caixa\(\s*p_ativo boolean/);
  assert.match(sql, /caixa_empresa_ativa_usuario\(\)/);
  assert.doesNotMatch(sql, /p_empresa_id/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.rpc_definir_controle_caixa\(boolean\) TO authenticated/);
});
