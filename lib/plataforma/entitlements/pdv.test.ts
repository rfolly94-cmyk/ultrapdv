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

function plano(empresaId: string, pdv: boolean | "ausente") {
  return {
    assinatura: {
      empresa_id: empresaId,
      plano_id: "plano-teste",
      status: "ativa",
    },
    recursosDoPlano:
      pdv === "ausente"
        ? []
        : [{ chave: "pdv", habilitado: pdv, ativo: true }],
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

test("rollout inclui somente os dezesseis recursos ativos", () => {
  assert.deepEqual([...RECURSOS_COM_ENFORCEMENT], ROLL_OUT);
  assert.equal(modoEntitlementDoRecurso("pdv"), "enforce");
  assert.equal(modoEntitlementDoRecurso("vendas"), "enforce");
  assert.equal(modoEntitlementDoRecurso("estoque"), "enforce");
  assert.equal(modoEntitlementDoRecurso("nfce"), "enforce");
  assert.equal(modoEntitlementDoRecurso("carteira"), "enforce");
  assert.equal(modoEntitlementDoRecurso("pix_integrado"), "enforce");
  assert.equal(modoEntitlementDoRecurso("impressao_automatica"), "enforce");
});

test("CASO 1: plano true + permissão true → permitido", () => {
  const acessar = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "pdv",
    modulo: "pdv",
    acao: "acessar",
    permissoes: presetDoPerfil("caixa"),
    ...plano(empresaA, true),
  });
  const finalizar = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "pdv",
    modulo: "pdv",
    acao: "finalizar_venda",
    permissoes: presetDoPerfil("caixa"),
    ...plano(empresaA, true),
  });
  const desconto = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "pdv",
    modulo: "pdv",
    acao: "aplicar_desconto",
    permissoes: presetDoPerfil("operador"),
    ...plano(empresaA, true),
  });
  const fiado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "pdv",
    modulo: "pdv",
    acao: "usar_fiado",
    permissoes: presetDoPerfil("vendedor"),
    ...plano(empresaA, true),
  });
  assert.equal(acessar.permitido, true);
  assert.equal(acessar.motivo, null);
  assert.equal(acessar.modoEntitlement, "enforce");
  assert.equal(finalizar.permitido, true);
  assert.equal(desconto.permitido, true);
  assert.equal(fiado.permitido, true);
});

test("CASO 2: plano false + permissão true → RECURSO_NAO_CONTRATADO", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "pdv",
    modulo: "pdv",
    acao: "finalizar_venda",
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
    recurso: "pdv",
    modulo: "pdv",
    acao: "acessar",
    permissoes: presetDoPerfil("contador"),
    ...plano(empresaA, true),
  });
  const semDesconto = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "pdv",
    modulo: "pdv",
    acao: "aplicar_desconto",
    permissoes: presetDoPerfil("caixa"),
    ...plano(empresaA, true),
  });
  const semFiado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "pdv",
    modulo: "pdv",
    acao: "usar_fiado",
    permissoes: presetDoPerfil("caixa"),
    ...plano(empresaA, true),
  });
  assert.equal(semAcesso.planoPermitiu, true);
  assert.equal(semAcesso.permitido, false);
  assert.equal(semAcesso.motivo, "PERMISSAO_USUARIO_NEGADA");
  assert.equal(semDesconto.permitido, false);
  assert.equal(semDesconto.motivo, "PERMISSAO_USUARIO_NEGADA");
  assert.equal(semFiado.permitido, false);
  assert.equal(semFiado.motivo, "PERMISSAO_USUARIO_NEGADA");
});

test("CASO 4: administrador da empresa não ultrapassa o plano", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "pdv",
    modulo: "pdv",
    acao: "finalizar_venda",
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
    recurso: "pdv",
    ...plano(empresaA, true),
  });
  const naB = decidirRecursoDoPlano({
    empresaId: empresaB,
    recurso: "pdv",
    ...plano(empresaB, false),
  });
  assert.equal(naA.permitido, true);
  assert.equal(naB.permitido, false);
  assert.equal(naB.motivo, "RECURSO_NAO_CONTRATADO");
});

