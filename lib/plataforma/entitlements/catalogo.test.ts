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

function plano(empresaId: string, catalogo: boolean | "ausente") {
  return {
    assinatura: {
      empresa_id: empresaId,
      plano_id: "plano-teste",
      status: "ativa",
    },
    recursosDoPlano:
      catalogo === "ausente"
        ? []
        : [{ chave: "catalogo", habilitado: catalogo, ativo: true }],
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

test("rollout inclui catalogo como 16º recurso e nenhum outro novo", () => {
  assert.deepEqual([...RECURSOS_COM_ENFORCEMENT], ROLL_OUT);
  assert.equal(RECURSOS_COM_ENFORCEMENT.size, 16);
  assert.equal(modoEntitlementDoRecurso("catalogo"), "enforce");
  assert.equal(modoEntitlementDoRecurso("pdv"), "enforce");
  assert.equal(modoEntitlementDoRecurso("vendas"), "enforce");
  assert.equal(modoEntitlementDoRecurso("produtos"), "enforce");
  assert.equal(modoEntitlementDoRecurso("suporte_prioritario"), "off");
});

test("Pro/Premium: catalogo true + permissão true → permitido", () => {
  const configurar = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "catalogo",
    modulo: "catalogo",
    acao: "configurar",
    permissoes: presetDoPerfil("gerente"),
    ...plano(empresaA, true),
  });
  const pedidos = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "catalogo",
    modulo: "catalogo",
    acao: "pedidos",
    permissoes: presetDoPerfil("operador"),
    ...plano(empresaA, true),
  });
  assert.equal(configurar.permitido, true);
  assert.equal(pedidos.permitido, true);
});

test("Básico: catalogo false bloqueia mesmo o administrador", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "catalogo",
    modulo: "catalogo",
    acao: "configurar",
    permissoes: presetDoPerfil("administrador"),
    ...plano(empresaA, false),
  });
  assert.equal(resultado.usuarioPermitiu, true);
  assert.equal(resultado.permitido, false);
  assert.equal(resultado.motivo, "RECURSO_NAO_CONTRATADO");
});

test("plano true + usuário sem catalogo.acessar → PERMISSAO_USUARIO_NEGADA", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "catalogo",
    modulo: "catalogo",
    acao: "acessar",
    permissoes: presetDoPerfil("caixa"),
    ...plano(empresaA, true),
  });
  assert.equal(resultado.planoPermitiu, true);
  assert.equal(resultado.permitido, false);
  assert.equal(resultado.motivo, "PERMISSAO_USUARIO_NEGADA");
});

test("empresa A true / empresa B false", () => {
  const naA = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "catalogo",
    ...plano(empresaA, true),
  });
  const naB = decidirRecursoDoPlano({
    empresaId: empresaB,
    recurso: "catalogo",
    ...plano(empresaB, false),
  });
  assert.equal(naA.permitido, true);
  assert.equal(naB.permitido, false);
  assert.equal(naB.motivo, "RECURSO_NAO_CONTRATADO");
});

test("ausência de configuração de catalogo mantém compatibilidade", () => {
  const vazio = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "catalogo",
    ...plano(empresaA, "ausente"),
  });
  assert.equal(vazio.permitido, true);
});

