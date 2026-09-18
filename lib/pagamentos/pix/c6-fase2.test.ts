import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import {
  normalizarStatusPagamentoPixGeranet,
} from "./evidencia-pagamento";
import { statusMonotonicoConsultaPix } from "./geranet-regras";
import { ehProvedorPixSelecionavel } from "./provedores-geranet";
import { prefixoSegredosProvedor } from "./provedores";
import { sanitizarRespostaPix } from "./sanitizar";
import { chaveCacheTokenC6 } from "./c6/http";
import {
  erroReadBackC6,
  flagsExistenciaCofreC6,
} from "./c6/persistencia";
import {
  MENSAGEM_C6_CONEXAO_OK,
  MENSAGEM_C6_CONEXAO_OK_PRODUCAO,
  URL_C6_PRODUCAO,
  URL_C6_SANDBOX,
  baseUrlC6,
  deveConsultarTxidExistenteAposFalha,
  mensagemTesteConexaoC6,
  respostaPublicaTesteC6,
  urlAuthC6,
  urlCobC6,
  urlWebhookC6,
} from "./c6/regras";
import {
  empresaIdExternaWebhookC6,
  eventoWebhookC6Sanitizado,
  extrairTxidsWebhookC6,
  mascararE2eid,
  urlPublicaWebhookPixC6,
} from "./c6/webhook";
import { filtrarCredenciaisDoProvedor, mesclarSegredosProvedor } from "./credenciais";
import { gerarTxidPixC6 } from "./c6/txid";

const ADAPTER = "lib/pagamentos/pix/c6/adapter.ts";
const ACTIONS = "app/configuracoes/financeiro/pix/actions.ts";
const WORKSPACE = "app/configuracoes/financeiro/pix/pix-workspace.tsx";
const CHECKOUT = "components/pdv/pix-geranet-checkout.tsx";
const ROTA = "app/api/webhooks/pix/c6/route.ts";
const GERANET = "lib/pagamentos/pix/geranet.ts";
const LOCAL = "lib/pagamentos/pix/local-pdv.ts";
const TXID = "a".repeat(32);

test("1. produção usa baas-api.c6bank.info", () => {
  assert.equal(baseUrlC6("1"), URL_C6_PRODUCAO);
  assert.equal(urlAuthC6("1"), "https://baas-api.c6bank.info/v1/auth/");
  assert.equal(
    urlCobC6("1", TXID),
    `https://baas-api.c6bank.info/v2/pix/cob/${TXID}`
  );
});

test("2. sandbox continua usando baas-api-sandbox.c6bank.info", () => {
  assert.equal(baseUrlC6("2"), URL_C6_SANDBOX);
  assert.equal(
    urlAuthC6("2"),
    "https://baas-api-sandbox.c6bank.info/v1/auth/"
  );
});

