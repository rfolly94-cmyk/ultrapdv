import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { haPendenciaFinanceiraNativa, pontoInstaladoNaSituacao } from "@/lib/pdv/tef/motor-csharp";
import { pinpadAprovadoNaCobranca, type RegistroPinpadProducao } from "@/lib/pdv/tef/habilitacao-producao";
import { carregarConfiguracaoMotor } from "@/lib/pdv/tef/politica-empresa-servidor";

export type ConsultaMotorLocal = {
  codigo: string;
  erro: string;
  terminalId: string;
  dispositivoId: string;
  referenciaInstalacao: string;
  codigoNativo: number | null;
  servidorValidado: boolean;
  nativo: boolean;
  chave: string;
};

function texto(valor: unknown) {
  return typeof valor === "string" ? valor : "";
}

export async function consultarMotorLocal(origem: string, empresaId: string, ambiente: 0 | 1): Promise<ConsultaMotorLocal | null> {
  let url: URL;
  try {
    url = new URL(origem);
  } catch {
    return null;
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return null;
  try {
    const resposta = await fetch(new URL("/tef/csharp", url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        comando: "situacao",
        empresaId,
        ambiente,
        finalidade: ambiente === 0 ? "consulta_producao" : undefined,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const corpo = (await resposta.json().catch(() => null)) as Record<string, unknown> | null;
    if (!corpo) return null;
    return {
      codigo: texto(corpo.codigo),
      erro: texto(corpo.erro),
      terminalId: texto(corpo.terminalId),
      dispositivoId: texto(corpo.dispositivoId),
      referenciaInstalacao: texto(corpo.referenciaInstalacao),
      codigoNativo: typeof corpo.codigoNativo === "number" ? corpo.codigoNativo : null,
      servidorValidado: corpo.servidorValidado === true,
      nativo: corpo.nativo === true,
      chave: texto(corpo.chave),
    };
  } catch {
    return null;
  }
}

export async function carregarPinpadProducao(empresaId: string): Promise<RegistroPinpadProducao | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("tef_motor_pinpad_producao")
      .select("empresa_id, terminal_id, dispositivo_id, journal_instalacao, codigo_nativo, aprovado")
      .eq("empresa_id", empresaId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return {
      empresaId: String(data.empresa_id),
      terminalId: String(data.terminal_id),
      dispositivoId: String(data.dispositivo_id),
      journalInstalacao: String(data.journal_instalacao ?? ""),
      codigoNativo: Number(data.codigo_nativo),
      aprovado: data.aprovado === true,
    };
  } catch {
    return null;
  }
}

export async function carregarSinaisCobranca(origem: string, empresaId: string) {
  const config = await carregarConfiguracaoMotor(empresaId);
  const consulta = origem ? await consultarMotorLocal(origem, empresaId, 1) : null;
  const producao = origem ? await consultarMotorLocal(origem, empresaId, 0) : null;
  const registro = await carregarPinpadProducao(empresaId);
  const terminalId = producao?.terminalId || consulta?.terminalId || "";
  const dispositivoId = producao?.dispositivoId || consulta?.dispositivoId || "";
  const journalInstalacao = producao?.referenciaInstalacao || "";
  const sinais = {
    conectorRespondeu: consulta !== null,
    pontoInstalado: pontoInstaladoNaSituacao(consulta?.codigo ?? ""),
    pendenciaFinanceira: consulta?.codigo === "venda_pendente"
      || producao?.codigo === "venda_pendente"
      || haPendenciaFinanceiraNativa(`${consulta?.erro ?? ""} ${producao?.erro ?? ""}`),
    pontoProducaoInstalado: producao?.codigo === "ponto_instalado",
    pinpadAprovado: pinpadAprovadoNaCobranca({
      empresaId,
      terminalId,
      dispositivoId,
      journalInstalacao,
      registro,
    }),
    credenciamentoProducao: config.credenciamentoComprovado,
    servidorComercialValidado: config.servidorComercialValidado,
  };
  return { config, sinais, consulta, producao, terminalId, dispositivoId, journalInstalacao };
}
