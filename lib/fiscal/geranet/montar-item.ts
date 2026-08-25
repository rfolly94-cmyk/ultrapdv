import {
  resolverIpiGeranet,
} from "./resolver-ipi";
import type {
  ModeloDocumentoFiscal,
  PerfilIpi,
} from "@/lib/fiscal/ipi";

import {
  resolverPoliticaIbscbs,
  type AmbienteGeranet,
  type CodigoRegimeTributario,
  type PoliticaIbscbs,
} from "./resolver-politica-ibscbs";
import { resolverCamposIcmsItemGeranet } from "./resolver-icms-geranet";

export type OperacaoFiscal =
  | "interna"
  | "interestadual";

export type ProdutoGeranetFonte = {
  codigo: string;
  codigoBarras?: string | null;
  nome: string;
  unidadeMedida: string;
  tipoItem?: string | null;
  precoVenda: number | string;
};

export type ProdutoFiscalGeranetFonte = {
  ncm: string | null;
  cest?: string | null;
  origemProduto?: string | null;
};

export type GrupoFiscalGeranetFonte = {
  cfopInterno: string | null;
  cfopInterestadual: string | null;

  icmsCstCsosn: string | null;

  pisCst: string | null;
  pisAliquota:
    | number
    | string
    | null;

  cofinsCst: string | null;
  cofinsAliquota:
    | number
    | string
    | null;

  cstIbscbs: string | null;
  classificacaoIbscbs:
    | string
    | null;

  aliquotaIbsUf:
    | number
    | string
    | null;

  aliquotaIbsMunicipio:
    | number
    | string
    | null;

  aliquotaCbs:
    | number
    | string
    | null;

  percentualReducaoIbsUf:
    | number
    | string
    | null;

  percentualReducaoIbsMunicipio:
    | number
    | string
    | null;

  percentualReducaoCbs:
    | number
    | string
    | null;

  ibscbsManual?: boolean | null;

  ipiAplicavel?: boolean | null;
  ipiCst?: string | null;
  ipiAliquota?: number | string | null;
  ipiEnquadramento?: string | null;
};

export type MontarItemGeranetInput = {
  produto: ProdutoGeranetFonte;
  fiscal: ProdutoFiscalGeranetFonte;
  grupo: GrupoFiscalGeranetFonte;

  operacao: OperacaoFiscal;

  quantidade: number | string;
  valorUnitario?: number | string;

  desconto?: number | string;
  frete?: number | string;
  seguro?: number | string;
  outro?: number | string;

  informacaoAdicional?: string | null;

  codigoRegimeTributario:
    CodigoRegimeTributario;

  ambiente: AmbienteGeranet;

  dataEmissao: Date | string;

  modelo: ModeloDocumentoFiscal;

  perfilIpi: PerfilIpi | null;

  /**
   * Somente para testes em ambiente 2.
   * Em produção este parâmetro não força nada.
   */
  forcarIbscbsHomologacao?: boolean;
};

type CamposIbscbsGeranet = {
  cstIbscbs: string;
  cClassTribIbscbs: string;

  aliquotaIbsUf: string;
  percentualReducaoIbsUf: string;

  percentualReducaoIbsMun: string;
  aliquotaIbsMun: string;

  percentualReducaoCbs: string;
  aliquotaCbs: string;

  ibscbsManual: "0";
};

export type ItemGeranet = {
  numeroPedido: string;
  numeroItemPedido: string;

  desconto: string;
  frete: string;
  seguro: string;
  outro: string;

  quantidade: string;
  valorUnitario: string;
  /** Bruto Geranet: quantidade * valorUnitario. Não é o líquido. */
  valorTotal: string;

  /**
   * NF-e 55 e NFC-e 65: string vazia pede o cálculo automático da Geranet
   * (valorTotal − desconto). Não é um valor IBPT calculado pelo UltraPDV.
   */
  vTotTrib?: string;

  informacaoAdicional: string;

  ncmProduto: string;
  cest: string;
  tipoItem: string;

  eanProduto: string;
  codigoProduto: string;
  nomeProduto: string;

  cfop: string;
  unidadeMedidaProduto: string;
  origemProduto: string;

  icmsCst?: string;
  icmsCsosn?: string;

  pisCst: string;
  pisAliquota: string;

  cofinsCst: string;
  cofinsAliquota: string;

  federaisRetido: "nao";
  aliquotaInss: string;
  aliquotaIrrf: string;
  aliquotaCsll: string;
  } & Partial<CamposIbscbsGeranet> &
  Partial<{
    ipiCst: string;
    ipiEnquadramento: string;
    ipiAliquota: string;
    ipiManual: "0";
    documentoFiscalReferenciado: {
      chaveAcesso: string;
      numeroItem: number;
    };
  }>;

