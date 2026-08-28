import { filtrarRegistrosDaEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { chaveDiaSaoPaulo } from "@/lib/dashboard/periodo";
import {
  agregarCarteiraPorCliente,
  situacaoCarteiraCliente,
} from "@/lib/clientes/listagem";

import { autorizarFerramentaIa, recusaFerramentaIa } from "../permissoes";
import { hrefCarteiraAssistente, hrefClienteAssistente } from "../rotas";
import {
  MENSAGEM_IA_FALHA_CONSULTA,
  type ResultadoFerramentaIa,
} from "../tipos";
import { arredondarMoeda } from "../periodo";
import type { ContextoFerramentaIa } from "./contexto";

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

export async function consultarClienteIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const auth = await autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso: "clientes",
    acao: "acessar",
  });
  if (!auth.ok) {
    return recusaFerramentaIa("consultar_cliente", auth);
  }
  const busca = String(args.busca ?? "").trim();
  const clienteId = String(
    args.clienteId ?? (busca ? "" : ctx.tela.clienteId) ?? ""
  ).trim();
  try {
    let query = ctx.supabase
      .from("clientes")
      .select("id, empresa_id, nome, ativo, bloqueado, limite_credito")
      .eq("empresa_id", ctx.empresaId)
      .limit(8);
    if (clienteId) {
      query = query.eq("id", clienteId);
    } else if (busca) {
      query = query.ilike("nome", `%${busca}%`);
    } else {
      return {
        ok: false,
        ferramenta: "consultar_cliente",
        erro: "Informe o cliente ou abra a ficha na tela.",
        codigo: "nao_encontrado",
      };
    }
    const { data, error } = await query;
    if (error) {
      return {
        ok: false,
        ferramenta: "consultar_cliente",
        erro: MENSAGEM_IA_FALHA_CONSULTA,
        codigo: "falha",
      };
    }
    const clientes = filtrarRegistrosDaEmpresaAtiva(data ?? [], ctx.empresaId);
    if (clientes.length === 0) {
      return {
        ok: false,
        ferramenta: "consultar_cliente",
        erro: "Cliente não encontrado nesta empresa.",
        codigo: "nao_encontrado",
      };
    }
    const carteira = await carregarCarteiraMapa(ctx);
    const itens = clientes.map((cliente) => {
      const situacao = situacaoCarteiraCliente({
        cliente,
        carteira: carteira.get(String(cliente.id)),
      });
      return {
        id: cliente.id,
        nome: cliente.nome,
        ativo: cliente.ativo !== false,
        bloqueado: cliente.bloqueado === true,
        debitoAberto: situacao.debitoAberto,
        creditoAberto: situacao.creditoAberto,
        vencido: situacao.vencido,
        limiteDisponivel: situacao.limiteDisponivel,
      };
    });
    return {
      ok: true,
      ferramenta: "consultar_cliente",
      dados: { itens },
      acoes: itens.slice(0, 3).flatMap((item) => [
        { label: "Abrir cliente", href: hrefClienteAssistente(String(item.id)) },
        { label: "Abrir carteira", href: hrefCarteiraAssistente(String(item.id)) },
      ]),
    };
  } catch {
    return {
      ok: false,
      ferramenta: "consultar_cliente",
      erro: MENSAGEM_IA_FALHA_CONSULTA,
      codigo: "falha",
    };
  }
}

export async function consultarCarteiraIa(
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
    return recusaFerramentaIa("consultar_carteira", auth);
  }
  try {
    const clienteId = String(args.clienteId ?? ctx.tela.clienteId ?? "").trim();
    const vencidos = args.somenteVencidos !== false;
    const ordenarAberto = args.ordenar === "aberto";
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
          id: cliente.id,
          nome: cliente.nome,
          ...situacao,
        };
      })
      .filter((item) => (vencidos ? item.vencido > 0 : item.debitoAberto > 0))
      .sort((a, b) =>
        ordenarAberto
          ? b.debitoAberto - a.debitoAberto || b.vencido - a.vencido
          : b.vencido - a.vencido || b.debitoAberto - a.debitoAberto
      );
    const lista = filtrados.slice(0, 8);
    const totalVencido = arredondarMoeda(
      filtrados.reduce((acc, item) => acc + item.vencido, 0)
    );
    const totalAberto = arredondarMoeda(
      filtrados.reduce((acc, item) => acc + item.debitoAberto, 0)
    );
    return {
      ok: true,
      ferramenta: "consultar_carteira",
      dados: {
        totalVencido,
        totalAberto,
        quantidade: filtrados.length,
        clientes: lista,
      },
      acoes: lista.slice(0, 3).map((item) => ({
        label: `Abrir carteira de ${item.nome}`,
        href: hrefCarteiraAssistente(String(item.id)),
      })),
    };
  } catch {
    return {
      ok: false,
      ferramenta: "consultar_carteira",
      erro: MENSAGEM_IA_FALHA_CONSULTA,
      codigo: "falha",
    };
  }
}
