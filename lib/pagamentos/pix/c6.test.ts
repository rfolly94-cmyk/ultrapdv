import assert from "node:assert/strict";
import { test } from "node:test";

import { empresaA, empresaB } from "@/lib/multiempresa/cenario";
import { fonte } from "@/lib/multiempresa/fonte";
import {
  montarContratoPixGeranet,
  normalizarStatusPagamentoPixGeranet,
} from "./evidencia-pagamento";
import {
  CAMPOS_PROIBIDOS_EMITIR_PDV,
  rejeitarCamposSensiveisEmitirPixPdv,
} from "./geranet-regras";
import { ehProvedorPixSelecionavel, nomeProvedorPix } from "./provedores-geranet";
import { payloadSemCredenciais, sanitizarRespostaPix } from "./sanitizar";
import { respostaPublicaTesteC6 } from "./c6/regras";
import { interpretarAuthC6, pemDeHexadecimal } from "./c6/http";
import {
  CODIGO_PROVEDOR_C6,
  MENSAGEM_C6_CONEXAO_OK,
  MENSAGEM_C6_INDISPONIVEL,
  URL_C6_PRODUCAO,
  URL_C6_SANDBOX,
  baseUrlC6,
  deveConsultarTxidExistenteAposFalha,
  ehProvedorPixC6Direto,
  mensagemErroHttpC6,
  payloadCobrancaImediataC6,
} from "./c6/regras";
import { ehTxidPixC6Valido, gerarTxidPixC6, reutilizarTxidC6AposFalha } from "./c6/txid";

const ADAPTER = "lib/pagamentos/pix/c6/adapter.ts";
const HTTP = "lib/pagamentos/pix/c6/http.ts";
const GERANET = "lib/pagamentos/pix/geranet.ts";
const PDV = "lib/pagamentos/pix/geranet-pdv.ts";
const ACTIONS = "app/configuracoes/financeiro/pix/actions.ts";
const WORKSPACE = "app/configuracoes/financeiro/pix/pix-workspace.tsx";
const CHECKOUT = "components/pdv/pix-geranet-checkout.tsx";
const VAULT = "supabase/migrations/20260816210000_pix_vault_provedor_ambiente.sql";
const RLS = "supabase/migrations/20260816200000_pix_geranet.sql";

const pem = `-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----`;

test("1. autenticação C6 é server-side e usa mTLS + client_credentials", () => {
  const http = fonte(HTTP);
  const adapter = fonte(ADAPTER);
  assert.match(http, /grant_type: "client_credentials"/);
  assert.match(http, /urlAuthC6/);
  assert.match(http, /cert: params.cert/);
  assert.match(http, /key: params.key/);
  assert.match(adapter, /testarConexaoPixC6/);
  assert.match(fonte("app/api/pagamentos/pix/geranet/testar/route.ts"), /exigirAdministradorPix/);
  assert.equal(ehProvedorPixC6Direto("c6bank"), true);

  const auth = interpretarAuthC6({
    status: 200,
    texto: '{"access_token":"tok-secreto","expires_in":600,"token_type":"Bearer"}',
    json: {
      access_token: "tok-secreto",
      expires_in: 600,
      token_type: "Bearer",
    },
  });
  assert.equal(auth.accessToken, "tok-secreto");
  assert.equal(auth.expiresIn, 600);
});

test("2. token nunca é enviado ao frontend no teste de conexão", () => {
  const publico = JSON.stringify(respostaPublicaTesteC6());
  assert.equal(publico.includes("access_token"), false);
  assert.equal(publico.includes("tok-secreto"), false);
  assert.match(publico, /Conexão com C6 Sandbox realizada com sucesso/);
  assert.match(fonte(ADAPTER), /void token/);
  assert.doesNotMatch(fonte(ADAPTER), /access_token.*jsonPix|return \{[^}]*access_token/);
});

test("3. client_secret nunca é enviado ao frontend", () => {
  const sanitizado = JSON.stringify(
    sanitizarRespostaPix({
      client_secret: "segredo-c6",
      clienteSegredo: "segredo-c6",
      access_token: "tok-secreto",
    })
  );
  assert.equal(sanitizado.includes("segredo-c6"), false);
  assert.equal(sanitizado.includes("tok-secreto"), false);
  assert.ok(
    (CAMPOS_PROIBIDOS_EMITIR_PDV as readonly string[]).includes("client_secret")
  );
  assert.ok(
    (CAMPOS_PROIBIDOS_EMITIR_PDV as readonly string[]).includes("access_token")
  );
});

test("4. geração válida de txid C6 tem 26 a 35 alfanuméricos", () => {
  const txid = gerarTxidPixC6();
  assert.equal(ehTxidPixC6Valido(txid), true);
  assert.ok(txid.length >= 26 && txid.length <= 35);
  assert.match(txid, /^[a-zA-Z0-9]+$/);
});

