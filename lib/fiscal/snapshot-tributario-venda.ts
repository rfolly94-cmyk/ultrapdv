import { camposIpiDoGrupo } from "@/lib/fiscal/ipi";
import type { GrupoFiscalGeranetFonte } from "@/lib/fiscal/geranet/montar-item";
import type { OperacaoFiscal } from "@/lib/fiscal/geranet/montar-item";

export const SNAPSHOT_TRIBUTARIO_ITEM_VERSAO = 1;

export const ORIGEM_SNAPSHOT_FINALIZACAO = "finalizacao";
export const ORIGEM_SNAPSHOT_EDICAO_VENDA = "edicao_venda";
export const ORIGEM_SNAPSHOT_FALLBACK_LEGADO = "fallback_legado";

export const MENSAGEM_SNAPSHOT_TRIBUTARIO_INCOMPLETO =
  "O snapshot tributário desta venda está incompleto. A emissão não inventa CFOP, CST ou alíquotas a partir do cadastro atual.";

export const MENSAGEM_GRUPO_FISCAL_LEGADO_AUSENTE =
  "Grupo Fiscal do item não encontrado ou inativo. Venda antiga sem snapshot tributário completo.";

export type OrigemSnapshotTributarioItem =
  | typeof ORIGEM_SNAPSHOT_FINALIZACAO
  | typeof ORIGEM_SNAPSHOT_EDICAO_VENDA
  | typeof ORIGEM_SNAPSHOT_FALLBACK_LEGADO;

export type SnapshotTributarioItemVenda = {
  versao: number;
  origem: OrigemSnapshotTributarioItem;
  congelado_em: string;
  grupo_fiscal_id: string | null;
  grupo_fiscal_nome: string | null;
  ncm: string | null;
  cest: string | null;
  origem_produto: string | null;
  unidade_medida: string | null;
  codigo_barras: string | null;
  tipo_item: string | null;
  cfop: string | null;
  cfop_interno: string | null;
  cfop_interestadual: string | null;
  icms_cst_csosn: string | null;
  icms_aliquota: number | string | null;
  icms_modalidade_bc: string | null;
  icms_percentual_reducao_bc: number | string | null;
  fcp_aliquota: number | string | null;
  pis_cst: string | null;
  pis_aliquota: number | string | null;
  cofins_cst: string | null;
  cofins_aliquota: number | string | null;
  ipi_aplicavel: boolean | null;
  ipi_cst: string | null;
  ipi_aliquota: number | string | null;
  ipi_enquadramento: string | null;
  cst_ibscbs: string | null;
  classificacao_ibscbs: string | null;
  aliquota_ibs_uf: number | string | null;
  aliquota_ibs_municipio: number | string | null;
  aliquota_cbs: number | string | null;
  percentual_reducao_ibs_uf: number | string | null;
  percentual_reducao_ibs_municipio: number | string | null;
  percentual_reducao_cbs: number | string | null;
  ibscbs_manual: boolean | null;
};

export type ItemVendaParaTributacao = {
  id?: string | null;
  produto_id?: string | null;
  produto_codigo?: string | null;
  produto_nome?: string | null;
  unidade_medida?: string | null;
  grupo_fiscal_id?: string | null;
  ncm?: string | null;
  cest?: string | null;
  origem_produto?: string | null;
  cfop?: string | null;
  icms_cst_csosn?: string | null;
  pis_cst?: string | null;
  cofins_cst?: string | null;
  cst_ibscbs?: string | null;
  classificacao_ibscbs?: string | null;
  snapshot_fiscal?: unknown;
};

