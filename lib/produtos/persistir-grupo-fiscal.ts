import { validarConfiguracaoIpiGrupo } from "@/lib/fiscal/ipi";
import {
  CFOPS_INTERESTADUAIS,
  CFOPS_INTERNOS,
  CSOSN,
  CST_ICMS,
  CST_PIS_COFINS,
  existeCodigo,
} from "@/lib/fiscal/tabelas-fiscais";
import { createClient } from "@/lib/supabase/server";

type ClienteSupabase = Awaited<ReturnType<typeof createClient>>;

export type DadosGrupoFiscalApi = {
  nome: string;
  descricao?: string | null;
  cfopInterno: string;
  cfopInterestadual: string;
  icmsCstCsosn: string;
  icmsAliquota?: number | null;
  pisCst: string;
  pisAliquota?: number | null;
  cofinsCst: string;
  cofinsAliquota?: number | null;
  ipiAplicavel?: boolean;
  ipiCst?: string | null;
  ipiAliquota?: number | null;
  ipiEnquadramento?: string | null;
  cstIbscbs: string;
  classificacaoIbscbs: string;
  aliquotaIbsUf?: number | null;
  aliquotaIbsMunicipio?: number | null;
  aliquotaCbs?: number | null;
};

function numero(valor: unknown) {
  if (valor == null || valor === "") {
    return null;
  }
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

export async function validarDadosGrupoFiscalApi(params: {
  supabase: ClienteSupabase;
  empresaId: string;
  dados: DadosGrupoFiscalApi;
}): Promise<{ ok: true; insert: Record<string, unknown> } | { ok: false; erro: string }> {
  const nome = String(params.dados.nome ?? "").trim();
  if (nome.length < 2) {
    return { ok: false, erro: "Informe o nome do grupo fiscal." };
  }
  if (!existeCodigo(CFOPS_INTERNOS, params.dados.cfopInterno)) {
    return { ok: false, erro: "Selecione um CFOP interno válido." };
  }
  if (!existeCodigo(CFOPS_INTERESTADUAIS, params.dados.cfopInterestadual)) {
    return { ok: false, erro: "Selecione um CFOP interestadual válido." };
  }

  const { data: fiscalEmpresa } = await params.supabase
    .from("empresas_fiscal")
    .select("codigo_regime_tributario")
    .eq("empresa_id", params.empresaId)
    .maybeSingle();
  const crt = fiscalEmpresa?.codigo_regime_tributario ?? null;
  const opcoesIcms =
    crt === 1 || crt === 4
      ? CSOSN
      : crt === 2 || crt === 3
        ? CST_ICMS
        : [...CSOSN, ...CST_ICMS];
  if (!existeCodigo(opcoesIcms, params.dados.icmsCstCsosn)) {
    return { ok: false, erro: "Selecione um CSOSN/CST de ICMS válido para o CRT da empresa." };
  }
  if (!existeCodigo(CST_PIS_COFINS, params.dados.pisCst)) {
    return { ok: false, erro: "Selecione um CST PIS válido." };
  }
  if (!existeCodigo(CST_PIS_COFINS, params.dados.cofinsCst)) {
    return { ok: false, erro: "Selecione um CST COFINS válido." };
  }

  const erroIpi = validarConfiguracaoIpiGrupo({
    ipiAplicavel: Boolean(params.dados.ipiAplicavel),
    ipiCst: params.dados.ipiCst ?? null,
    ipiAliquota: String(params.dados.ipiAliquota ?? ""),
    ipiEnquadramento: params.dados.ipiEnquadramento ?? null,
  });
  if (erroIpi) {
    return { ok: false, erro: erroIpi };
  }
  if (!params.dados.cstIbscbs) {
    return { ok: false, erro: "Selecione o CST IBS/CBS." };
  }
  if (!params.dados.classificacaoIbscbs) {
    return { ok: false, erro: "Selecione o cClassTrib." };
  }

  const { data: cstIbscbsCatalogo, error: cstError } = await params.supabase
    .from("fiscal_cst_ibscbs_catalogo")
    .select("codigo, permite_nfe, permite_nfce")
    .eq("codigo", params.dados.cstIbscbs)
    .eq("ativo", true)
    .maybeSingle();
  if (
    cstError ||
    !cstIbscbsCatalogo ||
    (!cstIbscbsCatalogo.permite_nfe && !cstIbscbsCatalogo.permite_nfce)
  ) {
    return { ok: false, erro: "CST IBS/CBS inválido para NF-e/NFC-e." };
  }

  const { data: classificacaoCatalogo, error: classError } = await params.supabase
    .from("fiscal_cclasstrib_catalogo")
    .select(
      "codigo, cst_codigo, percentual_reducao_ibs, percentual_reducao_cbs, permite_nfe, permite_nfce"
    )
    .eq("codigo", params.dados.classificacaoIbscbs)
    .eq("ativo", true)
    .maybeSingle();
  if (classError || !classificacaoCatalogo) {
    return { ok: false, erro: "cClassTrib inválido." };
  }
  if (classificacaoCatalogo.cst_codigo !== params.dados.cstIbscbs) {
    return {
      ok: false,
      erro: "O cClassTrib selecionado não pertence ao CST IBS/CBS informado.",
    };
  }
  if (!classificacaoCatalogo.permite_nfe && !classificacaoCatalogo.permite_nfce) {
    return { ok: false, erro: "O cClassTrib selecionado não é aplicável a NF-e/NFC-e." };
  }

  return {
    ok: true,
    insert: {
      empresa_id: params.empresaId,
      nome,
      descricao: String(params.dados.descricao ?? "").trim() || null,
      cfop_interno: params.dados.cfopInterno,
      cfop_interestadual: params.dados.cfopInterestadual,
      icms_cst_csosn: params.dados.icmsCstCsosn,
      icms_aliquota: numero(params.dados.icmsAliquota),
      pis_cst: params.dados.pisCst,
      pis_aliquota: numero(params.dados.pisAliquota),
      cofins_cst: params.dados.cofinsCst,
      cofins_aliquota: numero(params.dados.cofinsAliquota),
      ipi_aplicavel: Boolean(params.dados.ipiAplicavel),
      ipi_cst: params.dados.ipiCst || null,
      ipi_aliquota: numero(params.dados.ipiAliquota),
      ipi_enquadramento: params.dados.ipiEnquadramento || null,
      cst_ibscbs: params.dados.cstIbscbs,
      classificacao_ibscbs: params.dados.classificacaoIbscbs,
      aliquota_ibs_uf: numero(params.dados.aliquotaIbsUf),
      aliquota_ibs_municipio: numero(params.dados.aliquotaIbsMunicipio),
      aliquota_cbs: numero(params.dados.aliquotaCbs),
      percentual_reducao_ibs_uf: Number(classificacaoCatalogo.percentual_reducao_ibs ?? 0),
      percentual_reducao_ibs_municipio: Number(
        classificacaoCatalogo.percentual_reducao_ibs ?? 0
      ),
      percentual_reducao_cbs: Number(classificacaoCatalogo.percentual_reducao_cbs ?? 0),
      ibscbs_manual: false,
      ativo: true,
    },
  };
}

export async function buscarGrupoFiscalEquivalente(params: {
  supabase: ClienteSupabase;
  empresaId: string;
  nome: string;
  cfopInterno?: string | null;
  icmsCstCsosn?: string | null;
  cstIbscbs?: string | null;
  classificacaoIbscbs?: string | null;
}) {
  const nome = params.nome.trim();
  const { data: porNome } = await params.supabase
    .from("grupos_fiscais")
    .select("id, empresa_id, nome")
    .eq("empresa_id", params.empresaId)
    .ilike("nome", nome)
    .maybeSingle();
  if (porNome && String(porNome.empresa_id) === params.empresaId) {
    return { id: String(porNome.id), nome: String(porNome.nome), motivo: "nome" as const };
  }
  if (params.cstIbscbs && params.classificacaoIbscbs && params.cfopInterno && params.icmsCstCsosn) {
    const { data: porCampos } = await params.supabase
      .from("grupos_fiscais")
      .select("id, empresa_id, nome")
      .eq("empresa_id", params.empresaId)
      .eq("cfop_interno", params.cfopInterno)
      .eq("icms_cst_csosn", params.icmsCstCsosn)
      .eq("cst_ibscbs", params.cstIbscbs)
      .eq("classificacao_ibscbs", params.classificacaoIbscbs)
      .eq("ativo", true)
      .limit(1)
      .maybeSingle();
    if (porCampos && String(porCampos.empresa_id) === params.empresaId) {
      return {
        id: String(porCampos.id),
        nome: String(porCampos.nome),
        motivo: "campos" as const,
      };
    }
  }
  return null;
}

export async function criarGrupoFiscalApi(params: {
  supabase: ClienteSupabase;
  empresaId: string;
  dados: DadosGrupoFiscalApi;
}): Promise<{ ok: true; id: string; mensagem: string } | { ok: false; erro: string }> {
  const validado = await validarDadosGrupoFiscalApi(params);
  if (!validado.ok) {
    return validado;
  }
  const equivalente = await buscarGrupoFiscalEquivalente({
    supabase: params.supabase,
    empresaId: params.empresaId,
    nome: params.dados.nome,
    cfopInterno: params.dados.cfopInterno,
    icmsCstCsosn: params.dados.icmsCstCsosn,
    cstIbscbs: params.dados.cstIbscbs,
    classificacaoIbscbs: params.dados.classificacaoIbscbs,
  });
  if (equivalente) {
    return {
      ok: false,
      erro: `Já existe o grupo fiscal "${equivalente.nome}". Use-o em vez de criar outro.`,
    };
  }
  const { data, error } = await params.supabase
    .from("grupos_fiscais")
    .insert(validado.insert)
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      return { ok: false, erro: "Já existe um grupo fiscal com esse nome." };
    }
    return { ok: false, erro: error.message };
  }
  if (!data?.id) {
    return { ok: false, erro: "Não foi possível criar o grupo fiscal." };
  }
  return { ok: true, id: String(data.id), mensagem: "Grupo fiscal criado." };
}
