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

function plano(empresaId: string, relatorios: boolean | "ausente") {
  return {
    assinatura: {
      empresa_id: empresaId,
      plano_id: "plano-teste",
      status: "ativa",
    },
    recursosDoPlano:
      relatorios === "ausente"
        ? []
        : [{ chave: "relatorios", habilitado: relatorios, ativo: true }],
  };
}

test("rollout inclui importador, impressao_automatica, relatorios e contabilidade", () => {
  assert.deepEqual(
    [...RECURSOS_COM_ENFORCEMENT],
    ["importador", "impressao_automatica", "relatorios", "contabilidade", "pix_integrado", "carteira", "produtos", "clientes", "estoque", "nfce", "nfe", "cce", "inutilizacao_fiscal", "vendas", "pdv", "catalogo", "caixa"]
  );
  assert.equal(modoEntitlementDoRecurso("relatorios"), "enforce");
  assert.equal(modoEntitlementDoRecurso("contabilidade"), "enforce");
  assert.equal(modoEntitlementDoRecurso("pix_integrado"), "enforce");
  assert.equal(modoEntitlementDoRecurso("carteira"), "enforce");
  assert.equal(modoEntitlementDoRecurso("produtos"), "enforce");
  assert.equal(modoEntitlementDoRecurso("estoque"), "enforce");
  assert.equal(modoEntitlementDoRecurso("nfe"), "enforce");
  assert.equal(modoEntitlementDoRecurso("pdv"), "enforce");
});

test("CASO 1: plano true + permissão true → permitido", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "relatorios",
    modulo: "relatorios",
    acao: "acessar",
    permissoes: presetDoPerfil("gerente"),
    ...plano(empresaA, true),
  });
  assert.equal(resultado.permitido, true);
  assert.equal(resultado.motivo, null);
  assert.equal(resultado.modoEntitlement, "enforce");
});

test("CASO 2: plano false → RECURSO_NAO_CONTRATADO", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "relatorios",
    modulo: "relatorios",
    acao: "acessar",
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
    recurso: "relatorios",
    modulo: "relatorios",
    acao: "exportar",
    permissoes: presetDoPerfil("vendedor"),
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
    recurso: "relatorios",
    modulo: "relatorios",
    acao: "acessar",
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
    recurso: "relatorios",
    ...plano(empresaA, true),
  });
  const naB = decidirRecursoDoPlano({
    empresaId: empresaB,
    recurso: "relatorios",
    ...plano(empresaB, false),
  });
  assert.equal(naA.permitido, true);
  assert.equal(naB.permitido, false);
  assert.equal(naB.motivo, "RECURSO_NAO_CONTRATADO");
});

test("CASO 6: plano sem configuração explícita não bloqueia", () => {
  const vazio = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "relatorios",
    ...plano(empresaA, "ausente"),
  });
  const outros = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "relatorios",
    assinatura: { empresa_id: empresaA, status: "ativa" },
    recursosDoPlano: [{ chave: "pdv", habilitado: true, ativo: true }],
  });
  assert.equal(vazio.permitido, true);
  assert.equal(outros.permitido, true);
});

test("CASO 7: acesso direto à rota valida permissão no proxy", () => {
  const caixa = decidirAcessoRota({
    pathname: "/relatorios",
    permissoes: presetDoPerfil("caixa"),
  });
  const gerente = decidirAcessoRota({
    pathname: "/relatorios",
    permissoes: presetDoPerfil("gerente"),
  });
  assert.equal(caixa.ok, false);
  assert.equal(gerente.ok, true);
  assert.match(fonte("app/relatorios/page.tsx"), /RecursoNaoContratado/);
  assert.match(fonte("app/relatorios/page.tsx"), /planoPermiteRecursoEmpresa/);
  const pagina = fonte("app/relatorios/page.tsx");
  const corpoPagina = pagina.slice(pagina.indexOf("export default async function"));
  assert.ok(
    corpoPagina.indexOf("planoPermiteRecursoEmpresa") <
      corpoPagina.indexOf("carregarRelatorio")
  );
});

test("CASO 8: action/API direta exige plano e permissão antes de carregar", () => {
  const exportar = fonte("app/api/relatorios/exportar/route.ts");
  const corpoExportar = exportar.slice(exportar.indexOf("export async function GET"));
  assert.match(corpoExportar, /acao: "exportar"/);
  assert.match(corpoExportar, /exigirOperacaoRelatorio/);
  assert.ok(
    corpoExportar.indexOf("exigirOperacaoRelatorio") <
      corpoExportar.indexOf("carregarRelatorio")
  );
  assert.match(exportar, /respostaNegacaoRelatorio/);
  const pdf = fonte("app/api/impressao/relatorio/route.ts");
  const corpoPdf = pdf.slice(pdf.indexOf("export async function GET"));
  assert.match(corpoPdf, /exigirOperacaoRelatorio/);
  assert.match(corpoPdf, /acao: "acessar"/);
  assert.doesNotMatch(pdf, /impressao_automatica/);
  assert.doesNotMatch(fonte("lib/relatorios/carregar.ts"), /exigirOperacaoRelatorio/);
  assert.doesNotMatch(fonte("lib/relatorios/calculo.ts"), /exigirRecursoEmpresa/);
});

test("CASO 9: exportação humana não mistura com o Conector", () => {
  const acoes = fonte("components/relatorios/relatorio-acoes.tsx");
  assert.match(acoes, /useTemPermissao\("relatorios", "exportar"\)/);
  assert.match(acoes, /BotaoImprimirConector/);
  assert.doesNotMatch(acoes, /impressao_automatica/);
  assert.doesNotMatch(
    fonte("app/api/relatorios/exportar/route.ts"),
    /impressao_automatica|enviarImpressaoAgente/
  );
  assert.doesNotMatch(fonte("app/pdv/actions.ts"), /exigirRecursoEmpresa/);
  assert.doesNotMatch(fonte("print-agent/src/server.mjs"), /relatorios/);
});