export type GrupoFiscalVivo = {
  id?: string | null;
  nome?: string | null;
  ativo?: boolean | null;
  cfop_interno?: string | null;
  cfop_interestadual?: string | null;
  icms_cst_csosn?: string | null;
  icms_aliquota?: number | string | null;
  pis_cst?: string | null;
  pis_aliquota?: number | string | null;
  cofins_cst?: string | null;
  cofins_aliquota?: number | string | null;
  cst_ibscbs?: string | null;
  classificacao_ibscbs?: string | null;
  aliquota_ibs_uf?: number | string | null;
  aliquota_ibs_municipio?: number | string | null;
  aliquota_cbs?: number | string | null;
  percentual_reducao_ibs_uf?: number | string | null;
  percentual_reducao_ibs_municipio?: number | string | null;
  percentual_reducao_cbs?: number | string | null;
  ipi_aplicavel?: boolean | null;
  ipi_cst?: string | null;
  ipi_aliquota?: number | string | null;
  ipi_enquadramento?: string | null;
  ibscbs_manual?: boolean | null;
};

export type ProdutoFiscalVivo = {
  ncm?: string | null;
  cest?: string | null;
  origem_produto?: string | null;
};

export type ProdutoVivo = {
  ativo?: boolean | null;
  grupo_fiscal_id?: string | null;
  codigo_barras?: string | null;
  tipo_item?: string | null;
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function objeto(valor: unknown): Record<string, unknown> | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    return null;
  }
  return valor as Record<string, unknown>;
}

function cfopValido(valor: unknown) {
  return /^\d{4}$/.test(texto(valor));
}

export function lerSnapshotTributarioItem(
  valor: unknown
): SnapshotTributarioItemVenda | null {
  const raiz = objeto(valor);
  if (!raiz) {
    return null;
  }
  const interno = objeto(raiz.tributacao) ?? raiz;
  const origem = texto(interno.origem);
  if (
    origem !== ORIGEM_SNAPSHOT_FINALIZACAO &&
    origem !== ORIGEM_SNAPSHOT_EDICAO_VENDA &&
    origem !== ORIGEM_SNAPSHOT_FALLBACK_LEGADO
  ) {
    return null;
  }
  return {
    versao: Number(interno.versao ?? 0) || 0,
    origem,
    congelado_em: texto(interno.congelado_em) || "",
    grupo_fiscal_id: texto(interno.grupo_fiscal_id) || null,
    grupo_fiscal_nome: texto(interno.grupo_fiscal_nome) || null,
    ncm: texto(interno.ncm) || null,
    cest: texto(interno.cest) || null,
    origem_produto: texto(interno.origem_produto) || null,
    unidade_medida: texto(interno.unidade_medida) || null,
    codigo_barras: texto(interno.codigo_barras) || null,
    tipo_item: texto(interno.tipo_item) || null,
    cfop: texto(interno.cfop) || null,
    cfop_interno: texto(interno.cfop_interno) || null,
    cfop_interestadual: texto(interno.cfop_interestadual) || null,
    icms_cst_csosn: texto(interno.icms_cst_csosn) || null,
    icms_aliquota: interno.icms_aliquota as number | string | null,
    icms_modalidade_bc: texto(interno.icms_modalidade_bc) || null,
    icms_percentual_reducao_bc:
      interno.icms_percentual_reducao_bc as number | string | null,
    fcp_aliquota: interno.fcp_aliquota as number | string | null,
    pis_cst: texto(interno.pis_cst) || null,
    pis_aliquota: interno.pis_aliquota as number | string | null,
    cofins_cst: texto(interno.cofins_cst) || null,
    cofins_aliquota: interno.cofins_aliquota as number | string | null,
    ipi_aplicavel:
      interno.ipi_aplicavel == null ? null : Boolean(interno.ipi_aplicavel),
    ipi_cst: texto(interno.ipi_cst) || null,
    ipi_aliquota: interno.ipi_aliquota as number | string | null,
    ipi_enquadramento: texto(interno.ipi_enquadramento) || null,
    cst_ibscbs: texto(interno.cst_ibscbs) || null,
    classificacao_ibscbs: texto(interno.classificacao_ibscbs) || null,
    aliquota_ibs_uf: interno.aliquota_ibs_uf as number | string | null,
    aliquota_ibs_municipio:
      interno.aliquota_ibs_municipio as number | string | null,
    aliquota_cbs: interno.aliquota_cbs as number | string | null,
    percentual_reducao_ibs_uf:
      interno.percentual_reducao_ibs_uf as number | string | null,
    percentual_reducao_ibs_municipio:
      interno.percentual_reducao_ibs_municipio as number | string | null,
    percentual_reducao_cbs:
      interno.percentual_reducao_cbs as number | string | null,
    ibscbs_manual:
      interno.ibscbs_manual == null ? null : Boolean(interno.ibscbs_manual),
  };
}

