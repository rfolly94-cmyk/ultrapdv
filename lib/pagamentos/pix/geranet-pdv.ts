import { validarParcelaPixContraSaldo } from "@/lib/pdv/pagamentos-teto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  carregarApiKeyGeranet,
  carregarCnpjEmpresa,
  carregarIntegracaoPix,
  ErroPixGeranet,
  montarCredenciaisGeranetPix,
  resolverEmpresaPix,
} from "./contexto";
import {
  montarContratoPixGeranet,
  normalizarStatusPagamentoPixGeranet,
} from "./evidencia-pagamento";
import { cancelarCobrancaPix, linhaPublicaCobrancaPix } from "./geranet";
import {
  checkoutKeyPixValida,
  decidirReusoCobrancaCheckout,
  MENSAGEM_PIX_GERANET_NAO_CONFIGURADO,
  MENSAGEM_PIX_GERANET_PAGO_NAO_ALTERA,
  rejeitarCamposSensiveisEmitirPixPdv,
} from "./geranet-regras";
import { exigirPixGeranetAtivo } from "./modo-ativo-servidor";
import { chamarGeranetBanking } from "@/lib/geranet/cliente";
import { montarPayloadCobrancaPix } from "./montar-payload";
import { nomeProvedorPix } from "./provedores-geranet";
import { payloadSemCredenciais, sanitizarRespostaPix } from "./sanitizar";
import { statusAposRespostaHttp } from "./status";
import type {
  AmbientePixGeranet,
  DevedorPix,
  StatusCobrancaPix,
} from "./types";

const EXPIRACAO_SEGUNDOS = 3600;

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
    error instanceof Error ? error.message : MENSAGEM_PIX_GERANET_NAO_CONFIGURADO,
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
  await admin.from("pix_operacoes_log").insert({
    empresa_id: params.empresaId,
    cobranca_id: params.cobrancaId ?? null,
    endpoint: params.endpoint,
    provedor: params.provedor ?? null,
    http_status: params.httpStatus ?? null,
    situacao: params.situacao ?? null,
    mensagem: params.mensagem ?? null,
  });
}

async function validarPreRequisitosGeranetPdv(empresaId: string) {
  await exigirPixGeranetAtivo(empresaId);
  const integracao = await carregarIntegracaoPix(empresaId);

  if (!integracao || !integracao.ativo || integracao.modo !== "geranet") {
    throw new ErroPixGeranet(MENSAGEM_PIX_GERANET_NAO_CONFIGURADO);
  }

  const provedor = integracao.provedor;
  if (!provedor) {
    throw new ErroPixGeranet(MENSAGEM_PIX_GERANET_NAO_CONFIGURADO);
  }

  if (!integracao.ambiente) {
    throw new ErroPixGeranet(MENSAGEM_PIX_GERANET_NAO_CONFIGURADO);
  }

  if (!integracao.recebedor_nome || !integracao.recebedor_cidade) {
    throw new ErroPixGeranet(MENSAGEM_PIX_GERANET_NAO_CONFIGURADO);
  }

  const [apiKey, cnpj, credenciais] = await Promise.all([
    carregarApiKeyGeranet(empresaId),
    carregarCnpjEmpresa(empresaId),
    montarCredenciaisGeranetPix({
      empresaId,
      provedor,
      ambiente: integracao.ambiente as AmbientePixGeranet,
      chavePixPublica: integracao.chave_pix,
    }),
  ]);

  if (cnpj.replace(/\D/g, "").length !== 14) {
    throw new ErroPixGeranet(MENSAGEM_PIX_GERANET_NAO_CONFIGURADO);
  }

  return {
    integracao: { ...integracao, provedor },
    apiKey,
    cnpj,
    credenciais,
  };
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

  if (!nome && (cpfCnpj.length !== 11 && cpfCnpj.length !== 14)) {
    return undefined;
  }

  return {
    ...(nome ? { nome } : {}),
    ...(cpfCnpj.length === 11 || cpfCnpj.length === 14
      ? { cpfCnpj }
      : {}),
  };
}

async function buscarCobrancaCheckout(
  empresaId: string,
  checkoutKey: string
) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("cobrancas_pix")
    .select("*")
    .eq("empresa_id", empresaId)
    .eq("checkout_key", checkoutKey)
    .is("venda_id", null)
    .in("status", ["pendente", "paga", "divergencia_valor"])
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
    pixCopiaECola: contrato?.pixCopiaECola ?? null,
    qrCode: contrato?.qrCode ?? null,
    provedor: publica.provedor,
    provedor_nome: publica.provedor
      ? nomeProvedorPix(publica.provedor)
      : null,
    expira_em: publica.expira_em,
    pago_em: publica.pago_em,
    estado: evidencia?.estado ?? "pendente",
    evidencia: evidencia?.evidencia ?? "emissao_pendente",
    valor_pago: publica.valor_pago ?? null,
    resposta: params.respostaSanitizada ?? dados.resposta ?? null,
    cobranca: publica,
  };
}

