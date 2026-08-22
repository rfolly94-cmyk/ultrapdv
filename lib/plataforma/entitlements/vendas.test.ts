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

function plano(empresaId: string, vendas: boolean | "ausente") {
  return {
    assinatura: {
      empresa_id: empresaId,
      plano_id: "plano-teste",
      status: "ativa",
    },
    recursosDoPlano:
      vendas === "ausente"
        ? []
        : [{ chave: "vendas", habilitado: vendas, ativo: true }],
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

const vendaId = "11111111-1111-4111-8111-111111111111";

test("rollout inclui somente os dezesseis recursos ativos", () => {
  assert.deepEqual([...RECURSOS_COM_ENFORCEMENT], ROLL_OUT);
  assert.equal(modoEntitlementDoRecurso("vendas"), "enforce");
  assert.equal(modoEntitlementDoRecurso("nfe"), "enforce");
  assert.equal(modoEntitlementDoRecurso("nfce"), "enforce");
  assert.equal(modoEntitlementDoRecurso("carteira"), "enforce");
  assert.equal(modoEntitlementDoRecurso("estoque"), "enforce");
  assert.equal(modoEntitlementDoRecurso("pdv"), "enforce");
});

test("CASO 1: plano true + permissão true → permitido", () => {
  const acessar = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "vendas",
    modulo: "vendas",
    acao: "acessar",
    permissoes: presetDoPerfil("caixa"),
    ...plano(empresaA, true),
  });
  const criar = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "vendas",
    modulo: "vendas",
    acao: "criar",
    permissoes: presetDoPerfil("operador"),
    ...plano(empresaA, true),
  });
  const editar = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "vendas",
    modulo: "vendas",
    acao: "editar",
    permissoes: presetDoPerfil("operador"),
    ...plano(empresaA, true),
  });
  const cancelar = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "vendas",
    modulo: "vendas",
    acao: "cancelar",
    permissoes: presetDoPerfil("gerente"),
    ...plano(empresaA, true),
  });
  assert.equal(acessar.permitido, true);
  assert.equal(acessar.motivo, null);
  assert.equal(acessar.modoEntitlement, "enforce");
  assert.equal(criar.permitido, true);
  assert.equal(editar.permitido, true);
  assert.equal(cancelar.permitido, true);
});

test("CASO 2: plano false + permissão true → RECURSO_NAO_CONTRATADO", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "vendas",
    modulo: "vendas",
    acao: "acessar",
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
    recurso: "vendas",
    modulo: "vendas",
    acao: "acessar",
    permissoes: presetDoPerfil("contador"),
    ...plano(empresaA, true),
  });
  const semCancelar = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "vendas",
    modulo: "vendas",
    acao: "cancelar",
    permissoes: presetDoPerfil("caixa"),
    ...plano(empresaA, true),
  });
  const semEditar = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "vendas",
    modulo: "vendas",
    acao: "editar",
    permissoes: presetDoPerfil("caixa"),
    ...plano(empresaA, true),
  });
  assert.equal(semAcesso.planoPermitiu, true);
  assert.equal(semAcesso.permitido, false);
  assert.equal(semAcesso.motivo, "PERMISSAO_USUARIO_NEGADA");
  assert.equal(semCancelar.permitido, false);
  assert.equal(semCancelar.motivo, "PERMISSAO_USUARIO_NEGADA");
  assert.equal(semEditar.permitido, false);
  assert.equal(semEditar.motivo, "PERMISSAO_USUARIO_NEGADA");
});

test("CASO 4: administrador da empresa não ultrapassa o plano", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "vendas",
    modulo: "vendas",
    acao: "cancelar",
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
    recurso: "vendas",
    ...plano(empresaA, true),
  });
  const naB = decidirRecursoDoPlano({
    empresaId: empresaB,
    recurso: "vendas",
    ...plano(empresaB, false),
  });
  assert.equal(naA.permitido, true);
  assert.equal(naB.permitido, false);
  assert.equal(naB.motivo, "RECURSO_NAO_CONTRATADO");
});

test("CASO 6: plano sem configuração explícita não bloqueia", () => {
  const vazio = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "vendas",
    ...plano(empresaA, "ausente"),
  });
  const outros = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "vendas",
    assinatura: { empresa_id: empresaA, status: "ativa" },
    recursosDoPlano: [{ chave: "pdv", habilitado: true, ativo: true }],
  });
  assert.equal(vazio.permitido, true);
  assert.equal(outros.permitido, true);
});

test("CASO 7: acesso direto à lista e ao detalhe valida plano e permissão", () => {
  const caixaLista = decidirAcessoRota({
    pathname: "/vendas",
    permissoes: presetDoPerfil("caixa"),
  });
  const caixaDetalhe = decidirAcessoRota({
    pathname: `/vendas/${vendaId}`,
    permissoes: presetDoPerfil("caixa"),
  });
  const contador = decidirAcessoRota({
    pathname: "/vendas",
    permissoes: presetDoPerfil("contador"),
  });
  assert.equal(caixaLista.ok, true);
  assert.equal(caixaDetalhe.ok, true);
  assert.equal(contador.ok, false);

  const lista = fonte("app/vendas/page.tsx");
  const corpoLista = lista.slice(lista.indexOf("export default async function"));
  assert.match(corpoLista, /RecursoNaoContratado/);
  assert.match(corpoLista, /planoPermiteRecursoEmpresa/);
  assert.match(corpoLista, /"vendas"/);
  assert.ok(
    corpoLista.indexOf("planoPermiteRecursoEmpresa") <
      corpoLista.indexOf('.from("vendas")')
  );

  const detalhe = fonte("app/vendas/[id]/page.tsx");
  const corpoDetalhe = detalhe.slice(
    detalhe.indexOf("export default async function")
  );
  assert.match(corpoDetalhe, /RecursoNaoContratado/);
  assert.match(corpoDetalhe, /planoPermiteRecursoEmpresa/);
  assert.match(corpoDetalhe, /"vendas"/);
  assert.ok(
    corpoDetalhe.indexOf("planoPermiteRecursoEmpresa") <
      corpoDetalhe.indexOf('.from("vendas")')
  );

  assert.match(
    fonte("components/layout/app-sidebar.tsx"),
    /useRecursoLiberado\("vendas"\)/
  );
  assert.match(
    fonte("components/layout/app-sidebar.tsx"),
    /temAcessoModulo\(permissoes, "pdv"\)/
  );
});

