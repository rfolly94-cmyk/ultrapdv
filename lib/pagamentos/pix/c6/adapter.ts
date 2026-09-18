import "server-only";

import { validarParcelaPixContraSaldo } from "@/lib/pdv/pagamentos-teto";
import { createAdminClient } from "@/lib/supabase/admin";
import { renderizarQrBrCode } from "../brcode/qr";
import {
  carregarIntegracaoPix,
  ErroPixGeranet,
  montarCredenciaisGeranetPix,
  resolverEmpresaPix,
} from "../contexto";
import {
  montarContratoPixGeranet,
  normalizarStatusPagamentoPixGeranet,
} from "../evidencia-pagamento";
import { linhaPublicaCobrancaPix } from "../cobranca-publica";
import {
  checkoutKeyPixValida,
  decidirReusoCobrancaCheckout,
  MENSAGEM_PIX_GERANET_PAGO_NAO_ALTERA,
  rejeitarCamposSensiveisEmitirPixPdv,
} from "../geranet-regras";
import { exigirPixGeranetAtivo } from "../modo-ativo-servidor";
import { sanitizarRespostaPix } from "../sanitizar";
import { podeCancelarLocalmente } from "../status";
import type { AmbientePixGeranet, DevedorPix, StatusCobrancaPix } from "../types";
import {
  autenticarC6,
  lancarSeRespostaC6Falhou,
  pemDeHexadecimal,
  requisicaoC6Autenticada,
  type C6Http,
  type C6RespostaHttp,
} from "./http";
import {
  CODIGO_PROVEDOR_C6,
  EXPIRACAO_COBRANCA_C6_SEGUNDOS,
  MENSAGEM_C6_AGUARDANDO,
  MENSAGEM_C6_INDISPONIVEL,
  MENSAGEM_C6_NAO_CONFIGURADO,
  deveConsultarTxidExistenteAposFalha,
  ehProvedorPixC6Direto,
  mensagemTesteConexaoC6,
  payloadCobrancaImediataC6,
  rotuloAmbienteC6,
  urlWebhookC6,
} from "./regras";
import { gerarTxidPixC6, reutilizarTxidC6AposFalha } from "./txid";
import {
  decidirStatusPagamentoC6,
  e2eidConflitaComOutraCobranca,
  e2eidDaCobrancaC6,
  e2eidDeRespostaC6,
  ehE2eidPixC6Valido,
  pixRecebidoC6,
  valorPagoDeRespostaC6,
} from "./confirmacao";
import {
  empresaIdExternaWebhookC6,
  eventoWebhookC6Sanitizado,
  extrairTxidsWebhookC6,
  mascararE2eid,
  urlPublicaWebhookPixC6,
} from "./webhook";

function agoraIso() {
  return new Date().toISOString();
}

function decimalPix(valor: number) {
  return Math.round(valor * 100) / 100;
}

function erroAmigavel(error: unknown): never {
  if (error instanceof ErroPixGeranet) {
    throw error;
  }

  throw new ErroPixGeranet(
    error instanceof Error ? error.message : MENSAGEM_C6_NAO_CONFIGURADO,
    422
  );
}

async function registrarLog(params: {
  empresaId: string;
  cobrancaId?: string | null;
  endpoint: string;
  provedor?: string | null;
  httpStatus?: number | null;
  situacao?: string | null;
  mensagem?: string | null;
}) {
  const admin = createAdminClient();
  const sanitizado = sanitizarRespostaPix({
    mensagem: params.mensagem,
    situacao: params.situacao,
  }) as { mensagem?: unknown; situacao?: unknown };

  await admin.from("pix_operacoes_log").insert({
    empresa_id: params.empresaId,
    cobranca_id: params.cobrancaId ?? null,
    endpoint: params.endpoint,
    provedor: params.provedor ?? CODIGO_PROVEDOR_C6,
    http_status: params.httpStatus ?? null,
    situacao: sanitizado.situacao ? String(sanitizado.situacao) : params.situacao ?? null,
    mensagem: sanitizado.mensagem ? String(sanitizado.mensagem) : null,
  });
}