test("CASO 6: plano sem configuração explícita não bloqueia", () => {
  const vazio = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "pdv",
    ...plano(empresaA, "ausente"),
  });
  const outros = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "pdv",
    assinatura: { empresa_id: empresaA, status: "ativa" },
    recursosDoPlano: [{ chave: "vendas", habilitado: true, ativo: true }],
  });
  assert.equal(vazio.permitido, true);
  assert.equal(outros.permitido, true);
});

test("CASO 7: acesso direto ao PDV valida plano e permissão", () => {
  const caixa = decidirAcessoRota({
    pathname: "/pdv",
    permissoes: presetDoPerfil("caixa"),
  });
  const editar = decidirAcessoRota({
    pathname: "/pdv/editar/11111111-1111-4111-8111-111111111111",
    permissoes: presetDoPerfil("caixa"),
  });
  const contador = decidirAcessoRota({
    pathname: "/pdv",
    permissoes: presetDoPerfil("contador"),
  });
  assert.equal(caixa.ok, true);
  assert.equal(editar.ok, true);
  assert.equal(contador.ok, false);

  const pagina = fonte("app/pdv/page.tsx");
  const corpo = pagina.slice(pagina.indexOf("export default async function"));
  assert.match(corpo, /RecursoNaoContratado/);
  assert.match(corpo, /planoPermiteRecursoEmpresa/);
  assert.match(corpo, /"pdv"/);
  assert.ok(
    corpo.indexOf('planoPermiteRecursoEmpresa') < corpo.indexOf('.from("produtos")')
  );
  assert.ok(
    corpo.indexOf('"pdv"') < corpo.indexOf('.from("produtos")')
  );

  const edicao = fonte("app/pdv/editar/[id]/page.tsx");
  const corpoEdicao = edicao.slice(edicao.indexOf("export default async function"));
  assert.match(corpoEdicao, /RecursoNaoContratado/);
  assert.match(corpoEdicao, /"pdv"/);
  assert.ok(
    corpoEdicao.indexOf("planoPermiteRecursoEmpresa") <
      corpoEdicao.indexOf('.from("produtos")')
  );

  assert.match(
    fonte("components/layout/app-sidebar.tsx"),
    /useRecursoLiberado\("pdv"\)/
  );
});

test("CASO 8: finalizar e editar exigem plano + permissão antes da RPC", () => {
  const actions = fonte("app/pdv/actions.ts");
  assert.match(actions, /exigirOperacaoPdv/);
  assert.match(actions, /acao: "finalizar_venda"/);
  assert.ok(
    actions.indexOf("exigirOperacaoPdv") < actions.indexOf("rpc_finalizar_venda")
  );
  assert.match(actions, /acao: "aplicar_desconto"/);
  assert.match(actions, /acao: "usar_fiado"/);
  assert.ok(
    actions.indexOf("exigirOperacaoPdv") < actions.indexOf("acao: \"usar_fiado\"")
  );

  const editar = fonte("app/pdv/editar-actions.ts");
  assert.match(editar, /exigirEdicaoPdv/);
  assert.ok(
    editar.indexOf("exigirEdicaoPdv") < editar.indexOf("rpc_editar_venda_pdv")
  );
  assert.doesNotMatch(editar, /exigirOperacaoVenda|recurso: "vendas"/);

  const acesso = fonte("lib/pdv/acesso-operacao.ts");
  assert.match(acesso, /recurso: "pdv"/);
  assert.match(acesso, /modulo: "pdv"/);
  assert.match(acesso, /modulo: "vendas"/);
  assert.match(acesso, /acao: "editar"/);

  const prefs = fonte("app/pdv/preferencias-actions.ts");
  assert.match(prefs, /exigirOperacaoPdv/);
  assert.ok(
    prefs.indexOf("exigirOperacaoPdv") <
      prefs.indexOf("gravarPreferenciasPdvSessao")
  );
});

