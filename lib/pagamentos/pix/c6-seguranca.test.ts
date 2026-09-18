import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import { normalizarStatusPagamentoPixGeranet } from "./evidencia-pagamento";
import { validarVinculoPixGeranetNaFinalizacao } from "./geranet-regras";
import { prefixoSegredosProvedor } from "./provedores";
import { filtrarCredenciaisDoProvedor } from "./credenciais";
import { chavePixC6ParaVault } from "./c6/persistencia";
import {
  decidirStatusPagamentoC6,
  e2eidConflitaComOutraCobranca,
  e2eidDeRespostaC6,
  ehE2eidPixC6Valido,
} from "./c6/confirmacao";
import { decidirAcessoRota, resolverExigenciaRota } from "@/lib/permissoes/rotas";
import { presetDoPerfil } from "@/lib/permissoes/presets";

const E2EID = `E${"A".repeat(31)}`;
const E2EID_B = `E${"B".repeat(31)}`;
const ADAPTER = "lib/pagamentos/pix/c6/adapter.ts";
const ACTIONS = "app/configuracoes/financeiro/pix/actions.ts";
const WORKSPACE = "app/configuracoes/financeiro/pix/pix-workspace.tsx";
const MIGRATION = "supabase/migrations/20260918120000_pix_c6_e2eid.sql";

test("1. CONCLUIDA + valor correto + e2eid → paga", () => {
  const evidencia = normalizarStatusPagamentoPixGeranet({
    httpStatus: 200,
    resposta: {
      status: "CONCLUIDA",
      pix: [{ endToEndId: E2EID, valor: "1.00" }],
    },
  });
  assert.equal(evidencia.estado, "pago");
  assert.equal(e2eidDeRespostaC6({
    pix: [{ endToEndId: E2EID, valor: "1.00" }],
  }), E2EID);
  assert.equal(
    decidirStatusPagamentoC6({
      statusAtual: "pendente",
      estado: "pago",
      valorCobranca: 1,
      valorPago: 1,
      e2eid: E2EID,
      pixPresente: true,
    }).status,
    "paga"
  );
});

test("2. CONCLUIDA sem e2eid → NÃO paga", () => {
  assert.equal(
    decidirStatusPagamentoC6({
      statusAtual: "pendente",
      estado: "pago",
      valorCobranca: 1,
      valorPago: 1,
      e2eid: null,
      pixPresente: true,
    }).status,
    "pendente"
  );
  assert.equal(ehE2eidPixC6Valido(""), false);
});

test("3. CONCLUIDA sem valor pago → NÃO paga", () => {
  assert.equal(
    decidirStatusPagamentoC6({
      statusAtual: "pendente",
      estado: "pago",
      valorCobranca: 1,
      valorPago: null,
      e2eid: E2EID,
      pixPresente: true,
    }).status,
    "pendente"
  );
  assert.equal(
    decidirStatusPagamentoC6({
      statusAtual: "pendente",
      estado: "pago",
      valorCobranca: 1,
      valorPago: 1,
      e2eid: E2EID,
      pixPresente: false,
    }).status,
    "pendente"
  );
});

test("4. valor divergente → divergencia_valor", () => {
  assert.equal(
    decidirStatusPagamentoC6({
      statusAtual: "pendente",
      estado: "pago",
      valorCobranca: 10,
      valorPago: 1,
      e2eid: E2EID,
      pixPresente: true,
    }).status,
    "divergencia_valor"
  );
  assert.throws(
    () =>
      validarVinculoPixGeranetNaFinalizacao({
        empresaId: empresaA,
        valorPagamento: 10,
        cobranca: {
          empresa_id: empresaA,
          status: "divergencia_valor",
          modo_pix: "geranet",
          provedor: "c6bank",
          valor: 10,
          valor_pago: 1,
          txid: "a".repeat(32),
          e2eid: E2EID,
        },
      }),
    /divergente/
  );
});

test("5. e2eid duplicado → rejeitado", () => {
  assert.equal(
    e2eidConflitaComOutraCobranca({
      e2eid: E2EID,
      cobrancaIdAtual: "cob-1",
      outras: [{ id: "cob-2", e2eid: E2EID }],
    }),
    true
  );
  assert.equal(
    decidirStatusPagamentoC6({
      statusAtual: "pendente",
      estado: "pago",
      valorCobranca: 1,
      valorPago: 1,
      e2eid: E2EID,
      pixPresente: true,
      e2eidDuplicado: true,
    }).status,
    "pendente"
  );
  assert.match(fonte(ADAPTER), /e2eid_duplicado/);
  assert.match(fonte(MIGRATION), /ux_cobrancas_pix_empresa_e2eid/);
});

test("6. mesmo webhook repetido → idempotente", () => {
  assert.equal(
    decidirStatusPagamentoC6({
      statusAtual: "paga",
      estado: "pago",
      valorCobranca: 1,
      valorPago: 1,
      e2eid: E2EID,
      pixPresente: true,
    }).motivo,
    "idempotente"
  );
  assert.equal(
    decidirStatusPagamentoC6({
      statusAtual: "vinculado_venda",
      estado: "pago",
      valorCobranca: 1,
      valorPago: 1,
      e2eid: E2EID,
      pixPresente: true,
    }).status,
    "vinculado_venda"
  );
  assert.match(fonte(ADAPTER), /idempotente: true/);
});

test("7. cobrança paga não gera segunda venda", () => {
  assert.throws(
    () =>
      validarVinculoPixGeranetNaFinalizacao({
        empresaId: empresaA,
        valorPagamento: 1,
        cobranca: {
          empresa_id: empresaA,
          status: "paga",
          modo_pix: "geranet",
          provedor: "c6bank",
          valor: 1,
          valor_pago: 1,
          txid: "a".repeat(32),
          e2eid: E2EID,
          venda_id: "venda-1",
        },
      }),
    /outra venda/
  );
  assert.match(fonte(MIGRATION), /Este PIX já foi utilizado em outra venda/);
});