test("configuração direta e pedidos online exigem plano + permissão", () => {
  const caixaConfig = decidirAcessoRota({
    pathname: "/configuracoes/catalogo",
    permissoes: presetDoPerfil("caixa"),
  });
  const gerenteConfig = decidirAcessoRota({
    pathname: "/configuracoes/catalogo",
    permissoes: presetDoPerfil("gerente"),
  });
  const caixaPedidos = decidirAcessoRota({
    pathname: "/vendas/pedidos",
    permissoes: presetDoPerfil("caixa"),
  });
  const operadorPedidos = decidirAcessoRota({
    pathname: "/vendas/pedidos",
    permissoes: presetDoPerfil("operador"),
  });
  const pedidosOnline = decidirAcessoRota({
    pathname: "/vendas/pedidos-online",
    permissoes: presetDoPerfil("operador"),
  });
  assert.equal(caixaConfig.ok, false);
  assert.equal(gerenteConfig.ok, true);
  assert.equal(caixaPedidos.ok, false);
  assert.equal(operadorPedidos.ok, true);
  assert.equal(pedidosOnline.ok, true);

  const config = fonte("app/configuracoes/catalogo/page.tsx");
  assert.match(config, /RecursoNaoContratado/);
  assert.match(config, /planoPermiteRecursoEmpresa/);
  assert.match(config, /"catalogo"/);
  assert.ok(
    config.indexOf("planoPermiteRecursoEmpresa") <
      config.indexOf('.from("catalogo_config")')
  );

  const salvar = fonte("app/configuracoes/catalogo/actions.ts");
  assert.match(salvar, /exigirOperacaoCatalogo/);
  assert.match(salvar, /acao: "configurar"/);
  assert.ok(
    salvar.indexOf("exigirOperacaoCatalogo") <
      salvar.indexOf('.from("catalogo_config")')
  );

  const pedidos = fonte("app/vendas/pedidos/page.tsx");
  assert.match(pedidos, /RecursoNaoContratado/);
  assert.match(pedidos, /"catalogo"/);
  assert.ok(
    pedidos.indexOf("planoPermiteRecursoEmpresa") <
      pedidos.indexOf('.from("catalogo_pedidos")')
  );

  const acoesPedidos = fonte("app/vendas/pedidos/actions.ts");
  assert.match(acoesPedidos, /exigirOperacaoCatalogo/);
  assert.match(acoesPedidos, /acao: "pedidos"/);
  assert.doesNotMatch(acoesPedidos, /DELETE FROM/);
  assert.doesNotMatch(acoesPedidos, /\.delete\(/);
});

test("catálogo público: true libera, false fica indisponível sem expor plano", () => {
  const publico = fonte("lib/catalogo/publico.ts");
  assert.match(publico, /planoCatalogoPublicoPermitido/);
  assert.match(publico, /lojaPublicaIndisponivel/);
  assert.ok(
    publico.indexOf("planoCatalogoPublicoPermitido") <
      publico.indexOf("rpc_catalogo_publico")
  );
  assert.doesNotMatch(publico, /planoNome|RECURSO_NAO_CONTRATADO|RecursoNaoContratado/);

  const acesso = fonte("lib/catalogo/acesso-publico.ts");
  assert.match(acesso, /carregarEntitlementsEmpresaServico/);
  assert.match(acesso, /Catálogo temporariamente indisponível/);
  assert.doesNotMatch(acesso, /planoNome/);
  assert.doesNotMatch(acesso, /empresa_id: loja/);
});

test("novo pedido público é bloqueado com catalogo false, antes da RPC", () => {
  const action = fonte("app/catalogo/actions.ts");
  assert.match(action, /planoCatalogoPublicoPermitido/);
  assert.match(action, /mensagemCatalogoPublicoIndisponivel/);
  assert.ok(
    action.indexOf("planoCatalogoPublicoPermitido") <
      action.indexOf("rpc_catalogo_criar_pedido")
  );
  assert.doesNotMatch(action, /planoNome|RecursoNaoContratado/);
});

test("publicar no catálogo exige recurso catalogo; CRUD de produtos permanece independente", () => {
  const produtos = fonte("app/produtos/actions.ts");
  const publicar = produtos.slice(
    produtos.indexOf("export async function atualizarPublicacaoCatalogo")
  );
  assert.match(publicar, /recurso: "catalogo"/);
  assert.match(publicar, /exigirProduto/);
  assert.ok(
    publicar.indexOf('recurso: "catalogo"') <
      publicar.indexOf(".update({ catalogo_publicado")
  );

  const cadastrar = produtos.slice(
    produtos.indexOf("export async function cadastrarProduto"),
    produtos.indexOf("export async function editarProduto")
  );
  assert.match(cadastrar, /planoPermiteRecursoEmpresa/);
  assert.match(cadastrar, /"catalogo"/);
  assert.match(cadastrar, /exigirProduto\([\s\S]*"criar"/);

  const editar = produtos.slice(
    produtos.indexOf("export async function editarProduto"),
    produtos.indexOf("export async function atualizarPublicacaoCatalogo")
  );
  assert.match(editar, /planoPermiteRecursoEmpresa/);
  assert.match(editar, /catalogo \? payloadCatalogoProduto/);

  const form = fonte("app/produtos/produto-cadastro-form.tsx");
  assert.match(form, /useRecursoLiberado\("catalogo"\)/);
  assert.match(fonte("app/produtos/produtos-workspace.tsx"), /useRecursoLiberado\("catalogo"\)/);
});

test("pedidos/configurações existentes não são apagados no bloqueio", () => {
  assert.doesNotMatch(
    fonte("app/configuracoes/catalogo/page.tsx"),
    /\.delete\(|DELETE FROM/
  );
  assert.doesNotMatch(
    fonte("app/vendas/pedidos/page.tsx"),
    /\.delete\(|DELETE FROM/
  );
  assert.doesNotMatch(
    fonte("lib/catalogo/publico.ts"),
    /\.delete\(|DELETE FROM/
  );
  assert.match(
    fonte("app/configuracoes/catalogo/page.tsx"),
    /não são apagados/
  );
  assert.match(fonte("app/vendas/pedidos/page.tsx"), /não são apagados/);
});

test("/vendas normal não sofre regressão de catalogo", () => {
  const vendas = fonte("app/vendas/page.tsx");
  assert.match(vendas, /planoPermiteRecursoEmpresa/);
  assert.match(vendas, /"vendas"/);
  assert.doesNotMatch(vendas, /recurso: "catalogo"|exigirOperacaoCatalogo/);
  const corpo = vendas.slice(vendas.indexOf("export default async function"));
  assert.ok(corpo.indexOf('"vendas"') < corpo.indexOf('"catalogo"') || !corpo.includes('"catalogo"'));

  assert.doesNotMatch(
    fonte("app/pdv/actions.ts"),
    /exigirOperacaoCatalogo|recurso: "catalogo"/
  );
  assert.doesNotMatch(
    fonte("app/api/vendas/[id]/cancelar/route.ts"),
    /exigirOperacaoCatalogo|recurso: "catalogo"/
  );
  assert.doesNotMatch(
    fonte("lib/importacao/executar.ts"),
    /exigirOperacaoCatalogo|recurso: "catalogo"/
  );
  assert.match(
    fonte("lib/permissoes/rotas.ts"),
    /pathname\.startsWith\("\/vendas\/pedidos"\)/
  );
  assert.match(fonte("lib/permissoes/rotas.ts"), /modulo: "catalogo"/);
});
