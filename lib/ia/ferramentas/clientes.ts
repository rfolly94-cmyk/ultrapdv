import { filtrarRegistrosDaEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { chaveDiaSaoPaulo } from "@/lib/dashboard/periodo";
import {
  agregarCarteiraPorCliente,
  sanitizarBuscaCliente,
  situacaoCarteiraCliente,
} from "@/lib/clientes/listagem";

import { autorizarFerramentaIa, recusaFerramentaIa } from "../permissoes";
import { hrefCarteiraAssistente, hrefClienteAssistente } from "../rotas";
import {
  MENSAGEM_IA_FALHA_CONSULTA,
  type NomeFerramentaIa,
  type ResultadoFerramentaIa,
} from "../tipos";
import { arredondarMoeda } from "../periodo";
import { sanitizarTermoBuscaIa } from "./args";
import type { ContextoFerramentaIa } from "./contexto";
import { MAX_ITENS_FERRAMENTA_IA } from "./definicao";
import {
  acoesSelecaoEntidadeIa,
  mensagemAmbiguidadeIa,
  resolverEntidadesIa,
} from "./entidade";

async function carregarCarteiraMapa(ctx: ContextoFerramentaIa) {
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
  return agregarCarteiraPorCliente({
    titulos: filtrarRegistrosDaEmpresaAtiva(titulos ?? [], ctx.empresaId),
    creditos: filtrarRegistrosDaEmpresaAtiva(creditos ?? [], ctx.empresaId),
    hojeIso,
  });
}

async function mapearClientesComCarteira(
  ctx: ContextoFerramentaIa,
  clientes: Array<{
    id: unknown;
    nome: unknown;
    ativo?: unknown;
    bloqueado?: unknown;
    limite_credito?: unknown;
    cpf_cnpj?: unknown;
  }>
) {
  const carteira = await carregarCarteiraMapa(ctx);
  return clientes.map((cliente) => {
    const situacao = situacaoCarteiraCliente({
      cliente: {
        id: String(cliente.id),
        limite_credito:
          typeof cliente.limite_credito === "number" || typeof cliente.limite_credito === "string"
            ? cliente.limite_credito
            : null,
        bloqueado: Boolean(cliente.bloqueado),
      },
      carteira: carteira.get(String(cliente.id)),
    });
    return {
      id: String(cliente.id),
      nome: String(cliente.nome),
      documento: cliente.cpf_cnpj ? String(cliente.cpf_cnpj) : null,
      ativo: cliente.ativo !== false,
      bloqueado: cliente.bloqueado === true,
      debitoAberto: situacao.debitoAberto,
      creditoAberto: situacao.creditoAberto,
      vencido: situacao.vencido,
      limiteDisponivel: situacao.limiteDisponivel,
    };
  });
}

function resultadoClientes(
  ferramenta: NomeFerramentaIa,
  itens: Awaited<ReturnType<typeof mapearClientesComCarteira>>
): ResultadoFerramentaIa {
  const resolucao = resolverEntidadesIa(itens);
  if (resolucao.tipo === "nenhum") {
    return {
      ok: false,
      ferramenta,
      erro: "Cliente não encontrado nesta empresa.",
      codigo: "nao_encontrado",
    };
  }
  if (resolucao.tipo === "ambiguidade") {
    return {
      ok: true,
      ferramenta,
      dados: {
        ambiguidade: true,
        mensagem: mensagemAmbiguidadeIa(
          "cliente",
          resolucao.itens.map((item) => item.nome)
        ),
        itens: resolucao.itens,
      },
      acoes: acoesSelecaoEntidadeIa({
        itens: resolucao.itens.map((item) => ({
          id: item.id,
          nome: item.nome,
          href: hrefClienteAssistente(item.id),
        })),
        rotulo: "cliente",
      }),
    };
  }
  const item = resolucao.item;
  return {
    ok: true,
    ferramenta,
    dados: { itens: [item], ...item },
    acoes: [
      {
        type: "open_details",
        label: "Abrir cliente",
        href: hrefClienteAssistente(item.id),
        entityId: item.id,
        entityTipo: "cliente",
      },
      {
        type: "navigate",
        label: "Abrir carteira",
        href: hrefCarteiraAssistente(item.id),
        entityId: item.id,
        entityTipo: "carteira",
      },
    ],
  };
}

async function buscarClientesBase(
  ctx: ContextoFerramentaIa,
  ferramenta: NomeFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const auth = await autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso: "clientes",
    acao: "acessar",
  });
  if (!auth.ok) {
    return recusaFerramentaIa(ferramenta, auth);
  }
  const busca = sanitizarTermoBuscaIa(args.busca ?? args.nome);
  const clienteId = String(
    args.clienteId ?? (busca ? "" : ctx.tela.clienteId) ?? ""
  ).trim();
  try {
    let query = ctx.supabase
      .from("clientes")
      .select("id, empresa_id, nome, ativo, bloqueado, limite_credito, cpf_cnpj")
      .eq("empresa_id", ctx.empresaId)
      .limit(MAX_ITENS_FERRAMENTA_IA);
    if (clienteId) {
      query = query.eq("id", clienteId);
    } else if (busca) {
      const buscaSegura = sanitizarBuscaCliente(busca);
      const documento = buscaSegura.replace(/\D/g, "");
      const partes = [`nome.ilike.%${buscaSegura}%`];
      if (documento.length >= 3) {
        partes.push(`cpf_cnpj.ilike.%${documento}%`);
      }
      query = query.or(partes.join(","));
    } else {
      return {
        ok: false,
        ferramenta,
        erro: "Informe o cliente ou abra a ficha na tela.",
        codigo: "nao_encontrado",
      };
    }
    const { data, error } = await query;
    if (error) {
      return {
        ok: false,
        ferramenta,
        erro: MENSAGEM_IA_FALHA_CONSULTA,
        codigo: "falha",
      };
    }
    const clientes = filtrarRegistrosDaEmpresaAtiva(data ?? [], ctx.empresaId);
    const itens = await mapearClientesComCarteira(ctx, clientes);
    return resultadoClientes(ferramenta, itens);
  } catch {
    return {
      ok: false,
      ferramenta,
      erro: MENSAGEM_IA_FALHA_CONSULTA,
      codigo: "falha",
    };
  }
}

