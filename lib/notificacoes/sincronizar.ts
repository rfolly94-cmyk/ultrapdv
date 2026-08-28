import type { SupabaseClient } from "@supabase/supabase-js";

import { chaveDiaSaoPaulo } from "@/lib/dashboard/periodo";

import { avaliarCaixaNotificacoes } from "./avaliar-caixa";
import { avaliarEstoqueNotificacoes } from "./avaliar-estoque";
import { avaliarFinanceiroNotificacoes } from "./avaliar-financeiro";
import { avaliarFiscalNotificacoes } from "./avaliar-fiscal";
import { avaliarValidadeNotificacoes } from "./avaliar-validade";
import {
  normalizarConfiguracaoNotificacoes,
  tiposNotificacaoHabilitados,
} from "./config";
import { actionUrlSegura } from "./rotas";
import { tabelaNotificacoesIndisponivel } from "./schema";
import { planejarSincronizacaoNotificacoes } from "./sincronizar-plano";
import {
  TIPOS_NOTIFICACAO,
  type CandidatoNotificacao,
  type ConfiguracaoNotificacoes,
  type NotificacaoPersistida,
  type TipoNotificacao,
} from "./tipos";

const THROTTLE_MS = 5 * 60 * 1000;

export function mapearNotificacao(row: Record<string, unknown>): NotificacaoPersistida {
  return {
    id: String(row.id),
    empresaId: String(row.empresa_id),
    tipo: row.tipo as TipoNotificacao,
    categoria: row.categoria as NotificacaoPersistida["categoria"],
    nivel: row.nivel as NotificacaoPersistida["nivel"],
    titulo: String(row.titulo ?? ""),
    mensagem: String(row.mensagem ?? ""),
    entidadeTipo: row.entidade_tipo ? String(row.entidade_tipo) : null,
    entidadeId: row.entidade_id ? String(row.entidade_id) : null,
    actionUrl: actionUrlSegura(row.action_url ? String(row.action_url) : null),
    chaveDeduplicacao: String(row.chave_deduplicacao ?? ""),
    metadata:
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {},
    status: row.status === "resolvida" ? "resolvida" : "ativa",
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
  };
}

export async function carregarConfiguracaoNotificacoesEmpresa(
  supabase: SupabaseClient,
  empresaId: string
): Promise<
  | { ok: true; config: ConfiguracaoNotificacoes; sincronizadoEm: string | null }
  | { ok: false; erro: string; indisponivel?: boolean }
> {
  const { data, error } = await supabase
    .from("notificacoes_configuracoes")
    .select("configuracao, sincronizado_em")
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (error) {
    if (tabelaNotificacoesIndisponivel(error)) {
      return { ok: false, erro: error.message, indisponivel: true };
    }
    return { ok: false, erro: error.message };
  }

  return {
    ok: true,
    config: normalizarConfiguracaoNotificacoes(data?.configuracao),
    sincronizadoEm: data?.sincronizado_em
      ? String(data.sincronizado_em)
      : null,
  };
}

async function garantirConfiguracao(
  supabase: SupabaseClient,
  empresaId: string,
  config: ConfiguracaoNotificacoes
) {
  const { error } = await supabase.from("notificacoes_configuracoes").upsert(
    {
      empresa_id: empresaId,
      configuracao: config,
    },
    { onConflict: "empresa_id" }
  );
  return error;
}

