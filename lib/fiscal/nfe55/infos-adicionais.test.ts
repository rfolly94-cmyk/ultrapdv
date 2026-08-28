import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { montarPayloadNfeGeranet } from "@/lib/fiscal/geranet/montar-payload-nfe";
import { camposCabecalhoParaSnapshot } from "./cabecalho-fiscal";
import {
  LIMITE_INF_CPL_NFE,
  montarInformacaoAdicionalFisco,
  montarInformacaoComplementarNfe,
  persistirTextoInfAdicNfe,
  sanitizarTextoInfAdicNfe,
  textoUsuarioInfCplNfe,
} from "./infos-adicionais";
import { mesclarSnapshotOperacao } from "./pagamentos-rascunho";

function fonte(relativo: string) {
  return readFileSync(path.join(process.cwd(), relativo), "utf8");
}

function payloadEmissao(informacaoComplementar?: string | null) {
  return montarPayloadNfeGeranet({
    ambiente: "2",
    ufEmitente: "MT",
    certificadoDigital: "CERT",
    senhaCertificadoDigital: "SENHA",
    emitente: {
      cnpj: "42741754000142",
      inscricaoEstadual: "138856729",
      razaoSocial: "EMPRESA TESTE",
      logradouro: "Rua A",
      numero: "1",
      bairro: "Centro",
      municipio: "Cuiaba",
      codigoMunicipio: "5103403",
      uf: "MT",
      cep: "78000000",
      codigoRegimeTributario: 1,
    },
    destinatario: {
      cpf: "52998224725",
      consumidorFinal: "1",
      indicadorIEdestinatario: "9",
      logradouro: "Rua B",
      numero: "2",
      bairro: "Centro",
      municipio: "Cuiaba",
      codigoMunicipio: "5103403",
      uf: "MT",
      cep: "78000000",
    },
    config: {
      serie: 1,
      numeroNota: 1,
      codigoNumerico: "12345678",
      dataSaida: "2026-08-19 12:00:00",
      dataEmissao: "2026-08-19 12:00:00",
      fusoHorario: "America/Cuiaba",
      indicadorPresenca: "1",
      indicativoIntermediador: "0",
      naturezaOperacao: "Venda",
      tipo: "1",
      finalidade: "1",
      informacaoComplementar,
    },
    pagamento: {
      troco: 0,
      detalhamento: [{ tipo: "01", valor: 10, indicadorPagamento: "0" }],
    },
    itens: [{ ncmProduto: "85171231", icmsCsosn: "102" }],
  }) as { nfe: { informacaoComplementar: string } };
}

