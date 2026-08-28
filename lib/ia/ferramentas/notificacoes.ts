import { listarNotificacoesDaEmpresa } from "@/lib/notificacoes/listar";
import { actionUrlSegura } from "@/lib/notificacoes/rotas";
import {
  ROTULO_CATEGORIA_NOTIFICACAO,
  ROTULO_TIPO_NOTIFICACAO,
} from "@/lib/notificacoes/tipos";

import { hrefSeguroAssistente } from "../rotas";
import {
  MENSAGEM_IA_FALHA_CONSULTA,
  type ResultadoFerramentaIa,
} from "../tipos";
import type { ContextoFerramentaIa } from "./contexto";

export async function consultarNotificacoesIa(
  ctx: ContextoFerramentaIa
): Promise<ResultadoFerramentaIa> {
  try {
    const lista = await listarNotificacoesDaEmpresa({
      supabase: ctx.supabase,
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      filtro: "todas",
    });
    if (!lista.ok) {
      if (lista.indisponivel) {
        return {
          ok: true,
          ferramenta: "consultar_notificacoes",
          dados: {
            contador: 0,
            itens: [],
            aviso: "A central de notificações ainda não está disponível neste ambiente.",
          },
        };
      }
      return {
        ok: false,
        ferramenta: "consultar_notificacoes",
        erro: MENSAGEM_IA_FALHA_CONSULTA,
        codigo: "falha",
      };
    }
    const porCategoria = new Map<string, number>();
    for (const item of lista.itens) {
      porCategoria.set(
        item.categoria,
        (porCategoria.get(item.categoria) ?? 0) + 1
      );
    }
    const itens = lista.itens.slice(0, 8).map((item) => ({
      id: item.id,
      tipo: ROTULO_TIPO_NOTIFICACAO[item.tipo],
      categoria: ROTULO_CATEGORIA_NOTIFICACAO[item.categoria],
      nivel: item.nivel,
      titulo: item.titulo,
      mensagem: item.mensagem,
      href: hrefSeguroAssistente(actionUrlSegura(item.actionUrl)),
    }));
    return {
      ok: true,
      ferramenta: "consultar_notificacoes",
      dados: {
        contador: lista.contador,
        porCategoria: Object.fromEntries(porCategoria),
        itens,
      },
      acoes: itens
        .filter((item) => item.href)
        .slice(0, 4)
        .map((item) => ({
          label: item.titulo,
          href: item.href,
        })),
    };
  } catch {
    return {
      ok: false,
      ferramenta: "consultar_notificacoes",
      erro: MENSAGEM_IA_FALHA_CONSULTA,
      codigo: "falha",
    };
  }
}
