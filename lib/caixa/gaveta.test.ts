import assert from "node:assert/strict";
import { test } from "node:test";

import { fonte } from "@/lib/multiempresa/fonte";
import {
  ABRIR_GAVETA_APOS_VENDA_DINHEIRO_PADRAO,
  abrirGavetaAposVendaDinheiroDoRegistro,
  deveAbrirGavetaAposVenda,
  origemAberturaGaveta,
  vendaTemPagamentoDinheiro,
} from "@/lib/caixa/gaveta";
import {
  MENSAGEM_GAVETA_CAIXA_FECHADO,
  MENSAGEM_GAVETA_VENDA_SEM_ABRIR,
} from "@/lib/caixa/mensagens";

const MIGRATION = "supabase/migrations/20260828100000_caixa_gaveta.sql";

const dinheiro = { tipo: "DINHEIRO", codigo: "01", nome: "Dinheiro" };
const pix = { tipo: "PIX", codigo: "PIX", nome: "Pix" };
const debito = { tipo: "CARTAO_DEBITO", codigo: "04", nome: "Débito" };
const credito = { tipo: "CARTAO_CREDITO", codigo: "03", nome: "Crédito" };

test("padrão da abertura automática é false e é por empresa", () => {
  assert.equal(ABRIR_GAVETA_APOS_VENDA_DINHEIRO_PADRAO, false);
  assert.equal(abrirGavetaAposVendaDinheiroDoRegistro(undefined), false);
  assert.equal(abrirGavetaAposVendaDinheiroDoRegistro(null), false);
  assert.equal(abrirGavetaAposVendaDinheiroDoRegistro("true"), false);
  assert.equal(abrirGavetaAposVendaDinheiroDoRegistro(true), true);

  const sql = fonte(MIGRATION);
  assert.match(
    sql,
    /abrir_gaveta_apos_venda_dinheiro boolean NOT NULL DEFAULT false/
  );
  assert.match(sql, /ALTER TABLE public\.caixa_configuracoes/);
  assert.doesNotMatch(sql, /CREATE TABLE public\.caixa_configuracoes/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.caixa_eventos/);
  assert.match(sql, /tem_acesso_empresa\(empresa_id\)/);
  assert.match(sql, /caixa_empresa_ativa_usuario\(\)/);
  assert.match(sql, /rpc_definir_abrir_gaveta_apos_venda_dinheiro/);
  assert.match(sql, /rpc_registrar_abertura_gaveta/);
  assert.match(sql, /p_origem text/);
  assert.doesNotMatch(sql, /p_empresa_id/);
  assert.match(sql, /origem = ANY \(ARRAY\['caixa', 'pdv', 'venda'\]/);
  assert.match(sql, /tipo = 'abertura_gaveta'/);
  assert.doesNotMatch(sql, /INSERT INTO public\.caixa_movimentacoes/);
  assert.doesNotMatch(sql, /rpc_movimentar_caixa/);
});

test("RPC e actions não recebem empresa_id do browser", () => {
  const action = fonte("app/configuracoes/caixa/actions.ts");
  const gaveta = fonte("app/caixa/gaveta-actions.ts");
  assert.match(action, /rpc_definir_abrir_gaveta_apos_venda_dinheiro/);
  assert.doesNotMatch(action, /input\.empresaId|p_empresa_id/);
  assert.match(action, /principal", true/);
  assert.match(gaveta, /buscarCaixaAbertoEmpresa/);
  assert.match(gaveta, /rpc_registrar_abertura_gaveta/);
  assert.doesNotMatch(gaveta, /input\.empresaId|p_empresa_id/);
  assert.doesNotMatch(gaveta, /createAdminClient|service_role/);
});

test("abertura automática só com pagamento em dinheiro", () => {
  assert.equal(vendaTemPagamentoDinheiro([{ ...dinheiro, valorCentavos: 1000 }]), true);
  assert.equal(vendaTemPagamentoDinheiro([{ forma: pix, valorCentavos: 1000 }]), false);
  assert.equal(vendaTemPagamentoDinheiro([{ forma: debito, valorCentavos: 1000 }]), false);
  assert.equal(vendaTemPagamentoDinheiro([{ forma: credito, valorCentavos: 1000 }]), false);
  assert.equal(
    vendaTemPagamentoDinheiro([
      { forma: pix, valorCentavos: 500 },
      { forma: dinheiro, valorCentavos: 500 },
    ]),
    true
  );
  assert.equal(
    deveAbrirGavetaAposVenda({
      configAtiva: false,
      pagamentos: [{ forma: dinheiro, valorCentavos: 1000 }],
    }),
    false
  );
  assert.equal(
    deveAbrirGavetaAposVenda({
      configAtiva: true,
      pagamentos: [{ forma: pix, valorCentavos: 1000 }],
    }),
    false
  );
  assert.equal(
    deveAbrirGavetaAposVenda({
      configAtiva: true,
      pagamentos: [{ forma: dinheiro, valorCentavos: 1000 }],
    }),
    true
  );
  assert.equal(origemAberturaGaveta("caixa"), "caixa");
  assert.equal(origemAberturaGaveta("pdv"), "pdv");
  assert.equal(origemAberturaGaveta("venda"), "venda");
  assert.equal(origemAberturaGaveta("sangria"), null);
});

test("falha do Connector não desfaz a venda; abre só depois de finalizar", () => {
  const shell = fonte("components/pdv/pdv-shell.tsx");
  const posFinalizar = shell.indexOf("await finalizarVendaPdv");
  const posAutoGaveta = shell.indexOf('origem: "venda"');
  assert.ok(posFinalizar > 0);
  assert.ok(posAutoGaveta > posFinalizar);
  assert.match(shell, /if \(!resultado\.ok\)/);
  assert.match(shell, /deveAbrirGavetaAposVenda/);
  assert.match(shell, /avisoGaveta = MENSAGEM_GAVETA_VENDA_SEM_ABRIR/);
  assert.match(shell, /catch \{[\s\S]*avisoGaveta = MENSAGEM_GAVETA_VENDA_SEM_ABRIR/);
  assert.doesNotMatch(shell, /rpc_cancelar_venda|cancelarVenda/);
  assert.equal(
    MENSAGEM_GAVETA_VENDA_SEM_ABRIR,
    "Venda concluída, mas não foi possível abrir a gaveta."
  );
  assert.equal(
    MENSAGEM_GAVETA_CAIXA_FECHADO,
    "Abra o Caixa para solicitar a abertura da gaveta."
  );
});

test("botão, atalho F4 e configuração automática estão nos lugares certos", () => {
  const caixa = fonte("components/caixa/caixa-workspace.tsx");
  const pdv = fonte("components/pdv/pdv-shell.tsx");
  const form = fonte("app/configuracoes/caixa/caixa-controle-form.tsx");
  const conector = fonte("print-agent/src/pagina-status.html");
  const server = fonte("print-agent/src/server.mjs");

  assert.match(caixa, /Abrir gaveta/);
  assert.match(caixa, /origem: "caixa"/);
  assert.doesNotMatch(caixa, /rpc_movimentar_caixa/);
  assert.match(pdv, /Abrir gaveta/);
  assert.match(pdv, /event.key === "F4"/);
  assert.match(pdv, /origem: "pdv"/);
  assert.match(form, /Abrir gaveta automaticamente após finalizar venda em dinheiro/);
  assert.match(form, /definirAbrirGavetaAposVendaDinheiro/);
  assert.match(conector, /Gaveta de dinheiro/);
  assert.match(conector, /Testar abertura da gaveta/);
  assert.match(conector, /Pino 0/);
  assert.match(conector, /Pino 1/);
  assert.match(server, /\/drawer\/open/);
  assert.match(server, /somente localhost/i);
});
