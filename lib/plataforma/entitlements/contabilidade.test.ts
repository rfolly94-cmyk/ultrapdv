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

function plano(empresaId: string, contabilidade: boolean | "ausente") {
  return {
    assinatura: {
      empresa_id: empresaId,
      plano_id: "plano-teste",
      status: "ativa",
    },
    recursosDoPlano:
      contabilidade === "ausente"
        ? []
        : [{ chave: "contabilidade", habilitado: contabilidade, ativo: true }],
  };
}

test("rollout inclui somente os dezesseis recursos ativos", () => {
  assert.deepEqual(
    [...RECURSOS_COM_ENFORCEMENT],
    ["importador", "impressao_automatica", "relatorios", "contabilidade", "pix_integrado", "carteira", "produtos", "clientes", "estoque", "nfce", "nfe", "cce", "inutilizacao_fiscal", "vendas", "pdv", "catalogo"]
  );
  assert.equal(modoEntitlementDoRecurso("contabilidade"), "enforce");
  assert.equal(modoEntitlementDoRecurso("pix_integrado"), "enforce");
  assert.equal(modoEntitlementDoRecurso("carteira"), "enforce");
  assert.equal(modoEntitlementDoRecurso("produtos"), "enforce");
  assert.equal(modoEntitlementDoRecurso("estoque"), "enforce");
  assert.equal(modoEntitlementDoRecurso("nfe"), "enforce");
  assert.equal(modoEntitlementDoRecurso("nfce"), "enforce");
  assert.equal(modoEntitlementDoRecurso("pdv"), "enforce");
});

test("CASO 1: plano true + permissão true → permitido", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "contabilidade",
    modulo: "contabilidade",
    acao: "acessar",
    permissoes: presetDoPerfil("contador"),
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
    recurso: "contabilidade",
    modulo: "contabilidade",
    acao: "baixar_xml",
    permissoes: presetDoPerfil("gerente"),
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
    recurso: "contabilidade",
    modulo: "contabilidade",
    acao: "acessar",
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
    recurso: "contabilidade",
    modulo: "contabilidade",
    acao: "fechamento",
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
    recurso: "contabilidade",
    ...plano(empresaA, true),
  });
  const naB = decidirRecursoDoPlano({
    empresaId: empresaB,
    recurso: "contabilidade",
    ...plano(empresaB, false),
  });
  assert.equal(naA.permitido, true);
  assert.equal(naB.permitido, false);
  assert.equal(naB.motivo, "RECURSO_NAO_CONTRATADO");
});

test("CASO 6: plano sem configuração explícita não bloqueia", () => {
  const vazio = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "contabilidade",
    ...plano(empresaA, "ausente"),
  });
  const outros = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "contabilidade",
    assinatura: { empresa_id: empresaA, status: "ativa" },
    recursosDoPlano: [{ chave: "pdv", habilitado: true, ativo: true }],
  });
  assert.equal(vazio.permitido, true);
  assert.equal(outros.permitido, true);
});

test("CASO 7: acesso direto à rota valida plano e permissão", () => {
  const caixa = decidirAcessoRota({
    pathname: "/contabilidade",
    permissoes: presetDoPerfil("caixa"),
  });
  const contador = decidirAcessoRota({
    pathname: "/contabilidade",
    permissoes: presetDoPerfil("contador"),
  });
  assert.equal(caixa.ok, false);
  assert.equal(contador.ok, true);
  const layout = fonte("app/contabilidade/layout.tsx");
  const corpo = layout.slice(layout.indexOf("export default async function"));
  assert.match(corpo, /RecursoNaoContratado/);
  assert.match(corpo, /planoContabilidadePermitidoNaSessao/);
  assert.ok(
    corpo.indexOf("planoContabilidadePermitidoNaSessao") <
      corpo.indexOf("obterContextoContabilidade")
  );
  assert.match(fonte("lib/contabilidade/contexto.ts"), /redirect\("\/acesso-negado"\)/);
  assert.equal(
    decidirAcessoRota({
      pathname: "/api/contabilidade/zip",
      permissoes: presetDoPerfil("contador"),
    }).ok,
    true
  );
  assert.equal(
    decidirAcessoRota({
      pathname: "/api/contabilidade/zip",
      permissoes: presetDoPerfil("caixa"),
    }).ok,
    false
  );
  assert.equal(
    decidirAcessoRota({
      pathname: "/api/contabilidade/relatorio",
      permissoes: presetDoPerfil("caixa"),
    }).ok,
    false
  );
});

test("CASO 8: download XML direto pela área contábil é protegido", () => {
  const zip = fonte("app/api/contabilidade/zip/route.ts");
  const corpo = zip.slice(zip.indexOf("export async function GET"));
  assert.match(corpo, /acao: "baixar_xml"/);
  assert.match(corpo, /exigirOperacaoContabilidade/);
  assert.ok(corpo.indexOf("exigirOperacaoContabilidade") < corpo.indexOf("montarZipCompetencia"));
  assert.doesNotMatch(zip, /podeAcessarContabilidade|ctx\.perfil/);
  assert.doesNotMatch(
    fonte("app/api/fiscal/emissoes/[id]/arquivo/route.ts"),
    /exigirOperacaoContabilidade|contabilidade/
  );
});

test("CASO 9: fechamento e inventário diretos exigem plano + permissão", () => {
  const actions = fonte("app/contabilidade/actions.ts");
  const liberar = actions.slice(actions.indexOf("liberarCompetenciaAction"));
  assert.match(liberar, /acao: "fechamento"/);
  assert.match(liberar, /exigirOperacaoContabilidade/);
  assert.ok(
    liberar.indexOf("exigirOperacaoContabilidade") <
      liberar.indexOf("contabilidade_competencias")
  );
  const inventario = actions.slice(actions.indexOf("gerarInventarioAction"));
  assert.match(inventario, /acao: "inventario"/);
  assert.ok(
    inventario.indexOf("exigirOperacaoContabilidade") <
      inventario.indexOf("gerarSnapshotInventario")
  );
  assert.doesNotMatch(fonte("lib/contabilidade/inventario.ts"), /exigirOperacaoContabilidade/);
  assert.doesNotMatch(fonte("lib/contabilidade/documentos.ts"), /exigirRecursoEmpresa/);
});

test("CASO 10: fiscal continua independente de contabilidade", () => {
  assert.doesNotMatch(fonte("app/pdv/actions.ts"), /exigirOperacaoContabilidade/);
  assert.doesNotMatch(
    fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts"),
    /exigirOperacaoContabilidade|recurso: "contabilidade"/
  );
  assert.doesNotMatch(
    fonte("app/api/fiscal/geranet/nfce-emitir-venda/route.ts"),
    /exigirOperacaoContabilidade/
  );
  assert.doesNotMatch(
    fonte("app/api/fiscal/emissoes/[id]/cancelar/route.ts"),
    /exigirOperacaoContabilidade/
  );
  const csv = fonte("app/api/contabilidade/relatorio/route.ts");
  const corpoCsv = csv.slice(csv.indexOf("export async function GET"));
  assert.match(corpoCsv, /acao: "relatorios"/);
  assert.ok(corpoCsv.indexOf("exigirOperacaoContabilidade") < corpoCsv.indexOf("carregarDocumentosCompetencia"));
});