export async function buscarClientesIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
) {
  return buscarClientesBase(ctx, "buscar_clientes", args);
}

export async function consultarClienteIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
) {
  return buscarClientesBase(ctx, "consultar_cliente", args);
}

export async function consultarCarteiraIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>,
  ferramenta: NomeFerramentaIa = "consultar_carteira"
): Promise<ResultadoFerramentaIa> {
  const auth = await autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso: "clientes",
    acao: "acessar_carteira",
  });
  if (!auth.ok) {
    return recusaFerramentaIa(ferramenta, auth);
  }
  try {
    const clienteId = String(args.clienteId ?? ctx.tela.clienteId ?? "").trim();
    const vencidos = args.somenteVencidos !== false;
    const ordenarAberto = args.ordenar === "aberto" || args.somenteVencidos === false;
    const carteira = await carregarCarteiraMapa(ctx);
    const ids = clienteId ? [clienteId] : [...carteira.keys()];
    const { data: clientes } = await ctx.supabase
      .from("clientes")
      .select("id, empresa_id, nome, limite_credito, bloqueado")
      .eq("empresa_id", ctx.empresaId)
      .in("id", ids.slice(0, 200));
    const filtrados = filtrarRegistrosDaEmpresaAtiva(clientes ?? [], ctx.empresaId)
      .map((cliente) => {
        const situacao = situacaoCarteiraCliente({
          cliente,
          carteira: carteira.get(String(cliente.id)),
        });
        return {
          id: String(cliente.id),
          nome: String(cliente.nome),
          ...situacao,
        };
      })
      .filter((item) =>
        clienteId
          ? true
          : vencidos
            ? item.vencido > 0
            : item.debitoAberto > 0
      )
      .sort((a, b) =>
        ordenarAberto
          ? b.debitoAberto - a.debitoAberto || b.vencido - a.vencido
          : b.vencido - a.vencido || b.debitoAberto - a.debitoAberto
      );
    if (clienteId && filtrados.length === 0) {
      return {
        ok: false,
        ferramenta,
        erro: "Cliente não encontrado nesta empresa.",
        codigo: "nao_encontrado",
      };
    }
    const lista = filtrados.slice(0, MAX_ITENS_FERRAMENTA_IA);
    const totalVencido = arredondarMoeda(
      filtrados.reduce((acc, item) => acc + item.vencido, 0)
    );
    const totalAberto = arredondarMoeda(
      filtrados.reduce((acc, item) => acc + item.debitoAberto, 0)
    );
    return {
      ok: true,
      ferramenta,
      dados: {
        totalVencido,
        totalAberto,
        quantidade: filtrados.length,
        clientes: lista,
      },
      acoes: lista.slice(0, 3).map((item) => ({
        type: "navigate" as const,
        label: `Abrir carteira de ${item.nome}`,
        href: hrefCarteiraAssistente(item.id),
        entityId: item.id,
        entityTipo: "carteira",
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

export async function consultarCarteiraClienteIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
) {
  return consultarCarteiraIa(ctx, args, "consultar_carteira_cliente");
}

export async function consultarClientesEmAbertoIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
) {
  return consultarCarteiraIa(
    ctx,
    { ...args, somenteVencidos: false, ordenar: "aberto" },
    "consultar_clientes_em_aberto"
  );
}

export async function consultarRecebimentosIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const auth = await autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso: "clientes",
    acao: "acessar_carteira",
  });
  if (!auth.ok) {
    return recusaFerramentaIa("consultar_recebimentos", auth);
  }
  const clienteId = String(args.clienteId ?? ctx.tela.clienteId ?? "").trim();
  if (!clienteId) {
    return {
      ok: false,
      ferramenta: "consultar_recebimentos",
      erro: "Informe o cliente para consultar recebimentos.",
      codigo: "nao_encontrado",
    };
  }
  try {
    const { data, error } = await ctx.supabase
      .from("carteira_cliente_recebimentos")
      .select(
        "id, empresa_id, cliente_id, forma_pagamento_nome, valor, processado_at, created_at"
      )
      .eq("empresa_id", ctx.empresaId)
      .eq("cliente_id", clienteId)
      .order("created_at", { ascending: false })
      .limit(MAX_ITENS_FERRAMENTA_IA);
    if (error) {
      return {
        ok: false,
        ferramenta: "consultar_recebimentos",
        erro: MENSAGEM_IA_FALHA_CONSULTA,
        codigo: "falha",
      };
    }
    const itens = filtrarRegistrosDaEmpresaAtiva(data ?? [], ctx.empresaId).map(
      (item) => ({
        id: item.id,
        forma: item.forma_pagamento_nome,
        valor: arredondarMoeda(Number(item.valor ?? 0)),
        em: item.processado_at ?? item.created_at,
      })
    );
    const total = arredondarMoeda(
      itens.reduce((acc, item) => acc + item.valor, 0)
    );
    return {
      ok: true,
      ferramenta: "consultar_recebimentos",
      dados: { quantidade: itens.length, total, itens },
      acoes: [
        {
          type: "navigate",
          label: "Abrir carteira",
          href: hrefCarteiraAssistente(clienteId),
        },
      ],
    };
  } catch {
    return {
      ok: false,
      ferramenta: "consultar_recebimentos",
      erro: MENSAGEM_IA_FALHA_CONSULTA,
      codigo: "falha",
    };
  }
}

