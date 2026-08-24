import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB, usuarioA } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import { avaliarCamadasAcesso } from "@/lib/plataforma/entitlements/camadas";
import {
  modoEntitlementDoRecurso,
  RECURSOS_COM_ENFORCEMENT,
} from "@/lib/plataforma/entitlements/rollout";
import { presetDoPerfil } from "@/lib/permissoes/presets";
import { alertasCombinacaoPlano } from "@/lib/plataforma/recursos/alertas-plano";
import { CATALOGO_RECURSOS } from "@/lib/plataforma/recursos/catalogo";
import {
  catalogoCobertoPelosGruposComerciais,
  chavesDosGruposComerciais,
  classificarRecursosDoPlano,
  GRUPOS_COMERCIAIS_PLANO,
} from "@/lib/plataforma/recursos/grupos-comerciais";
import { validarPayloadPlano } from "@/lib/plataforma/recursos/validar-plano";
import type { RecursoDoPlano } from "@/lib/plataforma/recursos/resolver";

function recursosExemplo(ligados: string[]): RecursoDoPlano[] {
  return CATALOGO_RECURSOS.map((item) => ({
    chave: item.chave,
    habilitado: ligados.includes(item.chave),
    ativo: true,
  }));
}

function mapa(ligados: string[]) {
  return Object.fromEntries(
    CATALOGO_RECURSOS.map((item) => [item.chave, ligados.includes(item.chave)])
  );
}

const CHAVES_TECNICAS = [...RECURSOS_COM_ENFORCEMENT];
const BASICO = [
  "pdv",
  "vendas",
  "produtos",
  "clientes",
  "estoque",
  "relatorios",
  "nfce",
];
const PRO = CHAVES_TECNICAS.filter((chave) => chave !== "contabilidade");
const PREMIUM = CHAVES_TECNICAS;

test("grupos comerciais cobrem o catálogo sem criar chave nova", () => {
  const cobertura = catalogoCobertoPelosGruposComerciais();
  assert.equal(cobertura.ok, true);
  assert.deepEqual(cobertura.faltandoNoGrupo, []);
  assert.deepEqual(cobertura.extraNoGrupo, []);
  assert.equal(chavesDosGruposComerciais().length, CATALOGO_RECURSOS.length);
  assert.equal(new Set(chavesDosGruposComerciais()).size, CATALOGO_RECURSOS.length);
  assert.equal(GRUPOS_COMERCIAIS_PLANO[0].rotulo, "Operação comercial");
  assert.deepEqual([...GRUPOS_COMERCIAIS_PLANO[0].chaves], [
    "pdv",
    "caixa",
    "vendas",
    "produtos",
    "clientes",
  ]);
  assert.equal(GRUPOS_COMERCIAIS_PLANO[1].rotulo, "Catálogo online");
  assert.deepEqual([...GRUPOS_COMERCIAIS_PLANO[1].chaves], ["catalogo"]);
  assert.equal(RECURSOS_COM_ENFORCEMENT.size, 17);
  assert.equal(modoEntitlementDoRecurso("suporte_prioritario"), "off");
  assert.equal(modoEntitlementDoRecurso("pdv"), "enforce");
  assert.equal(modoEntitlementDoRecurso("catalogo"), "enforce");
});

