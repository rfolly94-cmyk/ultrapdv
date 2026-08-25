import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "@/lib/multiempresa/fonte";

test("PDV web e Nova NF-e Venda exigem caixa aberto; mobile não nesta fase", () => {
  const page = fonte("app/pdv/page.tsx");
  const shell = fonte("components/pdv/pdv-shell.tsx");
  const bloqueio = fonte("components/pdv/pdv-caixa-fechado.tsx");
  const actions = fonte("app/pdv/actions.ts");
  const api = fonte("app/api/pdv/finalizar/route.ts");
  const fiscal = fonte("app/fiscal/nfe/operacoes-actions.ts");
  const sessao = fonte("lib/caixa/sessao-aberta.ts");
  const abrir = fonte("app/caixa/actions.ts");

  assert.match(page, /buscarCaixaAbertoEmpresa/);
  assert.match(page, /caixaAberto=/);
  assert.match(page, /podeAbrirCaixa=/);
  assert.match(page, /temPermissao\(/);
  assert.match(page, /"caixa"/);
  assert.match(page, /"abrir"/);
  assert.doesNotMatch(page, /rpc_abrir_caixa|abrirCaixa\(/);

  assert.match(shell, /PdvCaixaFechado/);
  assert.match(shell, /caixaAberto/);
  assert.match(shell, /if \(!caixaAberto\)/);
  assert.match(bloqueio, /Caixa fechado/);
  assert.match(bloqueio, /Abrir Caixa/);
  assert.match(bloqueio, /abrirCaixa/);
  assert.match(bloqueio, /MENSAGEM_CAIXA_FECHADO_SEM_PERMISSAO/);
  assert.doesNotMatch(bloqueio, /onClose|Cancelar/);

  assert.match(abrir, /rpc_abrir_caixa/);
  assert.match(abrir, /revalidatePath\("\/pdv"\)/);

  assert.match(actions, /exigirCaixaAberto:\s*true/);
  assert.match(actions, /buscarCaixaAbertoEmpresa/);
  assert.match(actions, /MENSAGEM_CAIXA_FECHADO_FINALIZAR/);
  assert.match(actions, /rpc_finalizar_venda_com_caixa/);
  assert.match(actions, /fluxoExigeCaixa = opcoes\?\.exigirCaixaAberto === true/);
  assert.match(actions, /deveUsarLivroCaixa/);
  assert.match(actions, /controleCaixaAtivo/);
  assert.ok(actions.indexOf("usarLivroCaixa") < actions.indexOf("rpc_finalizar_venda_com_caixa"));
  assert.doesNotMatch(actions, /rpc_abrir_caixa|rpc_movimentar_caixa|rpc_fechar_caixa/);

  assert.match(api, /executarFinalizacaoVendaPdv\(corpo\)/);
  assert.doesNotMatch(api, /executarFinalizacaoVendaPdv\(corpo,/);
  assert.match(api, /Futura integração Caixa mobile/);

  assert.match(fiscal, /executarFinalizacaoVendaPdv/);
  assert.match(fiscal, /exigirCaixaAberto:/);
  assert.match(fiscal, /nfeVendaNovaExigeCaixa/);
  assert.doesNotMatch(fiscal, /finalizarVendaPdv\(/);

  assert.match(sessao, /\.eq\("status", "aberto"\)/);
  assert.match(sessao, /\.is\("filial_id", null\)/);
  assert.match(sessao, /registroPertenceAEmpresaAtiva/);
});
