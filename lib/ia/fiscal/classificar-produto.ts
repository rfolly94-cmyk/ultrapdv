import {
  consultarCclassTribCatalogo,
  consultarCstIbsCbsCatalogo,
  consultarRegraFiscalOficial,
  listarFontesFiscaisOficiais,
  resumoFontesParaIa,
} from "@/lib/fiscal/base-oficial/consultar";
import { avaliarStatusFiscalProduto } from "@/lib/fiscal/status-fiscal-produto";
import type { GrupoFiscalResumo } from "@/lib/fiscal/status-fiscal-produto";
import { ORIGENS_MERCADORIA, existeCodigo } from "@/lib/fiscal/tabelas-fiscais";
import { persistirFiscalProdutoApi } from "@/lib/produtos/persistir-api";
import {
  validarDadosFiscaisProduto,
  type DadosFiscaisProduto,
} from "@/lib/produtos/dados-fiscais-produto";

import { descricaoFiscalInsuficiente } from "../contexto";
import { autorizarFerramentaIa, recusaFerramentaIa } from "../permissoes";
import { hrefProdutoAssistente } from "../rotas";
import {
  MENSAGEM_IA_FALHA_CONSULTA,
  MENSAGEM_IA_PRECISA_MAIS,
  type ConfiancaFiscalIa,
  type PropostaFiscalProduto,
  type ResultadoFerramentaIa,
} from "../tipos";
import type { ContextoFerramentaIa } from "../ferramentas/contexto";

const GRUPO_SELECT =
  "id, nome, ativo, cfop_interno, cfop_interestadual, icms_cst_csosn, icms_aliquota, pis_cst, pis_aliquota, cofins_cst, cofins_aliquota, ipi_aplicavel, ipi_cst, ipi_aliquota, cst_ibscbs, classificacao_ibscbs, aliquota_ibs_uf, aliquota_ibs_municipio, aliquota_cbs";

const CAMPOS: Array<{ campo: string; rotulo: string }> = [
  { campo: "ncm", rotulo: "NCM" },
  { campo: "cest", rotulo: "CEST" },
  { campo: "origemProduto", rotulo: "Origem" },
  { campo: "grupoFiscalId", rotulo: "Grupo fiscal" },
  { campo: "cstIbscbs", rotulo: "CST IBS/CBS" },
  { campo: "cClassTrib", rotulo: "cClassTrib" },
  { campo: "cfopInterno", rotulo: "CFOP interno" },
  { campo: "icms", rotulo: "CST/CSOSN ICMS" },
  { campo: "pis", rotulo: "CST PIS" },
  { campo: "cofins", rotulo: "CST COFINS" },
];

type SnapshotFiscal = {
  produtoId: string;
  produtoNome: string;
  descricao: string | null;
  ncm: string | null;
  cest: string | null;
  origemProduto: string | null;
  grupoFiscalId: string | null;
  grupo: GrupoFiscalResumo | null;
};

async function carregarSnapshotFiscal(
  ctx: ContextoFerramentaIa,
  produtoId: string
): Promise<SnapshotFiscal | null> {
  const { data } = await ctx.supabase
    .from("produtos")
    .select(
      "id, empresa_id, nome, descricao, grupo_fiscal_id, produtos_fiscal ( empresa_id, ncm, cest, origem_produto )"
    )
    .eq("empresa_id", ctx.empresaId)
    .eq("id", produtoId)
    .maybeSingle();
  if (!data || String(data.empresa_id) !== ctx.empresaId) {
    return null;
  }
  const fiscal = Array.isArray(data.produtos_fiscal)
    ? data.produtos_fiscal[0]
    : data.produtos_fiscal;
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
  return {
    produtoId: String(data.id),
    produtoNome: String(data.nome ?? "Produto"),
    descricao: data.descricao ? String(data.descricao) : null,
    ncm: fiscal?.ncm ? String(fiscal.ncm) : null,
    cest: fiscal?.cest ? String(fiscal.cest) : null,
    origemProduto: fiscal?.origem_produto ? String(fiscal.origem_produto) : "0",
    grupoFiscalId: data.grupo_fiscal_id ? String(data.grupo_fiscal_id) : null,
    grupo,
  };
}