async function coletarCandidatos(params: {
  supabase: SupabaseClient;
  empresaId: string;
  config: ConfiguracaoNotificacoes;
}): Promise<CandidatoNotificacao[]> {
  const { supabase, empresaId, config } = params;
  const agora = new Date();
  const hojeIso = chaveDiaSaoPaulo(agora);
  const habilitados = new Set(tiposNotificacaoHabilitados(config));

  const precisaEstoque =
    habilitados.has("estoque_baixo") ||
    habilitados.has("estoque_zerado") ||
    habilitados.has("estoque_negativo");
  const precisaValidade =
    habilitados.has("lote_vencendo") || habilitados.has("lote_vencido");
  const precisaCarteira = habilitados.has("carteira_vencida");
  const precisaFiscal =
    habilitados.has("fiscal_rejeitada") ||
    habilitados.has("fiscal_aguardando_reconciliacao");
  const precisaCertificado = habilitados.has("fiscal_certificado_vencendo");
  const precisaRevisaoBase = habilitados.has("fiscal_revisao_base");
  const precisaCaixa = habilitados.has("caixa_aberto_anterior");

  const [
    estoqueRes,
    produtosRes,
    lotesRes,
    titulosRes,
    clientesRes,
    fiscalRes,
    certificadoRes,
    caixaRes,
  ] = await Promise.all([
    precisaEstoque
      ? supabase
          .from("estoque_atual")
          .select("produto_id, quantidade, estoque_minimo")
          .eq("empresa_id", empresaId)
      : Promise.resolve({ data: [], error: null }),
    precisaEstoque || precisaValidade
      ? supabase
          .from("produtos")
          .select("id, nome, ativo")
          .eq("empresa_id", empresaId)
      : Promise.resolve({ data: [], error: null }),
    precisaValidade
      ? supabase
          .from("estoque_lotes")
          .select("id, produto_id, codigo_lote, data_validade, quantidade")
          .eq("empresa_id", empresaId)
          .gt("quantidade", 0)
      : Promise.resolve({ data: [], error: null }),
    precisaCarteira
      ? supabase
          .from("carteira_cliente_titulos")
          .select("cliente_id, valor_aberto, vencimento, status")
          .eq("empresa_id", empresaId)
          .in("status", ["ABERTO", "PARCIAL"])
      : Promise.resolve({ data: [], error: null }),
    precisaCarteira
      ? supabase
          .from("clientes")
          .select("id, nome")
          .eq("empresa_id", empresaId)
      : Promise.resolve({ data: [], error: null }),
    precisaFiscal
      ? supabase
          .from("fiscal_emissoes")
          .select("id, modelo, numero, status, origem_tipo, origem_id")
          .eq("empresa_id", empresaId)
          .in("status", ["rejeitada", "aguardando_reconciliacao"])
      : Promise.resolve({ data: [], error: null }),
    precisaCertificado
      ? supabase
          .from("fiscal_credenciais_status")
          .select("empresa_id, certificado_validade")
          .eq("empresa_id", empresaId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    precisaCaixa
      ? supabase
          .from("caixas")
          .select("id, status, aberto_em")
          .eq("empresa_id", empresaId)
          .eq("status", "aberto")
          .is("filial_id", null)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const impactoRes = precisaRevisaoBase
    ? await supabase
        .from("fiscal_ia_impacto_empresa")
        .select("versao_id, quantidade_produtos, ativo")
        .eq("empresa_id", empresaId)
        .eq("ativo", true)
    : { data: [] as Array<{ versao_id?: string; quantidade_produtos?: number }>, error: null };

  const produtosPorId = new Map(
    (produtosRes.data ?? []).map((item) => [
      String(item.id),
      {
        nome: String(item.nome ?? ""),
        ativo: item.ativo !== false,
      },
    ])
  );

  const candidatos: CandidatoNotificacao[] = [];

  if (precisaEstoque && !estoqueRes.error) {
    candidatos.push(
      ...avaliarEstoqueNotificacoes({
        config,
        itens: (estoqueRes.data ?? []).map((item) => {
          const produto = produtosPorId.get(String(item.produto_id));
          return {
            produtoId: String(item.produto_id),
            nome: produto?.nome ?? "Produto",
            ativo: produto?.ativo !== false,
            quantidade: item.quantidade,
            estoqueMinimo: item.estoque_minimo,
          };
        }),
      })
    );
  }

  if (precisaValidade && !lotesRes.error) {
    candidatos.push(
      ...avaliarValidadeNotificacoes({
        config,
        referencia: agora,
        lotes: (lotesRes.data ?? []).map((item) => {
          const produto = produtosPorId.get(String(item.produto_id));
          return {
            loteId: String(item.id),
            produtoId: String(item.produto_id),
            nomeProduto: produto?.nome ?? "Produto",
            codigoLote: String(item.codigo_lote ?? ""),
            dataValidade: String(item.data_validade ?? ""),
            quantidade: item.quantidade,
          };
        }),
      })
    );
  }

  if (precisaCarteira && !titulosRes.error) {
    const nomes = new Map(
      (clientesRes.data ?? []).map((item) => [
        String(item.id),
        String(item.nome ?? ""),
      ])
    );
    candidatos.push(
      ...avaliarFinanceiroNotificacoes({
        config,
        hojeIso,
        titulos: (titulosRes.data ?? []).map((item) => ({
          clienteId: String(item.cliente_id),
          nomeCliente: nomes.get(String(item.cliente_id)) ?? "Cliente",
          status: String(item.status ?? ""),
          valorAberto: item.valor_aberto,
          vencimento: item.vencimento ? String(item.vencimento) : null,
        })),
      })
    );
  }

  const certificadoErroIgnoravel =
    certificadoRes.error &&
    (tabelaNotificacoesIndisponivel(certificadoRes.error) ||
      /fiscal_credenciais_status|certificado_validade/i.test(
        String(certificadoRes.error.message ?? "")
      ));

  candidatos.push(
    ...avaliarFiscalNotificacoes({
      config,
      referencia: agora,
      emissoes: precisaFiscal && !fiscalRes.error
        ? (fiscalRes.data ?? []).map((item) => ({
            id: String(item.id),
            modelo: item.modelo ? String(item.modelo) : null,
            numero: item.numero,
            status: String(item.status ?? ""),
            origemTipo: item.origem_tipo ? String(item.origem_tipo) : null,
            origemId: item.origem_id ? String(item.origem_id) : null,
          }))
        : [],
      certificado:
        precisaCertificado && !certificadoErroIgnoravel && certificadoRes.data
          ? {
              empresaId,
              validade: certificadoRes.data.certificado_validade
                ? String(certificadoRes.data.certificado_validade)
                : null,
            }
          : null,
      impactosBase:
        precisaRevisaoBase && !impactoRes.error
          ? (impactoRes.data ?? []).map((item) => ({
              versaoId: String(item.versao_id ?? ""),
              quantidade: Number(item.quantidade_produtos ?? 0),
            }))
          : [],
    })
  );

  if (precisaCaixa && !caixaRes.error) {
    candidatos.push(
      ...avaliarCaixaNotificacoes({
        config,
        agora,
        caixa: caixaRes.data
          ? {
              id: String(caixaRes.data.id),
              status: String(caixaRes.data.status ?? ""),
              abertoEm: caixaRes.data.aberto_em
                ? String(caixaRes.data.aberto_em)
                : null,
            }
          : null,
      })
    );
  }

  return candidatos.map((item) => ({
    ...item,
    actionUrl: actionUrlSegura(item.actionUrl),
  }));
}

export async function sincronizarNotificacoesEmpresa(params: {
  supabase: SupabaseClient;
  empresaId: string;
  forcar?: boolean;
}): Promise<
  | { ok: true; avaliadas: number; throttled?: boolean }
  | { ok: false; erro: string; indisponivel?: boolean }
> {
  const carregada = await carregarConfiguracaoNotificacoesEmpresa(
    params.supabase,
    params.empresaId
  );
  if (!carregada.ok) {
    return carregada;
  }

  if (!params.forcar && carregada.sincronizadoEm) {
    const idade =
      Date.now() - new Date(carregada.sincronizadoEm).getTime();
    if (Number.isFinite(idade) && idade >= 0 && idade < THROTTLE_MS) {
      return { ok: true, avaliadas: 0, throttled: true };
    }
  }

  const config = carregada.config;
  const garantir = await garantirConfiguracao(
    params.supabase,
    params.empresaId,
    config
  );
  if (garantir && tabelaNotificacoesIndisponivel(garantir)) {
    return { ok: false, erro: garantir.message, indisponivel: true };
  }

  const candidatos = await coletarCandidatos({
    supabase: params.supabase,
    empresaId: params.empresaId,
    config,
  });

  const { data: existentesBruto, error: erroExistentes } = await params.supabase
    .from("notificacoes")
    .select(
      "id, empresa_id, tipo, categoria, nivel, titulo, mensagem, entidade_tipo, entidade_id, action_url, chave_deduplicacao, metadata, status, created_at, updated_at, resolved_at"
    )
    .eq("empresa_id", params.empresaId);

  if (erroExistentes) {
    if (tabelaNotificacoesIndisponivel(erroExistentes)) {
      return { ok: false, erro: erroExistentes.message, indisponivel: true };
    }
    return { ok: false, erro: erroExistentes.message };
  }

  const existentes = (existentesBruto ?? []).map((row) =>
    mapearNotificacao(row as Record<string, unknown>)
  );
  const plano = planejarSincronizacaoNotificacoes({
    existentes,
    candidatos,
    tiposAvaliados: TIPOS_NOTIFICACAO,
  });

  if (plano.upsert.length > 0) {
    const { error } = await params.supabase.from("notificacoes").upsert(
      plano.upsert.map((item) => ({
        empresa_id: params.empresaId,
        tipo: item.tipo,
        categoria: item.categoria,
        nivel: item.nivel,
        titulo: item.titulo,
        mensagem: item.mensagem,
        entidade_tipo: item.entidadeTipo,
        entidade_id: item.entidadeId,
        action_url: actionUrlSegura(item.actionUrl),
        chave_deduplicacao: item.chaveDeduplicacao,
        metadata: item.metadata,
        status: "ativa",
        resolved_at: null,
      })),
      { onConflict: "empresa_id,chave_deduplicacao" }
    );
    if (error) {
      return { ok: false, erro: error.message };
    }
  }

  if (plano.resolverIds.length > 0) {
    const { error } = await params.supabase
      .from("notificacoes")
      .update({
        status: "resolvida",
        resolved_at: new Date().toISOString(),
      })
      .eq("empresa_id", params.empresaId)
      .in("id", plano.resolverIds)
      .eq("status", "ativa");
    if (error) {
      return { ok: false, erro: error.message };
    }
  }

  const { error: erroSync } = await params.supabase
    .from("notificacoes_configuracoes")
    .update({ sincronizado_em: new Date().toISOString() })
    .eq("empresa_id", params.empresaId);
  if (erroSync && !tabelaNotificacoesIndisponivel(erroSync)) {
    return { ok: false, erro: erroSync.message };
  }

  return { ok: true, avaliadas: candidatos.length };
}
