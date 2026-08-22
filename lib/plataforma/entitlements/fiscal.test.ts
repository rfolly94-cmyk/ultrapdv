import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB, usuarioA } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import { reconciliacaoFiscalDispensaPlano } from "@/lib/fiscal/entitlement-regras";
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

function plano(
  empresaId: string,
  chave: "nfe" | "nfce" | "cce" | "inutilizacao_fiscal",
  valor: boolean | "ausente"
) {
  return {
    assinatura: {
      empresa_id: empresaId,
      plano_id: "plano-teste",
      status: "ativa",
    },
    recursosDoPlano:
      valor === "ausente" ? [] : [{ chave, habilitado: valor, ativo: true }],
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

test("rollout inclui os dezesseis recursos ativos", () => {
  assert.deepEqual([...RECURSOS_COM_ENFORCEMENT], ROLL_OUT);
  assert.equal(modoEntitlementDoRecurso("nfce"), "enforce");
  assert.equal(modoEntitlementDoRecurso("nfe"), "enforce");
  assert.equal(modoEntitlementDoRecurso("cce"), "enforce");
  assert.equal(modoEntitlementDoRecurso("inutilizacao_fiscal"), "enforce");
  assert.equal(modoEntitlementDoRecurso("estoque"), "enforce");
  assert.equal(modoEntitlementDoRecurso("pdv"), "enforce");
  assert.equal(modoEntitlementDoRecurso("vendas"), "enforce");
});

test("CASO 1: plano true + permissão true → permitido", () => {
  const nfe = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "nfe",
    modulo: "fiscal",
    acao: "emitir_nfe",
    permissoes: presetDoPerfil("gerente"),
    ...plano(empresaA, "nfe", true),
  });
  const nfce = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "nfce",
    modulo: "fiscal",
    acao: "emitir_nfce",
    permissoes: presetDoPerfil("gerente"),
    ...plano(empresaA, "nfce", true),
  });
  const cce = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "cce",
    modulo: "fiscal",
    acao: "carta_correcao",
    permissoes: presetDoPerfil("gerente"),
    ...plano(empresaA, "cce", true),
  });
  const inutilizacao = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "inutilizacao_fiscal",
    modulo: "fiscal",
    acao: "inutilizar",
    permissoes: presetDoPerfil("gerente"),
    ...plano(empresaA, "inutilizacao_fiscal", true),
  });
  assert.equal(nfe.permitido, true);
  assert.equal(nfce.permitido, true);
  assert.equal(cce.permitido, true);
  assert.equal(inutilizacao.permitido, true);
  assert.equal(nfe.modoEntitlement, "enforce");
});

test("CASO 2: plano false + permissão true → RECURSO_NAO_CONTRATADO", () => {
  for (const [recurso, acao] of [
    ["nfe", "emitir_nfe"],
    ["nfce", "emitir_nfce"],
    ["cce", "carta_correcao"],
    ["inutilizacao_fiscal", "inutilizar"],
  ] as const) {
    const resultado = avaliarCamadasAcesso({
      empresaId: empresaA,
      usuarioId: usuarioA,
      recurso,
      modulo: "fiscal",
      acao,
      permissoes: presetDoPerfil("administrador"),
      ...plano(empresaA, recurso, false),
    });
    assert.equal(resultado.usuarioPermitiu, true, recurso);
    assert.equal(resultado.permitido, false, recurso);
    assert.equal(resultado.motivo, "RECURSO_NAO_CONTRATADO", recurso);
  }
});

test("CASO 3: plano true + permissão false → PERMISSAO_USUARIO_NEGADA", () => {
  const caixaNfe = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "nfe",
    modulo: "fiscal",
    acao: "emitir_nfe",
    permissoes: presetDoPerfil("caixa"),
    ...plano(empresaA, "nfe", true),
  });
  const caixaNfce = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "nfce",
    modulo: "fiscal",
    acao: "emitir_nfce",
    permissoes: presetDoPerfil("caixa"),
    ...plano(empresaA, "nfce", true),
  });
  assert.equal(caixaNfe.planoPermitiu, true);
  assert.equal(caixaNfe.permitido, false);
  assert.equal(caixaNfe.motivo, "PERMISSAO_USUARIO_NEGADA");
  assert.equal(caixaNfce.permitido, false);
  assert.equal(caixaNfce.motivo, "PERMISSAO_USUARIO_NEGADA");
});

test("CASO 4: administrador da empresa não ultrapassa o plano", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "nfe",
    modulo: "fiscal",
    acao: "emitir_nfe",
    permissoes: presetDoPerfil("administrador"),
    ...plano(empresaA, "nfe", false),
  });
  assert.equal(resultado.usuarioPermitiu, true);
  assert.equal(resultado.permitido, false);
  assert.equal(resultado.motivo, "RECURSO_NAO_CONTRATADO");
});