function atualDoSnapshot(snap: SnapshotFiscal) {
  return {
    ncm: snap.ncm,
    cest: snap.cest,
    origemProduto: snap.origemProduto,
    grupoFiscalId: snap.grupoFiscalId,
    grupoNome: snap.grupo?.nome ?? null,
    cstIbscbs: snap.grupo?.cst_ibscbs ?? null,
    cClassTrib: snap.grupo?.classificacao_ibscbs ?? null,
    cfopInterno: snap.grupo?.cfop_interno ?? null,
    icms: snap.grupo?.icms_cst_csosn ?? null,
    pis: snap.grupo?.pis_cst ?? null,
    cofins: snap.grupo?.cofins_cst ?? null,
    aliquotaIbsUf: snap.grupo?.aliquota_ibs_uf ?? null,
    aliquotaCbs: snap.grupo?.aliquota_cbs ?? null,
  };
}

export async function classificarProdutoFiscalIa(
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
    return recusaFerramentaIa("classificar_produto_fiscal", auth);
  }
  const produtoId = String(args.produtoId ?? ctx.tela.produtoId ?? "").trim();
  if (!produtoId) {
    return {
      ok: false,
      ferramenta: "classificar_produto_fiscal",
      erro: "Abra o produto ou informe o identificador.",
      codigo: "nao_encontrado",
    };
  }
  try {
    const snap = await carregarSnapshotFiscal(ctx, produtoId);
    if (!snap) {
      return {
        ok: false,
        ferramenta: "classificar_produto_fiscal",
        erro: "Produto não encontrado nesta empresa.",
        codigo: "nao_encontrado",
      };
    }
    const descricaoExtra = String(args.descricao ?? "").trim();
    const material = String(args.material ?? "").trim();
    const finalidade = String(args.finalidade ?? "").trim();
    const composicao = String(args.composicao ?? "").trim();
    const textoAnalise = [snap.produtoNome, snap.descricao, descricaoExtra, material, finalidade, composicao]
      .filter(Boolean)
      .join(" ");

    const fontes = await listarFontesFiscaisOficiais(ctx.supabase);
    const ncmFonte = fontes.find((item) => item.codigo === "ncm_oficial");
    const perguntas: string[] = [];
    if (descricaoFiscalInsuficiente(textoAnalise) || !material || !finalidade) {
      perguntas.push("Qual o material (plástico, silicone, tecido, metal, eletrônico)?");
      perguntas.push("Possui componente eletrônico?");
      perguntas.push("Qual a finalidade (proteção, vestuário, alimento, peça)?");
      perguntas.push("Qual a composição, se conhecida?");
    }

    const ncmRegra = snap.ncm
      ? await consultarRegraFiscalOficial({
          supabase: ctx.supabase,
          tipo: "ncm",
          codigo: snap.ncm.replace(/\D/g, ""),
        })
      : null;

    const cstCatalogo = snap.grupo?.cst_ibscbs
      ? await consultarCstIbsCbsCatalogo({
          supabase: ctx.supabase,
          codigo: String(snap.grupo.cst_ibscbs),
        })
      : null;
    const classes = snap.grupo?.classificacao_ibscbs
      ? await consultarCclassTribCatalogo({
          supabase: ctx.supabase,
          codigo: String(snap.grupo.classificacao_ibscbs),
        })
      : snap.grupo?.cst_ibscbs
        ? await consultarCclassTribCatalogo({
            supabase: ctx.supabase,
            cstCodigo: String(snap.grupo.cst_ibscbs),
          })
        : [];

    let confianca: ConfiancaFiscalIa = "nenhuma";
    if (ncmRegra && cstCatalogo) {
      confianca = "alta";
    } else if (cstCatalogo || snap.grupo) {
      confianca = perguntas.length ? "baixa" : "media";
    } else if (perguntas.length) {
      confianca = "baixa";
    }

    const justificativa = ncmRegra
      ? `NCM ${snap.ncm} encontrado na base oficial ${ncmRegra.fonte} (${ncmRegra.versao}).`
      : ncmFonte?.status === "pendente"
        ? "Não há tabela NCM oficial importada. Não é possível afirmar um NCM novo."
        : "Sem regra NCM vigente para este código.";

    return {
      ok: true,
      ferramenta: "classificar_produto_fiscal",
      dados: {
        produto: {
          id: snap.produtoId,
          nome: snap.produtoNome,
        },
        atual: atualDoSnapshot(snap),
        confianca,
        perguntas,
        justificativa,
        fontes: resumoFontesParaIa(fontes),
        catalogoIbsCbs: {
          cst: cstCatalogo,
          cClassTrib: classes.slice(0, 5),
        },
        ncmOficial: ncmRegra
          ? { codigo: ncmRegra.codigo, descricao: ncmRegra.descricao, versao: ncmRegra.versao }
          : null,
        aviso:
          perguntas.length > 0
            ? MENSAGEM_IA_PRECISA_MAIS
            : ncmRegra
              ? null
              : "Sem base NCM/CEST suficiente para sugerir códigos novos.",
      },
      acoes: [{ label: "Abrir produto", href: hrefProdutoAssistente(snap.produtoId) }],
    };
  } catch {
    return {
      ok: false,
      ferramenta: "classificar_produto_fiscal",
      erro: MENSAGEM_IA_FALHA_CONSULTA,
      codigo: "falha",
    };
  }
}

