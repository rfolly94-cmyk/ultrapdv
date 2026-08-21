import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import {
  CATALOGO_RECURSOS,
} from "@/lib/plataforma/recursos/catalogo";
import {
  empresaPossuiRecurso,
  obterLimite,
} from "@/lib/plataforma/recursos/resolver";
import { validarPayloadPlano } from "@/lib/plataforma/recursos/validar-plano";

const MIGRATION =
  "supabase/migrations/20260821160000_planos_saas_recursos_limites.sql";

function recursosTodos(habilitado: boolean) {
  return CATALOGO_RECURSOS.map((item) => ({
    chave: item.chave,
    habilitado,
    ativo: true,
  }));
}

test("catálogo de recursos não duplica chaves e migration casa com o código", () => {
  const chaves = CATALOGO_RECURSOS.map((item) => item.chave);
  assert.equal(new Set(chaves).size, chaves.length);
  const sql = fonte(MIGRATION);
  for (const chave of chaves) {
    assert.match(sql, new RegExp(`'${chave}'`));
  }
  assert.match(sql, /CONSTRAINT recursos_plataforma_chave_unica UNIQUE \(chave\)/);
  assert.match(sql, /CONSTRAINT planos_recursos_unico UNIQUE \(plano_id, recurso_id\)/);
  assert.match(sql, /CONSTRAINT planos_limites_unico UNIQUE \(plano_id, chave\)/);
});

