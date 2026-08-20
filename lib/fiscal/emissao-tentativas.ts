import type { SupabaseClient } from "@supabase/supabase-js";

import { sanitizarConsultaGeranet } from "@/lib/fiscal/geranet/classificar-consulta";
import {
  MENSAGEM_BLOQUEIO_AGUARDANDO_RECONCILIACAO,
  MENSAGEM_BLOQUEIO_RETRANSMISSAO,
} from "@/lib/fiscal/geranet/classificar-emissao";
import { montarDiagnosticoRespostaGeranet } from "@/lib/fiscal/geranet/cliente-geranet";
import { hexDocumentoFiscalPersistivel } from "@/lib/fiscal/documento-fiscal";
import { resolverEstadoOperacionalDeEmissaoPersistida } from "@/lib/fiscal/estado-operacional-fiscal";

export const COLUNAS_EMISSAO_TENTATIVA_CABECALHO = `
  id,
  empresa_id,
  status,
  modelo,
  serie,
  numero,
  ambiente,
  codigo_numerico,
  tipo_emissao,
  chave_acesso,
  protocolo,
  cstat,
  motivo,
  geranet_http_status,
  geranet_situacao,
  erro_comunicacao,
  resposta_resumo,
  tentativas
`;

export const STATUS_BLOQUEIA_RASCUNHO_FISCAL = [
  "enviando",
  "aguardando_reconciliacao",
  "autorizada",
  "aguardando_transmissao_contingencia",
  "transmitindo_contingencia",
  "aguardando_inutilizacao",
  "inutilizada",
  "cancelada",
] as const;

const CHAVES_OMITIR_PAYLOAD =
  /certificado|senha|api.?key|token|authorization|csc|csrt|password|secret|codigoSeguranca/i;

export type EmissaoCabecalhoTentativa = {
  id: string;
  empresa_id?: string | null;
  status?: string | null;
  modelo?: string | number | null;
  serie?: string | number | null;
  numero?: string | number | null;
  ambiente?: string | number | null;
  codigo_numerico?: string | null;
  tipo_emissao?: string | null;
  chave_acesso?: string | null;
  protocolo?: string | null;
  cstat?: string | null;
  motivo?: string | null;
  geranet_http_status?: number | null;
  geranet_situacao?: string | null;
  erro_comunicacao?: string | null;
  resposta_resumo?: unknown;
  tentativas?: number | null;
};

export type BloqueioRascunhoFiscal =
  | { tipo: "seguir" }
  | { tipo: "autorizada"; emissao: EmissaoCabecalhoTentativa }
  | { tipo: "inutilizacao"; emissao: EmissaoCabecalhoTentativa }
  | { tipo: "inutilizada"; emissao: EmissaoCabecalhoTentativa }
  | { tipo: "bloquear"; emissao: EmissaoCabecalhoTentativa; mensagem: string };

export type ClassificacaoInicialTentativa =
  | "autorizada"
  | "rejeitada"
  | "aguardando_reconciliacao"
  | "erro_comunicacao";

export type TentativaFiscalResumo = {
  id: string;
  emissao_id: string;
  tentativa: number;
  cstat?: string | null;
  motivo?: string | null;
  classificacao_inicial?: string | null;
  http_status?: number | null;
  iniciada_at?: string | null;
  respondida_at?: string | null;
  finalizada_at?: string | null;
};

export type ClaimTentativaFiscal =
  | {
      ok: true;
      emissaoId: string;
      tentativa: number;
      tentativaId: string;
    }
  | {
      ok: false;
      motivo: "bloqueado" | "erro";
      mensagem: string;
    };

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

export function statusBloqueiaRascunhoFiscal(
  status: string | null | undefined
) {
  return STATUS_BLOQUEIA_RASCUNHO_FISCAL.includes(
    texto(status) as (typeof STATUS_BLOQUEIA_RASCUNHO_FISCAL)[number]
  );
}

