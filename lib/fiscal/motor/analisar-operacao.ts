import type { SupabaseClient } from "@supabase/supabase-js";

import { resolverCfopEfetivo } from "@/lib/fiscal/operacoes/resolver-cfop";
import { resolverPoliticaIbscbs } from "@/lib/fiscal/geranet/resolver-politica-ibscbs";

import { classificarProdutoFiscal } from "./classificar";
import {
  carregarDestinatarioOperacao,
  destinoOperacao,
  montarContextoOperacaoFiscal,
} from "./contexto-operacao";
import { montarContextoFiscalEmpresa } from "./contexto-empresa";
import { operacaoSujeitaStPorCodigo, validarCstCsosn, validarCstPisCofins } from "./cst";
import type { ContextoFiscalEmpresa } from "./tipos";

export async function analisarOperacaoFiscal(params: {
  supabase: SupabaseClient;
  empresaId: string;
  produtoId: string;
  tipoOperacao?: string | null;
  ufDestino?: string | null;
  destinatarioId?: string | null;
  contribuinteIcmsDestinatario?: boolean | null;
  consumidorFinal?: boolean | null;
  naturezaId?: string | null;
  dataReferencia?: string | null;
  origemInformadaUsuario?: string | null;
}) {
  const empresa = await montarContextoFiscalEmpresa({
    supabase: params.supabase,
    empresaId: params.empresaId,
  });
  const destinatario = params.destinatarioId
    ? await carregarDestinatarioOperacao({
        supabase: params.supabase,
        empresaId: params.empresaId,
        destinatarioId: params.destinatarioId,
      })
    : null;
  const operacao = montarContextoOperacaoFiscal({
    empresa,
    produtoId: params.produtoId,
    tipoOperacao: params.tipoOperacao,
    ufDestino: params.ufDestino ?? destinatario?.uf,
    destinatarioId: params.destinatarioId,
    contribuinteIcmsDestinatario:
      params.contribuinteIcmsDestinatario ?? destinatario?.contribuinteIcms,
    consumidorFinal: params.consumidorFinal ?? destinatario?.consumidorFinal,
    naturezaId: params.naturezaId,
    dataReferencia: params.dataReferencia,
  });

  const classificacao = await classificarProdutoFiscal({
    supabase: params.supabase,
    empresaId: params.empresaId,
    entrada: {
      produtoId: params.produtoId,
      origemInformadaUsuario: params.origemInformadaUsuario,
      dataReferencia: operacao.dataReferencia,
    },
  });
  if (!classificacao.ok) {
    return classificacao;
  }

  const destino = destinoOperacao(operacao);
  const grupo = classificacao.resultado.grupoAtual
    ? await carregarGrupo(
        params.supabase,
        params.empresaId,
        classificacao.resultado.grupoAtual.id
      )
    : null;

  const cfop = grupo
    ? resolverCfopEfetivo({
        tipoOperacaoInterno: operacao.tipoOperacao,
        tipoDestino: destino ?? "interna",
        grupoFiscal: {
          nome: grupo.nome,
          cfopInterno: grupo.cfop_interno,
          cfopInterestadual: grupo.cfop_interestadual,
        },
        empresaIdAtiva: params.empresaId,
        naturezaPadrao: operacao.tipoOperacao === "venda",
        regras: [],
      })
    : { ok: false as const, mensagem: "Grupo fiscal da empresa não encontrado." };

  const icms = validarCstCsosn({
    crt: empresa.crt,
    codigo: grupo?.icms_cst_csosn,
  });
  const pis = validarCstPisCofins(grupo?.pis_cst);
  const cofins = validarCstPisCofins(grupo?.cofins_cst);
  const politica = empresa.crt
    ? resolverPoliticaIbscbs({
        codigoRegimeTributario: empresa.crt,
        dataEmissao: operacao.dataReferencia,
        ambiente: String(empresa.ambiente) === "1" ? "1" : "2",
      })
    : null;

  return {
    ok: true as const,
    dados: {
      contextoEmpresa: resumirEmpresa(empresa),
      contextoOperacao: {
        tipo: operacao.tipoOperacao,
        ufOrigem: operacao.ufOrigem,
        ufDestino: operacao.ufDestino,
        destino,
        contribuinteIcmsDestinatario: operacao.contribuinteIcmsDestinatario,
        consumidorFinal: operacao.consumidorFinal,
        dataReferencia: operacao.dataReferencia,
      },
      ncm: classificacao.resultado.ncmSugerido?.codigo ?? null,
      cest: Array.isArray(classificacao.resultado.cest)
        ? classificacao.resultado.cest.map((item) => item.codigo)
        : classificacao.resultado.cest?.codigo ?? null,
      origem: classificacao.resultado.origem,
      cfop: cfop.ok ? cfop.cfop : null,
      cfopOrigem: cfop.ok ? cfop.origem : cfop.mensagem,
      cstCsosn: grupo?.icms_cst_csosn ?? null,
      icms: icms.motivo,
      st: operacaoSujeitaStPorCodigo(grupo?.icms_cst_csosn),
      avisoSt:
        classificacao.resultado.produtoPossuiCest &&
        !operacaoSujeitaStPorCodigo(grupo?.icms_cst_csosn)
          ? "O produto possui CEST, mas a operação não está marcada como ST só por isso."
          : null,
      pis: pis.motivo,
      cofins: cofins.motivo,
      ibsCbs: classificacao.resultado.classificacaoIbsCbs,
      politicaIbsCbs: politica
        ? { incluir: politica.incluirIbscbs, modo: politica.modo, motivo: politica.motivo }
        : null,
      alertas: [
        ...classificacao.resultado.informacoesFaltantes,
        ...(cfop.ok ? [] : [cfop.mensagem]),
      ],
      informacoesFaltantes: classificacao.resultado.informacoesFaltantes,
      fontes: classificacao.resultado.fontes,
      versoes: classificacao.resultado.versoes,
    },
  };
}

function resumirEmpresa(empresa: ContextoFiscalEmpresa) {
  return {
    empresaId: empresa.empresaId,
    crt: empresa.crt,
    regime: empresa.regimeTributario,
    uf: empresa.uf,
    incompleto: empresa.incompleto,
    faltantes: empresa.faltantes,
  };
}

async function carregarGrupo(
  supabase: SupabaseClient,
  empresaId: string,
  grupoId: string
) {
  const { data } = await supabase
    .from("grupos_fiscais")
    .select(
      "id, empresa_id, nome, cfop_interno, cfop_interestadual, icms_cst_csosn, pis_cst, cofins_cst"
    )
    .eq("empresa_id", empresaId)
    .eq("id", grupoId)
    .maybeSingle();
  if (!data || String(data.empresa_id) !== empresaId) {
    return null;
  }
  return data;
}
