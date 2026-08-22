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

function plano(empresaId: string, carteira: boolean | "ausente") {
  return {
    assinatura: {
      empresa_id: empresaId,
      plano_id: "plano-teste",
      status: "ativa",
    },
    recursosDoPlano:
      carteira === "ausente"
        ? []
        : [{ chave: "carteira", habilitado: carteira, ativo: true }],
  };
}

const clienteId = "11111111-1111-4111-8111-111111111111";

test("rollout inclui somente os dezesseis recursos ativos", () => {
  assert.deepEqual(
    [...RECURSOS_COM_ENFORCEMENT],
    [
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
    ]
  );
  assert.equal(modoEntitlementDoRecurso("carteira"), "enforce");
  assert.equal(modoEntitlementDoRecurso("produtos"), "enforce");
  assert.equal(modoEntitlementDoRecurso("pix_integrado"), "enforce");
  assert.equal(modoEntitlementDoRecurso("nfe"), "enforce");
  assert.equal(modoEntitlementDoRecurso("nfce"), "enforce");
  assert.equal(modoEntitlementDoRecurso("pdv"), "enforce");
  assert.equal(modoEntitlementDoRecurso("clientes"), "enforce");
  assert.equal(modoEntitlementDoRecurso("estoque"), "enforce");
  assert.equal(modoEntitlementDoRecurso("vendas"), "enforce");
});

test("CASO 1: plano true + permissão true → permitido", () => {
  const acessar = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "carteira",
    modulo: "clientes",
    acao: "acessar_carteira",
    permissoes: presetDoPerfil("caixa"),
    ...plano(empresaA, true),
  });
  const receber = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "carteira",
    modulo: "clientes",
    acao: "receber_carteira",
    permissoes: presetDoPerfil("caixa"),
    ...plano(empresaA, true),
  });
  assert.equal(acessar.permitido, true);
  assert.equal(acessar.motivo, null);
  assert.equal(acessar.modoEntitlement, "enforce");
  assert.equal(receber.permitido, true);
});

test("CASO 2: plano false + permissão true → RECURSO_NAO_CONTRATADO", () => {
  const resultado = avaliarCamadasAcesso({
    empresaId: empresaA,
    usuarioId: usuarioA,
    recurso: "carteira",
    modulo: "clientes",
    acao: "receber_carteira",
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
    recurso: "carteira",
    modulo: "clientes",
    acao: "acessar_carteira",
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
    recurso: "carteira",
    modulo: "clientes",
    acao: "receber_carteira",
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
    recurso: "carteira",
    ...plano(empresaA, true),
  });
  const naB = decidirRecursoDoPlano({
    empresaId: empresaB,
    recurso: "carteira",
    ...plano(empresaB, false),
  });
  assert.equal(naA.permitido, true);
  assert.equal(naB.permitido, false);
  assert.equal(naB.motivo, "RECURSO_NAO_CONTRATADO");
});

test("CASO 6: plano sem configuração explícita não bloqueia", () => {
  const vazio = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "carteira",
    ...plano(empresaA, "ausente"),
  });
  const outros = decidirRecursoDoPlano({
    empresaId: empresaA,
    recurso: "carteira",
    assinatura: { empresa_id: empresaA, status: "ativa" },
    recursosDoPlano: [{ chave: "pdv", habilitado: true, ativo: true }],
  });
  assert.equal(vazio.permitido, true);
  assert.equal(outros.permitido, true);
});

test("CASO 7: acesso direto à carteira valida plano e permissão", () => {
  const caixa = decidirAcessoRota({
    pathname: `/clientes/${clienteId}/carteira`,
    permissoes: presetDoPerfil("caixa"),
  });
  const vendedor = decidirAcessoRota({
    pathname: `/clientes/${clienteId}/carteira`,
    permissoes: presetDoPerfil("vendedor"),
  });
  const imprimir = decidirAcessoRota({
    pathname: `/clientes/${clienteId}/carteira/imprimir-abertos`,
    permissoes: presetDoPerfil("caixa"),
  });
  const pdf = decidirAcessoRota({
    pathname: `/api/impressao/carteira-abertos/${clienteId}`,
    permissoes: presetDoPerfil("caixa"),
  });
  const pdfVendedor = decidirAcessoRota({
    pathname: `/api/impressao/carteira-abertos/${clienteId}`,
    permissoes: presetDoPerfil("vendedor"),
  });
  assert.equal(caixa.ok, true);
  assert.equal(vendedor.ok, false);
  assert.equal(imprimir.ok, true);
  assert.equal(pdf.ok, true);
  assert.equal(pdfVendedor.ok, false);

  const pagina = fonte("app/clientes/[id]/carteira/page.tsx");
  const corpo = pagina.slice(pagina.indexOf("export default async function"));
  assert.match(corpo, /RecursoNaoContratado/);
  assert.match(corpo, /planoPermiteRecursoEmpresa/);
  assert.ok(
    corpo.indexOf("planoPermiteRecursoEmpresa") <
      corpo.indexOf("CarteiraClienteWorkspace")
  );
  const imprimirPagina = fonte(
    "app/clientes/[id]/carteira/imprimir-abertos/page.tsx"
  );
  assert.match(imprimirPagina, /RecursoNaoContratado/);
  assert.ok(
    imprimirPagina.indexOf("planoPermiteRecursoEmpresa") <
      imprimirPagina.indexOf("titulosResult")
  );
  assert.match(
    fonte("components/clientes/cliente-navegacao.tsx"),
    /useRecursoLiberado\("carteira"\)/
  );
  assert.match(fonte("app/clientes/page.tsx"), /podeAcessarCarteira/);
});

