import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB, usuarioA } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import {
  avaliarCamadasAcesso,
  decidirRecursoDoPlano,
} from "@/lib/plataforma/entitlements/camadas";
import {
  modoEntitlementDoRecurso,
  RECURSOS_COM_ENFORCEMENT,
} from "@/lib/plataforma/entitlements/rollout";
import { presetDoPerfil } from "@/lib/permissoes/presets";
import { pixConfigPublicoPdv, classificarIntegracaoPix } from "@/lib/pagamentos/pix/modo-ativo";

function plano(empresaId: string, pixIntegrado: boolean | "ausente") {
  return {
    assinatura: {
      empresa_id: empresaId,
      plano_id: "plano-teste",
      status: "ativa",
    },
    recursosDoPlano:
      pixIntegrado === "ausente"
        ? []
        : [{ chave: "pix_integrado", habilitado: pixIntegrado, ativo: true }],
  };
}

test("rollout inclui somente os dezesseis recursos ativos", () => {
  assert.deepEqual(
    [...RECURSOS_COM_ENFORCEMENT],
    [
      "importador",
      "impressao_automatica",
      "relatorios",
      "contabilidade",
      "pix_integrado",
      "carteira",
      "produtos",
      "clientes",
      "estoque",
      "nfce",
      "nfe",
      "cce",
      "inutilizacao_fiscal",
      "vendas",
      "pdv",
      "catalogo",
      "caixa",
    ]
  );
  assert.equal(modoEntitlementDoRecurso("pix_integrado"), "enforce");
  assert.equal(modoEntitlementDoRecurso("carteira"), "enforce");
  assert.equal(modoEntitlementDoRecurso("produtos"), "enforce");
  assert.equal(modoEntitlementDoRecurso("nfe"), "enforce");
  assert.equal(modoEntitlementDoRecurso("nfce"), "enforce");
  assert.equal(modoEntitlementDoRecurso("pdv"), "enforce");
});

test("CASO 1: plano true + permissão true → permitido", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "pix_integrado",
    modulo: "financeiro",
    acao: "configurar_pix",
    permissoes: presetDoPerfil("administrador"),
    ...plano(empresaA, true),
  });
  assert.equal(resultado.permitido, true);
  assert.equal(resultado.motivo, null);
  assert.equal(resultado.modoEntitlement, "enforce");
});

test("CASO 2: plano false + permissão true → RECURSO_NAO_CONTRATADO", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "pix_integrado",
    modulo: "financeiro",
    acao: "configurar_pix",
    permissoes: presetDoPerfil("administrador"),
    ...plano(empresaA, false),
  });
  assert.equal(resultado.usuarioPermitiu, true);
  assert.equal(resultado.permitido, false);
  assert.equal(resultado.motivo, "RECURSO_NAO_CONTRATADO");
});

test("CASO 3: plano true + permissão false → PERMISSAO_USUARIO_NEGADA", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "pix_integrado",
    modulo: "financeiro",
    acao: "configurar_pix",
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
    recurso: "pix_integrado",
    modulo: "financeiro",
    acao: "configurar_pix",
    permissoes: presetDoPerfil("administrador"),
    ...plano(empresaA, false),
  });
  assert.equal(resultado.usuarioPermitiu, true);
  assert.equal(resultado.permitido, false);
  assert.equal(resultado.motivo, "RECURSO_NAO_CONTRATADO");
});

test("CASO 5: empresa A true / empresa B false", () => {
  const naA = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "pix_integrado",
    ...plano(empresaA, true),
  });
  const naB = decidirRecursoDoPlano({
    empresaId: empresaB,
    recurso: "pix_integrado",
    ...plano(empresaB, false),
  });
  assert.equal(naA.permitido, true);
  assert.equal(naB.permitido, false);
  assert.equal(naB.motivo, "RECURSO_NAO_CONTRATADO");
});

