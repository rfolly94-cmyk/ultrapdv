import { filtrarRegistrosDaEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { situacaoEstoque } from "@/lib/relatorios/calculo";
import { avaliarStatusFiscalProduto } from "@/lib/fiscal/status-fiscal-produto";
import type { GrupoFiscalResumo } from "@/lib/fiscal/status-fiscal-produto";

import { autorizarFerramentaIa, recusaFerramentaIa } from "../permissoes";
import { hrefProdutoAssistente } from "../rotas";
import {
  MENSAGEM_IA_FALHA_CONSULTA,
  type ResultadoFerramentaIa,
} from "../tipos";
import type { ContextoFerramentaIa } from "./contexto";

const GRUPO_SELECT =
  "id, nome, ativo, cfop_interno, cfop_interestadual, icms_cst_csosn, icms_aliquota, pis_cst, pis_aliquota, cofins_cst, cofins_aliquota, ipi_aplicavel, ipi_cst, ipi_aliquota, cst_ibscbs, classificacao_ibscbs, aliquota_ibs_uf, aliquota_ibs_municipio, aliquota_cbs";

export async function consultarProdutoIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const auth = await autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso: "produtos",
    acao: "acessar",
  });
  if (!auth.ok) {
    return recusaFerramentaIa("consultar_produto", auth);
  }
  const busca = String(args.busca ?? "").trim();
  const produtoId = String(
    args.produtoId ?? (busca ? "" : ctx.tela.produtoId) ?? ""
  ).trim();
  try {
    if (produtoId) {
      const { data, error } = await ctx.supabase
        .from("produtos")
        .select(
          "id, empresa_id, codigo, nome, descricao, ativo, preco_venda, preco_custo, grupo_fiscal_id, produtos_fiscal ( empresa_id, ncm, cest, origem_produto )"
        )
        .eq("empresa_id", ctx.empresaId)
        .eq("id", produtoId)
        .maybeSingle();
      if (error) {
        return {
          ok: false,
          ferramenta: "consultar_produto",
          erro: MENSAGEM_IA_FALHA_CONSULTA,
          codigo: "falha",
        };
      }
      if (!data || String(data.empresa_id) !== ctx.empresaId) {
        return {
          ok: false,
          ferramenta: "consultar_produto",
          erro: "Produto não encontrado nesta empresa.",
          codigo: "nao_encontrado",
        };
      }
      const fiscalRaw = Array.isArray(data.produtos_fiscal)
        ? data.produtos_fiscal[0]
        : data.produtos_fiscal;
      const { data: estoque } = await ctx.supabase
        .from("estoque_atual")
        .select("quantidade, estoque_minimo")
        .eq("empresa_id", ctx.empresaId)
        .eq("produto_id", produtoId)
        .maybeSingle();
      let grupo: GrupoFiscalResumo | null = null;
      if (data.grupo_fiscal_id) {
        const { data: grupoRow } = await ctx.supabase
          .from("grupos_fiscais")
          .select(GRUPO_SELECT)
          .eq("empresa_id", ctx.empresaId)
          .eq("id", data.grupo_fiscal_id)
          .maybeSingle();
        grupo = (grupoRow as GrupoFiscalResumo | null) ?? null;
      }
      const status = avaliarStatusFiscalProduto({
        ncm: fiscalRaw?.ncm,
        grupo,
      });
      return {
        ok: true,
        ferramenta: "consultar_produto",
        dados: {
          id: data.id,
          codigo: data.codigo,
          nome: data.nome,
          ativo: data.ativo !== false,
          precoVenda: Number(data.preco_venda ?? 0),
          estoque: Number(estoque?.quantidade ?? 0),
          estoqueMinimo: Number(estoque?.estoque_minimo ?? 0),
          ncm: fiscalRaw?.ncm ?? null,
          cest: fiscalRaw?.cest ?? null,
          origem: fiscalRaw?.origem_produto ?? null,
          grupoFiscal: grupo
            ? {
                id: grupo.id,
                nome: grupo.nome,
                cstIbscbs: grupo.cst_ibscbs,
                cClassTrib: grupo.classificacao_ibscbs,
                cfopInterno: grupo.cfop_interno,
                icms: grupo.icms_cst_csosn,
                pis: grupo.pis_cst,
                cofins: grupo.cofins_cst,
              }
            : null,
          fiscalOk: status.ok,
          fiscalMotivos: status.motivos,
        },
        acoes: [{ label: "Abrir produto", href: hrefProdutoAssistente(String(data.id)) }],
      };
    }

    if (!busca) {
      return {
        ok: false,
        ferramenta: "consultar_produto",
        erro: "Informe o produto ou abra a ficha na tela.",
        codigo: "nao_encontrado",
      };
    }

    const { data, error } = await ctx.supabase
      .from("produtos")
      .select("id, empresa_id, codigo, nome, ativo")
      .eq("empresa_id", ctx.empresaId)
      .or(`nome.ilike.%${busca}%,codigo.ilike.%${busca}%`)
      .limit(8);
    if (error) {
      return {
        ok: false,
        ferramenta: "consultar_produto",
        erro: MENSAGEM_IA_FALHA_CONSULTA,
        codigo: "falha",
      };
    }
    const itens = filtrarRegistrosDaEmpresaAtiva(data ?? [], ctx.empresaId).map(
      (item) => ({
        id: item.id,
        codigo: item.codigo,
        nome: item.nome,
        ativo: item.ativo !== false,
      })
    );
    return {
      ok: true,
      ferramenta: "consultar_produto",
      dados: { itens },
      acoes: itens.slice(0, 3).map((item) => ({
        label: `Abrir ${item.nome}`,
        href: hrefProdutoAssistente(String(item.id)),
      })),
    };
  } catch {
    return {
      ok: false,
      ferramenta: "consultar_produto",
      erro: MENSAGEM_IA_FALHA_CONSULTA,
      codigo: "falha",
    };
  }
}

