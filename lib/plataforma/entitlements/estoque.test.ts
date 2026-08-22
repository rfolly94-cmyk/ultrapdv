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

function plano(empresaId: string, estoque: boolean | "ausente") {
  return {
    assinatura: {
      empresa_id: empresaId,
      plano_id: "plano-teste",
      status: "ativa",
    },
    recursosDoPlano:
      estoque === "ausente"
        ? []
        : [{ chave: "estoque", habilitado: estoque, ativo: true }],
  };
}

const ROLL_OUT = [
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
];

test("rollout inclui somente os dezesseis recursos ativos", () => {
  assert.deepEqual([...RECURSOS_COM_ENFORCEMENT], ROLL_OUT);
  assert.equal(modoEntitlementDoRecurso("estoque"), "enforce");
  assert.equal(modoEntitlementDoRecurso("clientes"), "enforce");
  assert.equal(modoEntitlementDoRecurso("produtos"), "enforce");
  assert.equal(modoEntitlementDoRecurso("nfe"), "enforce");
  assert.equal(modoEntitlementDoRecurso("nfce"), "enforce");
  assert.equal(modoEntitlementDoRecurso("pdv"), "enforce");
  assert.equal(modoEntitlementDoRecurso("vendas"), "enforce");
});

test("CASO 1: plano true + permissão true → permitido", () => {
  const acessar = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "estoque",
    modulo: "estoque",
    acao: "acessar",
    permissoes: presetDoPerfil("operador"),
    ...plano(empresaA, true),
  });
  const movimentar = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "estoque",
    modulo: "estoque",
    acao: "movimentar",
    permissoes: presetDoPerfil("operador"),
    ...plano(empresaA, true),
  });
  const ajustar = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "estoque",
    modulo: "estoque",
    acao: "ajustar",
    permissoes: presetDoPerfil("gerente"),
    ...plano(empresaA, true),
  });
  assert.equal(acessar.permitido, true);
  assert.equal(acessar.motivo, null);
  assert.equal(acessar.modoEntitlement, "enforce");
  assert.equal(movimentar.permitido, true);
  assert.equal(ajustar.permitido, true);
});

test("CASO 2: plano false + permissão true → RECURSO_NAO_CONTRATADO", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "estoque",
    modulo: "estoque",
    acao: "movimentar",
    permissoes: presetDoPerfil("administrador"),
    ...plano(empresaA, false),
  });
  assert.equal(resultado.usuarioPermitiu, true);
  assert.equal(resultado.permitido, false);
  assert.equal(resultado.motivo, "RECURSO_NAO_CONTRATADO");
});

test("CASO 3: plano true + permissão false → PERMISSAO_USUARIO_NEGADA", () => {
  const semAcesso = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "estoque",
    modulo: "estoque",
    acao: "acessar",
    permissoes: presetDoPerfil("caixa"),
    ...plano(empresaA, true),
  });
  const semAjustar = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "estoque",
    modulo: "estoque",
    acao: "ajustar",
    permissoes: presetDoPerfil("operador"),
    ...plano(empresaA, true),
  });
  assert.equal(semAcesso.planoPermitiu, true);
  assert.equal(semAcesso.permitido, false);
  assert.equal(semAcesso.motivo, "PERMISSAO_USUARIO_NEGADA");
  assert.equal(semAjustar.permitido, false);
  assert.equal(semAjustar.motivo, "PERMISSAO_USUARIO_NEGADA");
});

test("CASO 4: administrador da empresa não ultrapassa o plano", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "estoque",
    modulo: "estoque",
    acao: "ajustar",
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
    recurso: "estoque",
    ...plano(empresaA, true),
  });
  const naB = decidirRecursoDoPlano({
    empresaId: empresaB,
    recurso: "estoque",
    ...plano(empresaB, false),
  });
  assert.equal(naA.permitido, true);
  assert.equal(naB.permitido, false);
  assert.equal(naB.motivo, "RECURSO_NAO_CONTRATADO");
});

test("CASO 6: plano sem configuração explícita não bloqueia", () => {
  const vazio = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "estoque",
    ...plano(empresaA, "ausente"),
  });
  const outros = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "estoque",
    assinatura: { empresa_id: empresaA, status: "ativa" },
    recursosDoPlano: [{ chave: "pdv", habilitado: true, ativo: true }],
  });
  assert.equal(vazio.permitido, true);
  assert.equal(outros.permitido, true);
});