/** Contrato oficial Geranet: cálculo automático IBPT considera desconto. */
export const IBPT_AUTOMATICO_GERANET = "sim" as const;

/**
 * String vazia no item pede o cálculo automático da Geranet.
 * O UltraPDV não envia percentual IBPT nem valor aproximado.
 */
export const VTOTTRIB_CALCULO_AUTOMATICO_GERANET = "" as const;

export type TotaisItemGeranet = {
  valorBrutoItem: number;
  valorLiquidoFiscal: number;
  desconto: number;
  frete: number;
  seguro: number;
  outro: number;
};

export type ResultadoItemGeranet = {
  item: ItemGeranet;
  politicaIbscbs: PoliticaIbscbs;
  valorBrutoItem: number;
  valorLiquidoFiscal: number;
};

export function calcularTotaisItemGeranet(input: {
  quantidade: number;
  valorUnitario: number;
  desconto?: number;
  frete?: number;
  seguro?: number;
  outro?: number;
}): TotaisItemGeranet {
  const valorBrutoItem =
    input.quantidade * input.valorUnitario;
  const desconto = input.desconto ?? 0;
  const frete = input.frete ?? 0;
  const seguro = input.seguro ?? 0;
  const outro = input.outro ?? 0;
  const valorLiquidoFiscal =
    valorBrutoItem - desconto + frete + seguro + outro;

  return {
    valorBrutoItem,
    valorLiquidoFiscal,
    desconto,
    frete,
    seguro,
    outro,
  };
}

export function arredondarMoedaFiscal(valor: number) {
  if (!Number.isFinite(valor)) {
    return 0;
  }
  return Math.round(valor * 100) / 100;
}

/**
 * Base informativa da Lei 12.741 para o item: líquido após desconto
 * incondicional (e acréscimos de frete/seguro/outro já rateados).
 * Não é vProd. Não altera vNF comercial.
 */
export function baseInformativaTributosItem(
  totais: TotaisItemGeranet
) {
  return Math.max(0, arredondarMoedaFiscal(totais.valorLiquidoFiscal));
}

/**
 * Helper interno. O UltraPDV não calcula nem envia percentual IBPT
 * no payload Geranet (NF-e 55 e NFC-e 65 usam vTotTrib vazio +
 * ibptAutomatico=sim).
 */
export function valorAproximadoTributosSobreBase(
  base: number,
  percentual: number
) {
  if (!Number.isFinite(percentual) || percentual < 0) {
    throw new Error("Percentual tributário aproximado inválido.");
  }
  return Math.max(
    0,
    arredondarMoedaFiscal((Math.max(0, arredondarMoedaFiscal(base)) * percentual) / 100)
  );
}

export function valorAproximadoTributosNota(
  valoresItens: number[]
) {
  return Math.max(
    0,
    arredondarMoedaFiscal(
      valoresItens.reduce((soma, valor) => soma + Number(valor ?? 0), 0)
    )
  );
}

function numero(
  valor:
    | number
    | string
    | null
    | undefined,
  nome: string
) {
  if (
    valor === null ||
    valor === undefined ||
    valor === ""
  ) {
    return 0;
  }

  let texto = String(valor).trim();

  if (
    texto.includes(".") &&
    texto.includes(",")
  ) {
    texto = texto
      .replace(/\./g, "")
      .replace(",", ".");
  } else if (texto.includes(",")) {
    texto = texto.replace(",", ".");
  }

  const resultado = Number(texto);

  if (!Number.isFinite(resultado)) {
    throw new Error(
      `${nome} possui valor inválido.`
    );
  }

  return resultado;
}

function decimal(
  valor:
    | number
    | string
    | null
    | undefined,
  casas: number,
  nome: string
) {
  return numero(
    valor,
    nome
  ).toFixed(casas);
}

function validarPercentual(
  valor: number,
  nome: string
) {
  if (valor < 0 || valor > 100) {
    throw new Error(
      `${nome} deve estar entre 0 e 100.`
    );
  }
}

function somenteDigitos(
  valor: string | null | undefined
) {
  return String(valor ?? "").replace(
    /\D/g,
    ""
  );
}

function obrigatorio(
  valor: string | null | undefined,
  nome: string
) {
  const texto = String(
    valor ?? ""
  ).trim();

  if (!texto) {
    throw new Error(
      `${nome} não está configurado.`
    );
  }

  return texto;
}