test("CASO 5: empresa A true / empresa B false", () => {
  const naA = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "nfe",
    ...plano(empresaA, "nfe", true),
  });
  const naB = decidirRecursoDoPlano({
    empresaId: empresaB,
    recurso: "nfe",
    ...plano(empresaB, "nfe", false),
  });
  const nfceB = decidirRecursoDoPlano({
    empresaId: empresaB,
    recurso: "nfce",
    ...plano(empresaB, "nfce", false),
  });
  assert.equal(naA.permitido, true);
  assert.equal(naB.permitido, false);
  assert.equal(nfceB.permitido, false);
});

test("CASO 6: plano sem configuração explícita não bloqueia", () => {
  const vazio = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "nfe",
    ...plano(empresaA, "nfe", "ausente"),
  });
  const outros = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "nfce",
    assinatura: { empresa_id: empresaA, status: "ativa" },
    recursosDoPlano: [{ chave: "pdv", habilitado: true, ativo: true }],
  });
  assert.equal(vazio.permitido, true);
  assert.equal(outros.permitido, true);
});

test("CASO 7: rotas humanas de emissão exigem permissão fiscal", () => {
  const nfeVenda = decidirAcessoRota({
    pathname: "/vendas/abc/nfe",
    permissoes: presetDoPerfil("gerente"),
  });
  const nfceVenda = decidirAcessoRota({
    pathname: "/vendas/abc/nfce",
    permissoes: presetDoPerfil("gerente"),
  });
  const caixaNfe = decidirAcessoRota({
    pathname: "/vendas/abc/nfe",
    permissoes: presetDoPerfil("caixa"),
  });
  const novaNfe = decidirAcessoRota({
    pathname: "/fiscal/nfe/nova",
    permissoes: presetDoPerfil("gerente"),
  });
  assert.equal(nfeVenda.ok, true);
  assert.equal(nfceVenda.ok, true);
  assert.equal(caixaNfe.ok, false);
  assert.equal(novaNfe.ok, true);

  const layout = fonte("app/fiscal/nfe/layout.tsx");
  assert.match(layout, /RecursoNaoContratado/);
  assert.match(layout, /planoNfePermitidoNaSessao/);
});

test("CASO 8: APIs humanas exigem plano + permissão antes da Geranet", () => {
  function assertAntesDaGeranet(arquivo: string, guard: string) {
    const corpo = fonte(arquivo);
    const post = corpo.indexOf("export async function POST");
    const trecho = post >= 0 ? corpo.slice(post) : corpo;
    assert.match(trecho, new RegExp(guard));
    const posGuard = trecho.search(new RegExp(guard));
    const posGeranet = [
      "chamarGeranet(",
      "persistenciaFalhaComunicacaoEmitir(",
    ]
      .map((token) => trecho.indexOf(token))
      .filter((indice) => indice >= 0)
      .sort((a, b) => a - b)[0];
    assert.ok(posGuard >= 0, arquivo);
    assert.ok(
      posGeranet === undefined || posGuard < posGeranet,
      `${arquivo} deve autorizar antes da Geranet`
    );
  }

  assertAntesDaGeranet(
    "app/api/fiscal/geranet/nfe-emitir-venda/route.ts",
    "exigirEmissaoNfe"
  );
  assertAntesDaGeranet(
    "app/api/fiscal/geranet/nfe-emitir/route.ts",
    "exigirEmissaoNfe"
  );
  assertAntesDaGeranet(
    "app/api/fiscal/geranet/nfe55-emitir/route.ts",
    "exigirEmissaoNfe"
  );
  assertAntesDaGeranet(
    "app/api/fiscal/geranet/nfe-emitir-operacao/route.ts",
    "exigirEmissaoNfe"
  );
  assertAntesDaGeranet(
    "app/api/fiscal/geranet/nfe-emitir-devolucao-fornecedor/route.ts",
    "exigirEmissaoNfe"
  );
  assertAntesDaGeranet(
    "app/api/fiscal/geranet/nfce-emitir-venda/route.ts",
    "exigirEmissaoNfce"
  );
  assertAntesDaGeranet(
    "app/api/fiscal/geranet/nfce-emitir/route.ts",
    "exigirEmissaoNfce"
  );
  assertAntesDaGeranet(
    "app/api/fiscal/geranet/nfce-contingencia-venda/route.ts",
    "exigirEmissaoNfce"
  );

  assertAntesDaGeranet(
    "app/api/fiscal/emissoes/[id]/cancelar/route.ts",
    "exigirCancelamentoDocumentoFiscal"
  );
  assertAntesDaGeranet(
    "app/api/fiscal/emissoes/[id]/carta-correcao/route.ts",
    "exigirCartaCorrecaoFiscal"
  );

  function assertAntesDaChamada(arquivo: string, guard: string, chamada: string) {
    const corpo = fonte(arquivo);
    const post = corpo.indexOf("export async function POST");
    const trecho = post >= 0 ? corpo.slice(post) : corpo;
    assert.match(trecho, new RegExp(guard));
    assert.ok(
      trecho.indexOf(guard) < trecho.indexOf(chamada),
      `${arquivo}: ${guard} antes de ${chamada}`
    );
  }

  assertAntesDaChamada(
    "app/api/fiscal/emissoes/[id]/inutilizar/route.ts",
    "exigirInutilizacaoFiscal",
    "inutilizarNumeracaoFiscal("
  );
  assertAntesDaChamada(
    "app/api/fiscal/emissoes/[id]/reconciliar/route.ts",
    "exigirReconciliacaoDocumentoFiscal",
    "reconciliarEmissaoFiscal("
  );
});