test("CASO 9: vendas/estoque/clientes/produtos/carteira false não bloqueiam o caixa", () => {
  assert.doesNotMatch(
    fonte("app/pdv/actions.ts"),
    /exigirOperacaoVenda|recurso: "vendas"|recurso: "estoque"|recurso: "clientes"|recurso: "produtos"|recurso: "carteira"|exigirOperacaoEstoque|exigirOperacaoCliente|exigirOperacaoProduto|exigirOperacaoCarteira/
  );
  assert.doesNotMatch(
    fonte("app/pdv/editar-actions.ts"),
    /exigirOperacaoVenda|recurso: "estoque"|recurso: "carteira"|exigirOperacaoCarteira/
  );
  assert.doesNotMatch(
    fonte("app/pdv/page.tsx"),
    /exigirOperacaoProduto|exigirOperacaoCliente|recurso: "produtos"|recurso: "clientes"/
  );
  assert.match(fonte("app/pdv/page.tsx"), /\.from\("produtos"\)/);
  assert.match(fonte("app/pdv/page.tsx"), /\.from\("clientes"\)/);
  assert.match(fonte("lib/pdv/validar-teto-servidor.ts"), /\.from\("produtos"\)/);
  assert.doesNotMatch(
    fonte("lib/pdv/validar-teto-servidor.ts"),
    /exigirOperacaoProduto|recurso: "produtos"/
  );
  assert.match(fonte("app/pdv/actions.ts"), /acao: "usar_fiado"/);
  assert.doesNotMatch(fonte("app/pdv/actions.ts"), /recurso: "carteira"/);
});

test("CASO 10: fiscal, PIX, impressão, recibo e cancelamento de vendas continuam independentes", () => {
  assert.doesNotMatch(
    fonte("app/pdv/actions.ts"),
    /exigirEmissaoNfce|exigirEmissaoNfe|exigirPixIntegradoEmpresa|exigirRecursoEmpresa\("impressao_automatica"\)|exigirOperacaoVenda/
  );
  assert.match(fonte("app/pdv/actions.ts"), /rpc_finalizar_venda/);
  assert.match(fonte("app/pdv/page.tsx"), /"nfce"/);
  assert.match(fonte("app/pdv/page.tsx"), /"pix_integrado"/);
  assert.match(fonte("app/pdv/page.tsx"), /emitirNfceAutomaticoPdv && planoNfce.permitido/);

  assert.doesNotMatch(
    fonte("app/pdv/imprimir/recibo/[id]/page.tsx"),
    /exigirOperacaoPdv|planoPermiteRecursoEmpresa/
  );
  assert.doesNotMatch(
    fonte("app/pdv/imprimir/carta-correcao/[eventoId]/page.tsx"),
    /exigirOperacaoPdv|planoPermiteRecursoEmpresa/
  );
  assert.doesNotMatch(
    fonte("app/api/impressao/recibo/[id]/route.ts"),
    /exigirOperacaoPdv|recurso: "pdv"/
  );
  assert.doesNotMatch(
    fonte("app/api/impressao/danfe/[id]/route.ts"),
    /exigirOperacaoPdv|recurso: "pdv"/
  );

  const cancelar = fonte("app/api/vendas/[id]/cancelar/route.ts");
  assert.match(cancelar, /exigirOperacaoVenda/);
  assert.doesNotMatch(cancelar, /exigirOperacaoPdv|recurso: "pdv"/);
  assert.doesNotMatch(fonte("app/pdv/actions.ts"), /rpc_cancelar_venda_comercial/);
  assert.doesNotMatch(
    fonte("app/pdv/editar-actions.ts"),
    /rpc_cancelar_venda_comercial/
  );
});
