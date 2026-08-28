import {
  consultarRegraFiscalOficial,
  listarRegrasCestAtivas,
  listarRegrasNcmAtivas,
} from "@/lib/fiscal/base-oficial/consultar";
import { analisarGruposFiscaisProdutos } from "@/lib/fiscal/motor/analisar-lote";
import { analisarOperacaoFiscal } from "@/lib/fiscal/motor/analisar-operacao";
import { validarCest } from "@/lib/fiscal/motor/cest";
import { classificarProdutoFiscal } from "@/lib/fiscal/motor/classificar";
import { dataReferenciaIso } from "@/lib/fiscal/motor/tipos";
import { pesquisarNcmLocal, validarNcmVigente } from "@/lib/fiscal/motor/ncm";
import { perguntaOrigemMercadoria, resolverOrigemMercadoria } from "@/lib/fiscal/motor/origem";
import { ORIGENS_MERCADORIA } from "@/lib/fiscal/tabelas-fiscais";
import { montarPropostasAtualizacaoFiscal } from "@/lib/fiscal/motor/proposta";
import { validarFiscalProdutoResultado } from "@/lib/fiscal/motor/validar-produto";

import { hrefProdutoAssistente } from "../rotas";
import { autorizarFerramentaIa, recusaFerramentaIa } from "../permissoes";
import {
  MENSAGEM_IA_FALHA_CONSULTA,
  type NomeFerramentaResultadoIa,
  type ResultadoFerramentaIa,
} from "../tipos";
import type { ContextoFerramentaIa } from "../ferramentas/contexto";

async function authFiscal(ctx: ContextoFerramentaIa, ferramenta: NomeFerramentaResultadoIa) {
  const auth = await autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso: "fiscal",
    acao: "acessar",
  });
  if (!auth.ok) {
    return recusaFerramentaIa(ferramenta, auth);
  }
  return null;
}

function dataRef(args: Record<string, unknown>) {
  return dataReferenciaIso(String(args.dataReferencia ?? "") || null);
}

export async function pesquisarNcmIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const recusa = await authFiscal(ctx, "pesquisar_ncm");
  if (recusa) return recusa;
  const termos = String(args.termos ?? args.descricao ?? "").trim();
  if (!termos) {
    return {
      ok: false,
      ferramenta: "pesquisar_ncm",
      erro: "Informe termos de busca ou um NCM.",
      codigo: "informacao_insuficiente",
    };
  }
  const regras = await listarRegrasNcmAtivas({
    supabase: ctx.supabase,
    busca: termos,
    codigo: termos.replace(/\D/g, "").length === 8 ? termos.replace(/\D/g, "") : undefined,
    limite: 20,
  });
  const candidatos = pesquisarNcmLocal({
    termos,
    regras,
    dataReferencia: dataRef(args),
  });
  return {
    ok: true,
    ferramenta: "pesquisar_ncm",
    dados: {
      candidatos,
      aviso:
        regras.length === 0
          ? "Base NCM oficial ainda não importada. Nenhum código foi inventado."
          : candidatos.length === 0
            ? "Nenhum NCM vigente corresponde aos termos."
            : null,
    },
  };
}

export async function consultarNcmIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const recusa = await authFiscal(ctx, "consultar_ncm");
  if (recusa) return recusa;
  const codigo = String(args.codigo ?? "").replace(/\D/g, "");
  const regra = await consultarRegraFiscalOficial({
    supabase: ctx.supabase,
    tipo: "ncm",
    codigo,
    referencia: dataRef(args),
  });
  return {
    ok: true,
    ferramenta: "consultar_ncm",
    dados: {
      ncm: regra
        ? { codigo: regra.codigo, descricao: regra.descricao, versao: regra.versao }
        : null,
      aviso: regra ? null : "NCM não encontrado na base oficial vigente. Não foi inventado.",
    },
  };
}

export async function validarNcmIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const recusa = await authFiscal(ctx, "validar_ncm");
  if (recusa) return recusa;
  const codigo = String(args.codigo ?? "").replace(/\D/g, "");
  const regras = await listarRegrasNcmAtivas({
    supabase: ctx.supabase,
    codigo,
    limite: 5,
  });
  return {
    ok: true,
    ferramenta: "validar_ncm",
    dados: validarNcmVigente({
      codigo,
      regras,
      dataReferencia: dataRef(args),
    }),
  };
}