export async function consultarCreditosClienteIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const auth = await autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso: "clientes",
    acao: "acessar_carteira",
  });
  if (!auth.ok) {
    return recusaFerramentaIa("consultar_creditos_cliente", auth);
  }
  const clienteId = String(args.clienteId ?? ctx.tela.clienteId ?? "").trim();
  if (!clienteId) {
    return {
      ok: false,
      ferramenta: "consultar_creditos_cliente",
      erro: "Informe o cliente para consultar créditos.",
      codigo: "nao_encontrado",
    };
  }
  try {
    const { data, error } = await ctx.supabase
      .from("carteira_cliente_creditos")
      .select("id, empresa_id, cliente_id, valor_disponivel, status")
      .eq("empresa_id", ctx.empresaId)
      .eq("cliente_id", clienteId)
      .limit(40);
    if (error) {
      return {
        ok: false,
        ferramenta: "consultar_creditos_cliente",
        erro: MENSAGEM_IA_FALHA_CONSULTA,
        codigo: "falha",
      };
    }
    const itens = filtrarRegistrosDaEmpresaAtiva(data ?? [], ctx.empresaId).map(
      (item) => ({
        id: item.id,
        status: item.status,
        disponivel: arredondarMoeda(Number(item.valor_disponivel ?? 0)),
      })
    );
    const total = arredondarMoeda(
      itens.reduce((acc, item) => acc + item.disponivel, 0)
    );
    return {
      ok: true,
      ferramenta: "consultar_creditos_cliente",
      dados: { total, itens: itens.slice(0, MAX_ITENS_FERRAMENTA_IA) },
      acoes: [
        {
          type: "navigate",
          label: "Abrir carteira",
          href: hrefCarteiraAssistente(clienteId),
        },
      ],
    };
  } catch {
    return {
      ok: false,
      ferramenta: "consultar_creditos_cliente",
      erro: MENSAGEM_IA_FALHA_CONSULTA,
      codigo: "falha",
    };
  }
}