test("CASO 6: PIX local continua independente de pix_integrado=false", () => {
  const planoNegado = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "pix_integrado",
    ...plano(empresaA, false),
  });
  assert.equal(planoNegado.permitido, false);

  const localCfg = pixConfigPublicoPdv(
    classificarIntegracaoPix({
      id: "int-local",
      ativo: true,
      modo: "local_manual",
      provedor: null,
    })
  );
  assert.equal(localCfg?.modo, "local_manual");

  const local = [
    fonte("app/api/pagamentos/pix/local/gerar/route.ts"),
    fonte("app/api/pagamentos/pix/local/confirmar/route.ts"),
    fonte("app/api/pagamentos/pix/local/descartar/route.ts"),
    fonte("lib/pagamentos/pix/local-pdv.ts"),
  ].join("\n");
  assert.doesNotMatch(local, /exigirPixIntegradoEmpresa/);
  const actions = fonte("app/configuracoes/financeiro/pix/actions.ts");
  const salvarLocal = actions.slice(
    actions.indexOf("export async function salvarConfiguracaoPixLocal"),
    actions.indexOf("export async function gerarQrPixLocalTeste")
  );
  assert.doesNotMatch(salvarLocal, /exigirPixIntegradoEmpresa/);
  assert.match(actions, /export async function salvarConfiguracaoPixLocal/);
  const geranetSave = fonte("app/configuracoes/financeiro/pix/actions.ts");
  const salvarIntegrado = geranetSave.slice(
    geranetSave.indexOf("export async function salvarConfiguracaoPix(")
  );
  assert.match(salvarIntegrado, /exigirPixIntegradoEmpresa/);
  assert.ok(
    salvarIntegrado.indexOf("exigirPixIntegradoEmpresa") <
      salvarIntegrado.indexOf("salvar_segredo_bancario_provedor")
  );
});

test("CASO 7: chamada direta às APIs integradas é negada pelo plano", () => {
  for (const arquivo of [
    "app/api/pagamentos/pix/geranet/emitir/route.ts",
    "app/api/pagamentos/pix/geranet/consultar/route.ts",
    "app/api/pagamentos/pix/geranet/cancelar/route.ts",
    "app/api/pagamentos/pix/geranet/testar/route.ts",
    "app/api/pagamentos/pix/geranet/pdv/emitir/route.ts",
  ]) {
    const texto = fonte(arquivo);
    const corpo = texto.slice(texto.indexOf("export async function POST"));
    assert.match(corpo, /exigirPixIntegradoEmpresa/, arquivo);
  }

  const pdvEmitir = fonte("app/api/pagamentos/pix/geranet/pdv/emitir/route.ts");
  const corpoPdv = pdvEmitir.slice(pdvEmitir.indexOf("export async function POST"));
  assert.ok(
    corpoPdv.indexOf("exigirPixIntegradoEmpresa") <
      corpoPdv.indexOf("emitirCobrancaPixPdv")
  );
  assert.doesNotMatch(fonte("lib/pagamentos/pix/geranet.ts"), /exigirPixIntegradoEmpresa/);
  assert.doesNotMatch(fonte("lib/pagamentos/pix/geranet-pdv.ts"), /exigirPixIntegradoEmpresa/);
  assert.doesNotMatch(fonte("lib/pagamentos/pix/contexto.ts"), /exigirPixIntegradoEmpresa/);
});

test("CASO 8: PDV não quebra e não oferece PIX integrado sem o plano", () => {
  const shell = fonte("components/pdv/pdv-shell.tsx");
  assert.match(shell, /pixIntegradoLiberado/);
  assert.match(shell, /pixConfig\?\.modo === "geranet" && pixIntegradoLiberado/);
  assert.match(shell, /pixConfig\?\.modo === "local_manual"/);
  assert.doesNotMatch(shell, /throw new ErroEntitlement/);
  assert.match(fonte("app/pdv/page.tsx"), /planoPermiteRecursoEmpresa/);
  assert.match(fonte("app/pdv/page.tsx"), /pix_integrado/);
  assert.doesNotMatch(fonte("app/pdv/actions.ts"), /exigirPixIntegradoEmpresa/);
  assert.doesNotMatch(
    fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts"),
    /exigirPixIntegradoEmpresa|pix_integrado/
  );
  assert.doesNotMatch(
    fonte("app/api/fiscal/geranet/nfce-emitir-venda/route.ts"),
    /exigirPixIntegradoEmpresa/
  );
});

test("CASO 9: plano sem configuração explícita não bloqueia", () => {
  const vazio = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "pix_integrado",
    ...plano(empresaA, "ausente"),
  });
  const outros = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "pix_integrado",
    assinatura: { empresa_id: empresaA, status: "ativa" },
    recursosDoPlano: [{ chave: "pdv", habilitado: true, ativo: true }],
  });
  assert.equal(vazio.permitido, true);
  assert.equal(outros.permitido, true);
});