test("administrador da plataforma é exigido para listar e salvar planos", () => {
  assert.match(fonte("lib/master/planos.ts"), /exigirMaster/);
  assert.match(fonte("lib/master/acoes.ts"), /exigirMaster/);
  assert.match(fonte("lib/master/acoes.ts"), /rpc_master_salvar_plano/);
  assert.match(fonte(MIGRATION), /administradores_plataforma/);
  assert.match(fonte(MIGRATION), /auth\.uid\(\)/);
  assert.doesNotMatch(fonte("lib/master/acoes.ts"), /usuarios\.perfil = ['\"]master['\"]/);
});

test("usuário comum não consegue editar plano pelo RPC", () => {
  const sql = fonte(MIGRATION);
  assert.match(sql, /nao_autorizado/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.rpc_master_salvar_plano\(jsonb\) TO authenticated/);
  assert.doesNotMatch(sql, /WITH CHECK \(true\)/);
  assert.match(
    sql,
    /REVOKE ALL ON TABLE public\.recursos_plataforma FROM PUBLIC, anon/
  );
  assert.match(
    sql,
    /GRANT SELECT ON TABLE public\.recursos_plataforma TO authenticated/
  );
});

test("administrador consegue criar e editar plano válido", () => {
  const criado = validarPayloadPlano({
    nome: "Crescimento",
    valorMensal: 219,
    valorAnual: "",
    ordem: 4,
    ativo: true,
    destaque: false,
    oferecerTeste: true,
    diasTeste: 7,
    nivelSuporte: "prioritario",
    limites: { usuarios: 5, filiais: 3 },
    recursos: { pdv: true, nfe: false },
  });
  assert.equal(criado.ok, true);
  if (!criado.ok) {
    return;
  }
  assert.equal(criado.payload.diasTeste, 7);
  assert.equal(criado.payload.limites.usuarios, 5);
  assert.equal(criado.payload.recursos.pdv, true);
  assert.equal(criado.payload.recursos.suporte_prioritario, true);

  const editado = validarPayloadPlano({
    id: "11111111-1111-4111-8111-111111111111",
    nome: "Pro",
    valorMensal: "197,00",
    ordem: 2,
    ativo: true,
    oferecerTeste: false,
    diasTeste: 14,
    nivelSuporte: "normal",
    limites: { usuarios: "ilimitado", filiais: 1 },
    recursos: { pdv: true, nfe: true },
  });
  assert.equal(editado.ok, true);
  if (!editado.ok) {
    return;
  }
  assert.equal(editado.payload.id, "11111111-1111-4111-8111-111111111111");
  assert.equal(editado.payload.valorMensal, 197);
  assert.equal(editado.payload.diasTeste, 0);
  assert.equal(editado.payload.limites.usuarios, null);
  assert.equal(editado.payload.limites.filiais, 1);
});

test("validações rejeitam nome vazio, valor negativo e limite inválido", () => {
  assert.equal(validarPayloadPlano({ nome: " ", valorMensal: 10, ordem: 1 }).ok, false);
  assert.equal(
    validarPayloadPlano({ nome: "Pro", valorMensal: -1, ordem: 1 }).ok,
    false
  );
  assert.equal(
    validarPayloadPlano({
      nome: "Pro",
      valorMensal: 10,
      ordem: 1,
      limites: { usuarios: 0, filiais: 1 },
    }).ok,
    false
  );
});

test("limite numérico e ilimitado são resolvidos corretamente", () => {
  const assinatura = { empresa_id: empresaA, plano_id: "plano-pro" };
  assert.equal(
    obterLimite({
      empresaId: empresaA,
      chave: "usuarios",
      assinatura,
      limitesDoPlano: [{ chave: "usuarios", valor: 5 }],
    }),
    5
  );
  assert.equal(
    obterLimite({
      empresaId: empresaA,
      chave: "filiais",
      assinatura,
      limitesDoPlano: [{ chave: "filiais", valor: null }],
    }),
    null
  );
});

test("helper resolve recurso habilitado e desabilitado", () => {
  const assinatura = { empresa_id: empresaA, plano_id: "plano-basico" };
  assert.equal(
    empresaPossuiRecurso({
      empresaId: empresaA,
      chave: "nfe",
      assinatura,
      recursosDoPlano: recursosTodos(true),
    }),
    true
  );
  assert.equal(
    empresaPossuiRecurso({
      empresaId: empresaA,
      chave: "nfe",
      assinatura,
      recursosDoPlano: recursosTodos(true).map((item) =>
        item.chave === "nfe" ? { ...item, habilitado: false } : item
      ),
    }),
    false
  );
});

test("empresa A não usa a assinatura da empresa B", () => {
  assert.equal(
    empresaPossuiRecurso({
      empresaId: empresaA,
      chave: "nfe",
      assinatura: { empresa_id: empresaB, plano_id: "plano-b" },
      recursosDoPlano: [{ chave: "nfe", habilitado: true, ativo: true }],
    }),
    false
  );
  assert.equal(
    obterLimite({
      empresaId: empresaA,
      chave: "usuarios",
      assinatura: { empresa_id: empresaB },
      limitesDoPlano: [{ chave: "usuarios", valor: 2 }],
    }),
    null
  );
});

test("empresa sem configuração nova não perde recursos nesta etapa", () => {
  assert.equal(
    empresaPossuiRecurso({
      empresaId: empresaA,
      chave: "pdv",
      assinatura: { empresa_id: empresaA, plano_id: "plano-x" },
      recursosDoPlano: [],
    }),
    true
  );
});

test("UI não pede UUID manual e não bloqueia o ERP", () => {
  const ui = fonte("components/master/planos-master-painel.tsx");
  const page = fonte("app/master/planos/page.tsx");
  assert.match(ui, /Editar plano/);
  assert.match(ui, /Novo plano/);
  assert.doesNotMatch(ui, /preencha para editar/);
  assert.doesNotMatch(page, /preencha para editar/);
  assert.doesNotMatch(fonte("app/pdv/editar-actions.ts"), /empresaPossuiRecurso/);
  assert.doesNotMatch(
    fonte("lib/plataforma/recursos/carregar.ts"),
    /redirect\(/
  );
  assert.doesNotMatch(
    fonte("lib/supabase/proxy.ts"),
    /empresaPossuiRecursoAtual/
  );
});

test("alteração de preço do catálogo não reescreve venda nem estoque", () => {
  const acoes = fonte("lib/master/acoes.ts");
  assert.match(acoes, /rpc_master_salvar_plano/);
  assert.doesNotMatch(acoes, /from\("vendas"\)/);
  assert.doesNotMatch(acoes, /from\("estoque_movimentos"\)/);
  assert.match(acoes, /valor_mensal_contratado/);
  assert.match(fonte(MIGRATION), /valor_mensal_contratado/);
  assert.match(
    fonte(MIGRATION),
    /Não acompanha alteração de catálogo/
  );
});

test("plano desativado permanece nas assinaturas e some das novas contratações na UI", () => {
  const sql = fonte(MIGRATION);
  assert.doesNotMatch(sql, /DELETE FROM public\.planos/);
  assert.match(fonte("components/master/planos-master-painel.tsx"), /Inativo/);
  assert.match(fonte("lib/master/empresas.ts"), /assinaturas_empresas/);
  assert.match(fonte("lib/master/planos.ts"), /carregarPainelPlanosMaster/);
});

test("backfill preserva Básico, Pro e Premium e habilita recursos existentes", () => {
  const sql = fonte(MIGRATION);
  assert.doesNotMatch(sql, /DELETE FROM public\.planos/);
  assert.match(sql, /INSERT INTO public\.planos_recursos/);
  assert.match(sql, /CROSS JOIN public\.recursos_plataforma/);
  assert.match(sql, /ON CONFLICT \(plano_id, recurso_id\) DO NOTHING/);
});

test("auditoria do plano fica na RPC da plataforma", () => {
  const sql = fonte(MIGRATION);
  assert.match(sql, /INSERT INTO public\.plataforma_auditoria/);
  assert.match(sql, /plano_criado/);
  assert.match(sql, /plano_atualizado/);
  assert.match(sql, /plano_desativado/);
});
