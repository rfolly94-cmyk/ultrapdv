import { classificarProdutoFiscal } from "@/lib/fiscal/motor/classificar";
import { montarPropostasAtualizacaoFiscal } from "@/lib/fiscal/motor/proposta";
import { MENSAGEM_NENHUM_GRUPO_COMPATIVEL } from "@/lib/fiscal/motor/recomendar-grupo";
import { consultarRegraFiscalOficial } from "@/lib/fiscal/base-oficial/consultar";
import type { OpcaoAdiarNotificacao } from "@/lib/notificacoes/tipos";
import { ADIAR_NOTIFICACAO } from "@/lib/notificacoes/tipos";

import { criarPropostaAcao } from "../acoes/criar";
import { hashDaEntidade, hashProdutoBasico, hashProdutoFiscal } from "../acoes/estado";
import {
  MAX_NOTIFICACOES_POR_PROPOSTA,
  MENSAGEM_IA_SEM_PERMISSAO_FISCAL,
  type CardPropostaAcao,
  type DiferencaAcaoIa,
  type PayloadAcaoIa,
} from "../acoes/tipos";
import { autorizarFerramentaIa, recusaFerramentaIa } from "../permissoes";
import { hrefProdutoAssistente } from "../rotas";
import {
  MENSAGEM_IA_FALHA_CONSULTA,
  type AcaoAssistente,
  type NomeFerramentaPropostaIa,
  type ResultadoFerramentaIa,
} from "../tipos";
import type { ContextoFerramentaIa } from "./contexto";