export function avaliarBloqueioRascunhoFiscal(
  emissao: EmissaoCabecalhoTentativa | null | undefined
): BloqueioRascunhoFiscal {
  if (!emissao?.id) {
    return { tipo: "seguir" };
  }

  const status = texto(emissao.status);

  if (status === "autorizada") {
    return { tipo: "autorizada", emissao };
  }

  if (status === "aguardando_inutilizacao") {
    return { tipo: "inutilizacao", emissao };
  }

  if (status === "inutilizada") {
    return { tipo: "inutilizada", emissao };
  }

  const estado = resolverEstadoOperacionalDeEmissaoPersistida(emissao);

  if (
    statusBloqueiaRascunhoFiscal(status) ||
    estado.bloqueiaRetransmissao
  ) {
    return {
      tipo: "bloquear",
      emissao,
      mensagem:
        estado.estado === "ambigua"
          ? MENSAGEM_BLOQUEIO_AGUARDANDO_RECONCILIACAO
          : MENSAGEM_BLOQUEIO_RETRANSMISSAO,
    };
  }

  return { tipo: "seguir" };
}

export async function carregarEmissaoPorChaveIdempotencia(
  admin: SupabaseClient,
  empresaId: string,
  chaveIdempotencia: string
): Promise<EmissaoCabecalhoTentativa | null> {
  const { data, error } = await admin
    .from("fiscal_emissoes")
    .select(COLUNAS_EMISSAO_TENTATIVA_CABECALHO)
    .eq("empresa_id", empresaId)
    .eq("chave_idempotencia", chaveIdempotencia)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as EmissaoCabecalhoTentativa;
}

function omitirChavesSecretas(valor: unknown): unknown {
  if (Array.isArray(valor)) {
    return valor.map(omitirChavesSecretas);
  }

  if (!valor || typeof valor !== "object") {
    return valor;
  }

  const saida: Record<string, unknown> = {};

  for (const [chave, conteudo] of Object.entries(
    valor as Record<string, unknown>
  )) {
    if (CHAVES_OMITIR_PAYLOAD.test(chave)) {
      continue;
    }

    saida[chave] = omitirChavesSecretas(conteudo);
  }

  return saida;
}

export function sanitizarPayloadTentativaFiscal(
  payload: unknown
): Record<string, unknown> {
  const sanitizado = omitirChavesSecretas(sanitizarConsultaGeranet(payload));

  if (sanitizado && typeof sanitizado === "object" && !Array.isArray(sanitizado)) {
    return sanitizado as Record<string, unknown>;
  }

  return { valor: sanitizado ?? null };
}

export function payloadTentativaContemSegredo(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const visitados = new Set<unknown>();

  const andar = (valor: unknown): boolean => {
    if (!valor || typeof valor !== "object") {
      return false;
    }

    if (visitados.has(valor)) {
      return false;
    }

    visitados.add(valor);

    if (Array.isArray(valor)) {
      return valor.some(andar);
    }

    for (const [chave, conteudo] of Object.entries(
      valor as Record<string, unknown>
    )) {
      if (CHAVES_OMITIR_PAYLOAD.test(chave)) {
        const bruto = String(conteudo ?? "").trim();
        if (
          bruto &&
          bruto !== "[REDACTED]" &&
          !bruto.includes("OCULT") &&
          bruto !== "[presente]"
        ) {
          return true;
        }
      }

      if (andar(conteudo)) {
        return true;
      }
    }

    return false;
  };

  return andar(payload);
}

export function snapshotItensDaTransmissao(itens: unknown) {
  try {
    return JSON.parse(JSON.stringify(itens ?? []));
  } catch {
    return [];
  }
}

export function snapshotItensDoPayload(payload: unknown) {
  const raiz =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const nfe =
    raiz.nfe && typeof raiz.nfe === "object"
      ? (raiz.nfe as Record<string, unknown>)
      : {};

  if (Array.isArray(nfe.itens)) {
    return snapshotItensDaTransmissao(nfe.itens);
  }

  if (nfe.item != null) {
    return snapshotItensDaTransmissao(
      Array.isArray(nfe.item) ? nfe.item : [nfe.item]
    );
  }

  return [];
}

