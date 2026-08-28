import { filtrarRegistrosDaEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { situacaoEstoque } from "@/lib/relatorios/calculo";
import { avaliarStatusFiscalProduto } from "@/lib/fiscal/status-fiscal-produto";
import type { GrupoFiscalResumo } from "@/lib/fiscal/status-fiscal-produto";
import { sanitizarBuscaCliente } from "@/lib/clientes/listagem";

import { autorizarFerramentaIa, recusaFerramentaIa } from "../permissoes";
import { hrefProdutoAssistente } from "../rotas";
import {
  MENSAGEM_IA_FALHA_CONSULTA,
  type NomeFerramentaIa,
  type ResultadoFerramentaIa,
} from "../tipos";
import { sanitizarTermoBuscaIa } from "./args";
import type { ContextoFerramentaIa } from "./contexto";
import { MAX_ITENS_FERRAMENTA_IA } from "./definicao";
import {
  acoesSelecaoEntidadeIa,
  mensagemAmbiguidadeIa,
  resolverEntidadesIa,
} from "./entidade";

const GRUPO_SELECT =
  "id, nome, ativo, cfop_interno, cfop_interestadual, icms_cst_csosn, icms_aliquota, pis_cst, pis_aliquota, cofins_cst, cofins_aliquota, ipi_aplicavel, ipi_cst, ipi_aliquota, cst_ibscbs, classificacao_ibscbs, aliquota_ibs_uf, aliquota_ibs_municipio, aliquota_cbs";

async function detalheProduto(
  ctx: ContextoFerramentaIa,
  ferramenta: NomeFerramentaIa,
  produtoId: string
): Promise<ResultadoFerramentaIa> {
  const { data, error } = await ctx.supabase
    .from("produtos")
    .select(
      "id, empresa_id, codigo, codigo_barras, nome, descricao, ativo, preco_venda, preco_custo, grupo_fiscal_id, categoria_id, marca_id, produtos_fiscal ( empresa_id, ncm, cest, origem_produto )"
    )
    .eq("empresa_id", ctx.empresaId)
    .eq("id", produtoId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      ferramenta,
      erro: MENSAGEM_IA_FALHA_CONSULTA,
      codigo: "falha",
    };
  }
  if (!data || String(data.empresa_id) !== ctx.empresaId) {
    return {
      ok: false,
      ferramenta,
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
    ferramenta,
    dados: {
      id: data.id,
      codigo: data.codigo,
      ean: data.codigo_barras ?? null,
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
    acoes: [
      {
        type: "open_details",
        label: "Abrir produto",
        href: hrefProdutoAssistente(String(data.id)),
        entityId: String(data.id),
        entityTipo: "produto",
      },
    ],
  };
}

export async function buscarProdutosIa(
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
    return recusaFerramentaIa("buscar_produtos", auth);
  }
  const busca = sanitizarTermoBuscaIa(args.busca ?? args.descricao ?? args.nome);
  const codigo = sanitizarTermoBuscaIa(args.codigo);
  const ean = sanitizarTermoBuscaIa(args.ean ?? args.codigoBarras);
  const categoria = sanitizarTermoBuscaIa(args.categoria);
  const marca = sanitizarTermoBuscaIa(args.marca);
  const ativo =
    args.ativo === true ? true : args.ativo === false ? false : null;
  if (!busca && !codigo && !ean && !categoria && !marca) {
    return {
      ok: false,
      ferramenta: "buscar_produtos",
      erro: "Informe nome, código, EAN, categoria ou marca do produto.",
      codigo: "nao_encontrado",
    };
  }
  try {
    let query = ctx.supabase
      .from("produtos")
      .select(
        "id, empresa_id, codigo, codigo_barras, nome, ativo, categoria_id, marca_id"
      )
      .eq("empresa_id", ctx.empresaId)
      .limit(MAX_ITENS_FERRAMENTA_IA);
    if (ativo != null) {
      query = query.eq("ativo", ativo);
    }
    const termos: string[] = [];
    const termo = busca || codigo || ean;
    if (termo) {
      termos.push(`nome.ilike.%${termo}%`);
      termos.push(`codigo.ilike.%${termo}%`);
      termos.push(`codigo_barras.ilike.%${termo}%`);
    }
    if (termos.length) {
      query = query.or(termos.join(","));
    }
    const { data, error } = await query;
    if (error) {
      return {
        ok: false,
        ferramenta: "buscar_produtos",
        erro: MENSAGEM_IA_FALHA_CONSULTA,
        codigo: "falha",
      };
    }
    let itens = filtrarRegistrosDaEmpresaAtiva(data ?? [], ctx.empresaId).map(
      (item) => ({
        id: String(item.id),
        codigo: item.codigo,
        ean: item.codigo_barras ?? null,
        nome: String(item.nome),
        ativo: item.ativo !== false,
        categoriaId: item.categoria_id ? String(item.categoria_id) : null,
        marcaId: item.marca_id ? String(item.marca_id) : null,
      })
    );

    if (categoria || marca) {
      const [{ data: cats }, { data: marcas }] = await Promise.all([
        categoria
          ? ctx.supabase
              .from("categorias")
              .select("id, empresa_id, nome")
              .eq("empresa_id", ctx.empresaId)
              .ilike("nome", `%${categoria}%`)
          : Promise.resolve({ data: [] as Array<{ id: string; empresa_id: string; nome: string }> }),
        marca
          ? ctx.supabase
              .from("marcas")
              .select("id, empresa_id, nome")
              .eq("empresa_id", ctx.empresaId)
              .ilike("nome", `%${marca}%`)
          : Promise.resolve({ data: [] as Array<{ id: string; empresa_id: string; nome: string }> }),
      ]);
      const catIds = new Set(
        filtrarRegistrosDaEmpresaAtiva(cats ?? [], ctx.empresaId).map((item) =>
          String(item.id)
        )
      );
      const marcaIds = new Set(
        filtrarRegistrosDaEmpresaAtiva(marcas ?? [], ctx.empresaId).map((item) =>
          String(item.id)
        )
      );
      itens = itens.filter((item) => {
        if (categoria && (!item.categoriaId || !catIds.has(item.categoriaId))) {
          return false;
        }
        if (marca && (!item.marcaId || !marcaIds.has(item.marcaId))) {
          return false;
        }
        return true;
      });
    }

    const resolucao = resolverEntidadesIa(itens);
    if (resolucao.tipo === "nenhum") {
      return {
        ok: false,
        ferramenta: "buscar_produtos",
        erro: "Não encontrei produto com esses dados nesta empresa.",
        codigo: "nao_encontrado",
      };
    }
    if (resolucao.tipo === "unico") {
      return detalheProduto(ctx, "buscar_produtos", resolucao.item.id);
    }
    return {
      ok: true,
      ferramenta: "buscar_produtos",
      dados: {
        ambiguidade: true,
        mensagem: mensagemAmbiguidadeIa(
          "produto",
          resolucao.itens.map((item) => item.nome)
        ),
        itens: resolucao.itens,
      },
      acoes: acoesSelecaoEntidadeIa({
        itens: resolucao.itens.map((item) => ({
          id: item.id,
          nome: item.nome,
          href: hrefProdutoAssistente(item.id),
        })),
        rotulo: "produto",
      }),
    };
  } catch {
    return {
      ok: false,
      ferramenta: "buscar_produtos",
      erro: MENSAGEM_IA_FALHA_CONSULTA,
      codigo: "falha",
    };
  }
}

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
  const busca = sanitizarTermoBuscaIa(args.busca);
  const produtoId = String(
    args.produtoId ?? (busca ? "" : ctx.tela.produtoId) ?? ""
  ).trim();
  try {
    if (produtoId) {
      return detalheProduto(ctx, "consultar_produto", produtoId);
    }
    if (!busca) {
      return {
        ok: false,
        ferramenta: "consultar_produto",
        erro: "Informe o produto ou abra a ficha na tela.",
        codigo: "nao_encontrado",
      };
    }
    const buscaSegura = sanitizarBuscaCliente(busca);
    const { data, error } = await ctx.supabase
      .from("produtos")
      .select("id, empresa_id, codigo, codigo_barras, nome, ativo")
      .eq("empresa_id", ctx.empresaId)
      .or(
        `nome.ilike.%${buscaSegura}%,codigo.ilike.%${buscaSegura}%,codigo_barras.ilike.%${buscaSegura}%`
      )
      .limit(MAX_ITENS_FERRAMENTA_IA);
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
        id: String(item.id),
        codigo: item.codigo,
        ean: item.codigo_barras ?? null,
        nome: String(item.nome),
        ativo: item.ativo !== false,
      })
    );
    const resolucao = resolverEntidadesIa(itens);
    if (resolucao.tipo === "nenhum") {
      return {
        ok: false,
        ferramenta: "consultar_produto",
        erro: "Produto não encontrado nesta empresa.",
        codigo: "nao_encontrado",
      };
    }
    if (resolucao.tipo === "unico") {
      return detalheProduto(ctx, "consultar_produto", resolucao.item.id);
    }
    return {
      ok: true,
      ferramenta: "consultar_produto",
      dados: {
        ambiguidade: true,
        mensagem: mensagemAmbiguidadeIa(
          "produto",
          resolucao.itens.map((item) => item.nome)
        ),
        itens: resolucao.itens,
      },
      acoes: acoesSelecaoEntidadeIa({
        itens: resolucao.itens.map((item) => ({
          id: item.id,
          nome: item.nome,
          href: hrefProdutoAssistente(item.id),
        })),
        rotulo: "produto",
      }),
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
  args: Record<string, unknown>,
  ferramenta: NomeFerramentaIa = "consultar_estoque"
): Promise<ResultadoFerramentaIa> {
  const auth = await autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso: "estoque",
    acao: "acessar",
  });
  if (!auth.ok) {
    return recusaFerramentaIa(ferramenta, auth);
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
      ferramenta,
      dados: {
        resumo,
        itens: filtrados.slice(0, MAX_ITENS_FERRAMENTA_IA),
      },
      acoes: filtrados.slice(0, 3).map((item) => ({
        type: "open_details" as const,
        label: `Abrir ${item.nome}`,
        href: hrefProdutoAssistente(item.produtoId),
        entityId: item.produtoId,
        entityTipo: "produto",
      })),
    };
  } catch {
    return {
      ok: false,
      ferramenta,
      erro: MENSAGEM_IA_FALHA_CONSULTA,
      codigo: "falha",
    };
  }
}

export async function consultarEstoqueBaixoIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
) {
  return consultarEstoqueIa(ctx, { ...args, filtro: "acabando" }, "consultar_estoque_baixo");
}

export async function consultarEstoqueNegativoIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
) {
  return consultarEstoqueIa(ctx, { ...args, filtro: "negativos" }, "consultar_estoque_negativo");
}
