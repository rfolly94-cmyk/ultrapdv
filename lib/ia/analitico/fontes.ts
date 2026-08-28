import { filtrarRegistrosDaEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { buscarEmLotes } from "@/lib/relatorios/contexto";
import {
  vendaValidaParaFaturamento,
  vendasNoPeriodo,
  type ItemVendaRelatorio,
  type PagamentoRelatorio,
} from "@/lib/relatorios/calculo";
import { chaveDiaSaoPaulo, dataVenda } from "@/lib/relatorios/periodo";
import { numeroSeguro } from "@/lib/relatorios/formatacao";
import {
  agregarCarteiraPorCliente,
  situacaoCarteiraCliente,
} from "@/lib/clientes/listagem";
import { carregarPainelCaixa } from "@/lib/caixa/carregar";
import { podeRevelarEsperadoCaixaCego } from "@/lib/caixa/conferencia";
import { analisarGruposFiscaisProdutos } from "@/lib/fiscal/motor/analisar-lote";
import { dataReferenciaIso } from "@/lib/fiscal/motor/tipos";

import type { ContextoFerramentaIa } from "../ferramentas/contexto";
import { autorizarFerramentaIa } from "../permissoes";
import type { RecursoFerramentaIa } from "../permissoes";
import { metricaAnalitica } from "./metricas";
import type { ConsultaAnalitica, DominioAnalitico } from "./tipos";
import {
  fontesAnaliticasVazias,
  type FontesAnaliticas,
  type VendaFonte,
} from "./fontes-modelo";

export type {
  CarteiraFonte,
  ClienteFonte,
  EstoqueFonte,
  FontesAnaliticas,
  ProdutoFonte,
  RecebimentoFonte,
  VendaFonte,
} from "./fontes-modelo";
export { fontesAnaliticasVazias } from "./fontes-modelo";

function dominiosDaConsulta(consulta: ConsultaAnalitica): Set<DominioAnalitico> {
  const set = new Set<DominioAnalitico>();
  for (const nome of consulta.metricas) {
    const def = metricaAnalitica(nome);
    if (def) {
      set.add(def.dominio);
    }
  }
  if (consulta.dimensoes.includes("produto") || consulta.dimensoes.includes("categoria") || consulta.dimensoes.includes("marca")) {
    set.add("estoque");
  }
  if (
    consulta.metricas.some((item) =>
      ["giro_estoque", "cobertura_estoque_dias"].includes(item)
    )
  ) {
    set.add("vendas");
    set.add("estoque");
  }
  return set;
}

async function autorizarDominio(
  ctx: ContextoFerramentaIa,
  recurso: RecursoFerramentaIa,
  acao: "acessar" | "acessar_carteira"
) {
  return autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso,
    acao,
  });
}

async function carregarVendasJanela(
  ctx: ContextoFerramentaIa,
  janela: { inicio: Date; fim: Date }
) {
  const { data, error } = await ctx.supabase
    .from("vendas")
    .select(
      "id, empresa_id, numero, cliente_id, usuario_id, status, valor_total, desconto, finalizada_at, created_at"
    )
    .eq("empresa_id", ctx.empresaId)
    .order("created_at", { ascending: false })
    .limit(4000);
  if (error) {
    throw new Error(error.message);
  }
  const vendas = vendasNoPeriodo(
    filtrarRegistrosDaEmpresaAtiva((data ?? []) as VendaFonte[], ctx.empresaId),
    janela.inicio,
    janela.fim
  ).map((venda) => ({
    id: String(venda.id),
    empresa_id: String(venda.empresa_id ?? ctx.empresaId),
    cliente_id: venda.cliente_id ? String(venda.cliente_id) : null,
    usuario_id: (venda as { usuario_id?: string | null }).usuario_id
      ? String((venda as { usuario_id?: string | null }).usuario_id)
      : null,
    status: String(venda.status),
    valor_total: numeroSeguro((venda as { valor_total?: number }).valor_total),
    desconto: numeroSeguro((venda as { desconto?: number }).desconto),
    finalizada_at: venda.finalizada_at ?? null,
    created_at: String(venda.created_at),
  })) as VendaFonte[];
  const validas = vendas.filter((venda) => vendaValidaParaFaturamento(venda.status));
  const ids = validas.map((venda) => venda.id);
  const [pagamentos, itens] = await Promise.all([
    ids.length
      ? buscarEmLotes(ids, async (fatia) => {
          const { data: rows } = await ctx.supabase
            .from("vendas_pagamentos")
            .select(
              "empresa_id, venda_id, forma_pagamento_nome, forma_pagamento_codigo, valor, status"
            )
            .eq("empresa_id", ctx.empresaId)
            .in("venda_id", fatia);
          return filtrarRegistrosDaEmpresaAtiva(
            (rows ?? []) as PagamentoRelatorio[],
            ctx.empresaId
          );
        })
      : Promise.resolve([] as PagamentoRelatorio[]),
    ids.length
      ? buscarEmLotes(ids, async (fatia) => {
          const { data: rows } = await ctx.supabase
            .from("vendas_itens")
            .select(
              "empresa_id, venda_id, produto_id, produto_nome, quantidade, valor_total"
            )
            .eq("empresa_id", ctx.empresaId)
            .in("venda_id", fatia);
          return filtrarRegistrosDaEmpresaAtiva(
            (rows ?? []) as ItemVendaRelatorio[],
            ctx.empresaId
          );
        })
      : Promise.resolve([] as ItemVendaRelatorio[]),
  ]);
  return { vendas: validas, pagamentos, itens };
}