test("CASO 7: acesso direto à rota valida plano e permissão", () => {
  const operador = decidirAcessoRota({
    pathname: "/estoque",
    permissoes: presetDoPerfil("operador"),
  });
  const caixa = decidirAcessoRota({
    pathname: "/estoque",
    permissoes: presetDoPerfil("caixa"),
  });
  const alias = decidirAcessoRota({
    pathname: "/app/estoque",
    permissoes: presetDoPerfil("contador"),
  });
  assert.equal(operador.ok, true);
  assert.equal(caixa.ok, false);
  assert.equal(alias.ok, true);

  const layout = fonte("app/estoque/layout.tsx");
  assert.match(layout, /RecursoNaoContratado/);
  assert.match(layout, /planoEstoquePermitidoNaSessao/);
  assert.ok(
    layout.indexOf("planoEstoquePermitidoNaSessao") <
      layout.indexOf("return children")
  );

  const pagina = fonte("app/estoque/page.tsx");
  const corpo = pagina.slice(pagina.indexOf("export default async function"));
  assert.match(corpo, /planoPermiteRecursoEmpresa/);
  assert.match(corpo, /"estoque"/);
  assert.ok(
    corpo.indexOf("planoPermiteRecursoEmpresa") <
      corpo.indexOf('.from("produtos")')
  );
  assert.match(
    fonte("components/layout/app-sidebar.tsx"),
    /useRecursoLiberado\("estoque"\)/
  );
});

test("CASO 8: ajuste e movimentação manual exigem plano + permissão antes da RPC", () => {
  const actions = fonte("app/estoque/actions.ts");

  function trecho(inicio: string, fim: string) {
    const de = actions.indexOf(inicio);
    const ate = actions.indexOf(fim, de + 1);
    return actions.slice(de, ate > de ? ate : undefined);
  }

  const movimentar = trecho(
    "export async function movimentarEstoque",
    "export async function atualizarLimitesEstoque"
  );
  assert.match(movimentar, /exigirEstoque\(/);
  assert.match(movimentar, /"movimentarEstoque"/);
  assert.ok(
    movimentar.indexOf("exigirEstoque") <
      movimentar.indexOf("rpc_movimentar_estoque_produto")
  );

  const limites = trecho(
    "export async function atualizarLimitesEstoque",
    "export async function listarMovimentacoesEstoque"
  );
  assert.match(limites, /exigirEstoque\([\s\S]*"ajustar"/);
  assert.ok(
    limites.indexOf("exigirEstoque") <
      limites.indexOf("rpc_atualizar_limites_estoque_produto")
  );

  const historico = trecho(
    "export async function listarMovimentacoesEstoque",
    ".limit(80)"
  );
  assert.match(historico, /exigirEstoque\([\s\S]*"acessar"/);
  assert.ok(
    historico.indexOf("exigirEstoque") < historico.indexOf("estoque_movimentacoes")
  );

  const legado = fonte("app/app/estoque/actions.ts");
  assert.match(legado, /exigirEstoque\(/);
  assert.ok(
    legado.indexOf("exigirEstoque") <
      legado.indexOf("rpc_movimentar_estoque_produto")
  );
  assert.ok(
    legado.indexOf("atualizarLimitesEstoque") <
      legado.indexOf("rpc_atualizar_limites_estoque_produto")
  );
  assert.match(
    legado.slice(legado.indexOf("export async function atualizarLimitesEstoque")),
    /exigirEstoque\([\s\S]*"ajustar"/
  );

  const acesso = fonte("lib/estoque/acesso-operacao.ts");
  assert.match(acesso, /recurso: "estoque"/);
  assert.match(acesso, /modulo: "estoque"/);
});

test("CASO 9: PDV, vendas, fiscal e importador continuam fora deste entitlement", () => {
  assert.doesNotMatch(
    fonte("app/pdv/actions.ts"),
    /exigirOperacaoEstoque|recurso: "estoque"/
  );
  assert.doesNotMatch(
    fonte("app/pdv/editar-actions.ts"),
    /exigirOperacaoEstoque|recurso: "estoque"/
  );
  assert.match(fonte("app/pdv/actions.ts"), /rpc_finalizar_venda/);
  assert.match(fonte("app/pdv/editar-actions.ts"), /rpc_editar_venda_pdv/);
  assert.doesNotMatch(
    fonte("app/api/vendas/[id]/cancelar/route.ts"),
    /exigirOperacaoEstoque|recurso: "estoque"/
  );
  assert.match(
    fonte("app/api/vendas/[id]/cancelar/route.ts"),
    /rpc_cancelar_venda_comercial/
  );
  assert.doesNotMatch(
    fonte("lib/importacao/executar.ts"),
    /exigirOperacaoEstoque|recurso: "estoque"/
  );
  assert.match(
    fonte("lib/importacao/executar.ts"),
    /rpc_movimentar_estoque_produto/
  );
  assert.doesNotMatch(
    fonte("app/configuracoes/importar-dados/actions.ts"),
    /exigirOperacaoEstoque|recurso: "estoque"/
  );
  assert.match(
    fonte("app/configuracoes/importar-dados/actions.ts"),
    /recurso: "importador"/
  );
  assert.doesNotMatch(
    fonte("app/fiscal/entradas/actions.ts"),
    /exigirOperacaoEstoque|recurso: "estoque"/
  );
  assert.match(
    fonte("app/fiscal/entradas/actions.ts"),
    /rpc_confirmar_entrada_nfe/
  );
  assert.doesNotMatch(
    fonte("app/fiscal/entradas/devolucao-actions.ts"),
    /exigirOperacaoEstoque|recurso: "estoque"/
  );
  assert.doesNotMatch(
    fonte("app/produtos/actions.ts"),
    /exigirOperacaoEstoque|recurso: "estoque"/
  );
});
