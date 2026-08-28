import type { SupabaseClient } from "@supabase/supabase-js";

import {
  carregarCatalogosIbsCbs,
  listarFontesFiscaisOficiais,
  listarRegrasCestAtivas,
  listarRegrasNcmAtivas,
  resumoFontesParaIa,
} from "@/lib/fiscal/base-oficial/consultar";
import { resolverPoliticaIbscbs } from "@/lib/fiscal/geranet/resolver-politica-ibscbs";
import type { GrupoFiscalResumo } from "@/lib/fiscal/status-fiscal-produto";
import { validarCest } from "./cest";
import { avaliarConfianca } from "./confianca";
import { montarContextoFiscalEmpresa } from "./contexto-empresa";
import { validarCstCsosn, validarCstPisCofins, operacaoSujeitaStPorCodigo } from "./cst";
import { evidenciasNfeEntradaProduto } from "./entrada-evidencia";
import { validarCombinacaoIbsCbs } from "./ibs-cbs";
import { pesquisarNcmLocal, validarNcmVigente } from "./ncm";
import { perguntaOrigemMercadoria, resolverOrigemMercadoria } from "./origem";
import { recomendarGrupoFiscalExistente } from "./recomendar-grupo";
import { informacoesFaltantesClassificacao } from "./texto";
import {
  dataReferenciaIso,
  type EntradaClassificacaoFiscal,
  type ResultadoClassificacaoFiscal,
} from "./tipos";

const GRUPO_SELECT =
  "id, empresa_id, nome, ativo, cfop_interno, cfop_interestadual, icms_cst_csosn, icms_aliquota, pis_cst, pis_aliquota, cofins_cst, cofins_aliquota, ipi_aplicavel, ipi_cst, ipi_aliquota, cst_ibscbs, classificacao_ibscbs, aliquota_ibs_uf, aliquota_ibs_municipio, aliquota_cbs";

type SnapshotProduto = {
  id: string;
  nome: string;
  descricao: string | null;
  marca: string | null;
  categoria: string | null;
  ncm: string | null;
  cest: string | null;
  origem: string | null;
  grupo: (GrupoFiscalResumo & { empresa_id?: string }) | null;
};

async function carregarProduto(params: {
  supabase: SupabaseClient;
  empresaId: string;
  produtoId: string;
}): Promise<SnapshotProduto | null> {
  const { data } = await params.supabase
    .from("produtos")
    .select(
      "id, empresa_id, nome, descricao, grupo_fiscal_id, produtos_fiscal ( empresa_id, ncm, cest, origem_produto )"
    )
    .eq("empresa_id", params.empresaId)
    .eq("id", params.produtoId)
    .maybeSingle();
  if (!data || String(data.empresa_id) !== params.empresaId) {
    return null;
  }
  const fiscal = Array.isArray(data.produtos_fiscal)
    ? data.produtos_fiscal[0]
    : data.produtos_fiscal;
  let grupo: SnapshotProduto["grupo"] = null;
  if (data.grupo_fiscal_id) {
    const { data: grupoRow } = await params.supabase
      .from("grupos_fiscais")
      .select(GRUPO_SELECT)
      .eq("empresa_id", params.empresaId)
      .eq("id", data.grupo_fiscal_id)
      .maybeSingle();
    grupo = (grupoRow as SnapshotProduto["grupo"]) ?? null;
  }
  return {
    id: String(data.id),
    nome: String(data.nome ?? "Produto"),
    descricao: data.descricao ? String(data.descricao) : null,
    marca: null,
    categoria: null,
    ncm: fiscal?.ncm ? String(fiscal.ncm) : null,
    cest: fiscal?.cest ? String(fiscal.cest) : null,
    origem: fiscal?.origem_produto ? String(fiscal.origem_produto) : null,
    grupo,
  };
}

