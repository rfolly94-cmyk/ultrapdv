import type { SupabaseClient } from "@supabase/supabase-js";

import type { Competencia } from "@/lib/contabilidade/competencia";
import { intervaloCompetencia } from "@/lib/contabilidade/competencia";
import {
  buscaDocumento,
  documentoCasaComFiltro,
  type FiltroStatusDocumento,
} from "@/lib/contabilidade/regras";

export const DOCUMENTO_SELECT = `
  id,
  origem_id,
  modelo,
  serie,
  numero,
  status,
  chave_acesso,
  protocolo,
  cstat,
  motivo,
  xml_hex,
  autorizada_at,
  created_at
`;

export type DocumentoFiscalContabil = {
  id: string;
  origemId: string | null;
  modelo: string;
  serie: number;
  numero: string;
  status: string;
  chave: string | null;
  protocolo: string | null;
  cstat: string | null;
  motivo: string | null;
  temXml: boolean;
  cliente: string;
  documento: string | null;
  valor: number;
  data: string;
  cfop: string | null;
};

export type FiltrosDocumentos = {
  modelo?: "55" | "65" | null;
  status?: FiltroStatusDocumento | null;
  busca?: string | null;
  pagina?: number;
  porPagina?: number;
};

export async function carregarEmissoesCompetencia(
  supabase: SupabaseClient,
  empresaId: string,
  competencia: Competencia,
  fuso?: string
) {
  const { inicio, fim } = intervaloCompetencia(competencia, fuso);

  const { data, error } = await supabase
    .from("fiscal_emissoes")
    .select(DOCUMENTO_SELECT)
    .eq("empresa_id", empresaId)
    .gte("created_at", inicio.toISOString())
    .lt("created_at", fim.toISOString())
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function enriquecerDocumentos(
  supabase: SupabaseClient,
  empresaId: string,
  emissoes: Array<{
    id: string;
    origem_id: string | null;
    modelo: string;
    serie: number;
    numero: number | string;
    status: string;
    chave_acesso: string | null;
    protocolo: string | null;
    cstat: string | null;
    motivo: string | null;
    xml_hex: string | null;
    autorizada_at: string | null;
    created_at: string;
  }>
): Promise<DocumentoFiscalContabil[]> {
  const vendaIds = [
    ...new Set(
      emissoes
        .map((item) => item.origem_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const vendas =
    vendaIds.length > 0
      ? (
          await supabase
            .from("vendas")
            .select("id, cliente_id, valor_total")
            .eq("empresa_id", empresaId)
            .in("id", vendaIds)
        ).data ?? []
      : [];

  const clienteIds = [
    ...new Set(
      vendas
        .map((venda) => venda.cliente_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const clientes =
    clienteIds.length > 0
      ? (
          await supabase
            .from("clientes")
            .select("id, nome, cpf_cnpj")
            .eq("empresa_id", empresaId)
            .in("id", clienteIds)
        ).data ?? []
      : [];

  const vendaPorId = new Map(vendas.map((venda) => [venda.id, venda]));
  const clientePorId = new Map(clientes.map((cliente) => [cliente.id, cliente]));

  return emissoes.map((emissao) => {
    const venda = emissao.origem_id
      ? vendaPorId.get(emissao.origem_id)
      : null;
    const cliente = venda?.cliente_id
      ? clientePorId.get(venda.cliente_id)
      : null;

    return {
      id: emissao.id,
      origemId: emissao.origem_id,
      modelo: String(emissao.modelo),
      serie: Number(emissao.serie),
      numero: String(emissao.numero),
      status: String(emissao.status),
      chave: emissao.chave_acesso,
      protocolo: emissao.protocolo,
      cstat: emissao.cstat,
      motivo: emissao.motivo,
      temXml: Boolean(emissao.xml_hex),
      cliente: cliente?.nome ?? "—",
      documento: cliente?.cpf_cnpj ?? null,
      valor: Number(venda?.valor_total ?? 0),
      data: emissao.autorizada_at ?? emissao.created_at,
      cfop: null,
    };
  });
}

export function filtrarDocumentos(
  documentos: DocumentoFiscalContabil[],
  filtros: FiltrosDocumentos = {}
) {
  const filtrados = documentos.filter((documento) => {
    if (filtros.modelo && documento.modelo !== filtros.modelo) {
      return false;
    }

    if (!documentoCasaComFiltro(documento.status, filtros.status)) {
      return false;
    }

    return buscaDocumento(filtros.busca ?? "", {
      numero: documento.numero,
      chave: documento.chave,
      cliente: documento.cliente,
      documento: documento.documento,
    });
  });

  const porPagina = Math.min(Math.max(filtros.porPagina ?? 50, 10), 100);
  const pagina = Math.max(filtros.pagina ?? 1, 1);
  const inicio = (pagina - 1) * porPagina;

  return {
    total: filtrados.length,
    pagina,
    porPagina,
    itens: filtrados.slice(inicio, inicio + porPagina),
    todos: filtrados,
  };
}

export async function carregarDocumentosCompetencia(
  supabase: SupabaseClient,
  empresaId: string,
  competencia: Competencia,
  filtros: FiltrosDocumentos = {},
  fuso?: string
) {
  const emissoes = await carregarEmissoesCompetencia(
    supabase,
    empresaId,
    competencia,
    fuso
  );
  const documentos = await enriquecerDocumentos(supabase, empresaId, emissoes);
  return filtrarDocumentos(documentos, filtros);
}