export async function validarFiscalProdutoIa(
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
    return recusaFerramentaIa("validar_fiscal_produto", auth);
  }
  const produtoId = String(args.produtoId ?? ctx.tela.produtoId ?? "").trim();
  if (!produtoId) {
    return {
      ok: false,
      ferramenta: "validar_fiscal_produto",
      erro: "Abra o produto para validar o fiscal.",
      codigo: "nao_encontrado",
    };
  }
  const snap = await carregarSnapshotFiscal(ctx, produtoId);
  if (!snap) {
    return {
      ok: false,
      ferramenta: "validar_fiscal_produto",
      erro: "Produto não encontrado nesta empresa.",
      codigo: "nao_encontrado",
    };
  }
  const status = avaliarStatusFiscalProduto({
    ncm: snap.ncm,
    grupo: snap.grupo,
  });
  const origemOk = existeCodigo(ORIGENS_MERCADORIA, snap.origemProduto ?? "0");
  return {
    ok: true,
    ferramenta: "validar_fiscal_produto",
    dados: {
      fiscalOk: status.ok && origemOk,
      motivos: [
        ...status.motivos,
        origemOk ? null : "Origem da mercadoria inválida.",
      ].filter(Boolean),
      atual: atualDoSnapshot(snap),
    },
    acoes: [{ label: "Abrir produto", href: hrefProdutoAssistente(snap.produtoId) }],
  };
}

export async function proporAtualizacaoFiscalIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const auth = await autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso: "produtos",
    acao: "editar",
  });
  if (!auth.ok) {
    return recusaFerramentaIa("propor_atualizacao_fiscal", auth);
  }
  const fiscalAuth = await autorizarFerramentaIa({
    empresaId: ctx.empresaId,
    permissoes: ctx.permissoes,
    recurso: "fiscal",
    acao: "acessar",
  });
  if (!fiscalAuth.ok) {
    return recusaFerramentaIa("propor_atualizacao_fiscal", fiscalAuth);
  }

  const produtoId = String(args.produtoId ?? ctx.tela.produtoId ?? "").trim();
  if (!produtoId) {
    return {
      ok: false,
      ferramenta: "propor_atualizacao_fiscal",
      erro: "Abra o produto para propor o fiscal.",
      codigo: "nao_encontrado",
    };
  }
  const snap = await carregarSnapshotFiscal(ctx, produtoId);
  if (!snap) {
    return {
      ok: false,
      ferramenta: "propor_atualizacao_fiscal",
      erro: "Produto não encontrado nesta empresa.",
      codigo: "nao_encontrado",
    };
  }

  const ncmInformado = String(args.ncm ?? "").replace(/\D/g, "");
  const cestInformado = String(args.cest ?? "").replace(/\D/g, "");
  const origemInformada = String(args.origemProduto ?? snap.origemProduto ?? "0");
  const grupoInformado = String(args.grupoFiscalId ?? snap.grupoFiscalId ?? "").trim() || null;

  const ncmRegra = ncmInformado
    ? await consultarRegraFiscalOficial({
        supabase: ctx.supabase,
        tipo: "ncm",
        codigo: ncmInformado,
      })
    : null;
  const cestRegra = cestInformado
    ? await consultarRegraFiscalOficial({
        supabase: ctx.supabase,
        tipo: "cest",
        codigo: cestInformado,
      })
    : null;

  const ncmSugerido = ncmRegra ? ncmRegra.codigo : snap.ncm;
  const cestSugerido = cestRegra ? cestRegra.codigo : snap.cest || null;
  if (ncmInformado && !ncmRegra) {
    return {
      ok: false,
      ferramenta: "propor_atualizacao_fiscal",
      erro: "Não há base oficial vigente para afirmar esse NCM.",
      codigo: "sem_base",
    };
  }
  if (cestInformado && !cestRegra) {
    return {
      ok: false,
      ferramenta: "propor_atualizacao_fiscal",
      erro: "Não há base oficial vigente para afirmar esse CEST.",
      codigo: "sem_base",
    };
  }

  let grupo = snap.grupo;
  if (grupoInformado && grupoInformado !== snap.grupoFiscalId) {
    const { data: grupoRow } = await ctx.supabase
      .from("grupos_fiscais")
      .select(GRUPO_SELECT)
      .eq("empresa_id", ctx.empresaId)
      .eq("id", grupoInformado)
      .maybeSingle();
    if (!grupoRow) {
      return {
        ok: false,
        ferramenta: "propor_atualizacao_fiscal",
        erro: "Grupo fiscal inválido ou de outra empresa.",
        codigo: "nao_encontrado",
      };
    }
    grupo = grupoRow as GrupoFiscalResumo;
  }

  const atual = atualDoSnapshot(snap);
  const sugerido = {
    ...atual,
    ncm: ncmSugerido,
    cest: cestSugerido,
    origemProduto: origemInformada,
    grupoFiscalId: grupoInformado ?? snap.grupoFiscalId,
    grupoNome: grupo?.nome ?? atual.grupoNome,
    cstIbscbs: grupo?.cst_ibscbs ?? atual.cstIbscbs,
    cClassTrib: grupo?.classificacao_ibscbs ?? atual.cClassTrib,
    cfopInterno: grupo?.cfop_interno ?? atual.cfopInterno,
    icms: grupo?.icms_cst_csosn ?? atual.icms,
    pis: grupo?.pis_cst ?? atual.pis,
    cofins: grupo?.cofins_cst ?? atual.cofins,
  };

  const diferencas = CAMPOS.filter((item) => atual[item.campo as keyof typeof atual] !== sugerido[item.campo as keyof typeof sugerido])
    .map((item) => ({
      campo: item.campo,
      rotulo: item.rotulo,
      atual: atual[item.campo as keyof typeof atual] ?? null,
      sugerido: sugerido[item.campo as keyof typeof sugerido] ?? null,
    }));

  const fontes: string[] = [];
  if (ncmRegra) {
    fontes.push(`${ncmRegra.fonte}:${ncmRegra.versao}`);
  }
  if (cestRegra) {
    fontes.push(`${cestRegra.fonte}:${cestRegra.versao}`);
  }
  if (grupo?.cst_ibscbs) {
    fontes.push("fiscal_cst_ibscbs_catalogo");
  }
  if (grupo?.classificacao_ibscbs) {
    fontes.push("fiscal_cclasstrib_catalogo");
  }

  const proposta: PropostaFiscalProduto = {
    propostaId: globalThis.crypto.randomUUID(),
    produtoId: snap.produtoId,
    produtoNome: snap.produtoNome,
    confianca: ncmRegra ? "alta" : diferencas.length ? "media" : "baixa",
    perguntas: [],
    justificativa: diferencas.length
      ? "Diferenças prontas para confirmação do usuário. Nada foi gravado."
      : "Cadastro já confere com os dados oficiais disponíveis.",
    fontes,
    versaoTabelas: fontes.join(",") || "sem-base-ncm",
    atual,
    sugerido,
    diferencas,
  };

  return {
    ok: true,
    ferramenta: "propor_atualizacao_fiscal",
    dados: { proposta },
    propostaFiscal: proposta,
    acoes: [
      { label: "Abrir produto", href: hrefProdutoAssistente(snap.produtoId) },
      ...(diferencas.length
        ? [{ label: "Aplicar alterações", aplicarFiscal: { propostaId: proposta.propostaId } }]
        : []),
    ],
  };
}