function primeiroRegistro(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    const item = data[0];
    return item && typeof item === "object"
      ? (item as Record<string, unknown>)
      : null;
  }

  if (data && typeof data === "object") {
    return data as Record<string, unknown>;
  }

  return null;
}

export async function claimTentativaEmissaoFiscal({
  admin,
  empresaId,
  emissaoId,
  usuarioId,
  payload,
  snapshotItens,
}: {
  admin: SupabaseClient;
  empresaId: string;
  emissaoId: string;
  usuarioId?: string | null;
  payload: unknown;
  snapshotItens?: unknown;
}): Promise<ClaimTentativaFiscal> {
  const { data: emissaoAtual, error: leituraError } = await admin
    .from("fiscal_emissoes")
    .select(
      `
      id,
      empresa_id,
      status,
      modelo,
      resposta_resumo,
      cstat,
      motivo,
      protocolo,
      chave_acesso,
      geranet_http_status,
      geranet_situacao,
      erro_comunicacao
    `
    )
    .eq("id", emissaoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (leituraError) {
    return {
      ok: false,
      motivo: "erro",
      mensagem: `Falha ao iniciar tentativa fiscal: ${leituraError.message}`,
    };
  }

  if (!emissaoAtual) {
    return {
      ok: false,
      motivo: "bloqueado",
      mensagem: MENSAGEM_BLOQUEIO_RETRANSMISSAO,
    };
  }

  const estado = resolverEstadoOperacionalDeEmissaoPersistida(emissaoAtual);
  const status = texto(emissaoAtual.status);

  if (status !== "reservada" && !estado.podeRetry) {
    return {
      ok: false,
      motivo: "bloqueado",
      mensagem: estado.requerDiagnostico
        ? "Situação fiscal ainda não classificada. Consulte o diagnóstico antes de retransmitir."
        : estado.estado === "ambigua"
          ? MENSAGEM_BLOQUEIO_AGUARDANDO_RECONCILIACAO
          : MENSAGEM_BLOQUEIO_RETRANSMISSAO,
    };
  }

  const { data, error } = await admin.rpc(
    "rpc_iniciar_tentativa_emissao_fiscal",
    {
      p_empresa_id: empresaId,
      p_emissao_id: emissaoId,
      p_usuario_id: usuarioId || null,
      p_payload_sanitizado: sanitizarPayloadTentativaFiscal(payload),
      p_snapshot_itens:
        snapshotItens === undefined
          ? snapshotItensDoPayload(payload)
          : snapshotItensDaTransmissao(snapshotItens),
    }
  );

  if (error) {
    return {
      ok: false,
      motivo: "erro",
      mensagem: `Falha ao iniciar tentativa fiscal: ${error.message}`,
    };
  }

  const claim = primeiroRegistro(data);
  const tentativaId = texto(claim?.tentativa_id);
  const emissaoClaim = texto(claim?.emissao_id);

  if (!emissaoClaim || !tentativaId) {
    return {
      ok: false,
      motivo: "bloqueado",
      mensagem: MENSAGEM_BLOQUEIO_RETRANSMISSAO,
    };
  }

  return {
    ok: true,
    emissaoId: emissaoClaim,
    tentativa: Number(claim?.tentativa ?? 0),
    tentativaId,
  };
}

export async function anexarTentativaTransmissaoContingencia({
  admin,
  empresaId,
  emissaoId,
  usuarioId,
  payload,
  snapshotItens,
}: {
  admin: SupabaseClient;
  empresaId: string;
  emissaoId: string;
  usuarioId?: string | null;
  payload: unknown;
  snapshotItens?: unknown;
}): Promise<ClaimTentativaFiscal> {
  const { data, error } = await admin.rpc(
    "rpc_anexar_tentativa_transmissao_fiscal",
    {
      p_empresa_id: empresaId,
      p_emissao_id: emissaoId,
      p_usuario_id: usuarioId || null,
      p_payload_sanitizado: sanitizarPayloadTentativaFiscal(payload),
      p_snapshot_itens:
        snapshotItens === undefined
          ? snapshotItensDoPayload(payload)
          : snapshotItensDaTransmissao(snapshotItens),
    }
  );

  if (error) {
    return {
      ok: false,
      motivo: "erro",
      mensagem: `Falha ao arquivar tentativa de contingência: ${error.message}`,
    };
  }

  const claim = primeiroRegistro(data);
  const tentativaId = texto(claim?.tentativa_id);

  if (!tentativaId) {
    return {
      ok: false,
      motivo: "bloqueado",
      mensagem: MENSAGEM_BLOQUEIO_RETRANSMISSAO,
    };
  }

  return {
    ok: true,
    emissaoId,
    tentativa: Number(claim?.tentativa ?? 0),
    tentativaId,
  };
}

export function geranetLogIdDe(dados: Record<string, unknown> | null | undefined) {
  if (!dados) {
    return null;
  }

  const bruto = dados.id ?? dados.log_id ?? dados.logId;
  const numero = Number(bruto);

  if (!Number.isFinite(numero) || numero <= 0) {
    return null;
  }

  return Math.trunc(numero);
}

export async function registrarRespostaTentativaFiscal({
  admin,
  empresaId,
  tentativaId,
  httpStatus,
  cstat,
  motivo,
  geranetLogId,
  resposta,
  xmlHex,
  pdfHex,
  classificacaoInicial,
  endpoint,
  erroTransporte,
}: {
  admin: SupabaseClient;
  empresaId: string;
  tentativaId: string | null | undefined;
  httpStatus?: number | null;
  cstat?: unknown;
  motivo?: unknown;
  geranetLogId?: number | string | null;
  resposta?: unknown;
  xmlHex?: string | null;
  pdfHex?: string | null;
  classificacaoInicial: ClassificacaoInicialTentativa | string;
  endpoint?: string | null;
  erroTransporte?: string | null;
}) {
  const id = texto(tentativaId);
  if (!id) {
    return;
  }

  const agora = new Date().toISOString();
  const logId = Number(geranetLogId);
  const diagnostico = sanitizarPayloadTentativaFiscal(
    montarDiagnosticoRespostaGeranet({
      dados: resposta ?? {},
      httpStatus,
      endpoint,
      timestamp: agora,
      erroTransporte,
    })
  );
  const { error } = await admin
    .from("fiscal_emissao_tentativas")
    .update({
      http_status: httpStatus ?? null,
      cstat: texto(cstat) || null,
      motivo: texto(motivo) || null,
      geranet_log_id:
        Number.isFinite(logId) && logId > 0 ? Math.trunc(logId) : null,
      resposta_sanitizada: diagnostico,
      xml_hex: hexDocumentoFiscalPersistivel(xmlHex, "xml"),
      pdf_hex: hexDocumentoFiscalPersistivel(pdfHex, "pdf"),
      classificacao_inicial: texto(classificacaoInicial) || null,
      respondida_at: agora,
      finalizada_at: agora,
    })
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .is("finalizada_at", null);

  if (error) {
    console.error("Falha ao registrar resposta da tentativa fiscal:", error.message);
  }
}

export function rotuloClassificacaoTentativa(valor: string | null | undefined) {
  const chave = texto(valor);

  if (chave === "autorizada") {
    return "Autorizada";
  }
  if (chave === "rejeitada") {
    return "Rejeitada";
  }
  if (chave === "aguardando_reconciliacao") {
    return "Aguardando reconciliação";
  }
  if (chave === "erro_comunicacao") {
    return "Erro de comunicação";
  }
  if (!chave) {
    return "Em andamento";
  }

  return chave.replace(/_/g, " ");
}
