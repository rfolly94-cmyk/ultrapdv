import { chamarGeranetBanking } from "@/lib/geranet/cliente";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  carregarApiKeyGeranet,
  carregarCnpjEmpresa,
  carregarIntegracaoPix,
  ErroPixGeranet,
  montarCredenciaisGeranetPix,
} from "./contexto";
import {
  montarContratoPixGeranet,
  normalizarStatusPagamentoPixGeranet,
} from "./evidencia-pagamento";
import { statusMonotonicoConsultaPix } from "./geranet-regras";
import { exigirPixGeranetAtivo } from "./modo-ativo-servidor";
import { montarPayloadCobrancaPix } from "./montar-payload";
import { normalizarRespostaPix } from "./normalizar-resposta";
import { obterProvedorPixGeranet } from "./provedores-geranet";
import { payloadSemCredenciais, sanitizarRespostaPix } from "./sanitizar";
import { podeCancelarLocalmente, statusAposRespostaHttp } from "./status";
import {
  classificarRespostaTestePix,
  METODO_TESTE_PIX_GERANET,
  TXID_TESTE_CONEXAO_PIX,
} from "./testar-conexao";
import type {
  AmbientePixGeranet,
  CobrancaPixPublica,
  DevedorPix,
  StatusCobrancaPix,
} from "./types";

function agoraIso() {
  return new Date().toISOString();
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

export function linhaPublicaCobrancaPix(
  row: Record<string, unknown>
): CobrancaPixPublica {
  return {
    id: String(row.id),
    empresa_id: String(row.empresa_id),
    txid: row.txid ? String(row.txid) : null,
    valor: Number(row.valor),
    status: row.status as StatusCobrancaPix,
    provedor: row.provedor ? String(row.provedor) : null,
    ambiente: row.ambiente ? String(row.ambiente) : null,
    dados_publicos:
      row.dados_publicos && typeof row.dados_publicos === "object"
        ? (row.dados_publicos as Record<string, unknown>)
        : {},
    geranet_http_status:
      typeof row.geranet_http_status === "number"
        ? row.geranet_http_status
        : null,
    geranet_situacao: row.geranet_situacao
      ? String(row.geranet_situacao)
      : null,
    geranet_mensagem: row.geranet_mensagem
      ? String(row.geranet_mensagem)
      : null,
    expira_em: row.expira_em ? String(row.expira_em) : null,
    pago_em: row.pago_em ? String(row.pago_em) : null,
    cancelado_em: row.cancelado_em ? String(row.cancelado_em) : null,
    modo_pix: row.modo_pix ? String(row.modo_pix) : null,
    valor_pago:
      row.valor_pago == null || row.valor_pago === ""
        ? null
        : Number(row.valor_pago),
    checkout_key: row.checkout_key ? String(row.checkout_key) : null,
  };
}

function linhaPublica(row: Record<string, unknown>): CobrancaPixPublica {
  return linhaPublicaCobrancaPix(row);
}

async function carregarCobrancaDaEmpresa(
  empresaId: string,
  cobrancaId: string
) {
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
    console.error("[pix] cobranca ausente na empresa ativa", {
      cobrancaId,
      empresaId,
    });
    throw new ErroPixGeranet("Recurso não encontrado.", 404);
  }

  return data as Record<string, unknown>;
}

