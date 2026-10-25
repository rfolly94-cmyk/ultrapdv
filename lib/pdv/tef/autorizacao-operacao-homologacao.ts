import { assinarAutorizacaoOperacao, lerChavePrivadaHomologacao } from "../../../print-agent/src/tef-menu-conector.mjs";

const VALIDADE_MS = 120_000;

export type OperacaoTesteHomologacao = {
  ambiente: "homologacao" | "producao";
  empresaId: string;
  dispositivoId: string;
  terminalCodigo: string;
  posid: string;
  valorCentavos: number;
  idempotencyKey: string;
  expiraEm: number;
  consumida: boolean;
};

const operacoes = new Map<string, OperacaoTesteHomologacao>();

export function esquecerOperacoesTesteHomologacao() {
  operacoes.clear();
}

export function definirOperacaoTesteHomologacao(
  entrada: {
    empresaId: string;
    dispositivoId: string;
    terminalCodigo: string;
    posid: string;
    valorCentavos: number;
    idempotencyKey: string;
    ambiente?: "homologacao" | "producao";
    informado?: {
      empresaId?: string;
      dispositivoId?: string;
      terminalCodigo?: string;
      posid?: string;
    };
  },
  agora = Date.now()
) {
  const informado = entrada.informado ?? {};
  if (informado.empresaId && informado.empresaId !== entrada.empresaId) {
    return { ok: false as const, codigo: "empresa" as const };
  }
  if (informado.dispositivoId && informado.dispositivoId !== entrada.dispositivoId) {
    return { ok: false as const, codigo: "dispositivo" as const };
  }
  if (informado.terminalCodigo && informado.terminalCodigo !== entrada.terminalCodigo) {
    return { ok: false as const, codigo: "terminal" as const };
  }
  if (informado.posid && informado.posid !== entrada.posid) {
    return { ok: false as const, codigo: "posid" as const };
  }
  const idempotencyKey = entrada.idempotencyKey.trim();
  if (
    !entrada.empresaId ||
    !entrada.dispositivoId ||
    !entrada.terminalCodigo ||
    !entrada.posid ||
    !idempotencyKey ||
    !Number.isInteger(entrada.valorCentavos) ||
    entrada.valorCentavos <= 0
  ) {
    return { ok: false as const, codigo: "pedido" as const };
  }
  const atual = operacoes.get(idempotencyKey);
  if (atual) {
    if (atual.expiraEm <= agora) return { ok: false as const, codigo: "expirada" as const };
    if (atual.consumida) return { ok: false as const, codigo: "consumida" as const };
    if (atual.empresaId !== entrada.empresaId) return { ok: false as const, codigo: "empresa" as const };
    if (atual.dispositivoId !== entrada.dispositivoId) return { ok: false as const, codigo: "dispositivo" as const };
    if (atual.terminalCodigo !== entrada.terminalCodigo) return { ok: false as const, codigo: "terminal" as const };
    if (atual.posid !== entrada.posid) return { ok: false as const, codigo: "posid" as const };
    if (atual.valorCentavos !== entrada.valorCentavos) return { ok: false as const, codigo: "valor" as const };
    return { ok: true as const, operacao: atual };
  }
  const operacao: OperacaoTesteHomologacao = {
    ambiente: entrada.ambiente === "producao" ? "producao" : "homologacao",
    empresaId: entrada.empresaId,
    dispositivoId: entrada.dispositivoId,
    terminalCodigo: entrada.terminalCodigo,
    posid: entrada.posid,
    valorCentavos: entrada.valorCentavos,
    idempotencyKey,
    expiraEm: agora + VALIDADE_MS,
    consumida: false,
  };
  operacoes.set(idempotencyKey, operacao);
  return { ok: true as const, operacao };
}

export async function provarOperacaoTesteHomologacao(
  entrada: Parameters<typeof definirOperacaoTesteHomologacao>[0],
  agora = Date.now(),
  chavePrivadaPem?: string
) {
  const registro = definirOperacaoTesteHomologacao(entrada, agora);
  if (!registro.ok) return registro;
  const privada = chavePrivadaPem ?? (await lerChavePrivadaHomologacao());
  return assinarOperacaoTesteHomologacao(registro.operacao, privada);
}

export function assinarOperacaoTesteHomologacao(operacao: OperacaoTesteHomologacao, chavePrivadaPem: string) {
  if (!chavePrivadaPem) return { ok: false as const, codigo: "chave" as const };
  return {
    ok: true as const,
    assinatura: assinarAutorizacaoOperacao(chavePrivadaPem, operacao),
    operacao,
  };
}
