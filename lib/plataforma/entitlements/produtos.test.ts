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

function plano(empresaId: string, produtos: boolean | "ausente") {
  return {
    assinatura: {
      empresa_id: empresaId,
      plano_id: "plano-teste",
      status: "ativa",
    },
    recursosDoPlano:
      produtos === "ausente"
        ? []
        : [{ chave: "produtos", habilitado: produtos, ativo: true }],
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
  assert.equal(modoEntitlementDoRecurso("produtos"), "enforce");
  assert.equal(modoEntitlementDoRecurso("carteira"), "enforce");
  assert.equal(modoEntitlementDoRecurso("clientes"), "enforce");
  assert.equal(modoEntitlementDoRecurso("estoque"), "enforce");
  assert.equal(modoEntitlementDoRecurso("nfe"), "enforce");
  assert.equal(modoEntitlementDoRecurso("nfce"), "enforce");
  assert.equal(modoEntitlementDoRecurso("pdv"), "enforce");
  assert.equal(modoEntitlementDoRecurso("vendas"), "enforce");
});

test("CASO 1: plano true + permissão true → permitido", () => {
  const acessar = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "produtos",
    modulo: "produtos",
    acao: "acessar",
    permissoes: presetDoPerfil("vendedor"),
    ...plano(empresaA, true),
  });
  const criar = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "produtos",
    modulo: "produtos",
    acao: "criar",
    permissoes: presetDoPerfil("operador"),
    ...plano(empresaA, true),
  });
  assert.equal(acessar.permitido, true);
  assert.equal(acessar.motivo, null);
  assert.equal(acessar.modoEntitlement, "enforce");
  assert.equal(criar.permitido, true);
});

test("CASO 2: plano false + permissão true → RECURSO_NAO_CONTRATADO", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "produtos",
    modulo: "produtos",
    acao: "criar",
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
    recurso: "produtos",
    modulo: "produtos",
    acao: "acessar",
    permissoes: presetDoPerfil("caixa"),
    ...plano(empresaA, true),
  });
  const semCriar = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "produtos",
    modulo: "produtos",
    acao: "criar",
    permissoes: presetDoPerfil("vendedor"),
    ...plano(empresaA, true),
  });
  assert.equal(semAcesso.planoPermitiu, true);
  assert.equal(semAcesso.permitido, false);
  assert.equal(semAcesso.motivo, "PERMISSAO_USUARIO_NEGADA");
  assert.equal(semCriar.permitido, false);
  assert.equal(semCriar.motivo, "PERMISSAO_USUARIO_NEGADA");
});

test("CASO 4: administrador da empresa não ultrapassa o plano", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "produtos",
    modulo: "produtos",
    acao: "excluir",
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
    recurso: "produtos",
    ...plano(empresaA, true),
  });
  const naB = decidirRecursoDoPlano({
    empresaId: empresaB,
    recurso: "produtos",
    ...plano(empresaB, false),
  });
  assert.equal(naA.permitido, true);
  assert.equal(naB.permitido, false);
  assert.equal(naB.motivo, "RECURSO_NAO_CONTRATADO");
});

test("CASO 6: plano sem configuração explícita não bloqueia", () => {
  const vazio = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "produtos",
    ...plano(empresaA, "ausente"),
  });
  const outros = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "produtos",
    assinatura: { empresa_id: empresaA, status: "ativa" },
    recursosDoPlano: [{ chave: "pdv", habilitado: true, ativo: true }],
  });
  assert.equal(vazio.permitido, true);
  assert.equal(outros.permitido, true);
});

