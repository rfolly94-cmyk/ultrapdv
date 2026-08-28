import { filtrarRegistrosDaEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { hrefOrigemEmissaoFiscal, rotuloModeloFiscal } from "@/lib/fiscal/acoes-emissao";

import { autorizarFerramentaIa, recusaFerramentaIa } from "../permissoes";
import { hrefFiscalAssistente, hrefSeguroAssistente } from "../rotas";
import {
  MENSAGEM_IA_FALHA_CONSULTA,
  type ResultadoFerramentaIa,
} from "../tipos";
import type { ContextoFerramentaIa } from "./contexto";

export async function consultarEmissaoFiscalIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const auth = await autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso: "fiscal",
    acao: "acessar",
  });
  if (!auth.ok) {
    return recusaFerramentaIa("consultar_emissao_fiscal", auth);
  }
  try {
    const status = String(args.status ?? "").trim();
    const emissaoId = String(args.emissaoId ?? ctx.tela.emissaoId ?? "").trim();
    let query = ctx.supabase
      .from("fiscal_emissoes")
      .select(
        "id, empresa_id, modelo, numero, status, motivo, origem_tipo, origem_id, created_at"
      )
      .eq("empresa_id", ctx.empresaId)
      .order("created_at", { ascending: false })
      .limit(8);
    if (emissaoId) {
      query = query.eq("id", emissaoId);
    } else if (status) {
      query = query.eq("status", status);
    } else {
      query = query.in("status", ["rejeitada", "aguardando_reconciliacao"]);
    }
    const { data, error } = await query;
    if (error) {
      return {
        ok: false,
        ferramenta: "consultar_emissao_fiscal",
        erro: MENSAGEM_IA_FALHA_CONSULTA,
        codigo: "falha",
      };
    }
    const itens = filtrarRegistrosDaEmpresaAtiva(data ?? [], ctx.empresaId).map(
      (item) => ({
        id: item.id,
        modelo: rotuloModeloFiscal(item.modelo),
        numero: item.numero,
        status: item.status,
        motivo: item.motivo ? String(item.motivo).slice(0, 280) : null,
        href:
          hrefSeguroAssistente(
            hrefOrigemEmissaoFiscal(item.origem_tipo, item.origem_id)
          ) ?? hrefFiscalAssistente(),
      })
    );
    return {
      ok: true,
      ferramenta: "consultar_emissao_fiscal",
      dados: { quantidade: itens.length, itens },
      acoes: itens.slice(0, 3).map((item) => ({
        label: "Abrir nota",
        href: item.href,
      })),
    };
  } catch {
    return {
      ok: false,
      ferramenta: "consultar_emissao_fiscal",
      erro: MENSAGEM_IA_FALHA_CONSULTA,
      codigo: "falha",
    };
  }
}

export async function diagnosticarNotaIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const auth = await autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso: "fiscal",
    acao: "acessar",
  });
  if (!auth.ok) {
    return recusaFerramentaIa("diagnosticar_nota", auth);
  }
  const emissaoId = String(args.emissaoId ?? ctx.tela.emissaoId ?? "").trim();
  const vendaId = String(args.vendaId ?? ctx.tela.vendaId ?? "").trim();
  try {
    let query = ctx.supabase
      .from("fiscal_emissoes")
      .select(
        "id, empresa_id, modelo, numero, status, motivo, cstat, origem_tipo, origem_id"
      )
      .eq("empresa_id", ctx.empresaId)
      .limit(1);
    if (emissaoId) {
      query = query.eq("id", emissaoId);
    } else if (vendaId) {
      query = query.eq("origem_tipo", "venda").eq("origem_id", vendaId);
    } else {
      return {
        ok: false,
        ferramenta: "diagnosticar_nota",
        erro: "Abra a nota ou a venda para diagnosticar.",
        codigo: "nao_encontrado",
      };
    }
    const { data, error } = await query.maybeSingle();
    if (error) {
      return {
        ok: false,
        ferramenta: "diagnosticar_nota",
        erro: MENSAGEM_IA_FALHA_CONSULTA,
        codigo: "falha",
      };
    }
    if (!data || String(data.empresa_id) !== ctx.empresaId) {
      return {
        ok: false,
        ferramenta: "diagnosticar_nota",
        erro: "Documento fiscal não encontrado nesta empresa.",
        codigo: "nao_encontrado",
      };
    }
    const href =
      hrefSeguroAssistente(
        hrefOrigemEmissaoFiscal(data.origem_tipo, data.origem_id)
      ) ?? hrefFiscalAssistente();
    return {
      ok: true,
      ferramenta: "diagnosticar_nota",
      dados: {
        id: data.id,
        modelo: rotuloModeloFiscal(data.modelo),
        numero: data.numero,
        status: data.status,
        cstat: data.cstat ?? null,
        motivo: data.motivo ? String(data.motivo).slice(0, 400) : null,
        naoRetransmitir: true,
      },
      acoes: [{ label: "Abrir nota", href }],
    };
  } catch {
    return {
      ok: false,
      ferramenta: "diagnosticar_nota",
      erro: MENSAGEM_IA_FALHA_CONSULTA,
      codigo: "falha",
    };
  }
}
