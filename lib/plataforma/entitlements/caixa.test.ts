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
import { decidirAcessoRota } from "@/lib/permissoes/rotas";

function plano(empresaId: string, caixa: boolean | "ausente") {
  return {
    assinatura: {
      empresa_id: empresaId,
      plano_id: "plano-teste",
      status: "ativa",
    },
    recursosDoPlano:
      caixa === "ausente"
        ? []
        : [{ chave: "caixa", habilitado: caixa, ativo: true }],
  };
}

test("rollout inclui caixa como 17º recurso", () => {
  assert.equal(RECURSOS_COM_ENFORCEMENT.has("caixa"), true);
  assert.equal(RECURSOS_COM_ENFORCEMENT.size, 17);
  assert.equal(modoEntitlementDoRecurso("caixa"), "enforce");
});

test("CASO 1: plano true + permissão true → permitido", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "caixa",
    modulo: "caixa",
    acao: "abrir",
    permissoes: presetDoPerfil("caixa"),
    ...plano(empresaA, true),
  });
  assert.equal(resultado.permitido, true);
  assert.equal(resultado.motivo, null);
});

test("CASO 2: plano false → RECURSO_NAO_CONTRATADO", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "caixa",
    modulo: "caixa",
    acao: "abrir",
    permissoes: presetDoPerfil("caixa"),
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
    recurso: "caixa",
    modulo: "caixa",
    acao: "abrir",
    permissoes: presetDoPerfil("vendedor"),
    ...plano(empresaA, true),
  });
  assert.equal(resultado.planoPermitiu, true);
  assert.equal(resultado.permitido, false);
  assert.equal(resultado.motivo, "PERMISSAO_USUARIO_NEGADA");
});

test("empresa A não usa assinatura da empresa B", () => {
  const resultado = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "caixa",
    assinatura: { empresa_id: empresaB, status: "ativa" },
    recursosDoPlano: [{ chave: "caixa", habilitado: true, ativo: true }],
  });
  assert.equal(resultado.permitido, false);
  assert.equal(resultado.motivo, "RECURSO_NAO_CONTRATADO");
});

test("rota /caixa exige permissão e a página checa o plano", () => {
  const caixa = decidirAcessoRota({
    pathname: "/caixa",
    permissoes: presetDoPerfil("caixa"),
  });
  const vendedor = decidirAcessoRota({
    pathname: "/caixa",
    permissoes: presetDoPerfil("vendedor"),
  });
  assert.equal(caixa.ok, true);
  assert.equal(vendedor.ok, false);
  assert.match(fonte("app/caixa/page.tsx"), /planoPermiteRecursoEmpresa/);
  assert.match(fonte("app/caixa/page.tsx"), /"caixa"/);
  assert.match(fonte("app/caixa/actions.ts"), /exigirOperacaoCaixa/);
});