test("CASO 7: acesso direto à rota valida plano e permissão", () => {
  const vendedor = decidirAcessoRota({
    pathname: "/produtos",
    permissoes: presetDoPerfil("vendedor"),
  });
  const caixa = decidirAcessoRota({
    pathname: "/produtos",
    permissoes: presetDoPerfil("caixa"),
  });
  const categorias = decidirAcessoRota({
    pathname: "/produtos/categorias",
    permissoes: presetDoPerfil("vendedor"),
  });
  const marcas = decidirAcessoRota({
    pathname: "/produtos/marcas",
    permissoes: presetDoPerfil("caixa"),
  });
  assert.equal(vendedor.ok, true);
  assert.equal(caixa.ok, false);
  assert.equal(categorias.ok, true);
  assert.equal(marcas.ok, false);

  const layout = fonte("app/produtos/layout.tsx");
  assert.match(layout, /RecursoNaoContratado/);
  assert.match(layout, /planoProdutosPermitidoNaSessao/);
  assert.ok(
    layout.indexOf("planoProdutosPermitidoNaSessao") <
      layout.indexOf("return children")
  );

  const pagina = fonte("app/produtos/page.tsx");
  const corpo = pagina.slice(pagina.indexOf("export default async function"));
  assert.match(corpo, /planoPermiteRecursoEmpresa/);
  assert.ok(
    corpo.indexOf('planoPermiteRecursoEmpresa') <
      corpo.indexOf('.from("produtos")')
  );
  assert.match(
    fonte("components/layout/app-sidebar.tsx"),
    /useRecursoLiberado\("produtos"\)/
  );
});

test("CASO 8: criar/editar/excluir direto exige plano + permissão antes da escrita", () => {
  const actions = fonte("app/produtos/actions.ts");

  function trecho(inicio: string, fim: string) {
    const de = actions.indexOf(inicio);
    const ate = actions.indexOf(fim, de + 1);
    return actions.slice(de, ate > de ? ate : undefined);
  }

  const cadastrar = trecho(
    "export async function cadastrarProduto",
    "export async function editarProduto"
  );
  assert.match(cadastrar, /exigirProduto\([\s\S]*"criar"/);
  assert.ok(cadastrar.indexOf("exigirProduto") < cadastrar.indexOf("rpc_cadastrar_produto"));

  const editar = trecho(
    "export async function editarProduto",
    "export async function atualizarPublicacaoCatalogo"
  );
  assert.match(editar, /exigirProduto\([\s\S]*"editar"/);
  assert.ok(editar.indexOf("exigirProduto") < editar.indexOf('.from("produtos")'));

  const excluir = trecho(
    "export async function excluirOuInativarProduto",
    "export async function reativarProduto"
  );
  assert.match(excluir, /exigirProduto\([\s\S]*"excluir"/);
  assert.ok(excluir.indexOf("exigirProduto") < excluir.indexOf('.from("produtos")'));

  const acesso = fonte("lib/produtos/acesso-operacao.ts");
  assert.match(acesso, /recurso: "produtos"/);
  assert.match(acesso, /modulo: "produtos"/);
});

test("CASO 9: PDV, fiscal e importador continuam fora deste entitlement", () => {
  assert.doesNotMatch(
    fonte("app/pdv/actions.ts"),
    /exigirOperacaoProduto|recurso: "produtos"/
  );
  assert.doesNotMatch(
    fonte("app/pdv/page.tsx"),
    /exigirOperacaoProduto|recurso: "produtos"/
  );
  assert.doesNotMatch(
    fonte("lib/pdv/validar-teto-servidor.ts"),
    /exigirOperacaoProduto|exigirRecursoEmpresa/
  );
  assert.doesNotMatch(
    fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts"),
    /exigirOperacaoProduto|recurso: "produtos"/
  );
  assert.doesNotMatch(
    fonte("app/api/fiscal/geranet/nfce-emitir-venda/route.ts"),
    /exigirOperacaoProduto/
  );
  assert.doesNotMatch(
    fonte("app/fiscal/entradas/actions.ts"),
    /exigirOperacaoProduto|recurso: "produtos"/
  );
  assert.doesNotMatch(
    fonte("lib/importacao/executar.ts"),
    /exigirOperacaoProduto|recurso: "produtos"/
  );
  assert.doesNotMatch(
    fonte("app/configuracoes/importar-dados/actions.ts"),
    /exigirOperacaoProduto|recurso: "produtos"/
  );
  assert.match(
    fonte("app/configuracoes/importar-dados/actions.ts"),
    /recurso: "importador"/
  );
});