export async function aplicarAtualizacaoFiscalConfirmada(params: {
  ctx: ContextoFerramentaIa;
  proposta: PropostaFiscalProduto;
}): Promise<
  | { ok: true; mensagem: string }
  | { ok: false; erro: string }
> {
  const authProd = await autorizarFerramentaIa({
    empresaId: params.ctx.empresaId,
    permissoes: params.ctx.permissoes,
    recurso: "produtos",
    acao: "editar",
  });
  if (!authProd.ok) {
    return authProd;
  }
  const authFiscal = await autorizarFerramentaIa({
    empresaId: params.ctx.empresaId,
    permissoes: params.ctx.permissoes,
    recurso: "fiscal",
    acao: "acessar",
  });
  if (!authFiscal.ok) {
    return authFiscal;
  }

  const snap = await carregarSnapshotFiscal(params.ctx, params.proposta.produtoId);
  if (!snap) {
    return { ok: false, erro: "Produto não encontrado nesta empresa." };
  }

  const ncm = String(params.proposta.sugerido.ncm ?? "").replace(/\D/g, "");
  const cest = String(params.proposta.sugerido.cest ?? "").replace(/\D/g, "");
  const origemProduto = String(params.proposta.sugerido.origemProduto ?? "0");
  const grupoFiscalId = params.proposta.sugerido.grupoFiscalId
    ? String(params.proposta.sugerido.grupoFiscalId)
    : null;

  if (ncm && ncm !== String(snap.ncm ?? "")) {
    const regra = await consultarRegraFiscalOficial({
      supabase: params.ctx.supabase,
      tipo: "ncm",
      codigo: ncm,
    });
    if (!regra) {
      return { ok: false, erro: "A vigência da regra NCM não permite gravar este código." };
    }
  }
  if (cest && cest !== String(snap.cest ?? "")) {
    const regra = await consultarRegraFiscalOficial({
      supabase: params.ctx.supabase,
      tipo: "cest",
      codigo: cest,
    });
    if (!regra) {
      return { ok: false, erro: "A vigência da regra CEST não permite gravar este código." };
    }
  }

  const dadosFiscais: DadosFiscaisProduto = {
    ncm,
    cest,
    origemProduto,
  };
  const erro = validarDadosFiscaisProduto(dadosFiscais);
  if (erro) {
    return { ok: false, erro };
  }

  const gravado = await persistirFiscalProdutoApi({
    supabase: params.ctx.supabase,
    empresaId: params.ctx.empresaId,
    produtoId: snap.produtoId,
    ncm: dadosFiscais.ncm,
    cest: dadosFiscais.cest,
    origemProduto: dadosFiscais.origemProduto,
    grupoFiscalId,
  });
  if (!gravado.ok) {
    return gravado;
  }

  const { error } = await params.ctx.supabase.from("ia_auditoria").insert({
    empresa_id: params.ctx.empresaId,
    usuario_id: params.ctx.usuarioId,
    entidade: "produto_fiscal",
    entidade_id: snap.produtoId,
    valores_anteriores: params.proposta.atual,
    valores_novos: params.proposta.sugerido,
    sugestao: params.proposta,
    fontes: params.proposta.fontes,
    versao_tabelas: params.proposta.versaoTabelas,
  });
  if (error) {
    console.error("[ia] falha ao registrar auditoria", error.message);
  }

  return { ok: true, mensagem: "Configuração fiscal aplicada." };
}
