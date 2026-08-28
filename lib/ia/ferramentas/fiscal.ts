import { filtrarRegistrosDaEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { hrefOrigemEmissaoFiscal, rotuloModeloFiscal } from "@/lib/fiscal/acoes-emissao";
import { montarContextoFiscalEmpresa } from "@/lib/fiscal/motor/contexto-empresa";

import { autorizarFerramentaIa, recusaFerramentaIa } from "../permissoes";
import { hrefFiscalAssistente, hrefSeguroAssistente } from "../rotas";
import {
  MENSAGEM_IA_FALHA_CONSULTA,
  type NomeFerramentaIa,
  type ResultadoFerramentaIa,
} from "../tipos";
import type { ContextoFerramentaIa } from "./contexto";
import { MAX_ITENS_FERRAMENTA_IA } from "./definicao";

export async function consultarEmissaoFiscalIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>,
  ferramenta: NomeFerramentaIa = "consultar_emissao_fiscal"
): Promise<ResultadoFerramentaIa> {
  const auth = await autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso: "fiscal",
    acao: "acessar",
  });
  if (!auth.ok) {
    return recusaFerramentaIa(ferramenta, auth);
  }
  try {
    const status = String(args.status ?? "").trim();
    const emissaoId = String(args.emissaoId ?? ctx.tela.emissaoId ?? "").trim();
    const modelo = String(args.modelo ?? "").trim();
    let query = ctx.supabase
      .from("fiscal_emissoes")
      .select(
        "id, empresa_id, modelo, numero, status, motivo, origem_tipo, origem_id, created_at"
      )
      .eq("empresa_id", ctx.empresaId)
      .order("created_at", { ascending: false })
      .limit(MAX_ITENS_FERRAMENTA_IA);
    if (emissaoId) {
      query = query.eq("id", emissaoId);
    } else {
      if (modelo === "55" || modelo === "65") {
        query = query.eq("modelo", modelo);
      }
      if (status) {
        query = query.eq("status", status);
      }
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
    const itens = filtrarRegistrosDaEmpresaAtiva(data ?? [], ctx.empresaId).map(
      (item) => ({
        id: item.id,
        modelo: rotuloModeloFiscal(item.modelo),
        modeloCodigo: item.modelo,
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
      ferramenta,
      dados: { quantidade: itens.length, itens },
      acoes: itens.slice(0, 3).map((item) => ({
        type: "open_details" as const,
        label: "Abrir nota",
        href: item.href,
        entityId: String(item.id),
        entityTipo: "nota",
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
      acoes: [{ type: "open_details", label: "Abrir nota", href }],
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

export async function consultarNotasFiscaisIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
) {
  return consultarEmissaoFiscalIa(ctx, args, "consultar_notas_fiscais");
}

export async function consultarDocumentoFiscalIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
) {
  const resultado = await diagnosticarNotaIa(ctx, args);
  return { ...resultado, ferramenta: "consultar_documento_fiscal" as const };
}

export async function consultarStatusNfeIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
) {
  return consultarEmissaoFiscalIa(
    ctx,
    { ...args, modelo: "55" },
    "consultar_status_nfe"
  );
}

export async function consultarStatusNfceIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
) {
  return consultarEmissaoFiscalIa(
    ctx,
    { ...args, modelo: "65" },
    "consultar_status_nfce"
  );
}

const CAMPOS_SECRETOS_FISCAL = [
  "senha",
  "csc",
  "certificado",
  "token",
  "api_key",
  "apikey",
  "secret",
];

function semSegredoFiscal(chave: string) {
  const lower = chave.toLowerCase();
  return !CAMPOS_SECRETOS_FISCAL.some((item) => lower.includes(item));
}

export async function consultarConfiguracaoFiscalIa(
  ctx: ContextoFerramentaIa
): Promise<ResultadoFerramentaIa> {
  const auth = await autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso: "fiscal",
    acao: "acessar",
  });
  if (!auth.ok) {
    return recusaFerramentaIa("consultar_configuracao_fiscal", auth);
  }
  try {
    const contexto = await montarContextoFiscalEmpresa({
      supabase: ctx.supabase,
      empresaId: ctx.empresaId,
    });
    const [{ data: numeracoes }, { data: credencial }] = await Promise.all([
      ctx.supabase
        .from("fiscal_numeracoes")
        .select("empresa_id, modelo, ambiente, serie, ativo")
        .eq("empresa_id", ctx.empresaId)
        .eq("ativo", true),
      ctx.supabase
        .from("fiscal_credenciais_status")
        .select("empresa_id, certificado_validade")
        .eq("empresa_id", ctx.empresaId)
        .maybeSingle(),
    ]);
    const series = filtrarRegistrosDaEmpresaAtiva(
      numeracoes ?? [],
      ctx.empresaId
    )
      .filter((item) =>
        Object.keys(item).every((chave) => semSegredoFiscal(chave))
      )
      .map((item) => ({
        modelo: item.modelo === "55" ? "NF-e" : item.modelo === "65" ? "NFC-e" : item.modelo,
        ambiente: item.ambiente,
        serie: item.serie,
        ativo: item.ativo !== false,
      }));
    const validade =
      credencial && String(credencial.empresa_id) === ctx.empresaId
        ? credencial.certificado_validade
        : null;
    return {
      ok: true,
      ferramenta: "consultar_configuracao_fiscal",
      dados: {
        crt: contexto.crt,
        regime: contexto.regimeTributario,
        uf: contexto.uf,
        municipio: contexto.municipio,
        ambiente: contexto.ambiente,
        cnpj: contexto.cnpj,
        faltantes: contexto.faltantes,
        series,
        certificadoConfigurado: Boolean(validade),
        certificadoValidade: validade ?? null,
      },
      acoes: [
        {
          type: "navigate",
          label: "Abrir configurações fiscais",
          href: "/configuracoes/fiscal",
        },
      ],
    };
  } catch {
    return {
      ok: false,
      ferramenta: "consultar_configuracao_fiscal",
      erro: MENSAGEM_IA_FALHA_CONSULTA,
      codigo: "falha",
    };
  }
}
