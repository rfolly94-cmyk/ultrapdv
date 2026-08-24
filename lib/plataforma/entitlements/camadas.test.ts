import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB, usuarioA, usuarioB } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import { CATALOGO_RECURSOS } from "@/lib/plataforma/recursos/catalogo";
import { presetDoPerfil } from "@/lib/permissoes/presets";
import {
  avaliarCamadasAcesso,
  MODO_ENTITLEMENT,
  RECURSO_PARA_MODULO,
} from "@/lib/plataforma/entitlements/camadas";
import { modoEntitlementDoRecurso } from "@/lib/plataforma/entitlements/rollout";

test("modo de entitlement permanece desligado no padrão e o PDV não chama avaliarCamadasAcesso direto", () => {
  assert.equal(MODO_ENTITLEMENT, "off");
  assert.equal(modoEntitlementDoRecurso("importador"), "enforce");
  assert.equal(modoEntitlementDoRecurso("impressao_automatica"), "enforce");
  assert.equal(modoEntitlementDoRecurso("relatorios"), "enforce");
  assert.equal(modoEntitlementDoRecurso("contabilidade"), "enforce");
  assert.equal(modoEntitlementDoRecurso("pix_integrado"), "enforce");
  assert.equal(modoEntitlementDoRecurso("carteira"), "enforce");
  assert.equal(modoEntitlementDoRecurso("produtos"), "enforce");
  assert.equal(modoEntitlementDoRecurso("clientes"), "enforce");
  assert.equal(modoEntitlementDoRecurso("estoque"), "enforce");
  assert.equal(modoEntitlementDoRecurso("nfe"), "enforce");
  assert.equal(modoEntitlementDoRecurso("nfce"), "enforce");
  assert.equal(modoEntitlementDoRecurso("cce"), "enforce");
  assert.equal(modoEntitlementDoRecurso("inutilizacao_fiscal"), "enforce");
  assert.equal(modoEntitlementDoRecurso("vendas"), "enforce");
  assert.equal(modoEntitlementDoRecurso("pdv"), "enforce");
  assert.equal(modoEntitlementDoRecurso("catalogo"), "enforce");
  assert.equal(modoEntitlementDoRecurso("caixa"), "enforce");
  assert.doesNotMatch(fonte("app/pdv/actions.ts"), /avaliarCamadasAcesso/);
  assert.doesNotMatch(fonte("app/pdv/editar-actions.ts"), /avaliarCamadasAcesso/);
  assert.doesNotMatch(
    fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts"),
    /avaliarCamadasAcesso/
  );
  assert.doesNotMatch(fonte("lib/supabase/proxy.ts"), /avaliarCamadasAcesso/);
});

test("plano é o teto: nfe false no plano nega mesmo com usuário autorizado, só em enforce", () => {
  const admin = presetDoPerfil("administrador");
  const base = {
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "nfe",
    modulo: "fiscal" as const,
    acao: "emitir_nfe",
    assinatura: { empresa_id: empresaA, plano_id: "pro", status: "ativa" },
    recursosDoPlano: [{ chave: "nfe", habilitado: false, ativo: true }],
    permissoes: admin,
  };

  const desligado = avaliarCamadasAcesso({ ...base, modoEntitlement: "off" });
  assert.equal(desligado.permitido, true);
  assert.equal(desligado.planoPermitiu, false);
  assert.equal(desligado.usuarioPermitiu, true);

  const enforce = avaliarCamadasAcesso({ ...base, modoEntitlement: "enforce" });
  assert.equal(enforce.permitido, false);
  assert.equal(enforce.motivo, "RECURSO_NAO_CONTRATADO");
});

test("plano permite e usuário nega → negado pela permissão", () => {
  const caixa = presetDoPerfil("caixa");
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "nfe",
    modulo: "fiscal",
    acao: "emitir_nfe",
    assinatura: { empresa_id: empresaA, status: "ativa" },
    recursosDoPlano: [{ chave: "nfe", habilitado: true, ativo: true }],
    permissoes: caixa,
    modoEntitlement: "enforce",
  });
  assert.equal(resultado.planoPermitiu, true);
  assert.equal(resultado.usuarioPermitiu, false);
  assert.equal(resultado.permitido, false);
  assert.equal(resultado.motivo, "PERMISSAO_USUARIO_NEGADA");
});

test("empresa A não usa assinatura da empresa B", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "pdv",
    modulo: "pdv",
    acao: "acessar",
    assinatura: { empresa_id: empresaB, status: "ativa" },
    recursosDoPlano: [{ chave: "pdv", habilitado: true, ativo: true }],
    permissoes: presetDoPerfil("caixa"),
    modoEntitlement: "enforce",
  });
  assert.equal(resultado.planoPermitiu, false);
  assert.equal(resultado.permitido, false);
  assert.equal(resultado.motivo, "RECURSO_NAO_CONTRATADO");
});

test("mapeamento plano → permissão cobre o catálogo conhecido", () => {
  for (const recurso of CATALOGO_RECURSOS) {
    assert.equal(
      recurso.chave in RECURSO_PARA_MODULO,
      true,
      recurso.chave
    );
  }
  assert.equal(RECURSO_PARA_MODULO.carteira, "clientes");
  assert.equal(RECURSO_PARA_MODULO.nfce, "fiscal");
  assert.equal(RECURSO_PARA_MODULO.relatorios, "relatorios");
});

test("usuário da empresa B não herda permissões avaliadas da empresa A", () => {
  const vendedorA = presetDoPerfil("administrador");
  const caixaB = presetDoPerfil("caixa");
  const naA = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "produtos",
    modulo: "produtos",
    acao: "editar",
    assinatura: { empresa_id: empresaA, status: "ativa" },
    recursosDoPlano: [{ chave: "produtos", habilitado: true, ativo: true }],
    permissoes: vendedorA,
    modoEntitlement: "enforce",
  });
  const naB = avaliarCamadasAcesso({
    empresaId: empresaB,
    usuarioId: usuarioB,
    recurso: "produtos",
    modulo: "produtos",
    acao: "editar",
    assinatura: { empresa_id: empresaB, status: "ativa" },
    recursosDoPlano: [{ chave: "produtos", habilitado: true, ativo: true }],
    permissoes: caixaB,
    modoEntitlement: "enforce",
  });
  assert.equal(naA.permitido, true);
  assert.equal(naB.permitido, false);
  assert.equal(naB.motivo, "PERMISSAO_USUARIO_NEGADA");
});