export async function emitirCobrancaPixTeste({
  empresaId,
  valor,
  devedor,
}: {
  empresaId: string;
  valor: number;
  devedor?: DevedorPix;
}) {
  if (!Number.isFinite(valor) || valor <= 0) {
    throw new ErroPixGeranet("Informe um valor PIX maior que zero.");
  }

  await exigirPixGeranetAtivo(empresaId);
  const integracao = await carregarIntegracaoPix(empresaId);
  if (!integracao || !integracao.ativo) {
    throw new ErroPixGeranet(
      "Configure a integração PIX Geranet antes de emitir uma cobrança."
    );
  }

  if (!integracao.provedor) {
    throw new ErroPixGeranet("Selecione um provedor PIX da Geranet.");
  }

  if (!integracao.recebedor_nome || !integracao.recebedor_cidade) {
    throw new ErroPixGeranet("Preencha os dados do recebedor PIX.");
  }

  const [apiKey, cnpj, credenciais] = await Promise.all([
    carregarApiKeyGeranet(empresaId),
    carregarCnpjEmpresa(empresaId),
    montarCredenciaisGeranetPix({
      empresaId,
      provedor: integracao.provedor,
      ambiente: integracao.ambiente as AmbientePixGeranet,
      chavePixPublica: integracao.chave_pix,
    }),
  ]);

  const payload = montarPayloadCobrancaPix({
    ambiente: integracao.ambiente as AmbientePixGeranet,
    provedor: integracao.provedor,
    cnpj,
    credenciais,
    recebedor: {
      nome: integracao.recebedor_nome,
      cep: integracao.recebedor_cep ?? "",
      cidade: integracao.recebedor_cidade,
      uf: integracao.recebedor_uf ?? "",
    },
    cobranca: {
      valor,
      expiracaoSegundos: 3600,
      solicitacaoPagador: "Teste UltraPDV",
      permitirAlterarValor: false,
    },
    devedor,
  });

  const admin = createAdminClient();
  const { data: inserida, error: insertError } = await admin
    .from("cobrancas_pix")
    .insert({
      empresa_id: empresaId,
      integracao_pix_id: integracao.id,
      venda_id: null,
      valor,
      status: "pendente",
      modo_pix: "geranet",
      provedor: integracao.provedor,
      ambiente: integracao.ambiente,
      expira_em: new Date(Date.now() + 3600 * 1000).toISOString(),
    })
    .select("*")
    .single();

  if (insertError || !inserida) {
    throw new ErroPixGeranet(
      insertError?.message ?? "Não foi possível persistir a cobrança PIX.",
      500
    );
  }

  const resultado = await chamarGeranetBanking({
    apiKey,
    endpoint: "/api/v1/pix/emitir",
    payload,
  });

  const normalizada = normalizarRespostaPix(
    resultado.dados as Record<string, unknown>
  );
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
    txid: normalizada.txid,
    status,
    geranet_http_status: resultado.httpStatus,
    geranet_situacao: String(resultado.dados.situacao ?? "") || null,
    geranet_mensagem: String(resultado.dados.mensagem ?? "") || null,
    pago_em: status === "paga" ? agoraIso() : null,
    dados_publicos: {
      normalizado: normalizada,
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
    .eq("id", inserida.id)
    .eq("empresa_id", empresaId)
    .select("*")
    .single();

  if (updateError) {
    throw new ErroPixGeranet(updateError.message, 500);
  }

  await registrarLog({
    empresaId,
    cobrancaId: inserida.id,
    endpoint: "/api/v1/pix/emitir",
    provedor: integracao.provedor,
    httpStatus: resultado.httpStatus,
    situacao: String(resultado.dados.situacao ?? "") || null,
    mensagem: String(resultado.dados.mensagem ?? "") || null,
  });

  return {
    cobranca: linhaPublica((atualizada ?? { ...inserida, ...patch }) as Record<string, unknown>),
    respostaSanitizada,
    payloadEnviado: payloadSemCredenciais(
      payload as unknown as Record<string, unknown>
    ),
  };
}

export async function consultarCobrancaPix({
  empresaId,
  cobrancaId,
}: {
  empresaId: string;
  cobrancaId: string;
}) {
  await exigirPixGeranetAtivo(empresaId);
  const cobranca = await carregarCobrancaDaEmpresa(empresaId, cobrancaId);
  const txid = String(cobranca.txid ?? "").trim();

  if (!txid) {
    throw new ErroPixGeranet(
      "Esta cobrança ainda não possui TXID. Emita novamente após corrigir a configuração."
    );
  }

  const integracao = await carregarIntegracaoPix(empresaId);
  if (!integracao) {
    throw new ErroPixGeranet("Integração PIX não configurada.");
  }

  const provedorConsulta = String(cobranca.provedor ?? integracao.provedor);
  const ambienteConsulta =
    (cobranca.ambiente as AmbientePixGeranet) || integracao.ambiente;

  const [apiKey, cnpj, credenciais] = await Promise.all([
    carregarApiKeyGeranet(empresaId),
    carregarCnpjEmpresa(empresaId),
    montarCredenciaisGeranetPix({
      empresaId,
      provedor: provedorConsulta,
      ambiente: ambienteConsulta,
      chavePixPublica: integracao.chave_pix,
    }),
  ]);

  const payload = montarPayloadCobrancaPix({
    ambiente: ambienteConsulta,
    provedor: provedorConsulta,
    cnpj,
    credenciais,
    recebedor: {
      nome: integracao.recebedor_nome ?? "",
      cep: integracao.recebedor_cep ?? "",
      cidade: integracao.recebedor_cidade ?? "",
      uf: integracao.recebedor_uf ?? "",
    },
    txid,
  });

  const resultado = await chamarGeranetBanking({
    apiKey,
    endpoint: "/api/v1/pix/consultar",
    payload,
  });

  const normalizada = normalizarRespostaPix(
    resultado.dados as Record<string, unknown>
  );
  const contrato = montarContratoPixGeranet(
    resultado.dados as Record<string, unknown>
  );
  const evidencia = normalizarStatusPagamentoPixGeranet({
    provedor: provedorConsulta,
    httpStatus: resultado.httpStatus,
    situacaoGeranet: String(resultado.dados.situacao ?? ""),
    resposta: resultado.dados as Record<string, unknown>,
  });
  const statusAtual = cobranca.status as StatusCobrancaPix;
  const status = statusMonotonicoConsultaPix({
    statusAtual,
    estado: evidencia.estado,
    valorCobranca: Number(cobranca.valor),
    valorPago: evidencia.valorPago,
  });

  const admin = createAdminClient();
  const respostaSanitizada = sanitizarRespostaPix(resultado.dados);
  const patch = {
    txid: contrato.txid || normalizada.txid || txid,
    geranet_http_status: resultado.httpStatus,
    geranet_situacao: String(resultado.dados.situacao ?? "") || null,
    geranet_mensagem: String(resultado.dados.mensagem ?? "") || null,
    valor_pago:
      evidencia.valorPago ??
      (cobranca.valor_pago == null ? null : Number(cobranca.valor_pago)),
    pago_em:
      status === "paga"
        ? String(cobranca.pago_em ?? evidencia.pagoEm ?? agoraIso())
        : cobranca.pago_em,
    cancelado_em:
      status === "cancelada"
        ? String(cobranca.cancelado_em ?? agoraIso())
        : cobranca.cancelado_em,
    dados_publicos: {
      ...((cobranca.dados_publicos as Record<string, unknown>) ?? {}),
      normalizado: { ...normalizada, pago: evidencia.estado === "pago" },
      contrato,
      evidencia,
      resposta: respostaSanitizada,
      consulta_em: agoraIso(),
    },
    updated_at: agoraIso(),
  };

  const atualizacao =
    statusAtual === "paga" || statusAtual === "vinculado_venda"
      ? admin
          .from("cobrancas_pix")
          .update(patch)
          .eq("id", cobrancaId)
          .eq("empresa_id", empresaId)
      : admin
          .from("cobrancas_pix")
          .update({ ...patch, status })
          .eq("id", cobrancaId)
          .eq("empresa_id", empresaId)
          .neq("status", "paga")
          .neq("status", "vinculado_venda");

  const { data: atualizada, error } = await atualizacao.select("*").maybeSingle();

  if (error) {
    throw new ErroPixGeranet(error.message, 500);
  }

  const cobrancaFinal =
    atualizada ??
    (statusAtual === "paga" || statusAtual === "vinculado_venda"
      ? cobranca
      : await carregarCobrancaDaEmpresa(empresaId, cobrancaId));

  await registrarLog({
    empresaId,
    cobrancaId,
    endpoint: "/api/v1/pix/consultar",
    provedor: String(cobranca.provedor ?? integracao.provedor),
    httpStatus: resultado.httpStatus,
    situacao: String(resultado.dados.situacao ?? "") || null,
    mensagem: `estado=${evidencia.estado};evidencia=${evidencia.evidencia};${String(resultado.dados.mensagem ?? "")}`,
  });

  return {
    cobranca: linhaPublica(
      (cobrancaFinal ?? { ...cobranca, ...patch, status }) as Record<
        string,
        unknown
      >
    ),
    respostaSanitizada,
    txid,
    evidencia,
    contrato,
  };
}

export async function cancelarCobrancaPix({
  empresaId,
  cobrancaId,
}: {
  empresaId: string;
  cobrancaId: string;
}) {
  await exigirPixGeranetAtivo(empresaId);
  const cobranca = await carregarCobrancaDaEmpresa(empresaId, cobrancaId);
  const statusAtual = cobranca.status as StatusCobrancaPix;

  if (statusAtual === "paga") {
    throw new ErroPixGeranet(
      "PIX já pago não pode ser cancelado por esta operação."
    );
  }

  if (!podeCancelarLocalmente(statusAtual)) {
    throw new ErroPixGeranet(
      "Somente cobrança pendente pode ser cancelada."
    );
  }

  const txid = String(cobranca.txid ?? "").trim();
  if (!txid) {
    throw new ErroPixGeranet("Cobrança sem TXID não pode ser cancelada na Geranet.");
  }

  const integracao = await carregarIntegracaoPix(empresaId);
  if (!integracao) {
    throw new ErroPixGeranet("Integração PIX não configurada.");
  }

  const provedorCancelamento = String(
    cobranca.provedor ?? integracao.provedor
  );
  const ambienteCancelamento =
    (cobranca.ambiente as AmbientePixGeranet) || integracao.ambiente;

  const [apiKey, cnpj, credenciais] = await Promise.all([
    carregarApiKeyGeranet(empresaId),
    carregarCnpjEmpresa(empresaId),
    montarCredenciaisGeranetPix({
      empresaId,
      provedor: provedorCancelamento,
      ambiente: ambienteCancelamento,
      chavePixPublica: integracao.chave_pix,
    }),
  ]);

  const payload = montarPayloadCobrancaPix({
    ambiente: ambienteCancelamento,
    provedor: provedorCancelamento,
    cnpj,
    credenciais,
    recebedor: {
      nome: integracao.recebedor_nome ?? "",
      cep: integracao.recebedor_cep ?? "",
      cidade: integracao.recebedor_cidade ?? "",
      uf: integracao.recebedor_uf ?? "",
    },
    txid,
  });

  const resultado = await chamarGeranetBanking({
    apiKey,
    endpoint: "/api/v1/pix/cancelar",
    payload,
  });

  const normalizada = normalizarRespostaPix(
    resultado.dados as Record<string, unknown>
  );
  const evidencia = normalizarStatusPagamentoPixGeranet({
    provedor: provedorCancelamento,
    httpStatus: resultado.httpStatus,
    situacaoGeranet: String(resultado.dados.situacao ?? ""),
    resposta: resultado.dados as Record<string, unknown>,
  });

  if (evidencia.estado === "pago") {
    const admin = createAdminClient();
    const { data: paga } = await admin
      .from("cobrancas_pix")
      .update({
        status: "paga",
        pago_em: String(cobranca.pago_em ?? agoraIso()),
        geranet_http_status: resultado.httpStatus,
        geranet_situacao: String(resultado.dados.situacao ?? "") || null,
        geranet_mensagem: String(resultado.dados.mensagem ?? "") || null,
        dados_publicos: {
          ...((cobranca.dados_publicos as Record<string, unknown>) ?? {}),
          normalizado: normalizada,
          resposta: sanitizarRespostaPix(resultado.dados),
        },
        updated_at: agoraIso(),
      })
      .eq("id", cobrancaId)
      .eq("empresa_id", empresaId)
      .select("*")
      .single();

    await registrarLog({
      empresaId,
      cobrancaId,
      endpoint: "/api/v1/pix/cancelar",
      provedor: String(cobranca.provedor ?? integracao.provedor),
      httpStatus: resultado.httpStatus,
      situacao: String(resultado.dados.situacao ?? "") || null,
      mensagem: "Provedor informou pagamento; cancelamento local recusado.",
    });

    return {
      cobranca: linhaPublica((paga ?? cobranca) as Record<string, unknown>),
      respostaSanitizada: sanitizarRespostaPix(resultado.dados),
      txid,
    };
  }

  const status = statusAposRespostaHttp({
    httpStatus: resultado.httpStatus,
    situacao: String(resultado.dados.situacao ?? ""),
    pago: false,
    cancelado: normalizada.cancelado,
    statusAtual,
    operacao: "cancelar",
  });

  const admin = createAdminClient();
  const { data: atualizada, error } = await admin
    .from("cobrancas_pix")
    .update({
      status,
      cancelado_em: status === "cancelada" ? agoraIso() : cobranca.cancelado_em,
      geranet_http_status: resultado.httpStatus,
      geranet_situacao: String(resultado.dados.situacao ?? "") || null,
      geranet_mensagem: String(resultado.dados.mensagem ?? "") || null,
      dados_publicos: {
        ...((cobranca.dados_publicos as Record<string, unknown>) ?? {}),
        normalizado: normalizada,
        resposta: sanitizarRespostaPix(resultado.dados),
      },
      updated_at: agoraIso(),
    })
    .eq("id", cobrancaId)
    .eq("empresa_id", empresaId)
    .select("*")
    .single();

  if (error) {
    throw new ErroPixGeranet(error.message, 500);
  }

  await registrarLog({
    empresaId,
    cobrancaId,
    endpoint: "/api/v1/pix/cancelar",
    provedor: String(cobranca.provedor ?? integracao.provedor),
    httpStatus: resultado.httpStatus,
    situacao: String(resultado.dados.situacao ?? "") || null,
    mensagem: String(resultado.dados.mensagem ?? "") || null,
  });

  return {
    cobranca: linhaPublica((atualizada ?? cobranca) as Record<string, unknown>),
    respostaSanitizada: sanitizarRespostaPix(resultado.dados),
    txid,
  };
}

export async function testarConexaoPixGeranet(empresaId: string) {
  await exigirPixGeranetAtivo(empresaId);
  const integracao = await carregarIntegracaoPix(empresaId);

  if (!integracao || !integracao.ativo) {
    throw new ErroPixGeranet(
      "Configure a integração PIX Geranet antes de testar a conexão."
    );
  }

  if (!integracao.provedor) {
    throw new ErroPixGeranet("Selecione um provedor PIX da Geranet.");
  }

  const meta = obterProvedorPixGeranet(integracao.provedor);
  if (!meta?.configuracaoDisponivel) {
    throw new ErroPixGeranet(
      "Configuração deste provedor ainda não foi mapeada no UltraPDV."
    );
  }

  if (!integracao.recebedor_nome || !integracao.recebedor_cidade) {
    throw new ErroPixGeranet("Preencha os dados do recebedor PIX.");
  }

  const [apiKey, cnpj, credenciais] = await Promise.all([
    carregarApiKeyGeranet(empresaId),
    carregarCnpjEmpresa(empresaId),
    montarCredenciaisGeranetPix({
      empresaId,
      provedor: integracao.provedor,
      ambiente: integracao.ambiente as AmbientePixGeranet,
      chavePixPublica: integracao.chave_pix,
    }),
  ]);

  const payload = montarPayloadCobrancaPix({
    ambiente: integracao.ambiente as AmbientePixGeranet,
    provedor: integracao.provedor,
    cnpj,
    credenciais,
    recebedor: {
      nome: integracao.recebedor_nome,
      cep: integracao.recebedor_cep ?? "",
      cidade: integracao.recebedor_cidade,
      uf: integracao.recebedor_uf ?? "",
    },
    txid: TXID_TESTE_CONEXAO_PIX,
  });

  const resultado = await chamarGeranetBanking({
    apiKey,
    endpoint: "/api/v1/pix/consultar",
    payload,
  });

  const dadosInternos =
    resultado.dados.dados && typeof resultado.dados.dados === "object"
      ? resultado.dados.dados
      : {};
  const dadosStatus = Number(
    (dadosInternos as { status?: unknown }).status ?? ""
  );
  const classificacao = classificarRespostaTestePix({
    httpStatus: resultado.httpStatus,
    situacao: String(resultado.dados.situacao ?? ""),
    mensagem: String(resultado.dados.mensagem ?? ""),
    dadosStatus: Number.isFinite(dadosStatus) ? dadosStatus : null,
    provedor: integracao.provedor,
  });

  await registrarLog({
    empresaId,
    endpoint: "/api/v1/pix/consultar",
    provedor: integracao.provedor,
    httpStatus: resultado.httpStatus,
    situacao: String(resultado.dados.situacao ?? "") || null,
    mensagem: `teste_conexao;${classificacao.resultado};${classificacao.mensagem}`,
  });

  return {
    ok: classificacao.ok,
    resultado: classificacao.resultado,
    httpStatus: resultado.httpStatus,
    provedor: integracao.provedor,
    ambiente: integracao.ambiente,
    credenciaisConfiguradas: true,
    cobrancaEmitida: false,
    metodoTeste: METODO_TESTE_PIX_GERANET,
    mensagem: classificacao.mensagem,
    limitacao: classificacao.limitacao,
    provedorAutenticado: classificacao.provedorAutenticado,
    respostaSanitizada: sanitizarRespostaPix(resultado.dados),
    payloadEnviado: payloadSemCredenciais(
      payload as unknown as Record<string, unknown>
    ),
  };
}