test("CASO 8: cancelar e editar humanos exigem plano + permissão antes da escrita", () => {
  const caixaCancelar = decidirAcessoRota({
    pathname: `/api/vendas/${vendaId}/cancelar`,
    method: "POST",
    permissoes: presetDoPerfil("caixa"),
  });
  const gerenteCancelar = decidirAcessoRota({
    pathname: `/api/vendas/${vendaId}/cancelar`,
    method: "POST",
    permissoes: presetDoPerfil("gerente"),
  });
  assert.equal(caixaCancelar.ok, false);
  assert.equal(gerenteCancelar.ok, true);

  const cancelar = fonte("app/api/vendas/[id]/cancelar/route.ts");
  assert.match(cancelar, /exigirOperacaoVenda/);
  assert.match(cancelar, /acao: "cancelar"/);
  assert.ok(
    cancelar.indexOf("exigirOperacaoVenda") <
      cancelar.indexOf("rpc_cancelar_venda_comercial")
  );

  const editar = fonte("app/api/vendas/[id]/editar/route.ts");
  const corpoEditar = editar.slice(editar.indexOf("export async function PATCH"));
  assert.match(corpoEditar, /exigirOperacaoVenda/);
  assert.match(corpoEditar, /acao: "editar"/);
  assert.ok(corpoEditar.indexOf("exigirOperacaoVenda") < corpoEditar.indexOf(".update("));

  const acesso = fonte("lib/vendas/acesso-operacao.ts");
  assert.match(acesso, /recurso: "vendas"/);
  assert.match(acesso, /modulo: "vendas"/);

  const redirecionaEdicao = fonte("app/vendas/[id]/editar/page.tsx");
  assert.doesNotMatch(redirecionaEdicao, /exigirOperacaoVenda|planoPermiteRecursoEmpresa/);
  assert.match(redirecionaEdicao, /resolverRotaEdicaoVenda/);
});

test("CASO 9: PDV continua finalizando e editando venda com vendas=false", () => {
  assert.doesNotMatch(
    fonte("app/pdv/actions.ts"),
    /exigirOperacaoVenda|recurso: "vendas"/
  );
  assert.match(fonte("app/pdv/actions.ts"), /rpc_finalizar_venda/);
  assert.match(fonte("app/pdv/actions.ts"), /modulo: "pdv"/);
  assert.doesNotMatch(
    fonte("app/pdv/editar-actions.ts"),
    /exigirOperacaoVenda|recurso: "vendas"/
  );
  assert.match(fonte("app/pdv/editar-actions.ts"), /rpc_editar_venda_pdv/);
  assert.doesNotMatch(
    fonte("app/pdv/page.tsx"),
    /exigirOperacaoVenda|recurso: "vendas"/
  );
  assert.doesNotMatch(
    fonte("components/pdv/pdv-shell.tsx"),
    /exigirOperacaoVenda|recurso: "vendas"/
  );
  assert.equal(modoEntitlementDoRecurso("pdv"), "enforce");
});

test("CASO 10: fiscal, carteira, estoque interno e PIX continuam independentes", () => {
  for (const arquivo of [
    "app/vendas/[id]/nfe/page.tsx",
    "app/vendas/[id]/nfce/page.tsx",
    "app/api/vendas/[id]/natureza/route.ts",
    "app/api/vendas/[id]/transporte/route.ts",
    "app/api/fiscal/geranet/nfe-emitir-venda/route.ts",
    "app/api/impressao/danfe/[id]/route.ts",
  ]) {
    assert.doesNotMatch(
      fonte(arquivo),
      /exigirOperacaoVenda|recurso: "vendas"/,
      arquivo
    );
  }

  const carteira = fonte("lib/carteira/acesso-operacao.ts");
  assert.match(carteira, /recurso: "carteira"/);
  assert.match(carteira, /modulo: "vendas"/);
  assert.match(carteira, /acao: "cancelar"/);
  assert.doesNotMatch(carteira, /recurso: "vendas"/);
  assert.doesNotMatch(
    fonte("app/api/clientes/[id]/carteira/cancelar-itens/route.ts"),
    /exigirOperacaoVenda|recurso: "vendas"/
  );
  assert.doesNotMatch(
    fonte("app/api/clientes/[id]/carteira/receber/route.ts"),
    /exigirOperacaoVenda|recurso: "vendas"/
  );

  assert.doesNotMatch(
    fonte("app/estoque/actions.ts"),
    /exigirOperacaoVenda|recurso: "vendas"/
  );
  assert.doesNotMatch(
    fonte("lib/pagamentos/pix/contexto.ts"),
    /exigirOperacaoVenda|recurso: "vendas"/
  );
  assert.doesNotMatch(
    fonte("app/vendas/pedidos/actions.ts"),
    /exigirOperacaoVenda|recurso: "vendas"/
  );
  assert.match(fonte("app/vendas/pedidos/actions.ts"), /exigirOperacaoCatalogo/);
});