test("1. infCpl informado aparece no payload da emissão", () => {
  const textoUsuario = "Mercadoria conferida no ato da entrega.";
  const infCpl = montarInformacaoComplementarNfe({
    textosAutomaticos: [],
    padraoEmpresa: "",
    textoUsuario,
  });
  const payload = payloadEmissao(infCpl);
  assert.equal(payload.nfe.informacaoComplementar, textoUsuario);

  const emitirVenda = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  const emitirOperacao = fonte("app/api/fiscal/geranet/nfe-emitir-operacao/route.ts");
  const montar = fonte("lib/fiscal/geranet/montar-payload-nfe.ts");
  assert.match(emitirVenda, /montarInformacaoComplementarNfe/);
  assert.match(emitirVenda, /textoUsuarioInfCplNfe/);
  assert.match(emitirVenda, /informacao_complementar_usuario/);
  assert.match(emitirOperacao, /textoUsuarioInfCplNfe/);
  assert.match(montar, /informacaoComplementar:\s*\n\s*texto\(\s*\n\s*config\s*\n\s*\.informacaoComplementar/);
  assert.match(montar, /infAdic\.infCpl/);
});

test("2. infCpl aparece no snapshot da operação e da venda", () => {
  const texto = "Pedido 88 — entregar pela manhã.";
  const snapshot = camposCabecalhoParaSnapshot({
    tpNf: "1",
    finNfe: "1",
    informacaoComplementarUsuario: persistirTextoInfAdicNfe(texto, LIMITE_INF_CPL_NFE),
    informacaoAdicionalFisco: null,
  });
  assert.equal(snapshot.informacao_complementar_usuario, texto);
  assert.equal(
    textoUsuarioInfCplNfe({ snapshot, coluna: null }),
    texto
  );

  const actions = fonte("app/fiscal/nfe/operacoes-actions.ts");
  const cabecalhoFn = actions.slice(
    actions.indexOf("export async function salvarCabecalhoFiscalOperacao"),
    actions.indexOf("export async function adicionarItemOperacaoFiscal")
  );
  assert.match(cabecalhoFn, /informacaoComplementarUsuario: infoUsuario/);
  assert.match(actions, /informacao_complementar_usuario: textoUsuarioInfCplNfe/);
  const preparar = actions.slice(
    actions.indexOf("export async function prepararVendaParaEmissaoNfe"),
    actions.length
  );
  assert.match(preparar, /informacao_complementar_usuario: textoUsuarioInfCplNfe/);
});

test("3. infCpl permanece após editar quantidade/valor ou pagamento", () => {
  const snapshot = mesclarSnapshotOperacao(
    {
      informacao_complementar_usuario: "Texto do usuário",
      informacao_adicional_fisco: "Fisco",
    },
    {
      pagamentos_rascunho: [{ formaPagamentoId: "x", valorCentavos: 100 }],
      totais_nota: { frete: 0 },
    }
  );
  assert.equal(snapshot.informacao_complementar_usuario, "Texto do usuário");
  assert.equal(snapshot.informacao_adicional_fisco, "Fisco");

  const depoisItem = mesclarSnapshotOperacao(snapshot, {
    quantidade: 3,
    valor_unitario: 12.5,
    valor_total: 37.5,
  });
  assert.equal(depoisItem.informacao_complementar_usuario, "Texto do usuário");

  const form = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");
  assert.match(form, /persistirCabecalhoSeSujo/);
  assert.match(form, /if \(!cabecalhoSujo\)/);
  const itemFn = fonte("app/fiscal/nfe/operacoes-actions.ts").slice(
    fonte("app/fiscal/nfe/operacoes-actions.ts").indexOf(
      "export async function atualizarItemOperacaoFiscal"
    ),
    fonte("app/fiscal/nfe/operacoes-actions.ts").indexOf(
      "export async function removerItemOperacaoFiscal"
    )
  );
  assert.doesNotMatch(itemFn, /informacao_complementar_usuario:\s*null/);
  assert.match(itemFn, /mesclarSnapshotItemComercial/);
});

test("4. emissão sem infCpl continua funcionando", () => {
  const infCpl = montarInformacaoComplementarNfe({
    textosAutomaticos: [],
    padraoEmpresa: null,
    textoUsuario: null,
  });
  assert.equal(infCpl, "");
  const payload = payloadEmissao(infCpl);
  assert.equal(payload.nfe.informacaoComplementar, "");
  assert.equal(payloadEmissao(undefined).nfe.informacaoComplementar, "");
  assert.equal(textoUsuarioInfCplNfe({ snapshot: {}, coluna: null }), null);
  assert.equal(montarInformacaoAdicionalFisco({ textoUsuario: "  " }), "");
});

test("5. caracteres especiais permitidos não são perdidos", () => {
  const especial =
    'Ação nº 12: R$ 10,50 — "entrega" & <urgente> às 14h; João/Maria.';
  const sanitizado = sanitizarTextoInfAdicNfe(`\u0001${especial}\u0007`, LIMITE_INF_CPL_NFE);
  assert.equal(sanitizado, especial);
  assert.equal(
    montarInformacaoComplementarNfe({
      textosAutomaticos: [],
      padraoEmpresa: "",
      textoUsuario: especial,
    }),
    especial
  );
  assert.equal(payloadEmissao(especial).nfe.informacaoComplementar, especial);
  assert.equal(
    persistirTextoInfAdicNfe(`  ${especial}  `, LIMITE_INF_CPL_NFE),
    especial
  );
  const longo = "a".repeat(LIMITE_INF_CPL_NFE + 20);
  assert.equal(sanitizarTextoInfAdicNfe(longo, LIMITE_INF_CPL_NFE).length, LIMITE_INF_CPL_NFE);
});

test("infCpl da NF-e não usa rodapé do recibo e recusa documento autorizado", () => {
  const emitirVenda = fonte("app/api/fiscal/geranet/nfe-emitir-venda/route.ts");
  const form = fonte("components/fiscal/nfe55/nfe-emissao-form.tsx");
  const actions = fonte("app/fiscal/nfe/operacoes-actions.ts");
  const carregar = fonte("lib/fiscal/nfe55/carregar-formulario-nfe.ts");
  assert.doesNotMatch(emitirVenda, /textoPersonalizado|recibo-layout/);
  assert.doesNotMatch(form, /textoPersonalizado/);
  assert.match(actions, /recusarEdicaoDocumentoFiscal/);
  assert.match(carregar, /textoUsuarioInfCplNfe/);
  const bodyVenda = form.slice(
    form.indexOf('"/api/fiscal/geranet/nfe-emitir-venda"'),
    form.indexOf("/api/fiscal/geranet/nfe-emitir-operacao")
  );
  assert.match(bodyVenda, /venda_id: preparada\.vendaId/);
  assert.doesNotMatch(bodyVenda, /empresa_id/);
});
