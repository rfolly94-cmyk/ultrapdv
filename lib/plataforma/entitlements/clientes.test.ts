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

function plano(empresaId: string, clientes: boolean | "ausente") {
  return {
    assinatura: {
      empresa_id: empresaId,
      plano_id: "plano-teste",
      status: "ativa",
    },
    recursosDoPlano:
      clientes === "ausente"
        ? []
        : [{ chave: "clientes", habilitado: clientes, ativo: true }],
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
  "caixa",
];

const clienteId = "11111111-1111-4111-8111-111111111111";

test("rollout inclui somente os dezesseis recursos ativos", () => {
  assert.deepEqual([...RECURSOS_COM_ENFORCEMENT], ROLL_OUT);
  assert.equal(modoEntitlementDoRecurso("clientes"), "enforce");
  assert.equal(modoEntitlementDoRecurso("carteira"), "enforce");
  assert.equal(modoEntitlementDoRecurso("produtos"), "enforce");
  assert.equal(modoEntitlementDoRecurso("estoque"), "enforce");
  assert.equal(modoEntitlementDoRecurso("nfe"), "enforce");
  assert.equal(modoEntitlementDoRecurso("pdv"), "enforce");
  assert.equal(modoEntitlementDoRecurso("vendas"), "enforce");
});

test("CASO 1: plano true + permissão true → permitido", () => {
  const acessar = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "clientes",
    modulo: "clientes",
    acao: "acessar",
    permissoes: presetDoPerfil("vendedor"),
    ...plano(empresaA, true),
  });
  const criar = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "clientes",
    modulo: "clientes",
    acao: "criar",
    permissoes: presetDoPerfil("vendedor"),
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
    recurso: "clientes",
    modulo: "clientes",
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
    recurso: "clientes",
    modulo: "clientes",
    acao: "acessar",
    permissoes: presetDoPerfil("contador"),
    ...plano(empresaA, true),
  });
  const semCriar = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "clientes",
    modulo: "clientes",
    acao: "criar",
    permissoes: presetDoPerfil("caixa"),
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
    recurso: "clientes",
    modulo: "clientes",
    acao: "editar",
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
    recurso: "clientes",
    ...plano(empresaA, true),
  });
  const naB = decidirRecursoDoPlano({
    empresaId: empresaB,
    recurso: "clientes",
    ...plano(empresaB, false),
  });
  assert.equal(naA.permitido, true);
  assert.equal(naB.permitido, false);
  assert.equal(naB.motivo, "RECURSO_NAO_CONTRATADO");
});

test("CASO 6: plano sem configuração explícita não bloqueia", () => {
  const vazio = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "clientes",
    ...plano(empresaA, "ausente"),
  });
  const outros = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "clientes",
    assinatura: { empresa_id: empresaA, status: "ativa" },
    recursosDoPlano: [{ chave: "pdv", habilitado: true, ativo: true }],
  });
  assert.equal(vazio.permitido, true);
  assert.equal(outros.permitido, true);
});

test("CASO 7: acesso direto ao cadastro valida plano e permissão", () => {
  const vendedor = decidirAcessoRota({
    pathname: "/clientes",
    permissoes: presetDoPerfil("vendedor"),
  });
  const contador = decidirAcessoRota({
    pathname: "/clientes",
    permissoes: presetDoPerfil("contador"),
  });
  assert.equal(vendedor.ok, true);
  assert.equal(contador.ok, false);

  const pagina = fonte("app/clientes/page.tsx");
  const corpo = pagina.slice(pagina.indexOf("export default async function"));
  assert.match(corpo, /RecursoNaoContratado/);
  assert.match(corpo, /planoPermiteRecursoEmpresa/);
  assert.match(corpo, /"clientes"/);
  assert.ok(
    corpo.indexOf("planoPermiteRecursoEmpresa") <
      corpo.indexOf('.from("clientes")')
  );
  assert.match(
    fonte("components/layout/app-sidebar.tsx"),
    /useRecursoLiberado\("clientes"\)/
  );
  assert.match(
    fonte("components/clientes/cliente-navegacao.tsx"),
    /useRecursoLiberado\("clientes"\)/
  );
});