function montarCamposIbscbs(
  grupo: GrupoFiscalGeranetFonte
): CamposIbscbsGeranet {
  const cstIbscbs = obrigatorio(
    grupo.cstIbscbs,
    "CST IBS/CBS"
  );

  const cClassTribIbscbs =
    obrigatorio(
      grupo.classificacaoIbscbs,
      "cClassTrib IBS/CBS"
    );

  if (!/^\d{3}$/.test(cstIbscbs)) {
    throw new Error(
      "CST IBS/CBS deve possuir 3 dígitos."
    );
  }

  if (
    !/^\d{6}$/.test(
      cClassTribIbscbs
    )
  ) {
    throw new Error(
      "cClassTrib deve possuir 6 dígitos."
    );
  }

  if (grupo.ibscbsManual) {
    throw new Error(
      "O fluxo padrão usa ibscbs_manual = false."
    );
  }

  const aliquotaIbsUf = numero(
    grupo.aliquotaIbsUf,
    "Alíquota IBS UF"
  );

  const aliquotaIbsMun = numero(
    grupo.aliquotaIbsMunicipio,
    "Alíquota IBS Município"
  );

  const aliquotaCbs = numero(
    grupo.aliquotaCbs,
    "Alíquota CBS"
  );

  const reducaoIbsUf = numero(
    grupo.percentualReducaoIbsUf,
    "Redução IBS UF"
  );

  const reducaoIbsMun = numero(
    grupo
      .percentualReducaoIbsMunicipio,
    "Redução IBS Município"
  );

  const reducaoCbs = numero(
    grupo.percentualReducaoCbs,
    "Redução CBS"
  );

  validarPercentual(
    aliquotaIbsUf,
    "Alíquota IBS UF"
  );

  validarPercentual(
    aliquotaIbsMun,
    "Alíquota IBS Município"
  );

  validarPercentual(
    aliquotaCbs,
    "Alíquota CBS"
  );

  validarPercentual(
    reducaoIbsUf,
    "Redução IBS UF"
  );

  validarPercentual(
    reducaoIbsMun,
    "Redução IBS Município"
  );

  validarPercentual(
    reducaoCbs,
    "Redução CBS"
  );

  return {
    cstIbscbs,
    cClassTribIbscbs,

    aliquotaIbsUf:
      aliquotaIbsUf.toFixed(4),

    percentualReducaoIbsUf:
      reducaoIbsUf.toFixed(2),

    percentualReducaoIbsMun:
      reducaoIbsMun.toFixed(2),

    aliquotaIbsMun:
      aliquotaIbsMun.toFixed(4),

    percentualReducaoCbs:
      reducaoCbs.toFixed(2),

    aliquotaCbs:
      aliquotaCbs.toFixed(4),

    // Geranet calcula base/valores.
    ibscbsManual: "0",
  };
}

