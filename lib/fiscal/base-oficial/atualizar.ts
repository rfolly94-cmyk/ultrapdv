import type { SupabaseClient } from "@supabase/supabase-js";

import {
  FONTE_CCLASS,
  FONTE_CEST,
  FONTE_CST_IBS,
  FONTE_NCM,
  URL_NCM_CLASSIF_OFICIAL,
  urlCestOficialConfigurada,
} from "./fontes";
import { hashSha256, parsearCestOficial, parsearNomenclaturaClassif } from "./parser";

export function planejarAtualizacaoBaseOficial(params: {
  agora?: Date;
  ncmImportada?: boolean;
  cestImportada?: boolean;
}) {
  const fontesPendentes: string[] = [];
  if (!params.ncmImportada) {
    fontesPendentes.push("ncm_oficial");
  }
  if (!params.cestImportada) {
    fontesPendentes.push("cest_oficial");
  }
  return {
    modo: "job_diario" as const,
    referencia: (params.agora ?? new Date()).toISOString(),
    fontesPendentes,
    fontesReutilizadas: [
      "cst_ibscbs_catalogo",
      "cclasstrib_catalogo",
      "tabelas_fiscais_codigo",
    ],
    observacao:
      "NCM via Siscomex Classif (JSON oficial). CEST só com arquivo/API oficial. Sem scraping de HTML.",
  };
}

type ResultadoFonte = {
  fonte: string;
  status: "ativada" | "sem_mudanca" | "mantida" | "pendente" | "erro";
  versao?: string;
  quantidade?: number;
  hash?: string;
  erro?: string;
};

async function baixarTextoOficial(url: string) {
  const resposta = await fetch(url, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "UltraPDV-BaseFiscal/1.0",
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!resposta.ok) {
    throw new Error(`HTTP ${resposta.status} em ${url}`);
  }
  return resposta.text();
}