test("Master organiza grupos na UI e não hardcodeia Básico/Pro/Premium", () => {
  const ui = fonte("components/master/planos-master-painel.tsx");
  assert.match(ui, /GRUPOS_COMERCIAIS_PLANO/);
  assert.match(ui, /<details/);
  assert.match(ui, /Recursos incluídos/);
  assert.match(ui, /Recursos não incluídos/);
  assert.match(ui, /empresas usando este plano|empresa usando este plano/);
  assert.match(ui, /alertasCombinacaoPlano/);
  assert.match(ui, /Isto não impede salvar/);
  assert.doesNotMatch(ui, /nome === ["']Básico["']/);
  assert.doesNotMatch(ui, /nome === ["']Pro["']/);
  assert.doesNotMatch(ui, /nome === ["']Premium["']/);
  assert.doesNotMatch(fonte("lib/master/planos.ts"), /if \(plano\.nome ===/);
  assert.doesNotMatch(fonte("lib/plataforma/recursos/validar-plano.ts"), /Básico|Premium/);
  assert.doesNotMatch(fonte("app/pdv/actions.ts"), /GRUPOS_COMERCIAIS_PLANO/);
  assert.doesNotMatch(fonte("app/vendas/page.tsx"), /GRUPOS_COMERCIAIS_PLANO/);
  assert.doesNotMatch(
    fonte("lib/plataforma/entitlements/rollout.ts"),
    /GRUPOS_COMERCIAIS/
  );
});

test("alertas de combinação não impedem salvar", () => {
  const cceSemNfe = alertasCombinacaoPlano({ cce: true, nfe: false });
  assert.equal(cceSemNfe.some((item) => item.codigo === "cce_sem_nfe"), true);
  const inutilizacao = alertasCombinacaoPlano({
    inutilizacao_fiscal: true,
    nfe: false,
  });
  assert.equal(
    inutilizacao.some((item) => item.codigo === "inutilizacao_sem_nfe"),
    true
  );
  assert.deepEqual(alertasCombinacaoPlano({ nfe: true, cce: true }), []);

  const salvo = validarPayloadPlano({
    nome: "Fiscal estranho",
    valorMensal: 10,
    ordem: 9,
    ativo: true,
    nivelSuporte: "normal",
    limites: { usuarios: null, filiais: null },
    recursos: { nfe: false, cce: true, inutilizacao_fiscal: true, pdv: true },
  });
  assert.equal(salvo.ok, true);
  if (salvo.ok) {
    assert.equal(salvo.payload.recursos.cce, true);
    assert.equal(salvo.payload.recursos.nfe, false);
  }
});

test("visão do plano separa incluídos e não incluídos", () => {
  const visao = classificarRecursosDoPlano(mapa(BASICO));
  assert.ok(visao.incluidos.some((item) => item.chave === "pdv"));
  assert.ok(visao.naoIncluidos.some((item) => item.chave === "nfe"));
  assert.equal(
    visao.incluidos.length + visao.naoIncluidos.length,
    CATALOGO_RECURSOS.length
  );
});

test("empresa A Básico: recurso false bloqueia mesmo o administrador", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "nfe",
    modulo: "fiscal",
    acao: "emitir_nfe",
    permissoes: presetDoPerfil("administrador"),
    assinatura: { empresa_id: empresaA, plano_id: "plano-basico", status: "ativa" },
    recursosDoPlano: recursosExemplo(BASICO),
  });
  assert.equal(resultado.usuarioPermitiu, true);
  assert.equal(resultado.permitido, false);
  assert.equal(resultado.motivo, "RECURSO_NAO_CONTRATADO");
});

test("empresa B Pro: recurso true permite conforme a permissão", () => {
  const estoque = avaliarCamadasAcesso({
    empresaId: empresaB,
    usuarioId: usuarioA,
    recurso: "estoque",
    modulo: "estoque",
    acao: "movimentar",
    permissoes: presetDoPerfil("operador"),
    assinatura: { empresa_id: empresaB, plano_id: "plano-pro", status: "ativa" },
    recursosDoPlano: recursosExemplo(PRO),
  });
  const nfe = avaliarCamadasAcesso({
    empresaId: empresaB,
    usuarioId: usuarioA,
    recurso: "nfe",
    modulo: "fiscal",
    acao: "emitir_nfe",
    permissoes: presetDoPerfil("gerente"),
    assinatura: { empresa_id: empresaB, plano_id: "plano-pro", status: "ativa" },
    recursosDoPlano: recursosExemplo(PRO),
  });
  const contabilidade = avaliarCamadasAcesso({
    empresaId: empresaB,
    usuarioId: usuarioA,
    recurso: "contabilidade",
    modulo: "contabilidade",
    acao: "acessar",
    permissoes: presetDoPerfil("administrador"),
    assinatura: { empresa_id: empresaB, plano_id: "plano-pro", status: "ativa" },
    recursosDoPlano: recursosExemplo(PRO),
  });
  assert.equal(estoque.permitido, true);
  assert.equal(nfe.permitido, true);
  assert.equal(contabilidade.usuarioPermitiu, true);
  assert.equal(contabilidade.permitido, false);
  assert.equal(contabilidade.motivo, "RECURSO_NAO_CONTRATADO");
});

test("empresa C Premium: recurso true + permissão true → permitido", () => {
  const nfe = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "nfe",
    modulo: "fiscal",
    acao: "emitir_nfe",
    permissoes: presetDoPerfil("gerente"),
    assinatura: { empresa_id: empresaA, plano_id: "plano-premium", status: "ativa" },
    recursosDoPlano: recursosExemplo(PREMIUM),
  });
  const pdv = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "pdv",
    modulo: "pdv",
    acao: "finalizar_venda",
    permissoes: presetDoPerfil("caixa"),
    assinatura: { empresa_id: empresaA, plano_id: "plano-premium", status: "ativa" },
    recursosDoPlano: recursosExemplo(PREMIUM),
  });
  assert.equal(nfe.permitido, true);
  assert.equal(pdv.permitido, true);
});

test("mesmo usuário em empresas com planos diferentes", () => {
  const naA = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "importador",
    modulo: "importacao_dados",
    acao: "importar_produtos",
    permissoes: presetDoPerfil("administrador"),
    assinatura: { empresa_id: empresaA, plano_id: "plano-basico", status: "ativa" },
    recursosDoPlano: recursosExemplo(BASICO),
  });
  const naB = avaliarCamadasAcesso({
    empresaId: empresaB,
    usuarioId: usuarioA,
    recurso: "importador",
    modulo: "importacao_dados",
    acao: "importar_produtos",
    permissoes: presetDoPerfil("administrador"),
    assinatura: { empresa_id: empresaB, plano_id: "plano-pro", status: "ativa" },
    recursosDoPlano: recursosExemplo(PRO),
  });
  assert.equal(naA.permitido, false);
  assert.equal(naA.motivo, "RECURSO_NAO_CONTRATADO");
  assert.equal(naB.permitido, true);
});

test("ausência de configuração mantém compatibilidade atual", () => {
  const vazio = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "nfe",
    modulo: "fiscal",
    acao: "emitir_nfe",
    permissoes: presetDoPerfil("gerente"),
    assinatura: { empresa_id: empresaA, status: "ativa" },
    recursosDoPlano: [],
  });
  assert.equal(vazio.permitido, true);
});

test("Premium com permissão insuficiente continua negado pela permissão", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "nfe",
    modulo: "fiscal",
    acao: "emitir_nfe",
    permissoes: presetDoPerfil("caixa"),
    assinatura: { empresa_id: empresaA, plano_id: "plano-premium", status: "ativa" },
    recursosDoPlano: recursosExemplo(PREMIUM),
  });
  assert.equal(resultado.planoPermitiu, true);
  assert.equal(resultado.permitido, false);
  assert.equal(resultado.motivo, "PERMISSAO_USUARIO_NEGADA");
});