export function snapshotTributarioItemCompleto(valor: unknown) {
  const snap = lerSnapshotTributarioItem(valor);
  if (!snap || snap.versao < 1) {
    return false;
  }
  const ncm = texto(snap.ncm).replace(/\D/g, "");
  const cfop = snap.cfop_interno || snap.cfop;
  return (
    ncm.length === 8 &&
    cfopValido(cfop) &&
    Boolean(texto(snap.origem_produto)) &&
    Boolean(texto(snap.icms_cst_csosn)) &&
    /^\d{2}$/.test(texto(snap.pis_cst)) &&
    /^\d{2}$/.test(texto(snap.cofins_cst)) &&
    snap.pis_aliquota != null &&
    snap.pis_aliquota !== "" &&
    snap.cofins_aliquota != null &&
    snap.cofins_aliquota !== ""
  );
}

export function vendaTemTributacaoItensCongelada(snapshotVenda: unknown) {
  const raiz = objeto(snapshotVenda);
  const bloco = objeto(raiz?.tributacao_itens);
  const origem = texto(bloco?.origem);
  return (
    origem === ORIGEM_SNAPSHOT_FINALIZACAO ||
    origem === ORIGEM_SNAPSHOT_EDICAO_VENDA
  );
}

export function cfopDoSnapshotTributario(
  snap: SnapshotTributarioItemVenda,
  tipoDestino: OperacaoFiscal
) {
  if (tipoDestino === "interestadual" && cfopValido(snap.cfop_interestadual)) {
    return texto(snap.cfop_interestadual);
  }
  if (cfopValido(snap.cfop_interno)) {
    return texto(snap.cfop_interno);
  }
  return cfopValido(snap.cfop) ? texto(snap.cfop) : "";
}

export function grupoGeranetDoSnapshotTributario(
  snap: SnapshotTributarioItemVenda,
  cfopEfetivo: string
): GrupoFiscalGeranetFonte {
  return {
    cfopInterno: cfopEfetivo,
    cfopInterestadual: cfopEfetivo,
    icmsCstCsosn: snap.icms_cst_csosn,
    pisCst: snap.pis_cst,
    pisAliquota: snap.pis_aliquota,
    cofinsCst: snap.cofins_cst,
    cofinsAliquota: snap.cofins_aliquota,
    cstIbscbs: snap.cst_ibscbs,
    classificacaoIbscbs: snap.classificacao_ibscbs,
    aliquotaIbsUf: snap.aliquota_ibs_uf,
    aliquotaIbsMunicipio: snap.aliquota_ibs_municipio,
    aliquotaCbs: snap.aliquota_cbs,
    percentualReducaoIbsUf: snap.percentual_reducao_ibs_uf,
    percentualReducaoIbsMunicipio: snap.percentual_reducao_ibs_municipio,
    percentualReducaoCbs: snap.percentual_reducao_cbs,
    ibscbsManual: snap.ibscbs_manual,
    ...camposIpiDoGrupo({
      ipi_aplicavel: snap.ipi_aplicavel,
      ipi_cst: snap.ipi_cst,
      ipi_aliquota: snap.ipi_aliquota,
      ipi_enquadramento: snap.ipi_enquadramento,
    }),
  };
}