async function fonteId(admin: SupabaseClient, codigo: string) {
  const { data } = await admin
    .from("fiscal_base_fontes")
    .select("id")
    .eq("codigo", codigo)
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

async function versaoPorHash(admin: SupabaseClient, fonte: string, hash: string) {
  const { data } = await admin
    .from("fiscal_base_versoes")
    .select("id, status, versao, quantidade_registros")
    .eq("fonte_codigo", fonte)
    .eq("hash", hash)
    .maybeSingle();
  return data;
}

async function ativarVersao(params: {
  admin: SupabaseClient;
  fonte: string;
  versaoId: string;
  versao: string;
  origem: string;
  quantidade: number;
}) {
  await params.admin
    .from("fiscal_base_versoes")
    .update({ status: "historica" })
    .eq("fonte_codigo", params.fonte)
    .eq("status", "ativa")
    .neq("id", params.versaoId);
  await params.admin
    .from("fiscal_base_versoes")
    .update({ status: "ativa" })
    .eq("id", params.versaoId);
  await params.admin
    .from("fiscal_base_fontes")
    .update({
      status: "ativa",
      versao: params.versao,
      origem: params.origem,
      atualizado_em: new Date().toISOString(),
      observacao: `${params.quantidade} registros ativos.`,
    })
    .eq("codigo", params.fonte);
}

async function importarNcm(admin: SupabaseClient): Promise<ResultadoFonte> {
  try {
    const bruto = await baixarTextoOficial(URL_NCM_CLASSIF_OFICIAL);
    const hash = hashSha256(bruto);
    const existente = await versaoPorHash(admin, FONTE_NCM, hash);
    if (existente) {
      if (existente.status !== "ativa") {
        await ativarVersao({
          admin,
          fonte: FONTE_NCM,
          versaoId: String(existente.id),
          versao: String(existente.versao),
          origem: URL_NCM_CLASSIF_OFICIAL,
          quantidade: Number(existente.quantidade_registros ?? 0),
        });
      }
      return {
        fonte: FONTE_NCM,
        status: existente.status === "ativa" ? "sem_mudanca" : "ativada",
        versao: String(existente.versao),
        quantidade: Number(existente.quantidade_registros ?? 0),
        hash,
      };
    }
    const json = JSON.parse(bruto) as unknown;
    const parseado = parsearNomenclaturaClassif(json);
    const fonte = await fonteId(admin, FONTE_NCM);
    if (!fonte) {
      return { fonte: FONTE_NCM, status: "erro", erro: "Fonte ncm_oficial ausente." };
    }
    const { data: versaoRow, error: erroVersao } = await admin
      .from("fiscal_base_versoes")
      .insert({
        fonte_codigo: FONTE_NCM,
        tipo_tabela: "ncm",
        versao: parseado.versao,
        publicacao: parseado.publicacao,
        vigencia_inicio: parseado.publicacao ?? "2017-01-01",
        hash,
        status: "candidata",
        origem_oficial: URL_NCM_CLASSIF_OFICIAL,
        quantidade_registros: parseado.itens.length,
        metadata: { ato: parseado.versao },
      })
      .select("id")
      .maybeSingle();
    if (erroVersao || !versaoRow) {
      throw new Error(erroVersao?.message ?? "Falha ao registrar versão NCM.");
    }
    const versaoId = String(versaoRow.id);
    const lote = 500;
    for (let i = 0; i < parseado.itens.length; i += lote) {
      const fatia = parseado.itens.slice(i, i + lote).map((item) => ({
        fonte_id: fonte,
        versao_id: versaoId,
        tipo: "ncm",
        codigo: item.codigo,
        codigo_normalizado: item.codigo,
        descricao: item.descricao,
        payload: {},
        vigencia_inicio: item.vigenciaInicio,
        vigencia_fim: item.vigenciaFim,
        ativo: true,
      }));
      const { error } = await admin.from("fiscal_base_regras").insert(fatia);
      if (error) {
        await admin
          .from("fiscal_base_versoes")
          .update({ status: "rejeitada", erro: error.message })
          .eq("id", versaoId);
        return {
          fonte: FONTE_NCM,
          status: "mantida",
          erro: error.message,
        };
      }
    }
    await admin
      .from("fiscal_base_versoes")
      .update({ status: "valida" })
      .eq("id", versaoId);
    await ativarVersao({
      admin,
      fonte: FONTE_NCM,
      versaoId,
      versao: parseado.versao,
      origem: URL_NCM_CLASSIF_OFICIAL,
      quantidade: parseado.itens.length,
    });
    return {
      fonte: FONTE_NCM,
      status: "ativada",
      versao: parseado.versao,
      quantidade: parseado.itens.length,
      hash,
    };
  } catch (erro) {
    return {
      fonte: FONTE_NCM,
      status: "mantida",
      erro: erro instanceof Error ? erro.message : "Falha ao atualizar NCM.",
    };
  }
}

async function importarCest(admin: SupabaseClient): Promise<ResultadoFonte> {
  const url = urlCestOficialConfigurada();
  if (!url) {
    return {
      fonte: FONTE_CEST,
      status: "pendente",
      erro:
        "Sem URL oficial de CEST configurada (ULTRAPDV_FISCAL_CEST_URL). CONVÊNIO ICMS 142/2018 não foi importado.",
    };
  }
  try {
    const bruto = await baixarTextoOficial(url);
    const hash = hashSha256(bruto);
    const existente = await versaoPorHash(admin, FONTE_CEST, hash);
    if (existente) {
      if (existente.status !== "ativa") {
        await ativarVersao({
          admin,
          fonte: FONTE_CEST,
          versaoId: String(existente.id),
          versao: String(existente.versao),
          origem: url,
          quantidade: Number(existente.quantidade_registros ?? 0),
        });
      }
      return {
        fonte: FONTE_CEST,
        status: existente.status === "ativa" ? "sem_mudanca" : "ativada",
        versao: String(existente.versao),
        quantidade: Number(existente.quantidade_registros ?? 0),
        hash,
      };
    }
    const json = JSON.parse(bruto) as unknown;
    const parseado = parsearCestOficial(json);
    const fonte = await fonteId(admin, FONTE_CEST);
    if (!fonte) {
      return { fonte: FONTE_CEST, status: "erro", erro: "Fonte cest_oficial ausente." };
    }
    const { data: versaoRow, error: erroVersao } = await admin
      .from("fiscal_base_versoes")
      .insert({
        fonte_codigo: FONTE_CEST,
        tipo_tabela: "cest",
        versao: parseado.versao,
        publicacao: parseado.publicacao,
        vigencia_inicio: parseado.publicacao ?? "2018-10-01",
        hash,
        status: "candidata",
        origem_oficial: url,
        quantidade_registros: parseado.itens.length,
      })
      .select("id")
      .maybeSingle();
    if (erroVersao || !versaoRow) {
      throw new Error(erroVersao?.message ?? "Falha ao registrar versão CEST.");
    }
    const versaoId = String(versaoRow.id);
    const lote = 400;
    for (let i = 0; i < parseado.itens.length; i += lote) {
      const fatia = parseado.itens.slice(i, i + lote).map((item) => ({
        fonte_id: fonte,
        versao_id: versaoId,
        tipo: "cest",
        codigo: item.codigo,
        codigo_normalizado: item.codigo,
        descricao: item.descricao,
        payload: { ncm: item.ncm, segmento: item.segmento },
        vigencia_inicio: item.vigenciaInicio,
        vigencia_fim: item.vigenciaFim,
        ativo: true,
      }));
      const { error } = await admin.from("fiscal_base_regras").insert(fatia);
      if (error) {
        await admin
          .from("fiscal_base_versoes")
          .update({ status: "rejeitada", erro: error.message })
          .eq("id", versaoId);
        return { fonte: FONTE_CEST, status: "mantida", erro: error.message };
      }
    }
    await admin
      .from("fiscal_base_versoes")
      .update({ status: "valida" })
      .eq("id", versaoId);
    await ativarVersao({
      admin,
      fonte: FONTE_CEST,
      versaoId,
      versao: parseado.versao,
      origem: url,
      quantidade: parseado.itens.length,
    });
    return {
      fonte: FONTE_CEST,
      status: "ativada",
      versao: parseado.versao,
      quantidade: parseado.itens.length,
      hash,
    };
  } catch (erro) {
    return {
      fonte: FONTE_CEST,
      status: "mantida",
      erro: erro instanceof Error ? erro.message : "Falha ao atualizar CEST.",
    };
  }
}

async function sincronizarCatalogoIbsCbs(
  admin: SupabaseClient
): Promise<ResultadoFonte[]> {
  const [csts, classes] = await Promise.all([
    admin.from("fiscal_cst_ibscbs_catalogo").select("codigo, descricao, ativo"),
    admin
      .from("fiscal_cclasstrib_catalogo")
      .select("codigo, cst_codigo, descricao, ativo"),
  ]);
  const saidas: ResultadoFonte[] = [];
  for (const item of [
    {
      fonte: FONTE_CST_IBS,
      tipo: "cst_ibs_cbs",
      origem: "tabela:fiscal_cst_ibscbs_catalogo",
      rows: csts.data ?? [],
      erro: csts.error?.message,
    },
    {
      fonte: FONTE_CCLASS,
      tipo: "cclass_trib",
      origem: "tabela:fiscal_cclasstrib_catalogo",
      rows: classes.data ?? [],
      erro: classes.error?.message,
    },
  ]) {
    if (item.erro) {
      saidas.push({ fonte: item.fonte, status: "mantida", erro: item.erro });
      continue;
    }
    const hash = hashSha256(JSON.stringify(item.rows));
    const existente = await versaoPorHash(admin, item.fonte, hash);
    if (existente?.status === "ativa") {
      saidas.push({
        fonte: item.fonte,
        status: "sem_mudanca",
        versao: String(existente.versao),
        quantidade: item.rows.length,
        hash,
      });
      continue;
    }
    const { data: versaoRow, error } = await admin
      .from("fiscal_base_versoes")
      .insert({
        fonte_codigo: item.fonte,
        tipo_tabela: item.tipo,
        versao: `catalogo-${item.rows.length}`,
        vigencia_inicio: "2026-01-01",
        hash,
        status: "valida",
        origem_oficial: item.origem,
        quantidade_registros: item.rows.length,
      })
      .select("id, versao")
      .maybeSingle();
    if (error || !versaoRow) {
      if (existente) {
        saidas.push({
          fonte: item.fonte,
          status: "sem_mudanca",
          versao: String(existente.versao),
          hash,
        });
        continue;
      }
      saidas.push({
        fonte: item.fonte,
        status: "mantida",
        erro: error?.message ?? "Falha ao versionar catálogo IBS/CBS.",
      });
      continue;
    }
    await ativarVersao({
      admin,
      fonte: item.fonte,
      versaoId: String(versaoRow.id),
      versao: String(versaoRow.versao),
      origem: item.origem,
      quantidade: item.rows.length,
    });
    saidas.push({
      fonte: item.fonte,
      status: "ativada",
      versao: String(versaoRow.versao),
      quantidade: item.rows.length,
      hash,
    });
  }
  return saidas;
}

export async function atualizarBaseFiscalOficial(params: {
  admin: SupabaseClient;
}): Promise<{
  status: "ok" | "erro" | "sem_mudanca";
  fontes: ResultadoFonte[];
  atualizacaoId: string | null;
}> {
  const { data: job } = await params.admin
    .from("fiscal_base_atualizacoes")
    .insert({ status: "verificando", resumo: {} })
    .select("id")
    .maybeSingle();
  const atualizacaoId = job?.id ? String(job.id) : null;

  const fontes: ResultadoFonte[] = [];
  fontes.push(await importarNcm(params.admin));
  fontes.push(await importarCest(params.admin));
  fontes.push(...(await sincronizarCatalogoIbsCbs(params.admin)));

  const erro = fontes.some((item) => item.status === "erro");
  const ativada = fontes.some((item) => item.status === "ativada");
  const status = erro ? "erro" : ativada ? "ok" : "sem_mudanca";

  if (atualizacaoId) {
    await params.admin
      .from("fiscal_base_atualizacoes")
      .update({
        status,
        finalizado_em: new Date().toISOString(),
        resumo: { fontes },
        erro: fontes
          .filter((item) => item.erro)
          .map((item) => `${item.fonte}: ${item.erro}`)
          .join(" | ") || null,
      })
      .eq("id", atualizacaoId);
  }

  return { status, fontes, atualizacaoId };
}
