import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB, usuarioA } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import { ignorarEmpresaIdDoCliente, parseContextoTelaAssistente } from "./contexto";
import {
  FERRAMENTAS_ESCRITA_IA,
  MENSAGEM_EMPRESA_TROCADA,
  MENSAGEM_PROPOSTA_EXPIRADA,
  MENSAGEM_STALE_PRODUTO,
} from "./acoes/tipos";
import { hashEstadoEntidade } from "./acoes/hash";
import {
  bloquearStale,
  bloquearTrocaEmpresa,
  ferramentaEscritaAutonoma,
  podeConfirmarStatus,
} from "./acoes/regras";
import { NOMES_FERRAMENTAS_IA } from "./tipos";

test("proposta não usa payload do client e ignora empresa_id arbitrário", () => {
  const limpo = ignorarEmpresaIdDoCliente({
    empresa_id: empresaB,
    empresaId: empresaB,
    propostaId: "x",
    payload: { ncm: "99999999" },
  });
  assert.equal("empresa_id" in limpo, false);
  assert.equal("empresaId" in limpo, false);
  assert.match(fonte("lib/ia/acoes/confirmar.ts"), /carregarPropostaAcao/);
  assert.doesNotMatch(fonte("lib/ia/acoes/confirmar.ts"), /params\.payload/);
  assert.match(fonte("supabase/migrations/20260828040000_ia_propostas_acoes.sql"), /Payload da proposta IA é imutável/);
  assert.match(
    fonte("supabase/migrations/20260828040000_ia_propostas_acoes.sql"),
    /usuario_id = auth.uid/
  );
});

test("confirmação, cancelamento, expiração e idempotência", () => {
  const agora = new Date("2026-08-27T12:00:00.000Z");
  const futura = "2026-08-27T12:30:00.000Z";
  const passada = "2026-08-27T11:00:00.000Z";
  assert.equal(podeConfirmarStatus("pendente", futura, agora).ok, true);
  const expirada = podeConfirmarStatus("pendente", passada, agora);
  assert.equal(expirada.ok, false);
  if (!expirada.ok) {
    assert.match(expirada.erro, /expirou/i);
  }
  assert.equal(MENSAGEM_PROPOSTA_EXPIRADA.includes("expirou"), true);
  const exec = podeConfirmarStatus("executada", futura, agora);
  assert.equal(exec.ok, true);
  if (exec.ok) {
    assert.equal(exec.idempotente, true);
  }
  assert.equal(podeConfirmarStatus("cancelada", futura, agora).ok, false);
  assert.match(fonte("lib/ia/acoes/cancelar.ts"), /eq\("status", "pendente"\)/);
  assert.match(fonte("lib/ia/acoes/confirmar.ts"), /eq\("status", "pendente"\)/);
});

test("stale write e troca de empresa bloqueiam execução", () => {
  const stale = bloquearStale({
    hashAtual: "aaa",
    hashProposta: "bbb",
    entidadeTipo: "produto",
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.erro, MENSAGEM_STALE_PRODUTO);
  const ok = bloquearStale({
    hashAtual: "aaa",
    hashProposta: "aaa",
    entidadeTipo: "produto",
  });
  assert.equal(ok.ok, true);
  const empresa = bloquearTrocaEmpresa(empresaA, empresaB);
  assert.equal(empresa.ok, false);
  assert.equal(empresa.erro, MENSAGEM_EMPRESA_TROCADA);
  assert.equal(bloquearTrocaEmpresa(empresaA, empresaA).ok, true);
  assert.notEqual(hashEstadoEntidade({ ncm: "1" }), hashEstadoEntidade({ ncm: "2" }));
});

test("modelo não recebe ferramentas de escrita nem SQL/RPC genérica", () => {
  for (const nome of FERRAMENTAS_ESCRITA_IA) {
    assert.equal((NOMES_FERRAMENTAS_IA as readonly string[]).includes(nome), false, nome);
    assert.equal(ferramentaEscritaAutonoma(nome), true);
  }
  assert.equal(NOMES_FERRAMENTAS_IA.includes("propor_atualizacao_fiscal_produto" as never), false);
  assert.equal(NOMES_FERRAMENTAS_IA.includes("propor_atribuicao_grupo_fiscal" as never), false);
  assert.equal(NOMES_FERRAMENTAS_IA.includes("propor_criacao_grupo_fiscal" as never), false);
  assert.equal(NOMES_FERRAMENTAS_IA.includes("propor_atualizacao_produto" as never), false);
  assert.equal(NOMES_FERRAMENTAS_IA.includes("propor_acao_notificacao" as never), false);
  assert.match(fonte("lib/ia/executar-assistente.ts"), /ferramentaEscritaAutonoma/);
  assert.match(fonte("lib/ia/executar-assistente.ts"), /MAX_CHAMADAS_POR_MENSAGEM/);
});

test("execução reusa actions oficiais e não inventa segundo gravador", () => {
  assert.match(fonte("lib/ia/acoes/executores/fiscal-produto.ts"), /persistirFiscalProdutoApi/);
  assert.match(fonte("lib/ia/acoes/executores/fiscal-produto.ts"), /classificarProdutoFiscal/);
  assert.match(fonte("lib/ia/acoes/executores/grupo-fiscal.ts"), /criarGrupoFiscalApi/);
  assert.match(fonte("lib/ia/acoes/executores/grupo-fiscal.ts"), /eq\("empresa_id", params.ctx.empresaId\)/);
  assert.match(fonte("lib/ia/acoes/executores/produto-basico.ts"), /persistirCamposBasicosProdutoApi/);
  assert.match(fonte("lib/ia/acoes/executores/produto-basico.ts"), /persistirEstoqueMinimoProdutoApi/);
  assert.doesNotMatch(fonte("lib/ia/acoes/executores/produto-basico.ts"), /preco_venda|estoque_atual\.quantidade/);
  assert.match(fonte("lib/ia/acoes/executores/notificacoes.ts"), /aplicarEstadoNotificacaoUsuario/);
  assert.match(fonte("app/notificacoes/actions.ts"), /aplicarEstadoNotificacaoUsuario/);
  assert.match(fonte("lib/ia/acoes/desfazer.ts"), /entidade: "desfazer"/);
  assert.doesNotMatch(fonte("lib/ia/acoes/desfazer.ts"), /delete\(\)|from\("ia_auditoria"\).*delete/);
});

test("contexto de grupo fiscal e central de notificações", () => {
  const grupo = parseContextoTelaAssistente({
    pathname: "/produtos/grupos-fiscais",
    search: `editar=${empresaA}`,
  });
  assert.equal(grupo.grupoFiscalId, empresaA);
  assert.equal(grupo.produtoId, null);
  assert.equal(grupo.rotulo, "grupo fiscal aberto");
  const central = parseContextoTelaAssistente({
    pathname: "/configuracoes/notificacoes",
    search: `notificacao=${usuarioA}`,
  });
  assert.equal(central.rotulo, "central de notificações");
  assert.ok(central.notificacaoIds.includes(usuarioA));
});

test("lote de escrita não é implementado nesta fase", () => {
  assert.doesNotMatch(fonte("lib/ia/ferramentas/propor.ts"), /propor_atualizacao_fiscal_lote|aplicar_lote/);
  assert.match(fonte("lib/ia/prompts/sistema.ts"), /SOMENTE LEITURA/);
});