async function e2eidUsadoPorOutraCobrancaC6(params: {
  empresaId: string;
  cobrancaId: string;
  e2eid: string;
}) {
  if (!ehE2eidPixC6Valido(params.e2eid)) {
    return false;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cobrancas_pix")
    .select("id, e2eid")
    .eq("empresa_id", params.empresaId)
    .eq("e2eid", params.e2eid)
    .neq("id", params.cobrancaId)
    .limit(5);

  if (error) {
    throw new ErroPixGeranet(error.message, 500);
  }

  return e2eidConflitaComOutraCobranca({
    e2eid: params.e2eid,
    cobrancaIdAtual: params.cobrancaId,
    outras: (data ?? []) as Array<{ id?: unknown; e2eid?: unknown }>,
  });
}

async function qrDeCopiaECola(pixCopiaECola: string | null) {
  const payload = String(pixCopiaECola ?? "").trim();
  if (!payload) {
    return null;
  }

  try {
    return await renderizarQrBrCode(payload);
  } catch {
    return null;
  }
}

async function carregarCobrancaDaEmpresa(empresaId: string, cobrancaId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cobrancas_pix")
    .select("*")
    .eq("id", cobrancaId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (error) {
    throw new ErroPixGeranet(error.message, 500);
  }

  if (!data) {
    throw new ErroPixGeranet("Recurso não encontrado.", 404);
  }

  return data as Record<string, unknown>;
}

async function buscarCobrancaCheckout(empresaId: string, checkoutKey: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cobrancas_pix")
    .select("*")
    .eq("empresa_id", empresaId)
    .eq("checkout_key", checkoutKey)
    .is("venda_id", null)
    .in("status", ["pendente", "paga", "divergencia_valor", "erro"])
    .maybeSingle();

  if (error) {
    throw new ErroPixGeranet(error.message, 500);
  }

  return (data as Record<string, unknown> | null) ?? null;
}

async function liberarCheckoutKey(empresaId: string, cobrancaId: string) {
  const admin = createAdminClient();
  await admin
    .from("cobrancas_pix")
    .update({
      checkout_key: null,
      updated_at: agoraIso(),
    })
    .eq("id", cobrancaId)
    .eq("empresa_id", empresaId);
}

async function credenciaisMtlsC6(params: {
  empresaId: string;
  ambiente: AmbientePixGeranet;
}) {
  const credenciais = await montarCredenciaisGeranetPix({
    empresaId: params.empresaId,
    provedor: CODIGO_PROVEDOR_C6,
    ambiente: params.ambiente,
    chavePixPublica: null,
  });

  const clientId = String(credenciais.clienteId ?? "").trim();
  const clientSecret = String(credenciais.clienteSegredo ?? "").trim();
  const chavePix = String(credenciais.chavePix ?? "").trim();
  const cert = pemDeHexadecimal(
    String(credenciais.certificadoPemHexadecimal ?? ""),
    "Certificado C6"
  );
  const key = pemDeHexadecimal(
    String(credenciais.chavePrivadaPemHexadecimal ?? ""),
    "Chave privada C6"
  );

  if (!clientId || !clientSecret || !chavePix) {
    throw new ErroPixGeranet(MENSAGEM_C6_NAO_CONFIGURADO);
  }

  return { clientId, clientSecret, chavePix, cert, key };
}

async function validarPreRequisitosC6(empresaId: string) {
  await exigirPixGeranetAtivo(empresaId);
  const integracao = await carregarIntegracaoPix(empresaId);

  if (
    !integracao ||
    !integracao.ativo ||
    integracao.modo !== "geranet" ||
    !ehProvedorPixC6Direto(integracao.provedor)
  ) {
    throw new ErroPixGeranet(MENSAGEM_C6_NAO_CONFIGURADO);
  }

  const mtls = await credenciaisMtlsC6({
    empresaId,
    ambiente: integracao.ambiente as AmbientePixGeranet,
  });

  return { integracao: { ...integracao, provedor: CODIGO_PROVEDOR_C6 }, ...mtls };
}

async function carregarDevedorOpcional(params: {
  empresaId: string;
  clienteId?: string | null;
}): Promise<DevedorPix | undefined> {
  if (!params.clienteId) {
    return undefined;
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("clientes")
    .select("nome, cpf_cnpj, empresa_id")
    .eq("id", params.clienteId)
    .eq("empresa_id", params.empresaId)
    .maybeSingle();

  if (!data) {
    return undefined;
  }

  const cpfCnpj = String(data.cpf_cnpj ?? "").replace(/\D/g, "");
  const nome = String(data.nome ?? "").trim();

  if (!nome && cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
    return undefined;
  }

  return {
    ...(nome ? { nome } : {}),
    ...(cpfCnpj.length === 11 || cpfCnpj.length === 14 ? { cpfCnpj } : {}),
  };
}

async function persistirRespostaC6(params: {
  empresaId: string;
  cobrancaId: string;
  checkoutKey?: string | null;
  cobranca: Record<string, unknown>;
  resposta: C6RespostaHttp;
  endpoint: string;
  payloadEnviado?: Record<string, unknown>;
}) {
  const json = params.resposta.json ?? {};
  const contratoBase = montarContratoPixGeranet(json);
  const qrCode = await qrDeCopiaECola(contratoBase.pixCopiaECola);
  const contrato = {
    ...contratoBase,
    qrCode: qrCode ?? contratoBase.qrCode,
  };
  const evidencia = normalizarStatusPagamentoPixGeranet({
    provedor: CODIGO_PROVEDOR_C6,
    httpStatus: params.resposta.status,
    situacaoGeranet: String(json.status ?? ""),
    resposta: json,
  });
  const statusAtual = String(params.cobranca.status ?? "pendente") as StatusCobrancaPix;
  const e2eidExtraido = e2eidDeRespostaC6(json);
  const e2eidValido = ehE2eidPixC6Valido(e2eidExtraido)
    ? String(e2eidExtraido)
    : null;
  const valorPago = valorPagoDeRespostaC6(json);
  const e2eidDuplicado = e2eidValido
    ? await e2eidUsadoPorOutraCobrancaC6({
        empresaId: params.empresaId,
        cobrancaId: params.cobrancaId,
        e2eid: e2eidValido,
      })
    : false;
  const decisao = decidirStatusPagamentoC6({
    statusAtual,
    estado: evidencia.estado,
    valorCobranca: Number(params.cobranca.valor),
    valorPago,
    e2eid: e2eidValido,
    pixPresente: Boolean(pixRecebidoC6(json)),
    e2eidDuplicado,
  });
  const status = decisao.status;
  if (decisao.motivo === "e2eid_duplicado") {
    await registrarLog({
      empresaId: params.empresaId,
      cobrancaId: params.cobrancaId,
      endpoint: params.endpoint,
      provedor: CODIGO_PROVEDOR_C6,
      httpStatus: params.resposta.status,
      situacao: "e2eid_duplicado",
      mensagem: `txid=${contrato.txid || params.cobranca.txid};e2eid_duplicado`,
    });
  }
  const respostaSanitizada = sanitizarRespostaPix(json);
  const e2eidPersistido =
    status === "paga" && e2eidValido
      ? e2eidValido
      : e2eidDaCobrancaC6(params.cobranca);
  const admin = createAdminClient();
  const patch = {
    txid: contrato.txid || params.cobranca.txid,
    status,
    e2eid: status === "paga" ? e2eidPersistido : params.cobranca.e2eid ?? null,
    geranet_http_status: params.resposta.status,
    geranet_situacao: String(json.status ?? "") || null,
    geranet_mensagem: MENSAGEM_C6_AGUARDANDO,
    valor_pago:
      valorPago ??
      (params.cobranca.valor_pago == null ? null : Number(params.cobranca.valor_pago)),
    pago_em:
      status === "paga"
        ? String(params.cobranca.pago_em ?? evidencia.pagoEm ?? agoraIso())
        : params.cobranca.pago_em ?? null,
    cancelado_em:
      status === "cancelada"
        ? String(params.cobranca.cancelado_em ?? agoraIso())
        : params.cobranca.cancelado_em,
    dados_publicos: {
      ...((params.cobranca.dados_publicos as Record<string, unknown>) ?? {}),
      checkout_key: params.checkoutKey,
      modo: "geranet",
      provedor: CODIGO_PROVEDOR_C6,
      contrato,
      evidencia,
      resposta: respostaSanitizada,
      status_bruto: json.status ?? null,
      location: json.location ?? contrato.identificador,
      pixCopiaECola: contrato.pixCopiaECola,
      e2eid:
        status === "paga"
          ? e2eidPersistido
          : ((params.cobranca.dados_publicos as Record<string, unknown> | undefined)
              ?.e2eid ?? null),
      payload_enviado: params.payloadEnviado
        ? sanitizarRespostaPix(params.payloadEnviado)
        : undefined,
    },
    updated_at: agoraIso(),
  };

  const atualizacao =
    statusAtual === "paga" || statusAtual === "vinculado_venda"
      ? admin
          .from("cobrancas_pix")
          .update(patch)
          .eq("id", params.cobrancaId)
          .eq("empresa_id", params.empresaId)
      : admin
          .from("cobrancas_pix")
          .update(patch)
          .eq("id", params.cobrancaId)
          .eq("empresa_id", params.empresaId)
          .neq("status", "paga")
          .neq("status", "vinculado_venda");

  const { data: atualizada, error } = await atualizacao.select("*").maybeSingle();
  if (error) {
    if (error.code === "23505") {
      await registrarLog({
        empresaId: params.empresaId,
        cobrancaId: params.cobrancaId,
        endpoint: params.endpoint,
        provedor: CODIGO_PROVEDOR_C6,
        httpStatus: params.resposta.status,
        situacao: "e2eid_duplicado",
        mensagem: `txid=${contrato.txid || params.cobranca.txid};unique_e2eid`,
      });
      return {
        cobranca: params.cobranca,
        contrato,
        evidencia,
        respostaSanitizada,
      };
    }
    throw new ErroPixGeranet(error.message, 500);
  }

  await registrarLog({
    empresaId: params.empresaId,
    cobrancaId: params.cobrancaId,
    endpoint: params.endpoint,
    provedor: CODIGO_PROVEDOR_C6,
    httpStatus: params.resposta.status,
    situacao: String(json.status ?? "") || null,
    mensagem: `txid=${contrato.txid || params.cobranca.txid};estado=${evidencia.estado};evidencia=${evidencia.evidencia};decisao=${decisao.motivo}`,
  });

  return {
    cobranca: (atualizada ?? { ...params.cobranca, ...patch }) as Record<string, unknown>,
    contrato,
    evidencia,
    respostaSanitizada,
  };
}

function respostaPdv(params: {
  cobranca: Record<string, unknown>;
  contrato?: ReturnType<typeof montarContratoPixGeranet> | null;
  evidencia?: ReturnType<typeof normalizarStatusPagamentoPixGeranet> | null;
  respostaSanitizada?: unknown;
}) {
  const publica = linhaPublicaCobrancaPix(params.cobranca);
  const dados = (publica.dados_publicos ?? {}) as Record<string, unknown>;
  const contrato =
    params.contrato ??
    (dados.contrato as ReturnType<typeof montarContratoPixGeranet> | undefined);
  const evidencia =
    params.evidencia ??
    (dados.evidencia as
      | ReturnType<typeof normalizarStatusPagamentoPixGeranet>
      | undefined);

  return {
    cobranca_id: publica.id,
    txid: publica.txid,
    valor: publica.valor,
    status: publica.status,
    pixCopiaECola: contrato?.pixCopiaECola ?? dados.pixCopiaECola ?? null,
    qrCode: contrato?.qrCode ?? null,
    location: dados.location ?? null,
    provedor: publica.provedor,
    provedor_nome: "C6 Bank",
    expira_em: publica.expira_em,
    pago_em: publica.pago_em,
    estado: evidencia?.estado ?? "pendente",
    evidencia: evidencia?.evidencia ?? "emissao_pendente",
    valor_pago: publica.valor_pago ?? null,
    e2eid_mascarado: mascararE2eid(dados.e2eid),
    resposta: params.respostaSanitizada ?? dados.resposta ?? null,
    cobranca: publica,
  };
}

export async function testarConexaoPixC6(
  empresaId: string,
  http?: C6Http
) {
  const pre = await validarPreRequisitosC6(empresaId);
  const token = await autenticarC6({
    empresaId,
    ambiente: pre.integracao.ambiente,
    clientId: pre.clientId,
    clientSecret: pre.clientSecret,
    cert: pre.cert,
    key: pre.key,
    http,
  });

  void token;

  const ambiente = String(pre.integracao.ambiente);
  await registrarLog({
    empresaId,
    endpoint: "c6:POST /v1/auth/",
    provedor: CODIGO_PROVEDOR_C6,
    httpStatus: 200,
    situacao: "sucesso",
    mensagem: `teste_conexao;${rotuloAmbienteC6(ambiente)};sem_cobranca`,
  });

  return {
    ok: true,
    resultado: "sucesso" as const,
    mensagem: mensagemTesteConexaoC6(ambiente),
    provedor: CODIGO_PROVEDOR_C6,
    ambiente,
    httpStatus: 200,
    credenciaisConfiguradas: true,
    cobrancaEmitida: false,
    metodoTeste: "c6_oauth_client_credentials",
    provedorAutenticado: true,
    limitacao: null as string | null,
    respostaSanitizada: {
      autenticado: true,
      ambiente: rotuloAmbienteC6(ambiente),
    },
    payloadEnviado: { grant_type: "client_credentials" },
  };
}

async function consultarNoC6(params: {
  empresaId: string;
  cobranca: Record<string, unknown>;
  mtls: Awaited<ReturnType<typeof credenciaisMtlsC6>>;
  ambiente: string;
  http?: C6Http;
}) {
  const txid = reutilizarTxidC6AposFalha(String(params.cobranca.txid ?? ""));
  const resposta = await requisicaoC6Autenticada({
    ...params.mtls,
    empresaId: params.empresaId,
    ambiente: params.ambiente,
    method: "GET",
    txid,
    http: params.http,
  });

  if (
    deveConsultarTxidExistenteAposFalha({
      httpStatus: resposta.status,
      timeout: resposta.timeout,
      rede: resposta.rede,
      txid,
    }) &&
    (resposta.timeout || resposta.rede || resposta.status >= 500)
  ) {
    throw new ErroPixGeranet(MENSAGEM_C6_INDISPONIVEL, 503);
  }

  lancarSeRespostaC6Falhou(resposta, "consulta");

  return persistirRespostaC6({
    empresaId: params.empresaId,
    cobrancaId: String(params.cobranca.id),
    checkoutKey: params.cobranca.checkout_key
      ? String(params.cobranca.checkout_key)
      : null,
    cobranca: params.cobranca,
    resposta,
    endpoint: "c6:GET /v2/pix/cob/{txid}",
  });
}

export async function consultarCobrancaPixC6(params: {
  empresaId: string;
  cobrancaId: string;
  http?: C6Http;
}) {
  await exigirPixGeranetAtivo(params.empresaId);
  const cobranca = await carregarCobrancaDaEmpresa(
    params.empresaId,
    params.cobrancaId
  );

  if (!ehProvedorPixC6Direto(String(cobranca.provedor))) {
    throw new ErroPixGeranet("Esta cobrança não é PIX C6.", 422);
  }

  const persistido = await reconciliarCobrancaC6Existente({
    cobranca,
    http: params.http,
  });
  const publica = linhaPublicaCobrancaPix(persistido.cobranca);
  const dados = (publica.dados_publicos ?? {}) as Record<string, unknown>;

  return {
    cobranca: publica,
    respostaSanitizada: persistido.respostaSanitizada,
    txid: persistido.contrato.txid,
    evidencia: persistido.evidencia,
    contrato: persistido.contrato,
    estado: persistido.evidencia.estado,
    valor_pago: publica.valor_pago,
    pago_em: publica.pago_em,
    e2eid_mascarado: mascararE2eid(dados.e2eid),
  };
}

export async function cancelarCobrancaPixC6(params: {
  empresaId: string;
  cobrancaId: string;
  http?: C6Http;
}) {
  await exigirPixGeranetAtivo(params.empresaId);
  const cobranca = await carregarCobrancaDaEmpresa(
    params.empresaId,
    params.cobrancaId
  );
  const statusAtual = cobranca.status as StatusCobrancaPix;

  if (statusAtual === "paga") {
    throw new ErroPixGeranet(
      "PIX já pago não pode ser cancelado por esta operação."
    );
  }

  if (!podeCancelarLocalmente(statusAtual)) {
    throw new ErroPixGeranet("Somente cobrança pendente pode ser cancelada.");
  }

  const txid = String(cobranca.txid ?? "").trim();
  if (!txid) {
    throw new ErroPixGeranet("Cobrança sem TXID não pode ser cancelada no C6.");
  }

  const integracao = await carregarIntegracaoPix(params.empresaId);
  if (!integracao) {
    throw new ErroPixGeranet(MENSAGEM_C6_NAO_CONFIGURADO);
  }

  const ambiente = String(cobranca.ambiente ?? "").trim();
  if (!ambiente) {
    throw new ErroPixGeranet("Cobrança C6 sem ambiente.", 422);
  }

  const mtls = await credenciaisMtlsC6({
    empresaId: params.empresaId,
    ambiente: ambiente as AmbientePixGeranet,
  });

  const resposta = await requisicaoC6Autenticada({
    ...mtls,
    empresaId: params.empresaId,
    ambiente,
    method: "PATCH",
    txid,
    json: { status: "REMOVIDA_PELO_USUARIO_RECEBEDOR" },
    http: params.http,
  });

  if (resposta.status === 200 || resposta.status === 202) {
    const persistido = await persistirRespostaC6({
      empresaId: params.empresaId,
      cobrancaId: params.cobrancaId,
      checkoutKey: cobranca.checkout_key ? String(cobranca.checkout_key) : null,
      cobranca,
      resposta,
      endpoint: "c6:PATCH /v2/pix/cob/{txid}",
    });

    return {
      cobranca: linhaPublicaCobrancaPix(persistido.cobranca),
      respostaSanitizada: persistido.respostaSanitizada,
      txid,
    };
  }

  if (deveConsultarTxidExistenteAposFalha({
    httpStatus: resposta.status,
    timeout: resposta.timeout,
    rede: resposta.rede,
    txid,
  })) {
    const consultada = await consultarCobrancaPixC6(params);
    return {
      cobranca: consultada.cobranca,
      respostaSanitizada: consultada.respostaSanitizada,
      txid,
    };
  }

  lancarSeRespostaC6Falhou(resposta, "cancelar");
  throw new ErroPixGeranet("Não foi possível cancelar a cobrança PIX C6.");
}

async function criarCobrancaC6NoBanco(params: {
  empresaId: string;
  integracaoId: string;
  valor: number;
  checkoutKey?: string | null;
  txid: string;
  solicitacao: string;
  ambiente: string;
}) {
  const admin = createAdminClient();
  const insercao = await admin
    .from("cobrancas_pix")
    .insert({
      empresa_id: params.empresaId,
      integracao_pix_id: params.integracaoId,
      venda_id: null,
      txid: params.txid,
      valor: params.valor,
      status: "pendente",
      modo_pix: "geranet",
      provedor: CODIGO_PROVEDOR_C6,
      ambiente: params.ambiente,
      checkout_key: params.checkoutKey,
      expira_em: new Date(
        Date.now() + EXPIRACAO_COBRANCA_C6_SEGUNDOS * 1000
      ).toISOString(),
      dados_publicos: {
        checkout_key: params.checkoutKey,
        modo: "geranet",
        provedor: CODIGO_PROVEDOR_C6,
        ambiente: params.ambiente,
        solicitacaoPagador: params.solicitacao,
      },
    })
    .select("*")
    .single();

  if (insercao.error || !insercao.data) {
    if (insercao.error?.code === "23505" && params.checkoutKey) {
      const concorrente = await buscarCobrancaCheckout(
        params.empresaId,
        params.checkoutKey
      );
      if (concorrente) {
        return concorrente;
      }
    }

    throw new ErroPixGeranet(
      insercao.error?.message ?? "Não foi possível persistir a cobrança PIX C6.",
      500
    );
  }

  return insercao.data as Record<string, unknown>;
}

async function emitirNoC6(params: {
  empresaId: string;
  cobranca: Record<string, unknown>;
  valor: number;
  chavePix: string;
  mtls: Awaited<ReturnType<typeof credenciaisMtlsC6>>;
  ambiente: string;
  solicitacaoPagador: string;
  devedor?: DevedorPix;
  http?: C6Http;
}) {
  const txid = reutilizarTxidC6AposFalha(String(params.cobranca.txid ?? ""));
  const payload = payloadCobrancaImediataC6({
    valor: params.valor,
    chavePix: params.chavePix,
    solicitacaoPagador: params.solicitacaoPagador,
    devedor: params.devedor,
  });

  const resposta = await requisicaoC6Autenticada({
    ...params.mtls,
    empresaId: params.empresaId,
    ambiente: params.ambiente,
    method: "PUT",
    txid,
    json: payload,
    http: params.http,
  });

  if (
    deveConsultarTxidExistenteAposFalha({
      httpStatus: resposta.status,
      timeout: resposta.timeout,
      rede: resposta.rede,
      txid,
    })
  ) {
    try {
      return await consultarNoC6({
        empresaId: params.empresaId,
        cobranca: params.cobranca,
        mtls: params.mtls,
        ambiente: params.ambiente,
        http: params.http,
      });
    } catch (error) {
      if (error instanceof ErroPixGeranet) {
        throw error;
      }
      throw new ErroPixGeranet(MENSAGEM_C6_INDISPONIVEL, 503);
    }
  }

  lancarSeRespostaC6Falhou(resposta, "cob");

  return persistirRespostaC6({
    empresaId: params.empresaId,
    cobrancaId: String(params.cobranca.id),
    checkoutKey: params.cobranca.checkout_key
      ? String(params.cobranca.checkout_key)
      : null,
    cobranca: params.cobranca,
    resposta,
    endpoint: "c6:PUT /v2/pix/cob/{txid}",
    payloadEnviado: payload,
  });
}

export async function emitirCobrancaPixC6Pdv(input: {
  valor: number;
  checkoutKey: string;
  clienteId?: string | null;
  saldoRestanteCentavos?: number;
  body?: Record<string, unknown>;
  http?: C6Http;
}) {
  if (input.body) {
    try {
      rejeitarCamposSensiveisEmitirPixPdv(input.body);
    } catch (error) {
      erroAmigavel(error);
    }
  }

  const valor = decimalPix(Number(input.valor));
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new ErroPixGeranet("Informe um valor PIX maior que zero.");
  }

  try {
    validarParcelaPixContraSaldo({
      valorPixCentavos: Math.round(valor * 100),
      saldoRestanteCentavos: Number(input.saldoRestanteCentavos),
    });
  } catch (error) {
    erroAmigavel(error);
  }

  if (!checkoutKeyPixValida(input.checkoutKey)) {
    throw new ErroPixGeranet("checkout_key inválida.");
  }

  const { empresaId } = await resolverEmpresaPix();

  let pre;
  try {
    pre = await validarPreRequisitosC6(empresaId);
  } catch (error) {
    if (error instanceof ErroPixGeranet) {
      const especifica =
        /certificado|Chave PIX|Client|chave privada|mTLS/i.test(error.message);
      throw new ErroPixGeranet(
        especifica ? error.message : MENSAGEM_C6_NAO_CONFIGURADO,
        error.status
      );
    }
    throw new ErroPixGeranet(MENSAGEM_C6_NAO_CONFIGURADO);
  }

  const existente = await buscarCobrancaCheckout(empresaId, input.checkoutKey);
  const decisao = decidirReusoCobrancaCheckout({
    existente: existente
      ? {
          status: String(existente.status),
          valor: Number(existente.valor),
          venda_id: existente.venda_id ? String(existente.venda_id) : null,
        }
      : null,
    valorNovo: valor,
  });

  if (decisao === "bloquear_pago" || decisao === "erro_vinculada") {
    throw new ErroPixGeranet(MENSAGEM_PIX_GERANET_PAGO_NAO_ALTERA);
  }

  if (decisao === "reutilizar" && existente) {
    if (String(existente.txid ?? "").trim()) {
      try {
        const consultada = await reconciliarCobrancaC6Existente({
          cobranca: existente,
          http: input.http,
        });
        return respostaPdv(consultada);
      } catch {
        return respostaPdv({ cobranca: existente });
      }
    }
    return respostaPdv({ cobranca: existente });
  }

  if (decisao === "substituir" && existente) {
    try {
      await cancelarCobrancaPixC6({
        empresaId,
        cobrancaId: String(existente.id),
        http: input.http,
      });
    } catch (error) {
      const recarregada = await buscarCobrancaCheckout(
        empresaId,
        input.checkoutKey
      );
      if (recarregada && String(recarregada.status) === "paga") {
        throw new ErroPixGeranet(MENSAGEM_PIX_GERANET_PAGO_NAO_ALTERA);
      }

      throw new ErroPixGeranet(
        error instanceof Error
          ? error.message
          : "Não foi possível cancelar a cobrança PIX C6 anterior.",
        409
      );
    }

    await liberarCheckoutKey(empresaId, String(existente.id));
  }

  const devedor = await carregarDevedorOpcional({
    empresaId,
    clienteId: input.clienteId,
  });
  const solicitacao = `UltraPDV ${input.checkoutKey.replace(/-/g, "").slice(0, 12)}`;
  const cobranca = await criarCobrancaC6NoBanco({
    empresaId,
    integracaoId: pre.integracao.id,
    valor,
    checkoutKey: input.checkoutKey,
    txid: gerarTxidPixC6(),
    solicitacao,
    ambiente: String(pre.integracao.ambiente),
  });

  const persistido = await emitirNoC6({
    empresaId,
    cobranca,
    valor,
    chavePix: pre.chavePix,
    mtls: pre,
    ambiente: pre.integracao.ambiente,
    solicitacaoPagador: solicitacao,
    devedor,
    http: input.http,
  });

  if (
    persistido.evidencia.estado === "pendente" ||
    persistido.evidencia.estado === "pago"
  ) {
    return respostaPdv(persistido);
  }

  if (!persistido.contrato.txid || persistido.evidencia.estado === "falha_cliente") {
    throw new ErroPixGeranet(
      "Não foi possível emitir a cobrança PIX C6.",
      422
    );
  }

  return respostaPdv(persistido);
}

export async function emitirCobrancaPixC6Teste(params: {
  empresaId: string;
  valor: number;
  devedor?: DevedorPix;
  http?: C6Http;
}) {
  if (!Number.isFinite(params.valor) || params.valor <= 0) {
    throw new ErroPixGeranet("Informe um valor PIX maior que zero.");
  }

  const pre = await validarPreRequisitosC6(params.empresaId);
  const solicitacao = "Teste UltraPDV C6";
  const cobranca = await criarCobrancaC6NoBanco({
    empresaId: params.empresaId,
    integracaoId: pre.integracao.id,
    valor: decimalPix(params.valor),
    txid: gerarTxidPixC6(),
    solicitacao,
    ambiente: String(pre.integracao.ambiente),
  });

  const persistido = await emitirNoC6({
    empresaId: params.empresaId,
    cobranca,
    valor: decimalPix(params.valor),
    chavePix: pre.chavePix,
    mtls: pre,
    ambiente: pre.integracao.ambiente,
    solicitacaoPagador: solicitacao,
    devedor: params.devedor,
    http: params.http,
  });

  return {
    cobranca: linhaPublicaCobrancaPix(persistido.cobranca),
    respostaSanitizada: persistido.respostaSanitizada,
    payloadEnviado: sanitizarRespostaPix(
      payloadCobrancaImediataC6({
        valor: decimalPix(params.valor),
        chavePix: "[oculto]",
        solicitacaoPagador: solicitacao,
        devedor: params.devedor,
      })
    ),
  };
}

export async function reconciliarCobrancaC6Existente(params: {
  cobranca: Record<string, unknown>;
  http?: C6Http;
}) {
  const empresaId = String(params.cobranca.empresa_id ?? "").trim();
  const ambiente = String(params.cobranca.ambiente ?? "").trim();
  if (!empresaId || !ambiente) {
    throw new ErroPixGeranet("Cobrança C6 sem empresa ou ambiente.", 422);
  }
  if (!ehProvedorPixC6Direto(String(params.cobranca.provedor))) {
    throw new ErroPixGeranet("Esta cobrança não é PIX C6.", 422);
  }

  const mtls = await credenciaisMtlsC6({
    empresaId,
    ambiente: ambiente as AmbientePixGeranet,
  });

  return consultarNoC6({
    empresaId,
    cobranca: params.cobranca,
    mtls,
    ambiente,
    http: params.http,
  });
}

async function buscarCobrancasC6PorTxid(txid: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cobrancas_pix")
    .select("*")
    .eq("txid", txid)
    .eq("provedor", CODIGO_PROVEDOR_C6);

  if (error) {
    throw new ErroPixGeranet(error.message, 500);
  }

  return (data ?? []) as Record<string, unknown>[];
}

export async function processarWebhookPixC6(params: {
  payload: unknown;
  http?: C6Http;
}) {
  void empresaIdExternaWebhookC6(params.payload);
  const txids = extrairTxidsWebhookC6(params.payload);
  const evento = eventoWebhookC6Sanitizado(params.payload);

  if (txids.length === 0) {
    return {
      status: 200,
      body: {
        ok: true,
        processado: false,
        motivo: "txid_nao_identificado",
        evento,
      },
    };
  }

  const resultados: Array<Record<string, unknown>> = [];

  for (const txid of txids) {
    const encontradas = await buscarCobrancasC6PorTxid(txid);
    if (encontradas.length !== 1) {
      resultados.push({
        txid,
        processado: false,
        motivo:
          encontradas.length === 0
            ? "cobranca_nao_encontrada"
            : "txid_ambiguo",
      });
      continue;
    }

    const cobranca = encontradas[0];
    const empresaId = String(cobranca.empresa_id);
    const statusAtual = String(cobranca.status ?? "");

    await registrarLog({
      empresaId,
      cobrancaId: String(cobranca.id),
      endpoint: "c6:webhook",
      provedor: CODIGO_PROVEDOR_C6,
      httpStatus: 200,
      situacao: "webhook_recebido",
      mensagem: `txid=${txid};status_atual=${statusAtual}`,
    });

    if (statusAtual === "paga" || statusAtual === "vinculado_venda") {
      resultados.push({
        txid,
        processado: true,
        idempotente: true,
        status: statusAtual,
        e2eid_mascarado: mascararE2eid(e2eidDaCobrancaC6(cobranca)),
      });
      continue;
    }

    try {
      const persistido = await reconciliarCobrancaC6Existente({
        cobranca,
        http: params.http,
      });

      resultados.push({
        txid,
        processado: true,
        status: persistido.cobranca.status,
        e2eid_mascarado: mascararE2eid(
          persistido.cobranca.e2eid ??
            (persistido.cobranca.dados_publicos as Record<string, unknown> | undefined)
              ?.e2eid
        ),
      });
    } catch {
      await registrarLog({
        empresaId,
        cobrancaId: String(cobranca.id),
        endpoint: "c6:webhook",
        provedor: CODIGO_PROVEDOR_C6,
        httpStatus: 503,
        situacao: "consulta_indisponivel",
        mensagem: `txid=${txid};webhook_nao_marca_pagamento`,
      });
      return {
        status: 503,
        body: {
          ok: false,
          processado: false,
          motivo: "consulta_indisponivel",
          txid,
          evento,
        },
      };
    }
  }

  return {
    status: 200,
    body: {
      ok: true,
      processado: resultados.some((item) => item.processado),
      evento,
      resultados,
    },
  };
}

async function operarWebhookC6(
  empresaId: string,
  method: "GET" | "PUT" | "DELETE",
  http?: C6Http
) {
  const pre = await validarPreRequisitosC6(empresaId);
  const webhookUrl = urlPublicaWebhookPixC6();
  const resposta = await requisicaoC6Autenticada({
    ...pre,
    empresaId,
    ambiente: pre.integracao.ambiente,
    method,
    url: urlWebhookC6(pre.integracao.ambiente, pre.chavePix),
    json: method === "PUT" ? { webhookUrl } : undefined,
    http,
  });
  lancarSeRespostaC6Falhou(resposta, "webhook");
  await registrarLog({
    empresaId,
    endpoint: `c6:${method} /v2/pix/webhook/{chave}`,
    provedor: CODIGO_PROVEDOR_C6,
    httpStatus: resposta.status,
    situacao: "sucesso",
    mensagem: `webhook;${rotuloAmbienteC6(String(pre.integracao.ambiente))}`,
  });

  const urlC6 = String(resposta.json?.webhookUrl ?? "").trim();
  return {
    ok: true as const,
    ambiente: String(pre.integracao.ambiente),
    webhookUrl: method === "DELETE" ? null : urlC6 || webhookUrl,
  };
}

export async function registrarWebhookPixC6(empresaId: string, http?: C6Http) {
  return operarWebhookC6(empresaId, "PUT", http);
}

export async function consultarWebhookPixC6(empresaId: string, http?: C6Http) {
  return operarWebhookC6(empresaId, "GET", http);
}

export async function removerWebhookPixC6(empresaId: string, http?: C6Http) {
  return operarWebhookC6(empresaId, "DELETE", http);
}

