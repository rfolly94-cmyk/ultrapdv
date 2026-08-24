import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, usuarioA } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import { totaisDoLivro } from "@/lib/caixa/saldo";
import { parseValorCaixa } from "@/lib/caixa/valor";
import { avaliarCamadasAcesso } from "@/lib/plataforma/entitlements/camadas";
import { modoEntitlementDoRecurso } from "@/lib/plataforma/entitlements/rollout";
import { hrefsMenuPermitidos } from "@/lib/permissoes/menu";
import { presetDoPerfil } from "@/lib/permissoes/presets";
import { decidirAcessoRota } from "@/lib/permissoes/rotas";
import { temPermissao } from "@/lib/permissoes/tem-permissao";

const MIGRATION = "supabase/migrations/20260824100000_caixa_modulo.sql";

test("saldo do caixa deriva das movimentações e não de coluna mutável", () => {
  const totais = totaisDoLivro([
    { tipo: "abertura", entrada: 100, saida: 0 },
    { tipo: "suprimento", entrada: 50, saida: 0 },
    { tipo: "sangria", entrada: 0, saida: 30 },
  ]);
  assert.equal(totais.saldoInicial, 100);
  assert.equal(totais.suprimentos, 50);
  assert.equal(totais.sangrias, 30);
  assert.equal(totais.saldoAtual, 120);
  assert.equal(parseValorCaixa("1.250,50"), 1250.5);

  const sql = fonte(MIGRATION);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.caixas/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.caixa_movimentacoes/);
  assert.doesNotMatch(
    sql.slice(0, sql.indexOf("CREATE TABLE IF NOT EXISTS public.caixa_movimentacoes")),
    /saldo_atual/
  );
  assert.match(sql, /caixa_saldo_dinheiro/);
  assert.match(sql, /rpc_abrir_caixa/);
  assert.match(sql, /rpc_movimentar_caixa/);
  assert.match(sql, /rpc_fechar_caixa/);
  assert.match(sql, /ux_caixas_aberto_empresa_sem_filial/);
  assert.match(sql, /tem_acesso_empresa\(empresa_id\)/);
  assert.match(sql, /caixa_empresa_ativa_usuario/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.rpc_abrir_caixa\(\s*p_saldo_inicial numeric/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.rpc_movimentar_caixa\(\s*p_caixa_id uuid/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.rpc_fechar_caixa\(\s*p_caixa_id uuid/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.caixas/);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.caixa_movimentacoes/);
});

test("abertura, sangria e fechamento são atômicos no servidor", () => {
  const actions = fonte("app/caixa/actions.ts");
  assert.match(actions, /eq\("principal", true\)/);
  assert.match(actions, /eq\("ativo", true\)/);
  assert.match(actions, /rpc_abrir_caixa/);
  assert.match(actions, /rpc_movimentar_caixa/);
  assert.match(actions, /rpc_fechar_caixa/);
  assert.match(actions, /exigirOperacaoCaixa/);
  assert.doesNotMatch(actions, /createAdminClient|SUPABASE_SECRET_KEY|service_role/);
  assert.doesNotMatch(actions, /searchParams\.get\("empresa_id"\)|input\.empresaId/);
  assert.doesNotMatch(fonte("components/caixa/caixa-workspace.tsx"), /createAdminClient/);
  assert.doesNotMatch(fonte("app/caixa/page.tsx"), /createAdminClient/);
});

test("módulo /caixa respeita plano e permissão, sem integrar PDV nesta fase", () => {
  assert.equal(modoEntitlementDoRecurso("caixa"), "enforce");
  assert.equal(temPermissao(presetDoPerfil("caixa"), "caixa", "abrir"), true);
  assert.equal(temPermissao(presetDoPerfil("vendedor"), "caixa", "abrir"), false);
  assert.equal(temPermissao(presetDoPerfil("contador"), "caixa", "acessar"), true);
  assert.equal(temPermissao(presetDoPerfil("contador"), "caixa", "abrir"), false);

  const permitido = decidirAcessoRota({
    pathname: "/caixa",
    permissoes: presetDoPerfil("caixa"),
  });
  const bloqueado = decidirAcessoRota({
    pathname: "/caixa",
    permissoes: presetDoPerfil("vendedor"),
  });
  assert.equal(permitido.ok, true);
  assert.equal(bloqueado.ok, false);
  assert.ok(hrefsMenuPermitidos(presetDoPerfil("caixa")).includes("/caixa"));
  assert.equal(hrefsMenuPermitidos(presetDoPerfil("vendedor")).includes("/caixa"), false);

  const camadas = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "caixa",
    modulo: "caixa",
    acao: "abrir",
    permissoes: presetDoPerfil("caixa"),
    assinatura: { empresa_id: empresaA, status: "ativa" },
    recursosDoPlano: [{ chave: "caixa", habilitado: true, ativo: true }],
  });
  assert.equal(camadas.permitido, true);

  assert.match(fonte("lib/permissoes/menu.ts"), /href: "\/caixa"/);
  assert.match(fonte("components/layout/app-sidebar.tsx"), /useRecursoLiberado\("caixa"\)/);
  assert.match(fonte("lib/permissoes/rotas.ts"), /modulo: "caixa"/);
  assert.doesNotMatch(fonte("app/pdv/actions.ts"), /rpc_abrir_caixa|rpc_movimentar_caixa|rpc_fechar_caixa/);
  assert.doesNotMatch(fonte("app/caixa/actions.ts"), /carteira_|pix_|rpc_cancelar_venda|finalizarVenda/);
});