test("CASO 9: PDV finaliza venda com nfce=false e não chama Geranet na venda", () => {
  assert.doesNotMatch(
    fonte("app/pdv/actions.ts"),
    /exigirEmissaoNfce|exigirEmissaoNfe|recurso: "nfce"|recurso: "nfe"/
  );
  assert.match(fonte("app/pdv/actions.ts"), /rpc_finalizar_venda/);
  const pagina = fonte("app/pdv/page.tsx");
  assert.match(pagina, /planoPermiteRecursoEmpresa/);
  assert.match(pagina, /"nfce"/);
  assert.match(pagina, /emitirNfceAutomaticoPdv && planoNfce.permitido/);
  assert.match(fonte("components/pdv/pdv-shell.tsx"), /if \(emitirNfceAutomaticoPdv\)/);
  assert.match(fonte("components/pdv/pdv-shell.tsx"), /if \(!emitirNfceAutomaticoPdv\)/);
});

test("CASO 10: histórico fiscal, cron e config compartilhada ficam fora do plano", () => {
  assert.doesNotMatch(
    fonte("app/api/fiscal/emissoes/[id]/arquivo/route.ts"),
    /exigirEmissaoNfe|exigirEmissaoNfce|exigirOperacaoFiscal/
  );
  assert.doesNotMatch(
    fonte("app/api/impressao/danfe/[id]/route.ts"),
    /exigirEmissaoNfe|exigirEmissaoNfce/
  );
  assert.doesNotMatch(
    fonte("app/api/cron/fiscal/reconciliar/route.ts"),
    /exigirEmissaoNfe|exigirOperacaoFiscal|exigirReconciliacaoDocumentoFiscal/
  );
  assert.doesNotMatch(
    fonte("app/configuracoes/fiscal/actions.ts"),
    /exigirEmissaoNfe|exigirEmissaoNfce|exigirCartaCorrecaoFiscal/
  );
  assert.doesNotMatch(
    fonte("lib/fiscal/geranet/montar-item.ts"),
    /exigirEmissaoNfe|exigirOperacaoFiscal/
  );
  assert.doesNotMatch(
    fonte("lib/fiscal/geranet/cliente-geranet.ts"),
    /exigirEmissaoNfe|exigirOperacaoFiscal/
  );
});

test("CASO 11: reconciliação de emissão já iniciada dispensa o plano", () => {
  assert.equal(
    reconciliacaoFiscalDispensaPlano({ status: "aguardando_reconciliacao" }),
    true
  );
  assert.equal(
    reconciliacaoFiscalDispensaPlano({ status: "enviando" }),
    true
  );
  assert.equal(
    reconciliacaoFiscalDispensaPlano({ status: "erro_comunicacao" }),
    true
  );
  assert.equal(
    reconciliacaoFiscalDispensaPlano({
      status: "aguardando_transmissao_contingencia",
    }),
    true
  );
  assert.equal(
    reconciliacaoFiscalDispensaPlano({ status: "autorizada" }),
    false
  );
  assert.equal(
    reconciliacaoFiscalDispensaPlano({ status: "cancelada" }),
    false
  );

  const acesso = fonte("lib/fiscal/acesso-operacao.ts");
  assert.match(acesso, /reconciliacaoFiscalDispensaPlano/);
  assert.match(acesso, /exigirPermissao\(\{\s*modulo: "fiscal",\s*acao: "reconciliar"/);
});