export async function classificarProdutoFiscal(params: {
  supabase: SupabaseClient;
  empresaId: string;
  usuarioId?: string;
  entrada: EntradaClassificacaoFiscal;
  registrarAnalise?: boolean;
}): Promise<
  | { ok: true; resultado: ResultadoClassificacaoFiscal; produtoId: string | null }
  | { ok: false; erro: string; codigo: "nao_encontrado" | "falha" }
> {
  try {
    const dataReferencia = dataReferenciaIso(params.entrada.dataReferencia);
    const empresa = await montarContextoFiscalEmpresa({
      supabase: params.supabase,
      empresaId: params.empresaId,
    });
    const produtoId = params.entrada.produtoId
      ? String(params.entrada.produtoId)
      : null;
    const produto = produtoId
      ? await carregarProduto({
          supabase: params.supabase,
          empresaId: params.empresaId,
          produtoId,
        })
      : null;
    if (produtoId && !produto) {
      return { ok: false, erro: "Produto não encontrado nesta empresa.", codigo: "nao_encontrado" };
    }

    const evidencia = produtoId
      ? await evidenciasNfeEntradaProduto({
          supabase: params.supabase,
          empresaId: params.empresaId,
          produtoId,
        })
      : null;

    const origem = resolverOrigemMercadoria({
      origemConfirmadaProduto: params.entrada.origemAtual ?? produto?.origem,
      evidenciaEntrada: evidencia,
      origemInformadaUsuario: params.entrada.origemInformadaUsuario,
      marca: params.entrada.marca ?? produto?.marca,
    });

    const descricao = [
      params.entrada.descricao ?? produto?.nome,
      params.entrada.descricaoComplementar ?? produto?.descricao,
      params.entrada.material,
      params.entrada.finalidade,
      params.entrada.composicao,
      params.entrada.caracteristicasTecnicas,
      params.entrada.uso,
    ]
      .filter(Boolean)
      .join(" ");

    const faltantes = informacoesFaltantesClassificacao({
      descricao,
      material: params.entrada.material,
      finalidade: params.entrada.finalidade,
      composicao: params.entrada.composicao,
      caracteristicasTecnicas: params.entrada.caracteristicasTecnicas,
    });
    if (origem.perguntar) {
      faltantes.push(...perguntaOrigemMercadoria());
    }
    if (empresa.incompleto) {
      faltantes.push(...empresa.faltantes);
    }

    const ncmAtual = params.entrada.ncmAtual ?? produto?.ncm ?? null;
    const [regrasCodigo, regrasBusca] = await Promise.all([
      ncmAtual
        ? listarRegrasNcmAtivas({
            supabase: params.supabase,
            codigo: ncmAtual.replace(/\D/g, ""),
            limite: 5,
          })
        : Promise.resolve([]),
      listarRegrasNcmAtivas({
        supabase: params.supabase,
        busca: descricao,
        limite: 30,
      }),
    ]);
    const regrasNcm = [...regrasCodigo, ...regrasBusca];
    const ncmValidado = validarNcmVigente({
      codigo: ncmAtual,
      regras: regrasNcm,
      dataReferencia,
    });
    const candidatos =
      ncmValidado.regra
        ? [ncmValidado.regra]
        : pesquisarNcmLocal({
            termos: descricao,
            regras: regrasNcm,
            dataReferencia,
            limite: 8,
          });

    const ncmSugerido =
      ncmValidado.status === "vigente"
        ? ncmValidado.regra
        : candidatos.length === 1
          ? candidatos[0]
          : null;

    const ncmParaCest = ncmSugerido?.codigo ?? ncmAtual ?? null;
    const regrasCest = await listarRegrasCestAtivas({
      supabase: params.supabase,
      cest: params.entrada.cestAtual ?? produto?.cest ?? undefined,
      ncm: ncmParaCest ?? undefined,
    });
    const cest = validarCest({
      cest: params.entrada.cestAtual ?? produto?.cest,
      ncm: ncmParaCest,
      descricao,
      regras: regrasCest,
      dataReferencia,
    });

    const catalogos = await carregarCatalogosIbsCbs(params.supabase);
    const politica = empresa.crt
      ? resolverPoliticaIbscbs({
          codigoRegimeTributario: empresa.crt,
          dataEmissao: dataReferencia,
          ambiente: String(empresa.ambiente) === "1" ? "1" : "2",
        })
      : null;
    const icmsGrupo = validarCstCsosn({
      crt: empresa.crt,
      codigo: produto?.grupo?.icms_cst_csosn,
    });
    const pisGrupo = validarCstPisCofins(produto?.grupo?.pis_cst);
    const cofinsGrupo = validarCstPisCofins(produto?.grupo?.cofins_cst);

    const ibsCbs = validarCombinacaoIbsCbs({
      cst: produto?.grupo?.cst_ibscbs,
      cClassTrib: produto?.grupo?.classificacao_ibscbs,
      csts: catalogos.csts,
      classes: catalogos.classes,
      aliquotaIbsUf: produto?.grupo
        ? Number(produto.grupo.aliquota_ibs_uf)
        : null,
      aliquotaCbs: produto?.grupo ? Number(produto.grupo.aliquota_cbs) : null,
      dataReferencia,
      ibsObrigatorio: politica?.incluirIbscbs === true,
    });

    const { data: gruposBruto } = await params.supabase
      .from("grupos_fiscais")
      .select(GRUPO_SELECT)
      .eq("empresa_id", params.empresaId)
      .eq("ativo", true)
      .limit(80);
    const grupos = (gruposBruto ?? []).filter(
      (item) => String(item.empresa_id) === params.empresaId
    );
    const recomendacao = recomendarGrupoFiscalExistente({
      empresaId: params.empresaId,
      grupos,
      crt: empresa.crt,
      origem: origem.codigo,
      ncm: ncmSugerido?.codigo ?? ncmAtual,
      cest: Array.isArray(cest.candidatos)
        ? cest.candidatos[0]?.codigo ?? null
        : null,
      ibsCbs,
    });

    const fontes = await listarFontesFiscaisOficiais(params.supabase);
    const confianca = avaliarConfianca([
      {
        id: "ncm",
        presente: ncmValidado.status === "vigente",
        peso: "alta",
        motivo: ncmValidado.motivo,
      },
      {
        id: "origem",
        presente: Boolean(origem.codigo),
        peso: "alta",
        motivo: origem.motivo,
      },
      {
        id: "empresa",
        presente: !empresa.incompleto,
        peso: "alta",
        motivo: empresa.incompleto
          ? "Contexto fiscal da empresa incompleto."
          : `CRT ${empresa.crt} / UF ${empresa.uf}.`,
      },
      {
        id: "ibs",
        presente: ibsCbs.combinacaoValida === true,
        peso: "media",
        motivo: ibsCbs.motivo,
      },
    ]);

    let status: ResultadoClassificacaoFiscal["status"] = "ok";
    if (empresa.incompleto) {
      status = "contexto_incompleto";
    } else if (faltantes.length > 0 || origem.perguntar) {
      status = "informacao_insuficiente";
    } else if (ncmValidado.status === "sem_base" || cest.status === "sem_base") {
      status = "sem_base";
    } else if (ncmValidado.status === "inexistente" || ncmValidado.status === "extinto") {
      status = "provavel_divergencia";
    } else if (candidatos.length > 1 && !ncmSugerido) {
      status = "informacao_insuficiente";
      faltantes.push("Há mais de um NCM candidato. Informe material, finalidade e composição.");
    } else if (ibsCbs.status === "aguardando_legislacao") {
      status = "aguardando_legislacao";
    } else if (ibsCbs.status === "provavel_divergencia") {
      status = "provavel_divergencia";
    }

    const atualNcm = ncmAtual ?? null;
    const atualCest = params.entrada.cestAtual ?? produto?.cest ?? null;
    const diferencas = [
      campo("ncm", "NCM", atualNcm, ncmSugerido?.codigo ?? null),
      campo(
        "cest",
        "CEST",
        atualCest,
        cest.candidatos.length === 1 ? cest.candidatos[0]?.codigo ?? null : null
      ),
      campo("origem", "Origem", produto?.origem ?? null, origem.codigo),
      campo(
        "grupoFiscal",
        "Grupo fiscal",
        produto?.grupo?.nome ?? null,
        recomendacao.recomendado?.nome ?? null
      ),
    ].filter((item) => item.atual !== item.sugerido && item.sugerido);

    const justificativa = [
      `Empresa ativa: ${empresa.regimeTributario ?? "CRT não cadastrado"} / UF ${empresa.uf ?? "—"}.`,
      origem.motivo,
      ncmValidado.motivo,
      cest.motivo,
      icmsGrupo.motivo,
      pisGrupo.ok ? pisGrupo.motivo : pisGrupo.motivo,
      cofinsGrupo.ok ? cofinsGrupo.motivo : cofinsGrupo.motivo,
      ibsCbs.motivo,
      recomendacao.mensagem ??
        (recomendacao.recomendado
          ? `Grupo recomendado: ${recomendacao.recomendado.nome} (${recomendacao.recomendado.compatibilidade}).`
          : ""),
      "A IA não é fonte normativa. Códigos só saem da base oficial versionada.",
    ]
      .filter(Boolean)
      .join(" ");

    const resultado: ResultadoClassificacaoFiscal = {
      status,
      candidatosNcm: candidatos,
      ncmSugerido,
      cest: cest.candidatos.length === 1 ? cest.candidatos[0] ?? null : cest.candidatos,
      origem: {
        codigo: origem.codigo,
        descricao: origem.descricao,
        fonte: origem.fonte,
        motivo: origem.motivo,
      },
      classificacaoIbsCbs: ibsCbs,
      grupoFiscalRecomendado: recomendacao.recomendado,
      grupoAtual: produto?.grupo
        ? { id: produto.grupo.id, nome: produto.grupo.nome }
        : null,
      confianca: confianca.confianca,
      motivoConfianca: confianca.motivo,
      informacoesFaltantes: faltantes,
      justificativa,
      fontes: resumoFontesParaIa(fontes).map((item) => ({
        codigo: item.codigo,
        versao: item.versao,
        origem: item.origem,
        status: item.status,
      })),
      versoes: Object.fromEntries(
        fontes.map((item) => [item.codigo, item.versao])
      ),
      diferencas,
      produtoPossuiCest: cest.produtoPossuiCest,
      operacaoSujeitaSt: produto?.grupo
        ? operacaoSujeitaStPorCodigo(produto.grupo.icms_cst_csosn)
        : null,
      empresa: {
        crt: empresa.crt,
        regime: empresa.regimeTributario,
        uf: empresa.uf,
      },
    };

    if (params.registrarAnalise && params.usuarioId) {
      await params.supabase.from("fiscal_ia_analises").insert({
        empresa_id: params.empresaId,
        usuario_id: params.usuarioId,
        produto_id: produto?.id ?? null,
        contexto: "produto",
        versao_base: JSON.stringify(resultado.versoes),
        resultado: {
          status: resultado.status,
          ncm: resultado.ncmSugerido?.codigo ?? null,
          cest: Array.isArray(resultado.cest)
            ? resultado.cest.map((item) => item.codigo)
            : resultado.cest?.codigo ?? null,
          origem: resultado.origem.codigo,
          confianca: resultado.confianca,
        },
        fontes: resultado.fontes,
      });
    }

    return { ok: true, resultado, produtoId: produto?.id ?? null };
  } catch {
    return { ok: false, erro: "Não foi possível classificar o produto.", codigo: "falha" };
  }
}

function campo(
  campoNome: string,
  rotulo: string,
  atual: string | null,
  sugerido: string | null
) {
  return { campo: campoNome, rotulo, atual, sugerido };
}
