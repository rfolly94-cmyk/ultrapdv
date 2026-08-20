import type { SupabaseClient } from "@supabase/supabase-js";

import type { Competencia } from "@/lib/contabilidade/competencia";
import { intervaloCompetencia } from "@/lib/contabilidade/competencia";
import {
  inconsistenciasNumeracao,
  pendenciasDeEmissao,
} from "@/lib/contabilidade/regras";

export type GravidadeAuditoria = "erro" | "atencao" | "info";

export type ItemAuditoria = {
  gravidade: GravidadeAuditoria;
  tipo: string;
  descricao: string;
  relacionado?: string;
  href?: string;
};

export type ResultadoAuditoria = {
  documentosAnalisados: number;
  erros: number;
  alertas: number;
  informacoes: number;
  itens: ItemAuditoria[];
};

export async function auditarCompetencia(
  supabase: SupabaseClient,
  empresaId: string,
  competencia: Competencia,
  fuso?: string
): Promise<ResultadoAuditoria> {
  const { inicio, fim } = intervaloCompetencia(competencia, fuso);
  const itens: ItemAuditoria[] = [];

  const [
    { data: empresa },
    { data: fiscal },
    { data: emissoes },
    { data: produtos },
    { data: estoques },
  ] = await Promise.all([
    supabase
      .from("empresas")
      .select("cnpj")
      .eq("id", empresaId)
      .maybeSingle(),
    supabase
      .from("empresas_fiscal")
      .select("inscricao_estadual, uf, codigo_regime_tributario")
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    supabase
      .from("fiscal_emissoes")
      .select(`
        id,
        origem_id,
        modelo,
        serie,
        numero,
        status,
        chave_acesso,
        protocolo,
        xml_hex,
        created_at
      `)
      .eq("empresa_id", empresaId)
      .gte("created_at", inicio.toISOString())
      .lt("created_at", fim.toISOString())
      .limit(2000),
    supabase
      .from("produtos")
      .select(`
        id,
        codigo,
        nome,
        unidade_medida,
        grupo_fiscal_id,
        ativo,
        produtos_fiscal (
          ncm,
          origem_produto
        )
      `)
      .eq("empresa_id", empresaId)
      .eq("ativo", true)
      .limit(2000),
    supabase
      .from("estoque_atual")
      .select("produto_id, quantidade")
      .eq("empresa_id", empresaId),
  ]);

  if (!empresa?.cnpj) {
    itens.push({
      gravidade: "erro",
      tipo: "Empresa",
      descricao: "CNPJ da empresa ausente.",
      href: "/configuracoes/fiscal",
    });
  }

  if (!fiscal?.inscricao_estadual) {
    itens.push({
      gravidade: "atencao",
      tipo: "Empresa",
      descricao: "Inscrição estadual ausente.",
      href: "/configuracoes/fiscal",
    });
  }

  if (!fiscal?.uf) {
    itens.push({
      gravidade: "erro",
      tipo: "Empresa",
      descricao: "UF fiscal ausente.",
      href: "/configuracoes/fiscal",
    });
  }

  if (fiscal?.codigo_regime_tributario == null) {
    itens.push({
      gravidade: "atencao",
      tipo: "Empresa",
      descricao: "CRT/regime tributário ausente.",
      href: "/configuracoes/fiscal",
    });
  }

  const documentos = emissoes ?? [];
  const eventosIds = documentos
    .filter((item) => item.status === "cancelada")
    .map((item) => item.id);

  const { data: eventos } = eventosIds.length
    ? await supabase
        .from("fiscal_emissao_eventos")
        .select("emissao_id, tipo, xml_hex")
        .eq("empresa_id", empresaId)
        .in("emissao_id", eventosIds)
    : { data: [] };

  const eventoPorEmissao = new Set(
    (eventos ?? [])
      .filter((evento) => evento.tipo === "cancelamento")
      .map((evento) => evento.emissao_id)
  );

  for (const emissao of documentos) {
    const rotulo = `${emissao.modelo === "55" ? "NF-e" : "NFC-e"} ${emissao.serie}/${emissao.numero}`;
    for (const pendencia of pendenciasDeEmissao({
      ...emissao,
      temEventoCancelamento: eventoPorEmissao.has(emissao.id),
    })) {
      itens.push({
        gravidade: pendencia.gravidade,
        tipo: "Documento",
        descricao: pendencia.descricao,
        relacionado: rotulo,
        href: pendencia.href,
      });
    }
  }

  for (const aviso of inconsistenciasNumeracao(documentos)) {
    itens.push({
      gravidade: "atencao",
      tipo: "Documento",
      descricao: aviso,
    });
  }

  const origemIds = documentos
    .filter((item) => item.status === "autorizada" && item.origem_id)
    .map((item) => item.origem_id as string);

  const { data: itensVenda } = origemIds.length
    ? await supabase
        .from("vendas_itens")
        .select("produto_id, produto_codigo, produto_nome")
        .eq("empresa_id", empresaId)
        .in("venda_id", origemIds.slice(0, 400))
    : { data: [] };

  const produtosPorId = new Map((produtos ?? []).map((item) => [item.id, item]));
  const vendidos = new Set<string>();

  for (const item of itensVenda ?? []) {
    if (!item.produto_id) {
      itens.push({
        gravidade: "atencao",
        tipo: "Estoque",
        descricao: `Item vendido sem produto vinculado: ${item.produto_codigo ?? item.produto_nome ?? "—"}.`,
      });
      continue;
    }

    vendidos.add(item.produto_id);
    const produto = produtosPorId.get(item.produto_id);
    if (!produto) {
      itens.push({
        gravidade: "atencao",
        tipo: "Estoque",
        descricao: `Produto vendido inexistente ou inativo: ${item.produto_codigo ?? item.produto_nome ?? item.produto_id}.`,
        href: "/produtos",
      });
    }
  }

  for (const produto of produtos ?? []) {
    if (!vendidos.has(produto.id)) {
      continue;
    }

    const fiscalProduto = Array.isArray(produto.produtos_fiscal)
      ? produto.produtos_fiscal[0]
      : produto.produtos_fiscal;

    if (!fiscalProduto?.ncm) {
      itens.push({
        gravidade: "atencao",
        tipo: "Produto",
        descricao: `${produto.codigo} — ${produto.nome} sem NCM.`,
        relacionado: produto.nome,
        href: `/produtos?fiscal=${produto.id}`,
      });
    }

    if (!produto.unidade_medida) {
      itens.push({
        gravidade: "erro",
        tipo: "Produto",
        descricao: `${produto.codigo} — ${produto.nome} sem unidade.`,
        relacionado: produto.nome,
        href: "/produtos",
      });
    }

    if (!fiscalProduto?.origem_produto && fiscalProduto?.origem_produto !== 0) {
      itens.push({
        gravidade: "info",
        tipo: "Produto",
        descricao: `${produto.codigo} — ${produto.nome} sem origem.`,
        relacionado: produto.nome,
        href: `/produtos?fiscal=${produto.id}`,
      });
    }

    if (!produto.grupo_fiscal_id) {
      itens.push({
        gravidade: "info",
        tipo: "Produto",
        descricao: `${produto.codigo} — ${produto.nome} sem grupo fiscal.`,
        relacionado: produto.nome,
        href: "/produtos",
      });
    }
  }

  for (const estoque of estoques ?? []) {
    if (Number(estoque.quantidade ?? 0) < 0) {
      itens.push({
        gravidade: "atencao",
        tipo: "Estoque",
        descricao: "Há produto com estoque negativo.",
        href: "/estoque",
      });
      break;
    }
  }

  const erros = itens.filter((item) => item.gravidade === "erro").length;
  const alertas = itens.filter((item) => item.gravidade === "atencao").length;
  const informacoes = itens.filter((item) => item.gravidade === "info").length;

  return {
    documentosAnalisados: documentos.length,
    erros,
    alertas,
    informacoes,
    itens,
  };
}