test("CASO 8: CRUD direto exige plano + permissão antes da escrita", () => {
  const actions = fonte("app/clientes/actions.ts");

  function trecho(inicio: string, fim?: string) {
    const de = actions.indexOf(inicio);
    const ate = fim ? actions.indexOf(fim, de + 1) : -1;
    return actions.slice(de, ate > de ? ate : undefined);
  }

  const cadastrar = trecho(
    "export async function cadastrarCliente",
    "export async function editarCliente"
  );
  assert.match(cadastrar, /exigirCliente\([\s\S]*"criar"/);
  assert.ok(cadastrar.indexOf("exigirCliente") < cadastrar.indexOf('.from("clientes")'));

  const editar = trecho(
    "export async function editarCliente",
    "export async function excluirCliente"
  );
  assert.match(editar, /exigirCliente\([\s\S]*"editar"/);
  assert.ok(editar.indexOf("exigirCliente") < editar.indexOf('.from("clientes")'));

  const excluir = trecho("export async function excluirCliente");
  assert.match(excluir, /exigirCliente\([\s\S]*"excluir"/);
  assert.ok(excluir.indexOf("exigirCliente") < excluir.indexOf('.from("clientes")'));

  const acesso = fonte("lib/clientes/acesso-operacao.ts");
  assert.match(acesso, /recurso: "clientes"/);
  assert.match(acesso, /modulo: "clientes"/);
});

test("CASO 9: clientes=false + carteira=true não bloqueia a Carteira", () => {
  const cadastro = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "clientes",
    assinatura: { empresa_id: empresaA, status: "ativa" },
    recursosDoPlano: [
      { chave: "clientes", habilitado: false, ativo: true },
      { chave: "carteira", habilitado: true, ativo: true },
    ],
  });
  const carteira = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "carteira",
    assinatura: { empresa_id: empresaA, status: "ativa" },
    recursosDoPlano: [
      { chave: "clientes", habilitado: false, ativo: true },
      { chave: "carteira", habilitado: true, ativo: true },
    ],
  });
  assert.equal(cadastro.permitido, false);
  assert.equal(cadastro.motivo, "RECURSO_NAO_CONTRATADO");
  assert.equal(carteira.permitido, true);

  const caixaCarteira = decidirAcessoRota({
    pathname: `/clientes/${clienteId}/carteira`,
    permissoes: presetDoPerfil("caixa"),
  });
  assert.equal(caixaCarteira.ok, true);

  for (const arquivo of [
    "app/clientes/[id]/carteira/page.tsx",
    "app/clientes/[id]/carteira/imprimir-abertos/page.tsx",
    "app/clientes/[id]/carteira/actions.ts",
    "app/api/clientes/[id]/carteira/receber/route.ts",
    "app/api/clientes/[id]/carteira/estornar-recebimento/route.ts",
    "app/api/clientes/[id]/carteira/cancelar-itens/route.ts",
  ]) {
    assert.doesNotMatch(
      fonte(arquivo),
      /exigirOperacaoCliente|exigirCliente\(/,
      arquivo
    );
  }

  const paginaCarteira = fonte("app/clientes/[id]/carteira/page.tsx");
  assert.match(paginaCarteira, /planoPermiteRecursoEmpresa/);
  assert.match(paginaCarteira, /"carteira"/);
  assert.match(fonte("lib/carteira/acesso-operacao.ts"), /recurso: "carteira"/);
});

test("CASO 10: PDV, fiscal e importador continuam fora deste entitlement", () => {
  assert.doesNotMatch(
    fonte("app/pdv/actions.ts"),
    /exigirOperacaoCliente|recurso: "clientes"/
  );
  assert.doesNotMatch(
    fonte("app/pdv/page.tsx"),
    /exigirOperacaoCliente|recurso: "clientes"/
  );
  assert.doesNotMatch(
    fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts"),
    /exigirOperacaoCliente|recurso: "clientes"/
  );
  assert.doesNotMatch(
    fonte("lib/importacao/executar.ts"),
    /exigirOperacaoCliente|recurso: "clientes"/
  );
  assert.doesNotMatch(
    fonte("app/configuracoes/importar-dados/actions.ts"),
    /exigirOperacaoCliente|recurso: "clientes"/
  );
  assert.match(
    fonte("app/configuracoes/importar-dados/actions.ts"),
    /recurso: "importador"/
  );
  assert.match(fonte("lib/importacao/executar.ts"), /from\("clientes"\)\.insert/);
});
