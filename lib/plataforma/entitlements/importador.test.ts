import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB, usuarioA } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import {
  avaliarCamadasAcesso,
  decidirRecursoDoPlano,
  MODO_ENTITLEMENT,
} from "@/lib/plataforma/entitlements/camadas";
import {
  ErroEntitlement,
  mensagemRecursoNaoContratado,
} from "@/lib/plataforma/entitlements/erro";
import {
  modoEntitlementDoRecurso,
  RECURSOS_COM_ENFORCEMENT,
} from "@/lib/plataforma/entitlements/rollout";
import { presetDoPerfil } from "@/lib/permissoes/presets";

function plano(empresaId: string, importador: boolean | "ausente") {
  return {
    assinatura: {
      empresa_id: empresaId,
      plano_id: "plano-teste",
      status: "ativa",
    },
    recursosDoPlano:
      importador === "ausente"
        ? []
        : [{ chave: "importador", habilitado: importador, ativo: true }],
  };
}

test("rollout liga importador, impressao_automatica, relatorios e contabilidade", () => {
  assert.deepEqual(
    [...RECURSOS_COM_ENFORCEMENT],
    ["importador", "impressao_automatica", "relatorios", "contabilidade", "pix_integrado", "carteira", "produtos", "clientes", "estoque", "nfce", "nfe", "cce", "inutilizacao_fiscal", "vendas", "pdv", "catalogo"]
  );
  assert.equal(modoEntitlementDoRecurso("importador"), "enforce");
  assert.equal(modoEntitlementDoRecurso("nfe"), "enforce");
  assert.equal(modoEntitlementDoRecurso("pdv"), "enforce");
  assert.equal(modoEntitlementDoRecurso("impressao_automatica"), "enforce");
  assert.equal(modoEntitlementDoRecurso("relatorios"), "enforce");
  assert.equal(modoEntitlementDoRecurso("contabilidade"), "enforce");
  assert.equal(modoEntitlementDoRecurso("pix_integrado"), "enforce");
  assert.equal(modoEntitlementDoRecurso("carteira"), "enforce");
  assert.equal(modoEntitlementDoRecurso("produtos"), "enforce");
  assert.equal(modoEntitlementDoRecurso("clientes"), "enforce");
  assert.equal(modoEntitlementDoRecurso("estoque"), "enforce");
  assert.equal(MODO_ENTITLEMENT, "off");
});

test("CASO 1: importador true + permissão → permitido", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "importador",
    modulo: "importacao_dados",
    acao: "importar_produtos",
    permissoes: presetDoPerfil("administrador"),
    ...plano(empresaA, true),
  });
  assert.equal(resultado.permitido, true);
  assert.equal(resultado.motivo, null);
  assert.equal(resultado.modoEntitlement, "enforce");
});

test("CASO 2: importador false + permissão → RECURSO_NAO_CONTRATADO", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "importador",
    modulo: "importacao_dados",
    acao: "importar_produtos",
    permissoes: presetDoPerfil("gerente"),
    ...plano(empresaA, false),
  });
  assert.equal(resultado.permitido, false);
  assert.equal(resultado.motivo, "RECURSO_NAO_CONTRATADO");
  assert.equal(resultado.usuarioPermitiu, true);
});

test("CASO 3: importador true + sem permissão → PERMISSAO_USUARIO_NEGADA", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "importador",
    modulo: "importacao_dados",
    acao: "importar_produtos",
    permissoes: presetDoPerfil("caixa"),
    ...plano(empresaA, true),
  });
  assert.equal(resultado.planoPermitiu, true);
  assert.equal(resultado.permitido, false);
  assert.equal(resultado.motivo, "PERMISSAO_USUARIO_NEGADA");
});

test("CASO 4: administrador da empresa não ultrapassa o plano", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "importador",
    modulo: "importacao_dados",
    acao: "acessar",
    permissoes: presetDoPerfil("administrador"),
    ...plano(empresaA, false),
  });
  assert.equal(resultado.usuarioPermitiu, true);
  assert.equal(resultado.permitido, false);
  assert.equal(resultado.motivo, "RECURSO_NAO_CONTRATADO");
});