export function montarItemGeranet(
  input: MontarItemGeranetInput
): ResultadoItemGeranet {
  const politicaIbscbs =
    resolverPoliticaIbscbs({
      codigoRegimeTributario:
        input.codigoRegimeTributario,

      dataEmissao:
        input.dataEmissao,

      ambiente:
        input.ambiente,

      forcarIbscbsHomologacao:
        input
          .forcarIbscbsHomologacao,
    });

  const quantidade = numero(
    input.quantidade,
    "Quantidade"
  );

  if (quantidade <= 0) {
    throw new Error(
      "Quantidade deve ser maior que zero."
    );
  }

  const valorUnitario = numero(
    input.valorUnitario ??
      input.produto.precoVenda,
    "Valor unitário"
  );

  if (valorUnitario < 0) {
    throw new Error(
      "Valor unitário não pode ser negativo."
    );
  }

  const desconto = numero(
    input.desconto ?? 0,
    "Desconto"
  );

  const frete = numero(
    input.frete ?? 0,
    "Frete"
  );

  const seguro = numero(
    input.seguro ?? 0,
    "Seguro"
  );

  const outro = numero(
    input.outro ?? 0,
    "Outras despesas"
  );

  for (const [nome, valor] of [
    ["Desconto", desconto],
    ["Frete", frete],
    ["Seguro", seguro],
    ["Outras despesas", outro],
  ] as const) {
    if (valor < 0) {
      throw new Error(
        `${nome} não pode ser negativo.`
      );
    }
  }

  const totais = calcularTotaisItemGeranet({
    quantidade,
    valorUnitario,
    desconto,
    frete,
    seguro,
    outro,
  });

  const valorBrutoItem = totais.valorBrutoItem;
  const valorLiquidoFiscal = totais.valorLiquidoFiscal;

  if (desconto > valorBrutoItem) {
    throw new Error(
      "O desconto fiscal do item é maior que o valor do produto."
    );
  }

  if (valorLiquidoFiscal < 0) {
    throw new Error(
      "O líquido fiscal do item ficou negativo."
    );
  }

  const ncm = somenteDigitos(
    input.fiscal.ncm
  );

  if (ncm.length !== 8) {
    throw new Error(
      "NCM deve possuir exatamente 8 dígitos."
    );
  }

  const cest = somenteDigitos(
    input.fiscal.cest
  );

  if (
    cest &&
    cest.length !== 7
  ) {
    throw new Error(
      "CEST deve possuir exatamente 7 dígitos."
    );
  }

  const cfop =
    input.operacao ===
    "interestadual"
      ? obrigatorio(
          input.grupo
            .cfopInterestadual,
          "CFOP interestadual"
        )
      : obrigatorio(
          input.grupo.cfopInterno,
          "CFOP interno"
        );

  if (!/^\d{4}$/.test(cfop)) {
    throw new Error(
      "CFOP deve possuir 4 dígitos."
    );
  }

  const origemProduto =
    obrigatorio(
      input.fiscal
        .origemProduto ?? "0",
      "Origem do produto"
    );

  const camposIcms = resolverCamposIcmsItemGeranet({
    codigoRegimeTributario: input.codigoRegimeTributario,
    codigoIcms: input.grupo.icmsCstCsosn,
  });

  const pisCst = obrigatorio(
    input.grupo.pisCst,
    "CST PIS"
  );

  const cofinsCst = obrigatorio(
    input.grupo.cofinsCst,
    "CST COFINS"
  );

  const camposIbscbs =
    politicaIbscbs.incluirIbscbs
      ? montarCamposIbscbs(
          input.grupo
        )
      : {};

  const camposIpi = resolverIpiGeranet({
    modelo: input.modelo,
    perfilIpi: input.perfilIpi,
    grupo: {
      ipiAplicavel: input.grupo.ipiAplicavel,
      ipiCst: input.grupo.ipiCst,
      ipiAliquota: input.grupo.ipiAliquota,
      ipiEnquadramento: input.grupo.ipiEnquadramento,
    },
  });

  const codigoBarras =
    input.produto.codigoBarras
      ?.trim();

  const item: ItemGeranet = {
    // A documentação simples da Geranet mostra null,
    // mas a estrutura completa usa string vazia.
    // Como o backend está retornando:
    // "Cannot convert data from Null value",
    // não enviamos Null nestes campos opcionais.
    numeroPedido: "",
    numeroItemPedido: "",

    desconto:
      desconto.toFixed(8),

    frete:
      frete.toFixed(8),

    seguro:
      seguro.toFixed(8),

    outro:
      outro.toFixed(8),

    quantidade:
      quantidade.toFixed(8),

    valorUnitario:
      valorUnitario.toFixed(8),

    // Geranet: valorTotal = bruto (qtd * unitário) → XML vProd.
    // O líquido (vNF do item) fica em valorLiquidoFiscal, só para conferência.
    // NF-e 55 e NFC-e 65: vTotTrib vazio + nfe.empresa.ibptAutomatico=sim
    // pede o cálculo automático da Geranet sobre valorTotal − desconto.
    // O UltraPDV não calcula percentual IBPT nem envia valor numérico.
    valorTotal:
      valorBrutoItem.toFixed(2),

    vTotTrib: VTOTTRIB_CALCULO_AUTOMATICO_GERANET,

    informacaoAdicional:
      input.informacaoAdicional
        ?.trim() ?? "",

    ncmProduto: ncm,
    cest,

    tipoItem:
      input.produto.tipoItem
        ?.trim() || "00",

    // Padrão NF-e/NFC-e para
    // produto sem GTIN.
    eanProduto:
      codigoBarras || "SEM GTIN",

    codigoProduto:
      obrigatorio(
        input.produto.codigo,
        "Código do produto"
      ),

    nomeProduto:
      obrigatorio(
        input.produto.nome,
        "Nome do produto"
      ),

    cfop,

    unidadeMedidaProduto:
      obrigatorio(
        input.produto
          .unidadeMedida,
        "Unidade de medida"
      ),

    origemProduto,
    ...camposIcms,

    pisCst,

    pisAliquota: decimal(
      input.grupo.pisAliquota,
      4,
      "Alíquota PIS"
    ),

    cofinsCst,

    cofinsAliquota: decimal(
      input.grupo
        .cofinsAliquota,
      4,
      "Alíquota COFINS"
    ),

    ...camposIbscbs,
    ...camposIpi,

    federaisRetido: "nao",
    aliquotaInss: "0.0000",
    aliquotaIrrf: "0.0000",
    aliquotaCsll: "0.0000",
  };

  return {
    item,
    politicaIbscbs,
    valorBrutoItem,
    valorLiquidoFiscal,
  };
}