export function montarSnapshotTributarioDoCadastro(params: {
  item: ItemVendaParaTributacao;
  grupo: GrupoFiscalVivo | null | undefined;
  fiscalProduto?: ProdutoFiscalVivo | null;
  produto?: ProdutoVivo | null;
  origem: OrigemSnapshotTributarioItem;
  agora?: string;
}): SnapshotTributarioItemVenda {
  const ncm =
    texto(params.item.ncm) || texto(params.fiscalProduto?.ncm) || null;
  const cest =
    texto(params.item.cest) || texto(params.fiscalProduto?.cest) || null;
  const origemProduto =
    texto(params.item.origem_produto) ||
    texto(params.fiscalProduto?.origem_produto) ||
    null;
  const cfopInterno = texto(params.grupo?.cfop_interno) || null;
  const cfopInterestadual = texto(params.grupo?.cfop_interestadual) || null;
  const cfopItem = texto(params.item.cfop) || null;

  return {
    versao: SNAPSHOT_TRIBUTARIO_ITEM_VERSAO,
    origem: params.origem,
    congelado_em: params.agora ?? new Date().toISOString(),
    grupo_fiscal_id:
      texto(params.item.grupo_fiscal_id) || texto(params.grupo?.id) || null,
    grupo_fiscal_nome: texto(params.grupo?.nome) || null,
    ncm,
    cest,
    origem_produto: origemProduto,
    unidade_medida: texto(params.item.unidade_medida) || null,
    codigo_barras: texto(params.produto?.codigo_barras) || null,
    tipo_item: texto(params.produto?.tipo_item) || null,
    cfop: cfopItem || cfopInterno,
    cfop_interno: cfopInterno,
    cfop_interestadual: cfopInterestadual,
    icms_cst_csosn:
      texto(params.item.icms_cst_csosn) ||
      texto(params.grupo?.icms_cst_csosn) ||
      null,
    icms_aliquota: params.grupo?.icms_aliquota ?? null,
    icms_modalidade_bc: null,
    icms_percentual_reducao_bc: null,
    fcp_aliquota: null,
    pis_cst: texto(params.item.pis_cst) || texto(params.grupo?.pis_cst) || null,
    pis_aliquota: params.grupo?.pis_aliquota ?? null,
    cofins_cst:
      texto(params.item.cofins_cst) || texto(params.grupo?.cofins_cst) || null,
    cofins_aliquota: params.grupo?.cofins_aliquota ?? null,
    ipi_aplicavel: params.grupo?.ipi_aplicavel ?? null,
    ipi_cst: texto(params.grupo?.ipi_cst) || null,
    ipi_aliquota: params.grupo?.ipi_aliquota ?? null,
    ipi_enquadramento: texto(params.grupo?.ipi_enquadramento) || null,
    cst_ibscbs:
      texto(params.item.cst_ibscbs) || texto(params.grupo?.cst_ibscbs) || null,
    classificacao_ibscbs:
      texto(params.item.classificacao_ibscbs) ||
      texto(params.grupo?.classificacao_ibscbs) ||
      null,
    aliquota_ibs_uf: params.grupo?.aliquota_ibs_uf ?? null,
    aliquota_ibs_municipio: params.grupo?.aliquota_ibs_municipio ?? null,
    aliquota_cbs: params.grupo?.aliquota_cbs ?? null,
    percentual_reducao_ibs_uf: params.grupo?.percentual_reducao_ibs_uf ?? null,
    percentual_reducao_ibs_municipio:
      params.grupo?.percentual_reducao_ibs_municipio ?? null,
    percentual_reducao_cbs: params.grupo?.percentual_reducao_cbs ?? null,
    ibscbs_manual: params.grupo?.ibscbs_manual ?? null,
  };
}

export type TributacaoItemVendaResolvida = {
  origem: OrigemSnapshotTributarioItem;
  ncm: string;
  cest: string | null;
  origemProduto: string;
  cfop: string;
  icms: string;
  pis: string;
  cofins: string;
  cstIbscbs: string | null;
  classificacaoIbscbs: string | null;
  codigoBarras: string | null;
  tipoItem: string | null;
  grupoGeranet: GrupoFiscalGeranetFonte;
  snapshot: SnapshotTributarioItemVenda;
  persistirFallback: boolean;
};