test("CASO 5: mesmo usuário, empresas diferentes", () => {
  const naA = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "importador",
    ...plano(empresaA, true),
  });
  const naB = decidirRecursoDoPlano({
    empresaId: empresaB,
    recurso: "importador",
    ...plano(empresaB, false),
  });
  assert.equal(naA.permitido, true);
  assert.equal(naB.permitido, false);
  assert.equal(naB.motivo, "RECURSO_NAO_CONTRATADO");
});

test("CASO 6: plano sem configuração explícita não bloqueia", () => {
  const vazio = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "importador",
    ...plano(empresaA, "ausente"),
  });
  const outrosRecursos = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "importador",
    assinatura: { empresa_id: empresaA, status: "ativa" },
    recursosDoPlano: [{ chave: "pdv", habilitado: true, ativo: true }],
  });
  assert.equal(vazio.permitido, true);
  assert.equal(vazio.planoPermitiu, true);
  assert.equal(outrosRecursos.permitido, true);
});

test("CASO 7: estoque da importação permanece interno ao entrypoint", () => {
  const executar = fonte("lib/importacao/executar.ts");
  assert.match(executar, /rpc_movimentar_estoque_produto/);
  assert.match(executar, /importar_estoque/);
  assert.doesNotMatch(executar, /exigirRecursoEmpresa/);
  assert.doesNotMatch(executar, /decidirRecursoDoPlano/);
  assert.doesNotMatch(executar, /empresaPossuiRecurso\(/);
});

test("CASO 8: rota direta mostra tela amigável de plano", () => {
  const page = fonte("app/configuracoes/importar-dados/page.tsx");
  const tela = fonte("components/plataforma/recurso-nao-contratado.tsx");
  assert.match(page, /planoPermiteRecursoEmpresa/);
  assert.match(page, /RecursoNaoContratado/);
  assert.match(page, /Importador de dados/);
  assert.match(page, /Voltar para Configurações/);
  assert.doesNotMatch(page, /plano_id|recurso_id/);
  assert.match(tela, /\/assinatura/);
  assert.match(tela, /Ver assinatura/);
});

test("CASO 9: entrypoint servidor exige plano antes da escrita", () => {
  const actions = fonte("app/configuracoes/importar-dados/actions.ts");
  const confirmar = actions.slice(actions.indexOf("confirmarImportacaoAction"));
  const insertIdx = confirmar.indexOf(".insert(");
  const entitleIdx = confirmar.indexOf("exigirAcessoOperacao");
  assert.ok(entitleIdx >= 0);
  assert.ok(insertIdx > entitleIdx);
  assert.match(actions, /recurso: "importador"/);
  assert.match(actions, /importar_produtos/);
  assert.match(actions, /importar_clientes/);
  assert.match(actions, /RECURSO_NAO_CONTRATADO/);
  assert.match(actions, /getContextoImportador/);
});

test("master e proxy continuam sem entitlement de plano", () => {
  assert.doesNotMatch(fonte("lib/supabase/proxy.ts"), /exigirRecursoEmpresa/);
  assert.doesNotMatch(fonte("app/master/page.tsx"), /exigirRecursoEmpresa/);
});

test("erro de entitlement não inclui payload nem documento", () => {
  const erro = new ErroEntitlement({
    recurso: "importador",
    empresaId: empresaA,
  });
  assert.equal(erro.status, 403);
  assert.equal(erro.codigo, "RECURSO_NAO_CONTRATADO");
  assert.equal(erro.message, mensagemRecursoNaoContratado("Importador de dados"));
  assert.doesNotMatch(erro.message, /[0-9a-f]{8}-[0-9a-f]{4}/i);
  const log = fonte("lib/plataforma/entitlements/erro.ts");
  assert.match(log, /\[entitlement\] acesso-negado/);
  assert.doesNotMatch(log, /cpf|cnpj|token|payload/i);
});