test("8. empresa A não acessa cobrança da empresa B", () => {
  assert.notEqual(empresaA, empresaB);
  assert.throws(
    () =>
      validarVinculoPixGeranetNaFinalizacao({
        empresaId: empresaA,
        valorPagamento: 1,
        cobranca: {
          empresa_id: empresaB,
          status: "paga",
          modo_pix: "geranet",
          provedor: "c6bank",
          valor: 1,
          valor_pago: 1,
          txid: "a".repeat(32),
          e2eid: E2EID,
        },
      }),
    /outra empresa/
  );
  assert.match(fonte(ADAPTER), /\.eq\("empresa_id", empresaId\)/);
  assert.match(fonte(MIGRATION), /v_cobranca\.empresa_id <> p_empresa_id/);
});

test("9. operador PDV consegue emitir/consultar PIX sem financeiro.configurar_pix", () => {
  const caixa = presetDoPerfil("caixa");
  assert.equal(caixa.financeiro.configurar_pix, false);
  assert.deepEqual(
    resolverExigenciaRota("/api/pagamentos/pix/geranet/pdv/emitir"),
    { tipo: "permissao", modulo: "pdv", acao: "acessar" }
  );
  assert.deepEqual(
    resolverExigenciaRota("/api/pagamentos/pix/geranet/consultar"),
    { tipo: "permissao", modulo: "pdv", acao: "acessar" }
  );
  assert.deepEqual(
    resolverExigenciaRota("/api/pagamentos/pix/geranet/cancelar"),
    { tipo: "permissao", modulo: "pdv", acao: "acessar" }
  );
  assert.equal(
    decidirAcessoRota({
      pathname: "/api/pagamentos/pix/geranet/pdv/emitir",
      permissoes: caixa,
    }).ok,
    true
  );
});

test("10. operador não consegue alterar configuração PIX", () => {
  const caixa = presetDoPerfil("caixa");
  assert.deepEqual(
    resolverExigenciaRota("/api/pagamentos/pix/geranet/testar"),
    { tipo: "permissao", modulo: "financeiro", acao: "configurar_pix" }
  );
  assert.deepEqual(
    resolverExigenciaRota("/configuracoes/financeiro/pix"),
    { tipo: "permissao", modulo: "financeiro", acao: "configurar_pix" }
  );
  assert.equal(
    decidirAcessoRota({
      pathname: "/configuracoes/financeiro/pix",
      permissoes: caixa,
    }).ok,
    false
  );
  assert.equal(
    decidirAcessoRota({
      pathname: "/api/pagamentos/pix/geranet/testar",
      permissoes: caixa,
    }).ok,
    false
  );
});

test("11. trocar Sandbox → Produção não copia chave PIX", () => {
  assert.equal(chavePixC6ParaVault(""), null);
  assert.equal(chavePixC6ParaVault("   "), null);
  assert.equal(chavePixC6ParaVault("chave-producao"), "chave-producao");
  assert.match(fonte(ACTIONS), /chavePixC6ParaVault\(chavePix\)/);
  assert.doesNotMatch(fonte(ACTIONS), /chavePix \|\| texto\(atual\?\.chave_pix\)/);
  assert.match(fonte(WORKSPACE), /ehC6 \? ""/);
  assert.match(fonte(WORKSPACE), /não copia a chave anterior/);
  assert.match(fonte(ADAPTER), /chavePixPublica: null/);
});

test("12. produção lê chave PIX somente do Vault de produção", () => {
  const producao = prefixoSegredosProvedor({
    empresaId: empresaA,
    provedor: "c6bank",
    ambiente: "1",
  });
  const sandbox = prefixoSegredosProvedor({
    empresaId: empresaA,
    provedor: "c6bank",
    ambiente: "2",
  });
  assert.match(producao, /\/producao\//);
  assert.match(sandbox, /\/homologacao\//);
  assert.notEqual(producao, sandbox);
  const filtrado = filtrarCredenciaisDoProvedor(
    "c6bank",
    { chavePix: "chave-vault-producao" },
    "chave-publica-sandbox",
    "1"
  );
  assert.equal(filtrado.chavePix, "chave-vault-producao");
  assert.match(fonte(ADAPTER), /chavePixPublica: null/);
});

test("C6 só finaliza venda com e2eid e valor_pago da coluna", () => {
  assert.doesNotThrow(() =>
    validarVinculoPixGeranetNaFinalizacao({
      empresaId: empresaA,
      valorPagamento: 1,
      cobranca: {
        empresa_id: empresaA,
        status: "paga",
        modo_pix: "geranet",
        provedor: "c6bank",
        valor: 1,
        valor_pago: 1,
        txid: "a".repeat(32),
        e2eid: E2EID,
      },
    })
  );
  assert.throws(
    () =>
      validarVinculoPixGeranetNaFinalizacao({
        empresaId: empresaA,
        valorPagamento: 1,
        cobranca: {
          empresa_id: empresaA,
          status: "paga",
          modo_pix: "geranet",
          provedor: "c6bank",
          valor: 1,
          valor_pago: 1,
          txid: "a".repeat(32),
        },
      }),
    /e2eid/
  );
  assert.match(fonte(MIGRATION), /Cobrança PIX C6 sem e2eid/);
  assert.match(fonte(MIGRATION), /v_cobranca\.valor_pago/);
  assert.equal(E2EID_B.length, 32);
});
