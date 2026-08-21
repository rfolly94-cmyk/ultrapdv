import "server-only";

import type { createClient } from "@/lib/supabase/server";

type SupabaseServidor = Awaited<ReturnType<typeof createClient>>;

export function linhasCartaCorrecao(input: {
  empresa: string;
  cnpj: string;
  modelo: string;
  serie: number | string | null;
  numero: number | string | null;
  chave: string;
  protocoloNfe: string;
  sequencia: number | string | null;
  protocoloEvento: string;
  cstat: string;
  data: string;
  texto: string;
}) {
  return [
    "Carta de Correcao Eletronica - CC-e",
    input.modelo === "55" ? "Evento vinculado a NF-e modelo 55" : `Modelo ${input.modelo}`,
    "",
    `Emitente: ${input.empresa}`,
    `CNPJ: ${input.cnpj || "-"}`,
    `Documento: ${input.serie ?? "-"}/${input.numero ?? "-"}`,
    `Chave: ${input.chave || "-"}`,
    `Protocolo NF-e: ${input.protocoloNfe || "-"}`,
    `CC-e n. ${input.sequencia ?? "-"}`,
    `Protocolo evento: ${input.protocoloEvento || "-"}`,
    `cStat: ${input.cstat || "-"}`,
    `Data: ${input.data}`,
    "",
    "Texto da correcao:",
    ...String(input.texto || "-")
      .split(/\r?\n/)
      .map((linha) => linha.slice(0, 86)),
  ];
}

export async function carregarCartaCorrecaoDaEmpresaAtiva(args: {
  supabase: SupabaseServidor;
  empresaId: string;
  eventoId: string;
}) {
  const { supabase, empresaId, eventoId } = args;
  const { data: evento } = await supabase
    .from("fiscal_emissao_eventos")
    .select(
      "id, empresa_id, emissao_id, tipo, status, sequencia, texto_correcao, cstat, protocolo, concluido_at, created_at"
    )
    .eq("empresa_id", empresaId)
    .eq("id", eventoId)
    .maybeSingle();

  if (
    !evento ||
    evento.empresa_id !== empresaId ||
    evento.tipo !== "carta_correcao" ||
    evento.status !== "sucesso"
  ) {
    return null;
  }

  const [{ data: emissao }, { data: empresa }] = await Promise.all([
    supabase
      .from("fiscal_emissoes")
      .select("id, empresa_id, modelo, serie, numero, chave_acesso, protocolo")
      .eq("empresa_id", empresaId)
      .eq("id", evento.emissao_id)
      .maybeSingle(),
    supabase
      .from("empresas")
      .select("razao_social, nome_fantasia, cnpj")
      .eq("id", empresaId)
      .maybeSingle(),
  ]);

  if (!emissao || emissao.empresa_id !== empresaId) {
    return null;
  }

  const dataEvento = evento.concluido_at ?? evento.created_at;
  return {
    empresa: empresa?.razao_social || empresa?.nome_fantasia || "Empresa",
    cnpj: empresa?.cnpj || "",
    modelo: String(emissao.modelo ?? ""),
    serie: emissao.serie,
    numero: emissao.numero,
    chave: emissao.chave_acesso || "",
    protocoloNfe: emissao.protocolo || "",
    sequencia: evento.sequencia,
    protocoloEvento: evento.protocolo || "",
    cstat: evento.cstat ? String(evento.cstat) : "",
    data: dataEvento
      ? new Intl.DateTimeFormat("pt-BR", {
          dateStyle: "short",
          timeStyle: "short",
          timeZone: "America/Cuiaba",
        }).format(new Date(dataEvento))
      : "-",
    texto: evento.texto_correcao || "",
  };
}
