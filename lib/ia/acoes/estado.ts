import type { SupabaseClient } from "@supabase/supabase-js";

import { hashEstadoEntidade } from "./hash";
import type { EntidadeAcaoIa, TipoAcaoIa } from "./tipos";

export async function hashProdutoFiscal(params: {
  supabase: SupabaseClient;
  empresaId: string;
  produtoId: string;
}) {
  const { data } = await params.supabase
    .from("produtos")
    .select(
      "id, empresa_id, descricao, categoria_id, grupo_fiscal_id, produtos_fiscal ( ncm, cest, origem_produto )"
    )
    .eq("empresa_id", params.empresaId)
    .eq("id", params.produtoId)
    .maybeSingle();
  if (!data || String(data.empresa_id) !== params.empresaId) {
    return null;
  }
  const fiscal = Array.isArray(data.produtos_fiscal)
    ? data.produtos_fiscal[0]
    : data.produtos_fiscal;
  const campos = {
    ncm: fiscal?.ncm ?? null,
    cest: fiscal?.cest ?? null,
    origem_produto: fiscal?.origem_produto ?? null,
    grupo_fiscal_id: data.grupo_fiscal_id ?? null,
    descricao: data.descricao ?? null,
    categoria_id: data.categoria_id ?? null,
  };
  return { hash: hashEstadoEntidade(campos), campos, existe: true };
}

export async function hashProdutoBasico(params: {
  supabase: SupabaseClient;
  empresaId: string;
  produtoId: string;
}) {
  const { data } = await params.supabase
    .from("produtos")
    .select("id, empresa_id, descricao, categoria_id, nome, codigo")
    .eq("empresa_id", params.empresaId)
    .eq("id", params.produtoId)
    .maybeSingle();
  if (!data || String(data.empresa_id) !== params.empresaId) {
    return null;
  }
  const { data: estoque } = await params.supabase
    .from("estoque_atual")
    .select("estoque_minimo, estoque_maximo")
    .eq("empresa_id", params.empresaId)
    .eq("produto_id", params.produtoId)
    .maybeSingle();
  const campos = {
    descricao: data.descricao ?? null,
    categoria_id: data.categoria_id ?? null,
    estoque_minimo: estoque?.estoque_minimo ?? null,
    estoque_maximo: estoque?.estoque_maximo ?? null,
  };
  return { hash: hashEstadoEntidade(campos), campos, existe: true, produto: data };
}

export async function hashGrupoFiscal(params: {
  supabase: SupabaseClient;
  empresaId: string;
  grupoId: string;
}) {
  const { data } = await params.supabase
    .from("grupos_fiscais")
    .select(
      "id, empresa_id, nome, cfop_interno, cfop_interestadual, icms_cst_csosn, pis_cst, cofins_cst, cst_ibscbs, classificacao_ibscbs, ativo"
    )
    .eq("empresa_id", params.empresaId)
    .eq("id", params.grupoId)
    .maybeSingle();
  if (!data || String(data.empresa_id) !== params.empresaId) {
    return null;
  }
  return { hash: hashEstadoEntidade(data as Record<string, unknown>), campos: data, existe: true };
}

export async function hashNotificacoes(params: {
  supabase: SupabaseClient;
  empresaId: string;
  usuarioId: string;
  ids: string[];
}) {
  const ids = [...params.ids].sort();
  const { data } = await params.supabase
    .from("notificacoes_usuarios")
    .select("notificacao_id, lida_em, dispensada_em, adiada_ate")
    .eq("empresa_id", params.empresaId)
    .eq("usuario_id", params.usuarioId)
    .in("notificacao_id", ids);
  const porId = new Map(
    (data ?? []).map((row) => [String(row.notificacao_id), row])
  );
  const campos = {
    ids,
    estados: ids.map((id) => {
      const row = porId.get(id);
      return {
        id,
        lida_em: row?.lida_em ?? null,
        dispensada_em: row?.dispensada_em ?? null,
        adiada_ate: row?.adiada_ate ?? null,
      };
    }),
  };
  return { hash: hashEstadoEntidade(campos), campos, existe: true };
}

export async function hashDaEntidade(params: {
  supabase: SupabaseClient;
  empresaId: string;
  usuarioId: string;
  tipo: TipoAcaoIa;
  entidadeTipo: EntidadeAcaoIa;
  entidadeId: string | null;
  ids?: string[];
}) {
  if (params.tipo === "criacao_grupo_fiscal") {
    return {
      hash: hashEstadoEntidade({ tipo: "criacao_grupo_fiscal", empresaId: params.empresaId }),
      campos: { empresaId: params.empresaId },
      existe: true,
    };
  }
  if (
    params.tipo === "notificacao_lida" ||
    params.tipo === "notificacao_dispensar" ||
    params.tipo === "notificacao_adiar"
  ) {
    const ids = params.ids ?? (params.entidadeId ? [params.entidadeId] : []);
    return hashNotificacoes({
      supabase: params.supabase,
      empresaId: params.empresaId,
      usuarioId: params.usuarioId,
      ids,
    });
  }
  if (!params.entidadeId) {
    return null;
  }
  if (params.tipo === "atualizacao_basica_produto") {
    return hashProdutoBasico({
      supabase: params.supabase,
      empresaId: params.empresaId,
      produtoId: params.entidadeId,
    });
  }
  if (params.entidadeTipo === "grupo_fiscal") {
    return hashGrupoFiscal({
      supabase: params.supabase,
      empresaId: params.empresaId,
      grupoId: params.entidadeId,
    });
  }
  return hashProdutoFiscal({
    supabase: params.supabase,
    empresaId: params.empresaId,
    produtoId: params.entidadeId,
  });
}