export async function sugerirCestIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const recusa = await authFiscal(ctx, "sugerir_cest");
  if (recusa) return recusa;
  const ncm = String(args.ncm ?? "").replace(/\D/g, "");
  const regras = await listarRegrasCestAtivas({
    supabase: ctx.supabase,
    ncm,
  });
  const resultado = validarCest({
    cest: null,
    ncm,
    descricao: String(args.descricao ?? ""),
    regras,
    dataReferencia: dataRef(args),
  });
  return {
    ok: true,
    ferramenta: "sugerir_cest",
    dados: {
      ...resultado,
      avisoSt: "CEST no produto não implica substituição tributária na operação.",
    },
  };
}

export async function consultarCestIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const recusa = await authFiscal(ctx, "consultar_cest");
  if (recusa) return recusa;
  const cest = String(args.codigo ?? args.cest ?? "").replace(/\D/g, "");
  const ncm = String(args.ncm ?? "").replace(/\D/g, "") || null;
  const regras = await listarRegrasCestAtivas({
    supabase: ctx.supabase,
    cest,
    ncm: ncm ?? undefined,
  });
  return {
    ok: true,
    ferramenta: "consultar_cest",
    dados: validarCest({
      cest,
      ncm,
      regras,
      dataReferencia: dataRef(args),
    }),
  };
}

export async function consultarOrigemMercadoriaIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const recusa = await authFiscal(ctx, "consultar_origem_mercadoria");
  if (recusa) return recusa;
  const resolvida = resolverOrigemMercadoria({
    origemConfirmadaProduto: String(args.origemAtual ?? "") || null,
    origemInformadaUsuario: String(args.origemInformada ?? "") || null,
    marca: String(args.marca ?? "") || null,
  });
  return {
    ok: true,
    ferramenta: "consultar_origem_mercadoria",
    dados: {
      origensOficiais: ORIGENS_MERCADORIA,
      resolvida,
      perguntas: resolvida.perguntar ? perguntaOrigemMercadoria() : [],
      aviso: "Marca não determina origem. Apple/Samsung/Xiaomi não implicam importado ou nacional.",
    },
  };
}

export async function consultarClassificacaoIbsCbsIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const recusa = await authFiscal(ctx, "consultar_classificacao_ibs_cbs");
  if (recusa) return recusa;
  const produtoId = String(args.produtoId ?? ctx.tela.produtoId ?? "").trim();
  if (!produtoId) {
    return {
      ok: false,
      ferramenta: "consultar_classificacao_ibs_cbs",
      erro: "Abra o produto ou informe o identificador.",
      codigo: "nao_encontrado",
    };
  }
  const saida = await classificarProdutoFiscal({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    entrada: { produtoId, dataReferencia: dataRef(args) },
  });
  if (!saida.ok) {
    return {
      ok: false,
      ferramenta: "consultar_classificacao_ibs_cbs",
      erro: saida.erro,
      codigo: saida.codigo,
    };
  }
  return {
    ok: true,
    ferramenta: "consultar_classificacao_ibs_cbs",
    dados: {
      ibsCbs: saida.resultado.classificacaoIbsCbs,
      versoes: saida.resultado.versoes,
    },
  };
}

export async function classificarProdutoFiscalMotorIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const recusa = await authFiscal(ctx, "classificar_produto_fiscal");
  if (recusa) return recusa;
  const produtoId = String(args.produtoId ?? ctx.tela.produtoId ?? "").trim() || null;
  const saida = await classificarProdutoFiscal({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    usuarioId: ctx.usuarioId,
    registrarAnalise: false,
    entrada: {
      produtoId,
      descricao: String(args.descricao ?? "") || null,
      descricaoComplementar: String(args.descricaoComplementar ?? "") || null,
      marca: String(args.marca ?? "") || null,
      categoria: String(args.categoria ?? "") || null,
      material: String(args.material ?? "") || null,
      composicao: String(args.composicao ?? "") || null,
      finalidade: String(args.finalidade ?? "") || null,
      uso: String(args.uso ?? "") || null,
      caracteristicasTecnicas: String(args.caracteristicasTecnicas ?? "") || null,
      origemInformadaUsuario: String(args.origemInformadaUsuario ?? "") || null,
      ncmAtual: String(args.ncmAtual ?? "") || null,
      cestAtual: String(args.cestAtual ?? "") || null,
      dataReferencia: dataRef(args),
    },
  });
  if (!saida.ok) {
    return {
      ok: false,
      ferramenta: "classificar_produto_fiscal",
      erro: saida.erro,
      codigo: saida.codigo,
    };
  }
  return {
    ok: true,
    ferramenta: "classificar_produto_fiscal",
    codigo:
      saida.resultado.status === "informacao_insuficiente"
        ? "informacao_insuficiente"
        : saida.resultado.status === "sem_base"
          ? "sem_base"
          : saida.resultado.status === "aguardando_legislacao"
            ? "aguardando_legislacao"
            : undefined,
    dados: saida.resultado as unknown as Record<string, unknown>,
    acoes: saida.produtoId
      ? [{ label: "Abrir produto", href: hrefProdutoAssistente(saida.produtoId) }]
      : [],
  };
}

export async function validarFiscalProdutoMotorIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const recusa = await authFiscal(ctx, "validar_fiscal_produto");
  if (recusa) return recusa;
  const produtoId = String(args.produtoId ?? ctx.tela.produtoId ?? "").trim();
  if (!produtoId) {
    return {
      ok: false,
      ferramenta: "validar_fiscal_produto",
      erro: "Abra o produto para validar o fiscal.",
      codigo: "nao_encontrado",
    };
  }
  const saida = await classificarProdutoFiscal({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    entrada: { produtoId, dataReferencia: dataRef(args) },
  });
  if (!saida.ok) {
    return {
      ok: false,
      ferramenta: "validar_fiscal_produto",
      erro: saida.erro,
      codigo: saida.codigo,
    };
  }
  const validacao = validarFiscalProdutoResultado(saida.resultado);
  return {
    ok: true,
    ferramenta: "validar_fiscal_produto",
    dados: {
      status: validacao.status,
      diferencas: saida.resultado.diferencas,
      informacoesFaltantes: saida.resultado.informacoesFaltantes,
      confianca: saida.resultado.confianca,
      motivoConfianca: saida.resultado.motivoConfianca,
      justificativa: saida.resultado.justificativa,
      fontes: saida.resultado.fontes,
      versoes: saida.resultado.versoes,
    },
    acoes: [{ label: "Abrir produto", href: hrefProdutoAssistente(produtoId) }],
  };
}

export async function analisarOperacaoFiscalIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const recusa = await authFiscal(ctx, "analisar_operacao_fiscal");
  if (recusa) return recusa;
  const produtoId = String(args.produtoId ?? ctx.tela.produtoId ?? "").trim();
  if (!produtoId) {
    return {
      ok: false,
      ferramenta: "analisar_operacao_fiscal",
      erro: "Informe o produto da operação.",
      codigo: "nao_encontrado",
    };
  }
  const saida = await analisarOperacaoFiscal({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    produtoId,
    tipoOperacao: String(args.tipoOperacao ?? "venda"),
    ufDestino: String(args.ufDestino ?? "") || null,
    destinatarioId: String(args.destinatarioId ?? "") || null,
    contribuinteIcmsDestinatario:
      typeof args.contribuinteIcms === "boolean" ? args.contribuinteIcms : null,
    consumidorFinal:
      typeof args.consumidorFinal === "boolean" ? args.consumidorFinal : null,
    dataReferencia: dataRef(args),
    origemInformadaUsuario: String(args.origemInformadaUsuario ?? "") || null,
  });
  if (!saida.ok) {
    return {
      ok: false,
      ferramenta: "analisar_operacao_fiscal",
      erro: saida.erro,
      codigo: saida.codigo,
    };
  }
  return {
    ok: true,
    ferramenta: "analisar_operacao_fiscal",
    dados: saida.dados as unknown as Record<string, unknown>,
  };
}

export async function recomendarGrupoFiscalIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const recusa = await authFiscal(ctx, "recomendar_grupo_fiscal");
  if (recusa) return recusa;
  const produtoId = String(args.produtoId ?? ctx.tela.produtoId ?? "").trim();
  if (!produtoId) {
    return {
      ok: false,
      ferramenta: "recomendar_grupo_fiscal",
      erro: "Abra o produto para recomendar o grupo fiscal.",
      codigo: "nao_encontrado",
    };
  }
  const saida = await classificarProdutoFiscal({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    entrada: { produtoId, dataReferencia: dataRef(args) },
  });
  if (!saida.ok) {
    return {
      ok: false,
      ferramenta: "recomendar_grupo_fiscal",
      erro: saida.erro,
      codigo: saida.codigo,
    };
  }
  return {
    ok: true,
    ferramenta: "recomendar_grupo_fiscal",
    dados: {
      grupoAtual: saida.resultado.grupoAtual,
      recomendado: saida.resultado.grupoFiscalRecomendado,
      mensagem:
        saida.resultado.grupoFiscalRecomendado
          ? null
          : "Nenhum grupo fiscal existente possui compatibilidade suficiente com esta classificação.",
      motivos: saida.resultado.grupoFiscalRecomendado?.motivos ?? [],
      diferencas: saida.resultado.grupoFiscalRecomendado?.diferencas ?? [],
    },
  };
}

export async function analisarGruposFiscaisProdutosIa(
  ctx: ContextoFerramentaIa
): Promise<ResultadoFerramentaIa> {
  const recusa = await authFiscal(ctx, "analisar_grupos_fiscais_produtos");
  if (recusa) return recusa;
  try {
    const lote = await analisarGruposFiscaisProdutos({
      supabase: ctx.supabase,
      empresaId: ctx.empresaId,
      dataReferencia: dataReferenciaIso(new Date()),
    });
    return {
      ok: true,
      ferramenta: "analisar_grupos_fiscais_produtos",
      dados: lote as unknown as Record<string, unknown>,
    };
  } catch {
    return {
      ok: false,
      ferramenta: "analisar_grupos_fiscais_produtos",
      erro: MENSAGEM_IA_FALHA_CONSULTA,
      codigo: "falha",
    };
  }
}

export async function proporAtualizacaoFiscalMotorIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const recusa = await authFiscal(ctx, "propor_atualizacao_fiscal");
  if (recusa) return recusa;
  const produtoId = String(args.produtoId ?? ctx.tela.produtoId ?? "").trim();
  if (!produtoId) {
    return {
      ok: false,
      ferramenta: "propor_atualizacao_fiscal",
      erro: "Abra o produto para montar a proposta.",
      codigo: "nao_encontrado",
    };
  }
  const saida = await classificarProdutoFiscal({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    usuarioId: ctx.usuarioId,
    entrada: { produtoId, dataReferencia: dataRef(args) },
  });
  if (!saida.ok) {
    return {
      ok: false,
      ferramenta: "propor_atualizacao_fiscal",
      erro: saida.erro,
      codigo: saida.codigo,
    };
  }
  const propostas = montarPropostasAtualizacaoFiscal({
    empresaId: ctx.empresaId,
    produtoId,
    classificacao: saida.resultado,
  });
  if (propostas.length) {
    await ctx.supabase.from("fiscal_ia_propostas").insert(
      propostas.map((item) => ({
        empresa_id: ctx.empresaId,
        usuario_id: ctx.usuarioId,
        produto_id: produtoId,
        campo: item.campo,
        atual: item.atual,
        sugerido: item.sugerido,
        confianca: item.confianca,
        justificativa: item.justificativa.slice(0, 2000),
        fontes: item.fontes,
        versao: item.versao,
      }))
    );
  }
  return {
    ok: true,
    ferramenta: "propor_atualizacao_fiscal",
    dados: {
      propostas,
      aviso: "Nada foi gravado no cadastro. Confirmação futura fica fora desta fase.",
    },
  };
}
