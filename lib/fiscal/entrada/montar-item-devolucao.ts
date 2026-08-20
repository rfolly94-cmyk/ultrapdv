import {
  impostoXmlDoSnapshot,
  parseTributosOriginaisNfe,
} from "@/lib/fiscal/entrada/parse-xml-nfe";
import {
  resolverIcmsDevolucaoFornecedor,
  valoresProporcionaisDevolucao,
} from "@/lib/fiscal/entrada/resolver-icms-devolucao-fornecedor";
import { calcularTotaisItemGeranet } from "@/lib/fiscal/geranet/montar-item";
import { resolverCamposIcmsItemGeranet } from "@/lib/fiscal/geranet/resolver-icms-geranet";
import {
  resolverPoliticaIbscbs,
  type AmbienteGeranet,
  type CodigoRegimeTributario,
} from "@/lib/fiscal/geranet/resolver-politica-ibscbs";
import type { ItemGeranet } from "@/lib/fiscal/geranet/montar-item";

export type PendenciaItemDevolucao = {
  itemId: string;
  descricao: string;
  mensagem: string;
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function somenteDigitos(valor: unknown) {
  return texto(valor).replace(/\D/g, "");
}

function decimal(valor: unknown, casas: number) {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n) || n < 0) {
    return (0).toFixed(casas);
  }
  return n.toFixed(casas);
}