export async function consultarEstoqueIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const auth = await autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso: "estoque",
    acao: "acessar",
  });
  if (!auth.ok) {
    return recusaFerramentaIa("consultar_estoque", auth);
  }
  const filtro = String(args.filtro ?? "acabando");
  try {
    const [{ data: produtos }, { data: estoque }] = await Promise.all([
      ctx.supabase
        .from("produtos")
        .select("id, empresa_id, nome, ativo")
        .eq("empresa_id", ctx.empresaId)
        .eq("ativo", true),
      ctx.supabase
        .from("estoque_atual")
        .select("empresa_id, produto_id, quantidade, estoque_minimo")
        .eq("empresa_id", ctx.empresaId),
    ]);
    const nomes = new Map(
      filtrarRegistrosDaEmpresaAtiva(produtos ?? [], ctx.empresaId).map((item) => [
        String(item.id),
        String(item.nome),
      ])
    );
    const itens = filtrarRegistrosDaEmpresaAtiva(estoque ?? [], ctx.empresaId)
      .map((item) => {
        const quantidade = Number(item.quantidade ?? 0);
        const minimo = Number(item.estoque_minimo ?? 0);
        return {
          produtoId: String(item.produto_id),
          nome: nomes.get(String(item.produto_id)) ?? "Produto",
          quantidade,
          minimo,
          situacao: situacaoEstoque({ quantidade, estoqueMinimo: minimo }),
        };
      })
      .filter((item) => nomes.has(item.produtoId));

    const filtrados = itens.filter((item) => {
      if (filtro === "zerados") {
        return item.situacao === "sem";
      }
      if (filtro === "negativos") {
        return item.situacao === "negativo";
      }
      if (filtro === "acabando" || filtro === "baixo") {
        return item.situacao === "baixo" || item.situacao === "sem" || item.situacao === "negativo";
      }
      return true;
    });

    const resumo = {
      baixo: itens.filter((item) => item.situacao === "baixo").length,
      zerados: itens.filter((item) => item.situacao === "sem").length,
      negativos: itens.filter((item) => item.situacao === "negativo").length,
    };

    return {
      ok: true,
      ferramenta: "consultar_estoque",
      dados: {
        resumo,
        itens: filtrados.slice(0, 8),
      },
      acoes: filtrados.slice(0, 3).map((item) => ({
        label: `Abrir ${item.nome}`,
        href: hrefProdutoAssistente(item.produtoId),
      })),
    };
  } catch {
    return {
      ok: false,
      ferramenta: "consultar_estoque",
      erro: MENSAGEM_IA_FALHA_CONSULTA,
      codigo: "falha",
    };
  }
}