test("5. txid C6 é única e sem dado sensível", () => {
  const gerados = new Set(Array.from({ length: 200 }, () => gerarTxidPixC6()));
  assert.equal(gerados.size, 200);
  const gerador = fonte("lib/pagamentos/pix/c6/txid.ts");
  assert.doesNotMatch(gerador, /cnpj|cpf|email|telefone|nome/i);
  assert.match(gerador, /randomUUID/);
});

test("6. cobrança imediata usa PUT /v2/pix/cob/{txid} no ambiente da empresa", () => {
  const adapter = fonte(ADAPTER);
  assert.match(adapter, /method: "PUT"/);
  assert.match(adapter, /c6:PUT \/v2\/pix\/cob\/\{txid\}/);
  assert.equal(baseUrlC6("2"), URL_C6_SANDBOX);
  assert.equal(baseUrlC6("1"), URL_C6_PRODUCAO);
  const payload = payloadCobrancaImediataC6({
    valor: 1,
    chavePix: "chave-empresa",
    solicitacaoPagador: "UltraPDV",
  });
  assert.deepEqual((payload.valor as { original: string }).original, "1.00");
});

test("7. pixCopiaECola é persistido a partir da resposta C6", () => {
  const adapter = fonte(ADAPTER);
  assert.match(adapter, /pixCopiaECola: contrato.pixCopiaECola/);
  const contrato = montarContratoPixGeranet({
    pixCopiaECola: "00020126copia",
    txid: "a".repeat(32),
    status: "ATIVA",
    location: "https://baas-api-sandbox.c6bank.info/pix/v2/loc/1",
  });
  assert.equal(contrato.pixCopiaECola, "00020126copia");
});