function uuid(valor: unknown) {
  const id = String(valor ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id
    : "";
}

function acoesProposta(propostaId: string, href?: string | null): AcaoAssistente[] {
  return [
    ...(href ? [{ label: "Abrir", href }] : []),
    { label: "Aplicar alterações", confirmarAcao: { propostaId } },
    { label: "Cancelar", cancelarAcao: { propostaId } },
  ];
}

function cardParaResultado(
  ferramenta: NomeFerramentaPropostaIa,
  card: CardPropostaAcao,
  extra?: Record<string, unknown>
): ResultadoFerramentaIa {
  return {
    ok: true,
    ferramenta,
    dados: {
      propostaId: card.id,
      aviso: "Nada foi gravado. Confirme na interface para aplicar.",
      ...extra,
    },
    propostaAcao: card,
    acoes: acoesProposta(card.id, extra?.href ? String(extra.href) : null),
  };
}

async function persistirCard(params: {
  ctx: ContextoFerramentaIa;
  ferramenta: NomeFerramentaPropostaIa;
  tipo: PayloadAcaoIa extends never ? never : import("../acoes/tipos").TipoAcaoIa;
  entidadeTipo: import("../acoes/tipos").EntidadeAcaoIa;
  entidadeId: string | null;
  descricao: string;
  diferencas: DiferencaAcaoIa[];
  impacto: string[];
  avisos: string[];
  campos: Record<string, unknown>;
  antes: Record<string, unknown>;
  depois: Record<string, unknown>;
  hashEstado: string;
  fontes?: string[];
  versaoFiscal?: string | null;
  titulo: string;
  nomeEditavel?: boolean;
  nomeSugerido?: string;
  href?: string | null;
  extraDados?: Record<string, unknown>;
}): Promise<ResultadoFerramentaIa> {
  if (!params.ctx.conversaId) {
    return {
      ok: false,
      ferramenta: params.ferramenta,
      erro: "Conversa do assistente não encontrada.",
      codigo: "falha",
    };
  }
  const preview: CardPropostaAcao = {
    id: "pendente",
    tipo: params.tipo,
    entidadeTipo: params.entidadeTipo,
    entidadeId: params.entidadeId,
    titulo: params.titulo,
    descricao: params.descricao,
    diferencas: params.diferencas,
    impacto: params.impacto,
    avisos: params.avisos,
    nomeEditavel: params.nomeEditavel,
    nomeSugerido: params.nomeSugerido,
    card: "proposta",
  };
  const payload: PayloadAcaoIa = {
    preview,
    campos: params.campos,
    antes: params.antes,
    depois: params.depois,
    fontes: params.fontes,
    versaoFiscal: params.versaoFiscal,
  };
  const criada = await criarPropostaAcao({
    supabase: params.ctx.supabase,
    empresaId: params.ctx.empresaId,
    usuarioId: params.ctx.usuarioId,
    conversaId: params.ctx.conversaId,
    tipo: params.tipo,
    entidadeTipo: params.entidadeTipo,
    entidadeId: params.entidadeId,
    descricao: params.descricao,
    payload,
    hashEstado: params.hashEstado,
  });
  if (!criada.ok) {
    return {
      ok: false,
      ferramenta: params.ferramenta,
      erro: criada.erro || MENSAGEM_IA_FALHA_CONSULTA,
      codigo: "falha",
    };
  }
  const card = { ...preview, id: criada.propostaId };
  return cardParaResultado(params.ferramenta, card, {
    href: params.href,
    ...params.extraDados,
  });
}

export async function proporAtualizacaoFiscalProdutoIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const ferramenta: NomeFerramentaPropostaIa = "propor_atualizacao_fiscal_produto";
  const authProd = await autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso: "produtos",
    acao: "editar",
    mensagem: MENSAGEM_IA_SEM_PERMISSAO_FISCAL,
  });
  if (!authProd.ok) {
    return recusaFerramentaIa(ferramenta, authProd);
  }
  const authFiscal = await autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso: "fiscal",
    acao: "acessar",
    mensagem: MENSAGEM_IA_SEM_PERMISSAO_FISCAL,
  });
  if (!authFiscal.ok) {
    return recusaFerramentaIa(ferramenta, authFiscal);
  }
  const produtoId = uuid(args.produtoId) || uuid(ctx.tela.produtoId);
  if (!produtoId) {
    return {
      ok: false,
      ferramenta,
      erro: "Abra o produto para montar a proposta fiscal.",
      codigo: "nao_encontrado",
    };
  }
  const saida = await classificarProdutoFiscal({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    usuarioId: ctx.usuarioId,
    entrada: { produtoId, dataReferencia: String(args.dataReferencia ?? "") || undefined },
  });
  if (!saida.ok) {
    return { ok: false, ferramenta, erro: saida.erro, codigo: saida.codigo };
  }
  const ncm = saida.resultado.ncmSugerido?.codigo ?? null;
  if (ncm) {
    const vigente = await consultarRegraFiscalOficial({
      supabase: ctx.supabase,
      tipo: "ncm",
      codigo: ncm,
    });
    if (!vigente) {
      return {
        ok: false,
        ferramenta,
        erro: "A vigência da regra NCM não permite propor este código.",
        codigo: "sem_base",
      };
    }
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
  const estado = await hashProdutoFiscal({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    produtoId,
  });
  if (!estado) {
    return {
      ok: false,
      ferramenta,
      erro: "Produto não encontrado nesta empresa.",
      codigo: "nao_encontrado",
    };
  }
  const grupoId = saida.resultado.grupoFiscalRecomendado?.id ?? estado.campos.grupo_fiscal_id;
  const depois = {
    ncm,
    cest:
      Array.isArray(saida.resultado.cest)
        ? saida.resultado.cest[0]?.codigo ?? estado.campos.cest
        : saida.resultado.cest && "codigo" in saida.resultado.cest
          ? saida.resultado.cest.codigo
          : estado.campos.cest,
    origemProduto: saida.resultado.origem.codigo ?? estado.campos.origem_produto,
    grupoFiscalId: grupoId,
  };
  const diferencas: DiferencaAcaoIa[] = saida.resultado.diferencas
    .filter((item) => item.sugerido && item.atual !== item.sugerido)
    .map((item) => ({
      campo: item.campo,
      rotulo: item.rotulo,
      atual: item.atual,
      novo: item.sugerido,
    }));
  if (!diferencas.length) {
    return {
      ok: true,
      ferramenta,
      dados: {
        aviso: "Não há alteração fiscal segura para propor neste produto.",
        classificacao: {
          confianca: saida.resultado.confianca,
          justificativa: saida.resultado.justificativa,
        },
      },
    };
  }
  const versao = Object.entries(saida.resultado.versoes)
    .map(([fonte, valor]) => `${fonte}:${valor}`)
    .join(",");
  return persistirCard({
    ctx,
    ferramenta,
    tipo: "atualizacao_fiscal_produto",
    entidadeTipo: "produto",
    entidadeId: produtoId,
    titulo: "Atualização fiscal",
    descricao: `Atualização fiscal do produto com ${diferencas.length} alteração(ões).`,
    diferencas,
    impacto: ["Altera NCM/CEST/origem e/ou grupo fiscal deste produto."],
    avisos: [
      "Nada será gravado até você confirmar.",
      saida.resultado.confianca === "alta" ? "" : "Confiança da classificação não é alta.",
    ].filter(Boolean),
    campos: depois,
    antes: {
      ncm: estado.campos.ncm,
      cest: estado.campos.cest,
      origemProduto: estado.campos.origem_produto,
      grupoFiscalId: estado.campos.grupo_fiscal_id,
    },
    depois,
    hashEstado: estado.hash,
    fontes: saida.resultado.fontes.map((item) => `${item.codigo}:${item.versao}`),
    versaoFiscal: versao || null,
    href: hrefProdutoAssistente(produtoId),
    extraDados: { produtoId, confianca: saida.resultado.confianca },
  });
}

export async function proporAtribuicaoGrupoFiscalIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const ferramenta: NomeFerramentaPropostaIa = "propor_atribuicao_grupo_fiscal";
  const auth = await autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso: "produtos",
    acao: "editar",
    mensagem: MENSAGEM_IA_SEM_PERMISSAO_FISCAL,
  });
  if (!auth.ok) {
    return recusaFerramentaIa(ferramenta, auth);
  }
  const produtoId = uuid(args.produtoId) || uuid(ctx.tela.produtoId);
  if (!produtoId) {
    return {
      ok: false,
      ferramenta,
      erro: "Abra o produto para atribuir o grupo fiscal.",
      codigo: "nao_encontrado",
    };
  }
  const saida = await classificarProdutoFiscal({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    usuarioId: ctx.usuarioId,
    entrada: { produtoId },
  });
  if (!saida.ok) {
    return { ok: false, ferramenta, erro: saida.erro, codigo: saida.codigo };
  }
  const recomendado = saida.resultado.grupoFiscalRecomendado;
  if (!recomendado) {
    return {
      ok: true,
      ferramenta,
      dados: {
        mensagem: MENSAGEM_NENHUM_GRUPO_COMPATIVEL,
        podeCriar: true,
      },
    };
  }
  const { data: grupo } = await ctx.supabase
    .from("grupos_fiscais")
    .select("id, empresa_id, nome, ativo")
    .eq("empresa_id", ctx.empresaId)
    .eq("id", recomendado.id)
    .maybeSingle();
  if (!grupo || String(grupo.empresa_id) !== ctx.empresaId || !grupo.ativo) {
    return {
      ok: false,
      ferramenta,
      erro: "Grupo fiscal inválido ou de outra empresa.",
      codigo: "nao_encontrado",
    };
  }
  const estado = await hashProdutoFiscal({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    produtoId,
  });
  if (!estado) {
    return {
      ok: false,
      ferramenta,
      erro: "Produto não encontrado nesta empresa.",
      codigo: "nao_encontrado",
    };
  }
  if (String(estado.campos.grupo_fiscal_id ?? "") === recomendado.id) {
    return {
      ok: true,
      ferramenta,
      dados: { mensagem: "O produto já está neste grupo fiscal." },
    };
  }
  return persistirCard({
    ctx,
    ferramenta,
    tipo: "atribuicao_grupo_fiscal",
    entidadeTipo: "produto",
    entidadeId: produtoId,
    titulo: "Atribuir grupo fiscal",
    descricao: `Atribuir o grupo "${grupo.nome}" ao produto.`,
    diferencas: [
      {
        campo: "grupoFiscal",
        rotulo: "Grupo fiscal",
        atual: saida.resultado.grupoAtual?.nome ?? null,
        novo: String(grupo.nome),
      },
    ],
    impacto: ["Altera somente o grupo fiscal deste produto."],
    avisos: ["Nada será gravado até você confirmar."],
    campos: { grupoFiscalId: recomendado.id },
    antes: {
      grupoFiscalId: estado.campos.grupo_fiscal_id,
      ncm: estado.campos.ncm,
      cest: estado.campos.cest,
      origemProduto: estado.campos.origem_produto,
    },
    depois: { grupoFiscalId: recomendado.id, grupoNome: grupo.nome },
    hashEstado: estado.hash,
    href: hrefProdutoAssistente(produtoId),
  });
}

export async function proporCriacaoGrupoFiscalIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const ferramenta: NomeFerramentaPropostaIa = "propor_criacao_grupo_fiscal";
  const auth = await autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso: "produtos",
    acao: "criar",
    mensagem: "Você não possui permissão para criar grupo fiscal.",
  });
  if (!auth.ok) {
    return recusaFerramentaIa(ferramenta, auth);
  }
  const produtoId = uuid(args.produtoId) || uuid(ctx.tela.produtoId);
  const saida = await classificarProdutoFiscal({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    usuarioId: ctx.usuarioId,
    entrada: produtoId ? { produtoId } : {},
  });
  if (!saida.ok) {
    return { ok: false, ferramenta, erro: saida.erro, codigo: saida.codigo };
  }
  if (saida.resultado.grupoFiscalRecomendado) {
    return {
      ok: true,
      ferramenta,
      dados: {
        mensagem:
          "Já existe um grupo fiscal compatível. Use a atribuição ao grupo existente em vez de criar outro.",
        grupo: saida.resultado.grupoFiscalRecomendado,
      },
    };
  }
  if (saida.resultado.classificacaoIbsCbs.combinacaoValida !== true) {
    return {
      ok: false,
      ferramenta,
      erro: "O Motor Fiscal não possui dados suficientes para criar um grupo agora.",
      codigo: "informacao_insuficiente",
    };
  }
  const { data: grupos } = await ctx.supabase
    .from("grupos_fiscais")
    .select(
      "id, empresa_id, nome, cfop_interno, cfop_interestadual, icms_cst_csosn, icms_aliquota, pis_cst, pis_aliquota, cofins_cst, cofins_aliquota, ipi_aplicavel, ipi_cst, ipi_aliquota, ipi_enquadramento, cst_ibscbs, classificacao_ibscbs, aliquota_ibs_uf, aliquota_ibs_municipio, aliquota_cbs, ativo"
    )
    .eq("empresa_id", ctx.empresaId)
    .eq("ativo", true)
    .limit(50);
  const daEmpresa = (grupos ?? []).filter((g) => String(g.empresa_id) === ctx.empresaId);
  const base = daEmpresa[0];
  if (!base?.cfop_interno || !base.icms_cst_csosn || !base.pis_cst || !base.cofins_cst) {
    return {
      ok: false,
      ferramenta,
      erro: "Não há grupo da empresa para copiar CFOP/ICMS/PIS com segurança. Crie o primeiro grupo na tela de grupos fiscais.",
      codigo: "informacao_insuficiente",
    };
  }
  const nomeSugerido = String(args.nome ?? "").trim() ||
    `Grupo ${saida.resultado.ncmSugerido?.codigo ?? "IA"}`.slice(0, 80);
  const campos = {
    nome: nomeSugerido,
    descricao: saida.resultado.justificativa.slice(0, 240),
    cfopInterno: String(base.cfop_interno),
    cfopInterestadual: String(base.cfop_interestadual ?? "6102"),
    icmsCstCsosn: String(base.icms_cst_csosn),
    icmsAliquota: base.icms_aliquota,
    pisCst: String(base.pis_cst),
    pisAliquota: base.pis_aliquota,
    cofinsCst: String(base.cofins_cst),
    cofinsAliquota: base.cofins_aliquota,
    ipiAplicavel: Boolean(base.ipi_aplicavel),
    ipiCst: base.ipi_cst,
    ipiAliquota: base.ipi_aliquota,
    ipiEnquadramento: base.ipi_enquadramento,
    cstIbscbs: saida.resultado.classificacaoIbsCbs.cst,
    classificacaoIbscbs: saida.resultado.classificacaoIbsCbs.cClassTrib,
    aliquotaIbsUf: base.aliquota_ibs_uf,
    aliquotaIbsMunicipio: base.aliquota_ibs_municipio,
    aliquotaCbs: base.aliquota_cbs,
  };
  const estado = await hashDaEntidade({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    usuarioId: ctx.usuarioId,
    tipo: "criacao_grupo_fiscal",
    entidadeTipo: "grupo_fiscal",
    entidadeId: null,
  });
  return persistirCard({
    ctx,
    ferramenta,
    tipo: "criacao_grupo_fiscal",
    entidadeTipo: "grupo_fiscal",
    entidadeId: null,
    titulo: "Novo grupo fiscal",
    descricao: "Criar grupo fiscal a partir da classificação. Nenhum produto será movido automaticamente.",
    diferencas: [
      { campo: "nome", rotulo: "Nome", atual: null, novo: nomeSugerido },
      { campo: "cstIbscbs", rotulo: "CST IBS/CBS", atual: null, novo: campos.cstIbscbs },
      { campo: "cClassTrib", rotulo: "cClassTrib", atual: null, novo: campos.classificacaoIbscbs },
      { campo: "cfopInterno", rotulo: "CFOP interno", atual: null, novo: campos.cfopInterno },
      { campo: "icms", rotulo: "CST/CSOSN ICMS", atual: null, novo: campos.icmsCstCsosn },
    ],
    impacto: ["Cria um grupo fiscal novo na empresa ativa. Não altera produtos."],
    avisos: [
      "O nome pode ser editado antes de confirmar.",
      "Nenhum produto será movido automaticamente.",
    ],
    campos,
    antes: {},
    depois: campos,
    hashEstado: estado?.hash ?? "",
    nomeEditavel: true,
    nomeSugerido,
    extraDados: { mensagem: MENSAGEM_NENHUM_GRUPO_COMPATIVEL },
  });
}

export async function proporAtualizacaoProdutoIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const ferramenta: NomeFerramentaPropostaIa = "propor_atualizacao_produto";
  const produtoId = uuid(args.produtoId) || uuid(ctx.tela.produtoId);
  if (!produtoId) {
    return {
      ok: false,
      ferramenta,
      erro: "Abra o produto para propor a alteração.",
      codigo: "nao_encontrado",
    };
  }
  const descricao = args.descricao == null ? null : String(args.descricao).trim();
  const categoriaNome = String(args.categoriaNome ?? args.categoria ?? "").trim();
  const categoriaIdArg = uuid(args.categoriaId);
  const minimoArg = args.estoqueMinimo;
  const alterarDescricao = descricao != null && descricao.length > 0 && args.descricao != null;
  const alterarMinimo = minimoArg != null && minimoArg !== "";
  let categoriaId: string | null = categoriaIdArg || null;
  let categoriaLabel: string | null = null;
  if (categoriaNome || categoriaId) {
    const query = ctx.supabase
      .from("categorias")
      .select("id, empresa_id, nome, ativo")
      .eq("empresa_id", ctx.empresaId);
    const { data: cat } = categoriaId
      ? await query.eq("id", categoriaId).maybeSingle()
      : await query.ilike("nome", categoriaNome).limit(1).maybeSingle();
    if (!cat || String(cat.empresa_id) !== ctx.empresaId || !cat.ativo) {
      return {
        ok: false,
        ferramenta,
        erro: "Categoria inválida ou de outra empresa.",
        codigo: "nao_encontrado",
      };
    }
    categoriaId = String(cat.id);
    categoriaLabel = String(cat.nome);
  }
  const alterarCategoria = Boolean(categoriaId);
  if (!alterarDescricao && !alterarCategoria && !alterarMinimo) {
    return {
      ok: false,
      ferramenta,
      erro: "Informe descrição, categoria existente ou estoque mínimo.",
      codigo: "informacao_insuficiente",
    };
  }
  if (alterarDescricao || alterarCategoria) {
    const auth = await autorizarFerramentaIa({
      empresaId: ctx.empresaId,
      permissoes: ctx.permissoes,
      recurso: "produtos",
      acao: "editar",
    });
    if (!auth.ok) {
      return recusaFerramentaIa(ferramenta, auth);
    }
  }
  if (alterarMinimo) {
    const auth = await autorizarFerramentaIa({
      empresaId: ctx.empresaId,
      permissoes: ctx.permissoes,
      recurso: "estoque",
      acao: "ajustar",
    });
    if (!auth.ok) {
      return recusaFerramentaIa(ferramenta, auth);
    }
  }
  const minimo = alterarMinimo ? Number(String(minimoArg).replace(",", ".")) : null;
  if (alterarMinimo && (minimo == null || !Number.isFinite(minimo) || minimo < 0)) {
    return { ok: false, ferramenta, erro: "Estoque mínimo inválido.", codigo: "falha" };
  }
  const estado = await hashProdutoBasico({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    produtoId,
  });
  if (!estado) {
    return {
      ok: false,
      ferramenta,
      erro: "Produto não encontrado nesta empresa.",
      codigo: "nao_encontrado",
    };
  }
  const diferencas: DiferencaAcaoIa[] = [];
  if (alterarDescricao) {
    diferencas.push({
      campo: "descricao",
      rotulo: "Descrição",
      atual: estado.campos.descricao as string | null,
      novo: descricao,
    });
  }
  if (alterarCategoria) {
    diferencas.push({
      campo: "categoria",
      rotulo: "Categoria",
      atual: null,
      novo: categoriaLabel,
    });
  }
  if (alterarMinimo) {
    diferencas.push({
      campo: "estoqueMinimo",
      rotulo: "Estoque mínimo",
      atual: estado.campos.estoque_minimo as number | null,
      novo: minimo,
    });
  }
  return persistirCard({
    ctx,
    ferramenta,
    tipo: "atualizacao_basica_produto",
    entidadeTipo: "produto",
    entidadeId: produtoId,
    titulo: "Atualização do produto",
    descricao: `Alterar dados básicos de ${String(estado.produto?.nome ?? "produto")}.`,
    diferencas,
    impacto: ["Não altera estoque atual, custo nem preço de venda."],
    avisos: ["Nada será gravado até você confirmar."],
    campos: {
      alterarDescricao,
      alterarCategoria,
      alterarEstoqueMinimo: alterarMinimo,
      descricao,
      categoriaId,
      estoqueMinimo: minimo,
    },
    antes: {
      descricao: estado.campos.descricao,
      categoriaId: estado.campos.categoria_id,
      estoqueMinimo: estado.campos.estoque_minimo,
    },
    depois: {
      descricao: alterarDescricao ? descricao : estado.campos.descricao,
      categoriaId: alterarCategoria ? categoriaId : estado.campos.categoria_id,
      estoqueMinimo: alterarMinimo ? minimo : estado.campos.estoque_minimo,
    },
    hashEstado: estado.hash,
    href: hrefProdutoAssistente(produtoId),
  });
}

export async function proporAcaoNotificacaoIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const ferramenta: NomeFerramentaPropostaIa = "propor_acao_notificacao";
  const acaoRaw = String(args.acao ?? "lida");
  const acao =
    acaoRaw === "dispensar" ? "dispensar" : acaoRaw === "adiar" ? "adiar" : "lida";
  const idsBrutos = Array.isArray(args.notificacaoIds)
    ? args.notificacaoIds
    : args.notificacaoId
      ? [args.notificacaoId]
      : ctx.tela.notificacaoIds ?? [];
  const ids = [...new Set(idsBrutos.map((id) => uuid(id)).filter(Boolean))].slice(
    0,
    MAX_NOTIFICACOES_POR_PROPOSTA
  );
  if (!ids.length) {
    return {
      ok: false,
      ferramenta,
      erro: "Informe os avisos que devem ser marcados.",
      codigo: "nao_encontrado",
    };
  }
  const { data: rows } = await ctx.supabase
    .from("notificacoes")
    .select("id, empresa_id, titulo")
    .eq("empresa_id", ctx.empresaId)
    .in("id", ids);
  const validos = (rows ?? []).filter((row) => String(row.empresa_id) === ctx.empresaId);
  if (!validos.length) {
    return {
      ok: false,
      ferramenta,
      erro: "Notificação não encontrada nesta empresa.",
      codigo: "nao_encontrado",
    };
  }
  const idsOk = validos.map((row) => String(row.id));
  const adiarRaw = String(args.adiar ?? "amanha");
  const adiar = (ADIAR_NOTIFICACAO as readonly string[]).includes(adiarRaw)
    ? (adiarRaw as OpcaoAdiarNotificacao)
    : "amanha";
  const tipo =
    acao === "dispensar"
      ? "notificacao_dispensar"
      : acao === "adiar"
        ? "notificacao_adiar"
        : "notificacao_lida";
  const estado = await hashDaEntidade({
    supabase: ctx.supabase,
    empresaId: ctx.empresaId,
    usuarioId: ctx.usuarioId,
    tipo,
    entidadeTipo: "notificacao",
    entidadeId: idsOk[0],
    ids: idsOk,
  });
  const rotulo = acao === "lida" ? "Marcar como lidos" : acao === "dispensar" ? "Dispensar" : "Adiar";
  return persistirCard({
    ctx,
    ferramenta,
    tipo,
    entidadeTipo: "notificacao",
    entidadeId: idsOk[0],
    titulo: "Avisos",
    descricao: `${rotulo} ${idsOk.length} aviso(s).`,
    diferencas: validos.slice(0, 8).map((row) => ({
      campo: String(row.id),
      rotulo: String(row.titulo ?? "Aviso"),
      atual: "ativo",
      novo: rotulo,
    })),
    impacto: ["Altera somente o estado do aviso para o seu usuário."],
    avisos: ["Não executa ação financeira."],
    campos: { notificacaoIds: idsOk, adiar, acao },
    antes: estado?.campos ?? {},
    depois: { notificacaoIds: idsOk, acao, adiar },
    hashEstado: estado?.hash ?? "",
  });
}