export function montarItemDevolucaoFornecedor(params: {
  descricao: string;
  codigo: string;
  ean?: string | null;
  unidade: string;
  ncm: string;
  cest?: string | null;
  cfop: string;
  quantidade: number;
  valorUnitario: number;
  desconto?: number;
  dadosFiscaisOriginal?: unknown;
  regraIcmsDevolucao?: string | null;
  icmsCstCsosnGrupo?: string | null;
  grupoFiscalNome?: string | null;
  grupoFiscalEmpresaId?: string | null;
  produtoEmpresaId?: string | null;
  empresaIdAtiva?: string | null;
  quantidadeOriginal?: number | null;
  codigoRegimeTributario: CodigoRegimeTributario;
  ambiente: AmbienteGeranet;
  dataEmissao: Date | string;
  ibs?: {
    cstIbscbs?: string | null;
    classificacaoIbscbs?: string | null;
    aliquotaIbsUf?: number | string | null;
    aliquotaIbsMunicipio?: number | string | null;
    aliquotaCbs?: number | string | null;
  } | null;
  documentoFiscalReferenciado?: {
    chaveAcesso: string;
    numeroItem: number;
  } | null;
}): {
  item?: ItemGeranet;
  pendencias: string[];
} {
  const tributos = parseTributosOriginaisNfe(
    impostoXmlDoSnapshot(params.dadosFiscaisOriginal)
  );
  const pendencias = [...tributos.pendencias];
  const ncm = somenteDigitos(params.ncm);
  const cfop = somenteDigitos(params.cfop);
  const quantidade = Number(params.quantidade);
  const valorUnitario = Number(params.valorUnitario);

  if (ncm.length !== 8) {
    pendencias.push("NCM da nota original inválido ou ausente.");
  }
  if (!(quantidade > 0)) {
    pendencias.push("Quantidade da devolução deve ser maior que zero.");
  }
  if (!(valorUnitario >= 0)) {
    pendencias.push("Valor unitário original inválido.");
  }
  if (!texto(params.codigo)) {
    pendencias.push("Código do produto UltraPDV ausente.");
  }
  if (!texto(params.descricao)) {
    pendencias.push("Descrição do item ausente.");
  }

  const icms = resolverIcmsDevolucaoFornecedor({
    empresaIdAtiva: params.empresaIdAtiva,
    produtoEmpresaId: params.produtoEmpresaId,
    grupoFiscalEmpresaId: params.grupoFiscalEmpresaId,
    codigoRegimeTributario: params.codigoRegimeTributario,
    ambiente: params.ambiente,
    dataEmissao: params.dataEmissao,
    tributosOriginais: tributos,
    regraIcmsDevolucao: params.regraIcmsDevolucao,
    icmsCstCsosnGrupo: params.icmsCstCsosnGrupo,
    grupoFiscalNome: params.grupoFiscalNome,
    produtoNome: params.descricao,
  });
  if (!icms.ok) {
    pendencias.push(icms.mensagem);
  }

  const quantidadeOriginal = Number(params.quantidadeOriginal ?? 0);
  if (quantidadeOriginal > 0) {
    const proporcional = valoresProporcionaisDevolucao({
      quantidadeOriginal,
      quantidadeDevolucao: quantidade,
      valorUnitario,
      descontoOriginal: params.desconto ?? 0,
    });
    if (!proporcional.ok) {
      pendencias.push(proporcional.mensagem);
    }
  }

  const politica = resolverPoliticaIbscbs({
    codigoRegimeTributario: params.codigoRegimeTributario,
    dataEmissao: params.dataEmissao,
    ambiente: params.ambiente,
  });

  if (pendencias.length > 0 || !icms.ok) {
    return { pendencias };
  }

  const totais = calcularTotaisItemGeranet({
    quantidade,
    valorUnitario,
    desconto: params.desconto ?? 0,
  });

  const cest = somenteDigitos(params.cest);
  const camposIcms = icms.ok
    ? resolverCamposIcmsItemGeranet({
        codigoRegimeTributario: params.codigoRegimeTributario,
        codigoIcms: icms.icmsCst,
      })
    : {};
  const item: ItemGeranet = {
    numeroPedido: "",
    numeroItemPedido: "",
    desconto: (params.desconto ?? 0).toFixed(8),
    frete: "0.00000000",
    seguro: "0.00000000",
    outro: "0.00000000",
    quantidade: quantidade.toFixed(8),
    valorUnitario: valorUnitario.toFixed(8),
    valorTotal: totais.valorBrutoItem.toFixed(2),
    informacaoAdicional: "Devolução ao fornecedor",
    ncmProduto: ncm,
    cest: cest.length === 7 ? cest : "",
    tipoItem: "00",
    eanProduto: somenteDigitos(params.ean) || "SEM GTIN",
    codigoProduto: texto(params.codigo),
    nomeProduto: texto(params.descricao),
    cfop,
    unidadeMedidaProduto: texto(params.unidade) || "UN",
    origemProduto: icms.ok ? icms.origem : "0",
    ...camposIcms,
    pisCst: tributos.pisCst,
    pisAliquota: decimal(tributos.pisAliquota, 4),
    cofinsCst: tributos.cofinsCst,
    cofinsAliquota: decimal(tributos.cofinsAliquota, 4),
    federaisRetido: "nao",
    aliquotaInss: "0.0000",
    aliquotaIrrf: "0.0000",
    aliquotaCsll: "0.0000",
  };

  if (politica.incluirIbscbs) {
    const cst = texto(params.ibs?.cstIbscbs);
    const classe = texto(params.ibs?.classificacaoIbscbs);
    if (!cst || !classe) {
      return {
        pendencias: [
          "IBS/CBS obrigatório nesta emissão, mas o grupo fiscal do produto não possui CST/classificação.",
        ],
      };
    }
    Object.assign(item, {
      cstIbscbs: cst,
      cClassTribIbscbs: classe,
      aliquotaIbsUf: decimal(params.ibs?.aliquotaIbsUf, 4),
      percentualReducaoIbsUf: "0.00",
      percentualReducaoIbsMun: "0.00",
      aliquotaIbsMun: decimal(params.ibs?.aliquotaIbsMunicipio, 4),
      percentualReducaoCbs: "0.00",
      aliquotaCbs: decimal(params.ibs?.aliquotaCbs, 4),
      ibscbsManual: "0",
    });
  }

  if (tributos.ipiCst) {
    item.ipiCst = tributos.ipiCst;
    item.ipiEnquadramento = tributos.ipiEnquadramento || "999";
    item.ipiManual = "0";
    if (tributos.ipiAliquota > 0) {
      item.ipiAliquota = decimal(tributos.ipiAliquota, 4);
    }
  }

  const chaveRef = somenteDigitos(params.documentoFiscalReferenciado?.chaveAcesso);
  const numeroItem = Number(params.documentoFiscalReferenciado?.numeroItem ?? 0);
  if (chaveRef.length === 44 && numeroItem > 0) {
    item.documentoFiscalReferenciado = {
      chaveAcesso: chaveRef,
      numeroItem,
    };
  }

  return { item, pendencias: [] };
}