test("3. credencial sandbox não é usada em produção", () => {
  const sandbox = prefixoSegredosProvedor({
    empresaId: empresaA,
    provedor: "c6bank",
    ambiente: "2",
  });
  const producao = prefixoSegredosProvedor({
    empresaId: empresaA,
    provedor: "c6bank",
    ambiente: "1",
  });
  assert.match(sandbox, /\/homologacao\//);
  assert.match(producao, /\/producao\//);
  assert.notEqual(sandbox, producao);
  assert.notEqual(
    chaveCacheTokenC6({ empresaId: empresaA, ambiente: "2", clientId: "cli" }),
    chaveCacheTokenC6({ empresaId: empresaA, ambiente: "1", clientId: "cli" })
  );
});

test("4. credencial produção não é usada em sandbox", () => {
  const mesclado = mesclarSegredosProvedor({
    provedor: "c6bank",
    ambiente: "2",
    novos: {},
    existentes: {
      clienteId: "id-sandbox",
      chavePix: "chave-sandbox",
    },
  });
  const filtrado = filtrarCredenciaisDoProvedor(
    "c6bank",
    mesclado,
    "chave-producao-publica",
    "2"
  );
  assert.equal(filtrado.chavePix, "chave-sandbox");
  assert.notEqual(filtrado.chavePix, "chave-producao-publica");
});

test("5. webhook não confia em empresa_id externo", () => {
  const payload = { empresa_id: empresaB, txid: TXID };
  assert.equal(empresaIdExternaWebhookC6(payload), empresaB);
  const rota = fonte(ROTA);
  assert.doesNotMatch(rota, /buscarVinculoEmpresaAtiva/);
  assert.doesNotMatch(rota, /resolverEmpresaPix/);
  assert.match(fonte(ADAPTER), /void empresaIdExternaWebhookC6/);
  assert.doesNotMatch(
    fonte(ADAPTER),
    /buscarCobrancasC6PorTxid\([\s\S]{0,200}empresa_id.*payload/
  );
});

test("6. cobrança resolve empresa pelo registro interno", () => {
  const adapter = fonte(ADAPTER);
  assert.match(adapter, /buscarCobrancasC6PorTxid/);
  assert.match(adapter, /const empresaId = String\(cobranca\.empresa_id\)/);
  assert.match(adapter, /reconciliarCobrancaC6Existente/);
  assert.match(adapter, /params\.cobranca\.ambiente/);
});

test("7. webhook duplicado é idempotente", () => {
  const adapter = fonte(ADAPTER);
  assert.match(adapter, /statusAtual === "paga" \|\| statusAtual === "vinculado_venda"/);
  assert.match(adapter, /idempotente: true/);
  assert.match(adapter, /\.neq\("status", "paga"\)/);
  assert.match(adapter, /\.neq\("status", "vinculado_venda"\)/);
  assert.equal(
    statusMonotonicoConsultaPix({
      statusAtual: "paga",
      estado: "pago",
      valorCobranca: 1,
      valorPago: 1,
    }),
    "paga"
  );
});

test("8. ATIVA não finaliza venda", () => {
  const evidencia = normalizarStatusPagamentoPixGeranet({
    httpStatus: 200,
    resposta: { status: "ATIVA", pixCopiaECola: "000201" },
  });
  assert.equal(evidencia.estado, "pendente");
  assert.equal(
    statusMonotonicoConsultaPix({
      statusAtual: "pendente",
      estado: "pendente",
      valorCobranca: 1,
      valorPago: null,
    }),
    "pendente"
  );
});

test("9. CONCLUIDA pode marcar pagamento", () => {
  const evidencia = normalizarStatusPagamentoPixGeranet({
    httpStatus: 200,
    resposta: {
      status: "CONCLUIDA",
      valor: { original: "1.00" },
      pix: [{ valor: "1.00", horario: "2026-09-11T12:00:00.000Z" }],
    },
  });
  assert.equal(evidencia.estado, "pago");
  assert.equal(
    statusMonotonicoConsultaPix({
      statusAtual: "pendente",
      estado: "pago",
      valorCobranca: 1,
      valorPago: 1,
    }),
    "paga"
  );
});

test("10. valor divergente não finaliza", () => {
  assert.equal(
    statusMonotonicoConsultaPix({
      statusAtual: "pendente",
      estado: "pago",
      valorCobranca: 10,
      valorPago: 1,
    }),
    "divergencia_valor"
  );
});

test("11. txid divergente não finaliza", () => {
  assert.deepEqual(extrairTxidsWebhookC6({ txid: "curto" }), []);
  assert.deepEqual(extrairTxidsWebhookC6({ outro: TXID }), []);
  const adapter = fonte(ADAPTER);
  assert.match(adapter, /txid_nao_identificado/);
  assert.match(adapter, /cobranca_nao_encontrada/);
});

test("12. cobrança de outra empresa não é acessível", () => {
  assert.notEqual(empresaA, empresaB);
  const adapter = fonte(ADAPTER);
  assert.match(adapter, /\.eq\("id", cobrancaId\)/);
  assert.match(adapter, /\.eq\("empresa_id", empresaId\)/);
  assert.match(adapter, /txid_ambiguo/);
});

test("13. e2eid é persistido em dados_publicos", () => {
  const adapter = fonte(ADAPTER);
  assert.match(fonte("lib/pagamentos/pix/c6/confirmacao.ts"), /endToEndId \?\? primeiro\.e2eId \?\? primeiro\.e2eid/);
  assert.match(adapter, /dados_publicos: \{/);
  assert.match(adapter, /e2eid: status === "paga"/);
  assert.equal(mascararE2eid("E2E123456789XYZ"), "E2E1••••9XYZ");
});

test("14. webhook dispara consulta autoritativa", () => {
  const adapter = fonte(ADAPTER);
  assert.match(adapter, /processarWebhookPixC6/);
  assert.match(adapter, /reconciliarCobrancaC6Existente/);
  assert.match(adapter, /c6:GET \/v2\/pix\/cob\/\{txid\}/);
  assert.match(fonte(ROTA), /processarWebhookPixC6/);
});

test("15. webhook falso não marca pagamento", () => {
  const payload = {
    empresa_id: empresaB,
    status: "CONCLUIDA",
    pago: true,
    pix: [{ txid: TXID, valor: "999.00" }],
  };
  assert.equal(extrairTxidsWebhookC6(payload)[0], TXID);
  const adapter = fonte(ADAPTER);
  assert.doesNotMatch(
    adapter,
    /processarWebhookPixC6[\s\S]{0,800}status = "paga"/
  );
  assert.match(adapter, /consultarNoC6/);
});

test("16. polling + webhook não duplicam venda", () => {
  const adapter = fonte(ADAPTER);
  assert.match(adapter, /decidirStatusPagamentoC6/);
  assert.match(adapter, /idempotente: true/);
  assert.match(
    fonte("lib/pagamentos/pix/geranet-regras.ts"),
    /paga[\s\S]{0,80}vinculado_venda/
  );
  assert.match(fonte(CHECKOUT), /intervaloPollingPixGeranet/);
});

test("17. token não vai ao frontend", () => {
  const sandbox = JSON.stringify(respostaPublicaTesteC6("2"));
  const producao = JSON.stringify(respostaPublicaTesteC6("1"));
  assert.equal(sandbox.includes("access_token"), false);
  assert.equal(producao.includes("access_token"), false);
  assert.match(sandbox, new RegExp(MENSAGEM_C6_CONEXAO_OK));
  assert.match(producao, new RegExp(MENSAGEM_C6_CONEXAO_OK_PRODUCAO));
  assert.equal(mensagemTesteConexaoC6("1"), MENSAGEM_C6_CONEXAO_OK_PRODUCAO);
  assert.match(fonte(ADAPTER), /void token/);
});

test("18. secrets não aparecem em logs", () => {
  const sanitizado = JSON.stringify(
    sanitizarRespostaPix({
      access_token: "tok-secreto",
      client_secret: "segredo-c6",
      certificadoPemHexadecimal: "aabbcc",
      chavePrivadaPemHexadecimal: "ddeeff",
    })
  );
  assert.equal(sanitizado.includes("tok-secreto"), false);
  assert.equal(sanitizado.includes("segredo-c6"), false);
  assert.equal(sanitizado.includes("aabbcc"), false);
  const evento = JSON.stringify(
    eventoWebhookC6Sanitizado({
      access_token: "tok-secreto",
      txid: TXID,
    })
  );
  assert.equal(evento.includes("tok-secreto"), false);
});

test("19. produção bloqueia se credenciais incompletas", () => {
  const incompleto = flagsExistenciaCofreC6({
    clienteId: "id",
    clienteSegredo: "secret",
  });
  assert.ok(erroReadBackC6(incompleto));
  assert.match(fonte(ADAPTER), /MENSAGEM_C6_NAO_CONFIGURADO/);
  assert.match(fonte(ADAPTER), /validarPreRequisitosC6/);
  assert.match(fonte(ACTIONS), /erroReadBackC6/);
});

test("20. erro 5xx não perde cobrança", () => {
  assert.equal(
    deveConsultarTxidExistenteAposFalha({ httpStatus: 502, txid: TXID }),
    true
  );
  assert.match(fonte(ADAPTER), /consulta_indisponivel/);
  assert.match(fonte(ROTA), /503/);
  assert.doesNotMatch(fonte(CHECKOUT), /setItens\(\[\]\)/);
});

test("21. timeout consulta a mesma txid", () => {
  assert.equal(
    deveConsultarTxidExistenteAposFalha({ timeout: true, txid: TXID }),
    true
  );
  assert.match(fonte(ADAPTER), /reutilizarTxidC6AposFalha/);
  assert.match(fonte(ADAPTER), /consultarNoC6/);
});

test("22. provider Geranet continua intacto", () => {
  assert.equal(ehProvedorPixSelecionavel("efibank"), true);
  assert.equal(ehProvedorPixSelecionavel("sicredi"), true);
  assert.match(fonte(GERANET), /chamarGeranetBanking/);
  assert.match(fonte(GERANET), /ehProvedorPixC6Direto/);
  assert.doesNotMatch(fonte(GERANET), /baas-api\.c6bank\.info/);
});

test("23. PIX local continua intacto", () => {
  assert.match(fonte(LOCAL), /gerarPixEstatico|chave_pix/);
  assert.doesNotMatch(fonte(LOCAL), /processarWebhookPixC6/);
  assert.doesNotMatch(fonte(LOCAL), /baas-api/);
});

test("webhook C6 PUT/GET/DELETE fica no servidor", () => {
  const adapter = fonte(ADAPTER);
  assert.match(adapter, /PATH_C6_WEBHOOK|urlWebhookC6/);
  assert.match(adapter, /operarWebhookC6\(empresaId, "PUT"/);
  assert.match(adapter, /operarWebhookC6\(empresaId, "DELETE"/);
  assert.equal(
    urlWebhookC6("1", "minha-chave"),
    "https://baas-api.c6bank.info/v2/pix/webhook/minha-chave"
  );
  assert.match(fonte(ACTIONS), /gerenciarWebhookPixC6/);
  assert.doesNotMatch(fonte(WORKSPACE), /baas-api\.c6bank/);
});

test("URL pública do webhook exige HTTPS real", () => {
  const anterior = process.env.NEXT_PUBLIC_SITE_URL;
  try {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    assert.throws(() => urlPublicaWebhookPixC6(), /HTTPS/);
    process.env.NEXT_PUBLIC_SITE_URL = "https://app.ultrapdv.com.br";
    assert.equal(
      urlPublicaWebhookPixC6(),
      "https://app.ultrapdv.com.br/api/webhooks/pix/c6"
    );
    process.env.NEXT_PUBLIC_SITE_URL = "https://ultrapdv.app";
    assert.equal(
      urlPublicaWebhookPixC6(),
      "https://ultrapdv.app/api/webhooks/pix/c6"
    );
  } finally {
    if (anterior == null) {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    } else {
      process.env.NEXT_PUBLIC_SITE_URL = anterior;
    }
  }
});

test("PDV C6 mostra confirmação e oculta cancelamento remoto", () => {
  const checkout = fonte(CHECKOUT);
  assert.match(checkout, /Pagamento confirmado/);
  assert.match(checkout, /Aguardando pagamento/);
  assert.match(checkout, /e2eidMascarado/);
  assert.match(checkout, /ehPixC6\(state\) \? null/);
  assert.match(fonte(WORKSPACE), /cobranca\.provedor === "c6bank"/);
});

test("parser de webhook é defensivo e não inventa schema", () => {
  const txid = gerarTxidPixC6();
  assert.deepEqual(extrairTxidsWebhookC6({ pix: [{ txid }] }), [txid]);
  assert.deepEqual(extrairTxidsWebhookC6("texto"), []);
  assert.deepEqual(extrairTxidsWebhookC6({ data: { cobranca: { txid } } }), [
    txid,
  ]);
  assert.match(fonte(ADAPTER), /txid_nao_identificado/);
});
