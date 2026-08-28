import { carregarPainelCaixa } from "@/lib/caixa/carregar";
import { podeRevelarEsperadoCaixaCego } from "@/lib/caixa/conferencia";

import { autorizarFerramentaIa, recusaFerramentaIa } from "../permissoes";
import { hrefCaixaAssistente } from "../rotas";
import { arredondarMoeda } from "../periodo";
import {
  MENSAGEM_IA_FALHA_CONSULTA,
  type ResultadoFerramentaIa,
} from "../tipos";
import type { ContextoFerramentaIa } from "./contexto";

export async function consultarCaixaIa(
  ctx: ContextoFerramentaIa
): Promise<ResultadoFerramentaIa> {
  const auth = await autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso: "caixa",
    acao: "acessar",
  });
  if (!auth.ok) {
    return recusaFerramentaIa("consultar_caixa", auth);
  }
  try {
    const painel = await carregarPainelCaixa(ctx.empresaId, {
      podeRevelarEsperadoCego: podeRevelarEsperadoCaixaCego(ctx.permissoes),
    });
    const atual = painel.atual;
    if (!atual) {
      return {
        ok: true,
        ferramenta: "consultar_caixa",
        dados: { aberto: false, mensagem: "Não há caixa aberto." },
        acoes: [{ label: "Abrir caixa", href: hrefCaixaAssistente() }],
      };
    }
    const movimentos = atual.movimentos.slice(-8).map((item) => ({
      tipo: item.tipo,
      entrada: arredondarMoeda(item.entrada),
      saida: arredondarMoeda(item.saida),
      descricao: item.descricao,
    }));
    return {
      ok: true,
      ferramenta: "consultar_caixa",
      dados: {
        aberto: atual.status === "aberto",
        numero: atual.numero,
        abertoEm: atual.aberto_em,
        saldoInicial: arredondarMoeda(atual.saldoInicial),
        saldoAtual:
          atual.saldoAtual == null ? null : arredondarMoeda(atual.saldoAtual),
        entradas: arredondarMoeda(atual.entradas),
        saidas: arredondarMoeda(atual.saidas),
        sangrias: arredondarMoeda(atual.sangrias),
        suprimentos: arredondarMoeda(atual.suprimentos),
        vendasTotal: arredondarMoeda(atual.vendasTotal),
        fechamentoCego: painel.fechamentoCego,
        movimentos,
      },
      acoes: [{ label: "Abrir caixa", href: hrefCaixaAssistente() }],
    };
  } catch {
    return {
      ok: false,
      ferramenta: "consultar_caixa",
      erro: MENSAGEM_IA_FALHA_CONSULTA,
      codigo: "falha",
    };
  }
}