test("CASO 8: recebimento direto exige plano + permissão antes da RPC", () => {
  const caixa = decidirAcessoRota({
    pathname: `/api/clientes/${clienteId}/carteira/receber`,
    method: "POST",
    permissoes: presetDoPerfil("caixa"),
  });
  const vendedor = decidirAcessoRota({
    pathname: `/api/clientes/${clienteId}/carteira/receber`,
    method: "POST",
    permissoes: presetDoPerfil("vendedor"),
  });
  assert.equal(caixa.ok, true);
  assert.equal(vendedor.ok, false);

  const rota = fonte("app/api/clientes/[id]/carteira/receber/route.ts");
  const corpo = rota.slice(rota.indexOf("export async function POST"));
  assert.match(corpo, /acao: "receber_carteira"/);
  assert.match(corpo, /exigirOperacaoCarteira/);
  assert.ok(
    corpo.indexOf("exigirOperacaoCarteira") <
      corpo.indexOf("rpc_receber_carteira_cliente")
  );

  const actions = fonte("app/clientes/[id]/carteira/actions.ts");
  const receber = actions.slice(actions.indexOf("export async function receberCarteira"));
  assert.match(receber, /exigirOperacaoCarteira/);
  assert.ok(
    receber.indexOf("exigirOperacaoCarteira") <
      receber.indexOf("rpc_receber_carteira_cliente")
  );
});

test("CASO 9: estorno/cancelamento direto exige plano + permissão antes da RPC", () => {
  const caixaEstorno = decidirAcessoRota({
    pathname: `/api/clientes/${clienteId}/carteira/estornar-recebimento`,
    method: "POST",
    permissoes: presetDoPerfil("caixa"),
  });
  const vendedorEstorno = decidirAcessoRota({
    pathname: `/api/clientes/${clienteId}/carteira/estornar-recebimento`,
    method: "POST",
    permissoes: presetDoPerfil("vendedor"),
  });
  assert.equal(caixaEstorno.ok, true);
  assert.equal(vendedorEstorno.ok, false);

  const estorno = fonte(
    "app/api/clientes/[id]/carteira/estornar-recebimento/route.ts"
  );
  const corpoEstorno = estorno.slice(estorno.indexOf("export async function POST"));
  assert.match(corpoEstorno, /exigirOperacaoCarteira/);
  assert.ok(
    corpoEstorno.indexOf("exigirOperacaoCarteira") <
      corpoEstorno.indexOf("rpc_estornar_recebimento_carteira")
  );

  const actions = fonte("app/clientes/[id]/carteira/actions.ts");
  const estornar = actions.slice(
    actions.indexOf("export async function estornarRecebimentoCarteira")
  );
  assert.match(estornar, /exigirOperacaoCarteira/);
  assert.ok(
    estornar.indexOf("exigirOperacaoCarteira") <
      estornar.indexOf("rpc_estornar_recebimento_carteira")
  );

  const caixaCancelar = decidirAcessoRota({
    pathname: `/api/clientes/${clienteId}/carteira/cancelar-itens`,
    method: "POST",
    permissoes: presetDoPerfil("caixa"),
  });
  const gerenteCancelar = decidirAcessoRota({
    pathname: `/api/clientes/${clienteId}/carteira/cancelar-itens`,
    method: "POST",
    permissoes: presetDoPerfil("gerente"),
  });
  assert.equal(caixaCancelar.ok, false);
  assert.equal(gerenteCancelar.ok, true);

  const cancelar = fonte(
    "app/api/clientes/[id]/carteira/cancelar-itens/route.ts"
  );
  assert.match(cancelar, /exigirCancelamentoItensCarteira/);
  assert.ok(
    cancelar.indexOf("exigirCancelamentoItensCarteira") <
      cancelar.indexOf("rpc_cancelar_itens_carteira")
  );

  const pdf = fonte("app/api/impressao/carteira-abertos/[id]/route.ts");
  const corpoPdf = pdf.slice(pdf.indexOf("export async function GET"));
  assert.match(corpoPdf, /acao: "acessar_carteira"/);
  assert.ok(
    corpoPdf.indexOf("exigirOperacaoCarteira") <
      corpoPdf.indexOf("carregarItensAbertosCarteiraDaEmpresaAtiva")
  );
});

test("CASO 10: fiado do PDV e débito interno da venda continuam fora deste entitlement", () => {
  assert.match(fonte("app/pdv/actions.ts"), /usar_fiado/);
  assert.doesNotMatch(
    fonte("app/pdv/actions.ts"),
    /exigirOperacaoCarteira|recurso: "carteira"/
  );
  assert.doesNotMatch(
    fonte("app/pdv/editar-actions.ts"),
    /exigirOperacaoCarteira|recurso: "carteira"/
  );
  assert.doesNotMatch(
    fonte("app/pdv/page.tsx"),
    /exigirOperacaoCarteira|recurso: "carteira"/
  );
  assert.doesNotMatch(
    fonte("components/pdv/pdv-shell.tsx"),
    /exigirOperacaoCarteira|recurso: "carteira"/
  );
  assert.doesNotMatch(
    fonte("app/api/vendas/[id]/cancelar/route.ts"),
    /exigirOperacaoCarteira|recurso: "carteira"/
  );
  assert.doesNotMatch(
    fonte("lib/carteira/cancelar-itens.ts"),
    /exigirOperacaoCarteira|exigirRecursoEmpresa|avaliarCamadasAcesso/
  );
  assert.doesNotMatch(
    fonte("lib/impressao/carregar-carteira.ts"),
    /exigirOperacaoCarteira|exigirRecursoEmpresa/
  );
  assert.doesNotMatch(
    fonte("lib/relatorios/carteira.ts"),
    /exigirOperacaoCarteira|recurso: "carteira"/
  );
});