test("8. location é salva, mas o QR sai de pixCopiaECola", () => {
  const adapter = fonte(ADAPTER);
  assert.match(adapter, /location: json.location/);
  assert.match(adapter, /qrDeCopiaECola\(contratoBase.pixCopiaECola\)/);
  assert.match(adapter, /renderizarQrBrCode/);
  assert.doesNotMatch(adapter, /renderizarQrBrCode\(.*location/);
});

test("9. consultar cobrança usa GET \/v2\/pix\/cob\/{txid}", () => {
  assert.match(fonte(ADAPTER), /method: "GET"/);
  assert.match(fonte(ADAPTER), /c6:GET \/v2\/pix\/cob\/\{txid\}/);
  assert.match(fonte(GERANET), /consultarCobrancaPixC6/);
});

test("10. cobrança ATIVA não finaliza venda", () => {
  const evidencia = normalizarStatusPagamentoPixGeranet({
    httpStatus: 200,
    resposta: { status: "ATIVA", pixCopiaECola: "000201" },
  });
  assert.equal(evidencia.estado, "pendente");
  assert.notEqual(evidencia.estado, "pago");
  assert.match(fonte(ADAPTER), /decidirStatusPagamentoC6/);
  assert.match(
    fonte("lib/pagamentos/pix/geranet-regras.ts"),
    /status !== "paga"/
  );
});

test("11. cobrança CONCLUIDA pode avançar o pagamento", () => {
  const evidencia = normalizarStatusPagamentoPixGeranet({
    httpStatus: 200,
    resposta: {
      status: "CONCLUIDA",
      valor: { original: "10.00" },
      pix: [{ valor: "10.00", horario: "2026-09-11T12:00:00.000Z" }],
    },
  });
  assert.equal(evidencia.estado, "pago");
});

test("12. timeout não gera cobrança duplicada; reutiliza txid", () => {
  const txid = "a".repeat(32);
  assert.equal(reutilizarTxidC6AposFalha(txid), txid);
  assert.equal(
    deveConsultarTxidExistenteAposFalha({
      timeout: true,
      txid,
    }),
    true
  );
  const adapter = fonte(ADAPTER);
  assert.match(adapter, /txid: params.txid/);
  assert.match(adapter, /deveConsultarTxidExistenteAposFalha/);
  assert.match(adapter, /consultarNoC6/);
  assert.doesNotMatch(adapter, /gerarTxidPixC6\(\).*PUT/);
});

test("13. erro 502 não perde a venda e usa mensagem amigável", () => {
  assert.equal(mensagemErroHttpC6(502), MENSAGEM_C6_INDISPONIVEL);
  assert.throws(
    () =>
      interpretarAuthC6({
        status: 502,
        texto: "Bad Gateway",
        json: null,
      }),
    /temporariamente indisponível/
  );
  assert.doesNotMatch(fonte(CHECKOUT), /setItens\(\[\]\)/);
  assert.doesNotMatch(fonte("components/pdv/pdv-shell.tsx"), /pixGeranet.*itens = \[\]/);
});

test("14. empresa A não acessa credenciais B", () => {
  const vault = fonte(VAULT);
  assert.match(vault, /pix\/' \|\| p_empresa_id::text/);
  assert.match(fonte("lib/pagamentos/pix/contexto.ts"), /buscarVinculoEmpresaAtiva/);
  assert.match(fonte("lib/pagamentos/pix/contexto.ts"), /p_empresa_id: params.empresaId/);
  assert.notEqual(empresaA, empresaB);
});

test("15. empresa A não consulta cobrança B", () => {
  const adapter = fonte(ADAPTER);
  assert.match(adapter, /\.eq\("id", cobrancaId\)/);
  assert.match(adapter, /\.eq\("empresa_id", empresaId\)/);
  assert.match(adapter, /Recurso não encontrado/);
});

test("16. request adulterado com empresa_id é rejeitado", () => {
  assert.throws(
    () => rejeitarCamposSensiveisEmitirPixPdv({ empresa_id: empresaB }),
    /não pode escolher empresa/
  );
  assert.ok(CAMPOS_PROIBIDOS_EMITIR_PDV.includes("empresa_id"));
  assert.match(fonte(PDV), /rejeitarCamposSensiveisEmitirPixPdv/);
});

test("17. RLS impede acesso cruzado em integracoes_pix e cobrancas_pix", () => {
  const sql = fonte(RLS);
  assert.match(sql, /tem_acesso_empresa\(empresa_id\)/);
  assert.match(sql, /POLICY cobrancas_pix_select_empresa/);
  assert.match(sql, /POLICY integracoes_pix_select_empresa/);
});

test("18. provider PIX anterior continua funcionando", () => {
  assert.equal(ehProvedorPixSelecionavel("efibank"), true);
  assert.equal(ehProvedorPixSelecionavel("sicredi"), true);
  assert.equal(nomeProvedorPix("efibank"), "Efí Bank");
  assert.match(fonte(GERANET), /chamarGeranetBanking/);
  assert.match(fonte(PDV), /\/api\/v1\/pix\/emitir/);
  assert.match(fonte(PDV), /ehProvedorPixC6Direto/);
});

test("19. carrinho permanece intacto quando C6 falha", () => {
  const checkout = fonte(CHECKOUT);
  assert.match(checkout, /onErro\(/);
  assert.doesNotMatch(checkout, /onState\(null\).*erro/);
  assert.match(fonte(ADAPTER), /Nenhuma venda foi perdida|MENSAGEM_C6_INDISPONIVEL|ErroPixGeranet/);
});

test("20. nenhuma credencial sensível aparece em logs", () => {
  const adapter = fonte(ADAPTER);
  assert.match(adapter, /sanitizarRespostaPix/);
  assert.match(adapter, /registrarLog/);
  assert.doesNotMatch(fonte(ADAPTER), /registrarLog\([\s\S]{0,400}clientSecret/);
  const sanitizado = JSON.stringify(
    sanitizarRespostaPix({
      Authorization: "Bearer tok-secreto",
      certificadoPemHexadecimal: "aabbcc",
      chavePrivadaPemHexadecimal: "ddeeff",
      client_secret: "segredo-c6",
    })
  );
  assert.equal(sanitizado.includes("tok-secreto"), false);
  assert.equal(sanitizado.includes("segredo-c6"), false);
  assert.equal(sanitizado.includes("aabbcc"), false);
});

test("C6 produção usa host próprio e não mistura sandbox", () => {
  assert.equal(URL_C6_PRODUCAO, "https://baas-api.c6bank.info");
  assert.equal(URL_C6_SANDBOX, "https://baas-api-sandbox.c6bank.info");
  assert.equal(baseUrlC6("1"), URL_C6_PRODUCAO);
  assert.equal(baseUrlC6("2"), URL_C6_SANDBOX);
  assert.doesNotMatch(fonte(ACTIONS), /MENSAGEM_C6_PRODUCAO_BLOQUEADA/);
  assert.doesNotMatch(fonte(WORKSPACE), /Produção \(indisponível nesta fase\)/);
  assert.match(fonte(WORKSPACE), /Testar conexão de produção/);
});

test("C6 não envia cobrança pela Geranet", () => {
  const adapter = fonte(ADAPTER);
  assert.doesNotMatch(adapter, /chamarGeranetBanking/);
  assert.doesNotMatch(adapter, /carregarApiKeyGeranet/);
  assert.match(fonte(GERANET), /ehProvedorPixC6Direto/);
  assert.match(fonte("lib/pagamentos/pix/c6/regras.ts"), /baas-api-sandbox\.c6bank\.info/);
  assert.match(fonte(HTTP), /urlAuthC6/);
  assert.match(fonte(HTTP), /urlCobC6/);
});

test("PEM do cofre é reconstruído no servidor", () => {
  const hex = Buffer.from(pem, "utf8").toString("hex");
  assert.equal(pemDeHexadecimal(hex, "Certificado C6"), pem);
  assert.throws(() => pemDeHexadecimal("abcd", "Certificado C6"), /PEM/);
});

test("payload de cobrança C6 não inclui credenciais", () => {
  const payload = payloadCobrancaImediataC6({
    valor: 25,
    chavePix: "minha-chave",
    solicitacaoPagador: "UltraPDV",
    devedor: { nome: "Cliente", cpfCnpj: "12345678000190" },
  });
  const publico = JSON.stringify(payloadSemCredenciais(payload));
  assert.equal(publico.includes("clienteSegredo"), false);
  assert.equal((payload.devedor as { cnpj: string }).cnpj, "12345678000190");
});