export async function emitirCobrancaPixPdv(input: {
  valor: number;
  checkoutKey: string;
  clienteId?: string | null;
  saldoRestanteCentavos?: number;
  body?: Record<string, unknown>;
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
    pre = await validarPreRequisitosGeranetPdv(empresaId);
  } catch (error) {
    if (error instanceof ErroPixGeranet) {
      const especifica =
        /certificado|Chave PIX|Client|token|senha|não mapeada/i.test(
          error.message
        );
      throw new ErroPixGeranet(
        especifica ? error.message : MENSAGEM_PIX_GERANET_NAO_CONFIGURADO,
        error.status
      );
    }
    throw new ErroPixGeranet(MENSAGEM_PIX_GERANET_NAO_CONFIGURADO);
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
    return respostaPdv({ cobranca: existente });
  }

  if (decisao === "substituir" && existente) {
    try {
      await cancelarCobrancaPix({
        empresaId,
        cobrancaId: String(existente.id),
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
          : "Não foi possível cancelar a cobrança PIX anterior.",
        409
      );
    }

    await liberarCheckoutKey(empresaId, String(existente.id));
  }

  const devedor = await carregarDevedorOpcional({
    empresaId,
    clienteId: input.clienteId,
  });

  const payload = montarPayloadCobrancaPix({
    ambiente: pre.integracao.ambiente as AmbientePixGeranet,
    provedor: pre.integracao.provedor,
    cnpj: pre.cnpj,
    credenciais: pre.credenciais,
    recebedor: {
      nome: pre.integracao.recebedor_nome ?? "",
      cep: pre.integracao.recebedor_cep ?? "",
      cidade: pre.integracao.recebedor_cidade ?? "",
      uf: pre.integracao.recebedor_uf ?? "",
    },
    cobranca: {
      valor,
      expiracaoSegundos: EXPIRACAO_SEGUNDOS,
      solicitacaoPagador: `UltraPDV ${input.checkoutKey.replace(/-/g, "").slice(0, 12)}`,
      permitirAlterarValor: false,
    },
    devedor,
  });

  const admin = createAdminClient();
  const insercao = await admin
    .from("cobrancas_pix")
    .insert({
      empresa_id: empresaId,
      integracao_pix_id: pre.integracao.id,
      venda_id: null,
      valor,
      status: "pendente",
      modo_pix: "geranet",
      provedor: pre.integracao.provedor,
      ambiente: pre.integracao.ambiente,
      checkout_key: input.checkoutKey,
      expira_em: new Date(Date.now() + EXPIRACAO_SEGUNDOS * 1000).toISOString(),
      dados_publicos: {
        checkout_key: input.checkoutKey,
        modo: "geranet",
      },
    })
    .select("*")
    .single();

  if (insercao.error || !insercao.data) {
    if (insercao.error?.code === "23505") {
      const concorrente = await buscarCobrancaCheckout(
        empresaId,
        input.checkoutKey
      );
      if (concorrente) {
        return respostaPdv({ cobranca: concorrente });
      }
    }

    throw new ErroPixGeranet(
      insercao.error?.message ?? "Não foi possível persistir a cobrança PIX.",
      500
    );
  }

  const resultado = await chamarGeranetBanking({
    apiKey: pre.apiKey,
    endpoint: "/api/v1/pix/emitir",
    payload,
  });

  const contrato = montarContratoPixGeranet(
    resultado.dados as Record<string, unknown>
  );
  const evidencia = normalizarStatusPagamentoPixGeranet({
    provedor: pre.integracao.provedor,
    httpStatus: resultado.httpStatus,
    situacaoGeranet: String(resultado.dados.situacao ?? ""),
    resposta: resultado.dados as Record<string, unknown>,
  });
  const status = statusAposRespostaHttp({
    httpStatus: resultado.httpStatus,
    situacao: String(resultado.dados.situacao ?? ""),
    pago: false,
    cancelado: false,
    statusAtual: "pendente",
    operacao: "emitir",
  });
  const respostaSanitizada = sanitizarRespostaPix(resultado.dados);

  const patch = {
    txid: contrato.txid,
    status,
    geranet_http_status: resultado.httpStatus,
    geranet_situacao: String(resultado.dados.situacao ?? "") || null,
    geranet_mensagem: String(resultado.dados.mensagem ?? "") || null,
    dados_publicos: {
      checkout_key: input.checkoutKey,
      modo: "geranet",
      contrato,
      evidencia,
      resposta: respostaSanitizada,
      payload_enviado: payloadSemCredenciais(
        payload as unknown as Record<string, unknown>
      ),
    },
    updated_at: agoraIso(),
  };

  const { data: atualizada, error: updateError } = await admin
    .from("cobrancas_pix")
    .update(patch)
    .eq("id", insercao.data.id)
    .eq("empresa_id", empresaId)
    .select("*")
    .single();

  if (updateError) {
    throw new ErroPixGeranet(updateError.message, 500);
  }

  await registrarLog({
    empresaId,
    cobrancaId: insercao.data.id,
    endpoint: "/api/v1/pix/emitir",
    provedor: pre.integracao.provedor,
    httpStatus: resultado.httpStatus,
    situacao: String(resultado.dados.situacao ?? "") || null,
    mensagem: `estado=${evidencia.estado};evidencia=${evidencia.evidencia};${String(resultado.dados.mensagem ?? "")}`,
  });

  if (status === "erro" || !contrato.txid) {
    throw new ErroPixGeranet(
      String(resultado.dados.mensagem ?? "") ||
        "Não foi possível emitir a cobrança PIX integrada.",
      resultado.httpStatus >= 400 ? resultado.httpStatus : 422
    );
  }

  return respostaPdv({
    cobranca: (atualizada ?? { ...insercao.data, ...patch }) as Record<
      string,
      unknown
    >,
    contrato,
    evidencia,
    respostaSanitizada,
  });
}

export function statusCobrancaParaUi(status: StatusCobrancaPix | string) {
  return String(status);
}