export async function carregarFontesAnaliticas(params: {
  ctx: ContextoFerramentaIa;
  consulta: ConsultaAnalitica;
  janela: FontesAnaliticas["janela"];
  janelaAnterior: FontesAnaliticas["janelaAnterior"];
}): Promise<FontesAnaliticas> {
  const { ctx, consulta, janela, janelaAnterior } = params;
  const fontes = fontesAnaliticasVazias(ctx.empresaId);
  fontes.janela = janela;
  fontes.janelaAnterior = janelaAnterior;
  const dominios = dominiosDaConsulta(consulta);
  const precisaProduto =
    dominios.has("estoque") ||
    consulta.dimensoes.some((item) => ["produto", "categoria", "marca"].includes(item)) ||
    consulta.metricas.some((item) =>
      ["custo_vendido", "margem_bruta", "margem_percentual", "giro_estoque", "cobertura_estoque_dias"].includes(item)
    );

  if (dominios.has("vendas") || dominios.has("clientes")) {
    const auth = await autorizarDominio(ctx, "vendas", "acessar");
    if (!auth.ok) {
      fontes.dominiosNegados.push("vendas");
      fontes.avisos.push("Sem permissão para métricas de vendas.");
    } else {
      const atual = await carregarVendasJanela(ctx, janela);
      fontes.vendas = atual.vendas.filter((venda) => venda.empresa_id === ctx.empresaId);
      fontes.itens = atual.itens;
      fontes.pagamentos = atual.pagamentos;
      if (janelaAnterior) {
        const prev = await carregarVendasJanela(ctx, janelaAnterior);
        fontes.vendasAnterior = prev.vendas.filter((venda) => venda.empresa_id === ctx.empresaId);
        fontes.itensAnterior = prev.itens;
        fontes.pagamentosAnterior = prev.pagamentos;
      }
      const usuarioIds = [
        ...new Set(
          [...fontes.vendas, ...fontes.vendasAnterior]
            .map((venda) => venda.usuario_id)
            .filter((id): id is string => Boolean(id))
        ),
      ];
      if (usuarioIds.length) {
        try {
          const { data, error } = await ctx.supabase
            .from("usuarios")
            .select("id, nome")
            .in("id", usuarioIds.slice(0, 80));
          if (!error) {
            for (const row of data ?? []) {
              fontes.vendedores.set(String(row.id), String(row.nome ?? "Vendedor"));
            }
          }
        } catch {
          fontes.avisos.push("Nomes de vendedor indisponíveis.");
        }
      }
    }
  }

  if (precisaProduto || dominios.has("estoque")) {
    const authEstoque = dominios.has("estoque")
      ? await autorizarDominio(ctx, "estoque", "acessar")
      : { ok: true as const };
    const authProdutos = await autorizarDominio(ctx, "produtos", "acessar");
    if (dominios.has("estoque") && !authEstoque.ok) {
      fontes.dominiosNegados.push("estoque");
      fontes.avisos.push("Sem permissão para métricas de estoque.");
    }
    if (authProdutos.ok && (authEstoque.ok || precisaProduto)) {
      const [{ data: produtos }, { data: estoque }, { data: categorias }, { data: marcas }] =
        await Promise.all([
          ctx.supabase
            .from("produtos")
            .select(
              "id, empresa_id, nome, categoria_id, marca_id, preco_custo, preco_venda, ativo"
            )
            .eq("empresa_id", ctx.empresaId)
            .limit(4000),
          ctx.supabase
            .from("estoque_atual")
            .select("empresa_id, produto_id, quantidade, estoque_minimo")
            .eq("empresa_id", ctx.empresaId),
          ctx.supabase
            .from("categorias")
            .select("id, nome, empresa_id")
            .eq("empresa_id", ctx.empresaId),
          ctx.supabase
            .from("marcas")
            .select("id, nome, empresa_id")
            .eq("empresa_id", ctx.empresaId),
        ]);
      fontes.produtos = filtrarRegistrosDaEmpresaAtiva(produtos ?? [], ctx.empresaId).map(
        (item) => ({
          id: String(item.id),
          empresa_id: String(item.empresa_id),
          nome: String(item.nome ?? "Produto"),
          categoria_id: item.categoria_id ? String(item.categoria_id) : null,
          marca_id: item.marca_id ? String(item.marca_id) : null,
          preco_custo: numeroSeguro(item.preco_custo),
          preco_venda: numeroSeguro(item.preco_venda),
          ativo: item.ativo !== false,
        })
      );
      for (const item of filtrarRegistrosDaEmpresaAtiva(estoque ?? [], ctx.empresaId)) {
        fontes.estoque.set(String(item.produto_id), {
          produto_id: String(item.produto_id),
          quantidade: numeroSeguro(item.quantidade),
          minimo: numeroSeguro(item.estoque_minimo),
        });
      }
      for (const item of filtrarRegistrosDaEmpresaAtiva(categorias ?? [], ctx.empresaId)) {
        fontes.categorias.set(String(item.id), String(item.nome));
      }
      for (const item of filtrarRegistrosDaEmpresaAtiva(marcas ?? [], ctx.empresaId)) {
        fontes.marcas.set(String(item.id), String(item.nome));
      }
    }
  }

  if (dominios.has("carteira") || dominios.has("clientes")) {
    const authCarteira = dominios.has("carteira")
      ? await autorizarDominio(ctx, "clientes", "acessar_carteira")
      : { ok: true as const };
    const authClientes = await autorizarDominio(ctx, "clientes", "acessar");
    if (dominios.has("carteira") && !authCarteira.ok) {
      fontes.dominiosNegados.push("carteira");
      fontes.avisos.push("Sem permissão para métricas de carteira.");
    }
    if (authClientes.ok) {
      const { data: clientes } = await ctx.supabase
        .from("clientes")
        .select("id, empresa_id, nome, ativo, bloqueado, limite_credito")
        .eq("empresa_id", ctx.empresaId)
        .limit(2000);
      for (const cliente of filtrarRegistrosDaEmpresaAtiva(clientes ?? [], ctx.empresaId)) {
        fontes.clientes.set(String(cliente.id), {
          id: String(cliente.id),
          nome: String(cliente.nome ?? "Cliente"),
          ativo: cliente.ativo !== false,
          limite_credito: numeroSeguro(cliente.limite_credito),
          bloqueado: cliente.bloqueado === true,
        });
      }
    }
    if (authCarteira.ok && dominios.has("carteira")) {
      const hojeIso = chaveDiaSaoPaulo(new Date());
      const [{ data: titulos }, { data: creditos }] = await Promise.all([
        ctx.supabase
          .from("carteira_cliente_titulos")
          .select("cliente_id, empresa_id, valor_aberto, status, vencimento")
          .eq("empresa_id", ctx.empresaId)
          .in("status", ["ABERTO", "PARCIAL"]),
        ctx.supabase
          .from("carteira_cliente_creditos")
          .select("cliente_id, empresa_id, valor_disponivel, status")
          .eq("empresa_id", ctx.empresaId),
      ]);
      const mapa = agregarCarteiraPorCliente({
        titulos: filtrarRegistrosDaEmpresaAtiva(titulos ?? [], ctx.empresaId),
        creditos: filtrarRegistrosDaEmpresaAtiva(creditos ?? [], ctx.empresaId),
        hojeIso,
      });
      for (const [id, carteira] of mapa) {
        const cliente = fontes.clientes.get(id);
        const situacao = situacaoCarteiraCliente({
          cliente: {
            id,
            limite_credito: cliente?.limite_credito ?? 0,
            bloqueado: cliente?.bloqueado ?? false,
          },
          carteira,
        });
        fontes.carteira.set(id, {
          debitoAberto: situacao.debitoAberto,
          vencido: situacao.vencido,
          creditoAberto: situacao.creditoAberto,
        });
      }
      const { data: recebidos } = await ctx.supabase
        .from("carteira_cliente_recebimentos")
        .select("empresa_id, cliente_id, valor, created_at")
        .eq("empresa_id", ctx.empresaId)
        .gte("created_at", janela.inicio.toISOString())
        .lt("created_at", janela.fim.toISOString())
        .limit(2000);
      fontes.recebimentos = filtrarRegistrosDaEmpresaAtiva(recebidos ?? [], ctx.empresaId).map(
        (item) => ({
          cliente_id: String(item.cliente_id),
          valor: numeroSeguro(item.valor),
          created_at: String(item.created_at),
        })
      );
      if (janelaAnterior) {
        const { data: prev } = await ctx.supabase
          .from("carteira_cliente_recebimentos")
          .select("empresa_id, cliente_id, valor, created_at")
          .eq("empresa_id", ctx.empresaId)
          .gte("created_at", janelaAnterior.inicio.toISOString())
          .lt("created_at", janelaAnterior.fim.toISOString())
          .limit(2000);
        fontes.recebimentosAnterior = filtrarRegistrosDaEmpresaAtiva(prev ?? [], ctx.empresaId).map(
          (item) => ({
            cliente_id: String(item.cliente_id),
            valor: numeroSeguro(item.valor),
            created_at: String(item.created_at),
          })
        );
      }
    }
  }

  if (dominios.has("caixa")) {
    const auth = await autorizarDominio(ctx, "caixa", "acessar");
    if (!auth.ok) {
      fontes.dominiosNegados.push("caixa");
      fontes.avisos.push("Sem permissão para métricas de caixa.");
    } else {
      const painel = await carregarPainelCaixa(ctx.empresaId, {
        podeRevelarEsperadoCego: podeRevelarEsperadoCaixaCego(ctx.permissoes),
      });
      if (!painel.atual) {
        fontes.caixa = { aberto: false, entradas: 0, saidas: 0, saldoAtual: null };
      } else {
        fontes.caixa = {
          aberto: painel.atual.status === "aberto",
          entradas: Number(painel.atual.entradas ?? 0),
          saidas: Number(painel.atual.saidas ?? 0),
          saldoAtual:
            painel.atual.saldoAtual == null ? null : Number(painel.atual.saldoAtual),
        };
      }
    }
  }

  if (dominios.has("fiscal")) {
    const auth = await autorizarDominio(ctx, "fiscal", "acessar");
    if (!auth.ok) {
      fontes.dominiosNegados.push("fiscal");
      fontes.avisos.push("Sem permissão para métricas fiscais agregadas.");
    } else {
      const lote = await analisarGruposFiscaisProdutos({
        supabase: ctx.supabase,
        empresaId: ctx.empresaId,
        dataReferencia: dataReferenciaIso(new Date()),
      });
      const { data: notas } = await ctx.supabase
        .from("fiscal_emissoes")
        .select("id, empresa_id, status")
        .eq("empresa_id", ctx.empresaId)
        .eq("status", "rejeitada")
        .limit(200);
      fontes.fiscal = {
        revisao: lote.quantidadeRevisao,
        gruposIncompativeis: lote.gruposIncompativeis.length,
        notasRejeitadas: filtrarRegistrosDaEmpresaAtiva(notas ?? [], ctx.empresaId).length,
      };
    }
  }

  return fontes;
}

export { dataVenda };