export function resolverTributacaoItemVenda(params: {
  item: ItemVendaParaTributacao;
  produto?: ProdutoVivo | null;
  fiscalProduto?: ProdutoFiscalVivo | null;
  grupo?: GrupoFiscalVivo | null;
  vendaTributacaoCongelada: boolean;
  tipoDestino: OperacaoFiscal;
  indiceItem: number;
}):
  | { ok: true; valor: TributacaoItemVendaResolvida }
  | { ok: false; mensagem: string } {
  const snapExistente = lerSnapshotTributarioItem(params.item.snapshot_fiscal);

  if (snapshotTributarioItemCompleto(snapExistente) && snapExistente) {
    const cfop = cfopDoSnapshotTributario(snapExistente, params.tipoDestino);
    if (!cfopValido(cfop)) {
      return { ok: false, mensagem: MENSAGEM_SNAPSHOT_TRIBUTARIO_INCOMPLETO };
    }
    return {
      ok: true,
      valor: {
        origem: snapExistente.origem,
        ncm: texto(snapExistente.ncm),
        cest: texto(snapExistente.cest) || null,
        origemProduto: texto(snapExistente.origem_produto),
        cfop,
        icms: texto(snapExistente.icms_cst_csosn),
        pis: texto(snapExistente.pis_cst),
        cofins: texto(snapExistente.cofins_cst),
        cstIbscbs: texto(snapExistente.cst_ibscbs) || null,
        classificacaoIbscbs: texto(snapExistente.classificacao_ibscbs) || null,
        codigoBarras: snapExistente.codigo_barras,
        tipoItem: snapExistente.tipo_item,
        grupoGeranet: grupoGeranetDoSnapshotTributario(snapExistente, cfop),
        snapshot: snapExistente,
        persistirFallback: false,
      },
    };
  }

  if (params.vendaTributacaoCongelada) {
    return { ok: false, mensagem: MENSAGEM_SNAPSHOT_TRIBUTARIO_INCOMPLETO };
  }

  if (!params.grupo || params.grupo.ativo === false) {
    return {
      ok: false,
      mensagem: `${MENSAGEM_GRUPO_FISCAL_LEGADO_AUSENTE} Item ${params.indiceItem}.`,
    };
  }

  const montado = montarSnapshotTributarioDoCadastro({
    item: params.item,
    grupo: params.grupo,
    fiscalProduto: params.fiscalProduto,
    produto: params.produto,
    origem: ORIGEM_SNAPSHOT_FALLBACK_LEGADO,
  });

  if (!snapshotTributarioItemCompleto(montado)) {
    return {
      ok: false,
      mensagem: `Configuração fiscal incompleta no item ${params.indiceItem}. Fallback legado não inventa tributos.`,
    };
  }

  const cfop = cfopDoSnapshotTributario(montado, params.tipoDestino);
  return {
    ok: true,
    valor: {
      origem: ORIGEM_SNAPSHOT_FALLBACK_LEGADO,
      ncm: texto(montado.ncm),
      cest: texto(montado.cest) || null,
      origemProduto: texto(montado.origem_produto),
      cfop,
      icms: texto(montado.icms_cst_csosn),
      pis: texto(montado.pis_cst),
      cofins: texto(montado.cofins_cst),
      cstIbscbs: texto(montado.cst_ibscbs) || null,
      classificacaoIbscbs: texto(montado.classificacao_ibscbs) || null,
      codigoBarras:
        montado.codigo_barras || texto(params.produto?.codigo_barras) || null,
      tipoItem: montado.tipo_item || texto(params.produto?.tipo_item) || null,
      grupoGeranet: grupoGeranetDoSnapshotTributario(montado, cfop),
      snapshot: montado,
      persistirFallback: true,
    },
  };
}
