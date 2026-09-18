import {
  ehCodigoTipoOperacaoInterno,
  ehFinNfeSuportada,
  ehTpNf,
  type CodigoTipoOperacaoInterno,
  type FinNfeSuportada,
  type NaturezaOperacaoFiscal,
  type TpNf,
} from "./catalogo";
import {
  CFOPS,
  existeCodigo,
  type OpcaoFiscal,
} from "@/lib/fiscal/tabelas-fiscais";

export type DestinoCfopMatriz = "interna" | "interestadual";

/** A matriz atual só persiste interna/interestadual. Exterior (3xxx/7xxx) não tem tipo_destino. */
export const FLUXO_MATRIZ_SUPORTA_EXTERIOR = false;

export const TEXTO_AJUDA_REGRAS_CFOP =
  "A natureza define o contexto da operação (entrada ou saída e a finalidade). O CFOP é configurado por grupo fiscal e pode variar entre itens conforme o destino. CFOP incompatível com entrada, saída ou finalidade não será permitido.";

export const TEXTO_AJUDA_CFOP_SAIDA =
  "Configure o CFOP por grupo fiscal conforme o destino da operação. Para saídas: 5xxx em operações internas, 6xxx em operações interestaduais e 7xxx quando aplicável a operações com o exterior.";

export const TEXTO_AJUDA_CFOP_ENTRADA =
  "Configure o CFOP por grupo fiscal conforme o destino da operação. Para entradas: 1xxx em operações internas, 2xxx em operações interestaduais e 3xxx quando aplicável a operações com o exterior.";

export const TEXTO_AJUDA_EXTERIOR_INDISPONIVEL =
  "Operações com o exterior ainda não estão disponíveis nesta matriz. Use o destino interno ou interestadual.";

export const MENSAGEM_FIN_NFE_5_6_NAO_SUPORTADA =
  "Nota de crédito e nota de débito ainda não estão disponíveis. O UltraPDV e a geração do XML só aceitam finalidade 1 (Normal), 2 (Complementar), 3 (Ajuste) ou 4 (Devolução/Retorno).";

const TIPOS_COM_DOCUMENTO_ORIGEM = new Set<string>([
  "devolucao_venda",
  "devolucao_fornecedor",
  "retorno",
  "complementar",
  "nota_credito",
  "nota_debito",
]);

const TIPOS_DEVOLUCAO_OU_RETORNO = new Set<string>([
  "devolucao_venda",
  "devolucao_fornecedor",
  "retorno",
]);

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function codigoCfop(valor: unknown) {
  return texto(valor).replace(/\D/g, "");
}

export function prefixoCfop(valor: unknown) {
  return codigoCfop(valor).slice(0, 1);
}

export function cfopEhEntrada(valor: unknown) {
  return ["1", "2", "3"].includes(prefixoCfop(valor));
}

export function cfopEhSaida(valor: unknown) {
  return ["5", "6", "7"].includes(prefixoCfop(valor));
}

export function cfopEhExterior(valor: unknown) {
  return ["3", "7"].includes(prefixoCfop(valor));
}

export function cfopCompativelComTpNf(cfop: string, tpNf: string) {
  if (tpNf === "0") {
    return cfopEhEntrada(cfop);
  }
  if (tpNf === "1") {
    return cfopEhSaida(cfop);
  }
  return false;
}

export function cfopCompativelComDestino(
  cfop: string,
  tipoDestino: DestinoCfopMatriz
) {
  const prefixo = prefixoCfop(cfop);
  if (tipoDestino === "interna") {
    return prefixo === "1" || prefixo === "5";
  }
  return prefixo === "2" || prefixo === "6";
}

function descricaoCfopCatalogo(cfop: string) {
  return (
    CFOPS.find((item) => item.codigo === codigoCfop(cfop))?.descricao ?? ""
  );
}

/**
 * Classificação a partir do catálogo oficial (descrição), sem lista hardcoded de códigos.
 */
export function cfopCatalogadoComoDevolucaoOuRetorno(cfop: string) {
  const descricao = descricaoCfopCatalogo(cfop)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    descricao.startsWith("devolucao") ||
    descricao.startsWith("retorno") ||
    descricao.includes("devolucao de") ||
    descricao.includes("devolucao simbolica") ||
    descricao.includes("retorno de") ||
    descricao.includes("retorno simbolico")
  );
}

export function tipoExigeDocumentoFiscalReferenciado(tipo: string) {
  return TIPOS_COM_DOCUMENTO_ORIGEM.has(texto(tipo));
}

export function tipoExigeCfopDevolucaoOuRetorno(tipo: string, finNfe: string) {
  return TIPOS_DEVOLUCAO_OU_RETORNO.has(texto(tipo)) || finNfe === "4";
}

export function tipoRejeitaCfopDevolucaoOuRetorno(tipo: string, finNfe: string) {
  if (tipoExigeCfopDevolucaoOuRetorno(tipo, finNfe)) {
    return false;
  }
  return (
    (tipo === "venda" ||
      tipo === "bonificacao" ||
      tipo === "transferencia" ||
      tipo === "remessa") &&
    finNfe === "1"
  );
}

export function identidadeSugeridaParaTipo(
  tipo: string
): { tpNf: TpNf; finNfe: FinNfeSuportada } | null {
  switch (texto(tipo)) {
    case "venda":
    case "bonificacao":
    case "transferencia":
    case "remessa":
      return { tpNf: "1", finNfe: "1" };
    case "devolucao_fornecedor":
      return { tpNf: "1", finNfe: "4" };
    case "devolucao_venda":
    case "retorno":
      return { tpNf: "0", finNfe: "4" };
    case "complementar":
      return { tpNf: "1", finNfe: "2" };
    case "ajuste":
      return { tpNf: "1", finNfe: "3" };
    default:
      return null;
  }
}

export function validarCoerenciaNatureza(params: {
  tipoOperacaoInterno: string;
  tpNf: string;
  finNfe: string;
}): { ok: true } | { ok: false; mensagem: string } {
  const tipo = texto(params.tipoOperacaoInterno);
  const tpNf = texto(params.tpNf);
  const finNfe = texto(params.finNfe);

  if (tipo === "nota_credito" || tipo === "nota_debito") {
    return { ok: false, mensagem: MENSAGEM_FIN_NFE_5_6_NAO_SUPORTADA };
  }

  if (!ehCodigoTipoOperacaoInterno(tipo)) {
    return { ok: false, mensagem: "Selecione um tipo de operação interno válido." };
  }

  if (!ehTpNf(tpNf)) {
    return { ok: false, mensagem: "Selecione entrada (0) ou saída (1)." };
  }

  if (!ehFinNfeSuportada(finNfe)) {
    return {
      ok: false,
      mensagem:
        "A finalidade fiscal deve ser 1 (Normal), 2 (Complementar), 3 (Ajuste) ou 4 (Devolução/Retorno).",
    };
  }

  const esperado = identidadeSugeridaParaTipo(tipo);
  if (!esperado) {
    return { ok: true };
  }

  if (tipo === "complementar" || tipo === "ajuste") {
    if (finNfe !== esperado.finNfe) {
      return {
        ok: false,
        mensagem:
          tipo === "complementar"
            ? "NF-e complementar precisa da finalidade 2."
            : "NF-e de ajuste precisa da finalidade 3.",
      };
    }
    return { ok: true };
  }

  if (tpNf !== esperado.tpNf || finNfe !== esperado.finNfe) {
    const rotuloTp = esperado.tpNf === "1" ? "saída (1)" : "entrada (0)";
    const rotuloFin =
      esperado.finNfe === "1"
        ? "Normal (1)"
        : esperado.finNfe === "4"
          ? "Devolução/Retorno (4)"
          : esperado.finNfe === "2"
            ? "Complementar (2)"
            : "Ajuste (3)";
    return {
      ok: false,
      mensagem: `Este tipo de operação precisa ser ${rotuloTp} com finalidade ${rotuloFin}.`,
    };
  }

  return { ok: true };
}

export function naturezaFiscalmenteCoerente(
  natureza: Pick<
    NaturezaOperacaoFiscal,
    "tipo_operacao_interno" | "tp_nf" | "fin_nfe"
  >
) {
  return validarCoerenciaNatureza({
    tipoOperacaoInterno: natureza.tipo_operacao_interno,
    tpNf: natureza.tp_nf,
    finNfe: natureza.fin_nfe,
  });
}

export function validarDocumentoFiscalReferenciado(params: {
  tipoOperacaoInterno: string;
  chaveDocumentoOrigem?: string | null;
}): { ok: true } | { ok: false; mensagem: string } {
  if (!tipoExigeDocumentoFiscalReferenciado(params.tipoOperacaoInterno)) {
    return { ok: true };
  }

  const chave = texto(params.chaveDocumentoOrigem).replace(/\D/g, "");
  if (!/^\d{44}$/.test(chave)) {
    return {
      ok: false,
      mensagem:
        "Informe o documento fiscal de origem (chave de acesso de 44 dígitos) antes de transmitir esta operação.",
    };
  }

  return { ok: true };
}

export function cfopsParaMatriz(params: {
  tpNf: string;
  tipoDestino: DestinoCfopMatriz;
  tipoOperacaoInterno?: string;
  finNfe?: string;
}): OpcaoFiscal[] {
  const prefixoEsperado =
    params.tipoDestino === "interna"
      ? params.tpNf === "1"
        ? "5"
        : "1"
      : params.tpNf === "1"
        ? "6"
        : "2";

  let lista = CFOPS.filter((item) => item.codigo.startsWith(prefixoEsperado));
  const tipo = texto(params.tipoOperacaoInterno);
  const finNfe = texto(params.finNfe);

  if (tipoExigeCfopDevolucaoOuRetorno(tipo, finNfe)) {
    lista = lista.filter((item) =>
      cfopCatalogadoComoDevolucaoOuRetorno(item.codigo)
    );
  } else if (tipoRejeitaCfopDevolucaoOuRetorno(tipo, finNfe)) {
    lista = lista.filter(
      (item) => !cfopCatalogadoComoDevolucaoOuRetorno(item.codigo)
    );
  }

  return lista;
}

export function validarCfopNaMatrizNatureza(params: {
  cfop: string;
  tpNf: string;
  tipoDestino: DestinoCfopMatriz;
  tipoOperacaoInterno?: string;
  finNfe?: string;
}): { ok: true } | { ok: false; mensagem: string } {
  const cfop = codigoCfop(params.cfop);
  if (!/^\d{4}$/.test(cfop) || !existeCodigo(CFOPS, cfop)) {
    return {
      ok: false,
      mensagem: `CFOP ${params.cfop} não consta no catálogo fiscal.`,
    };
  }

  if (cfopEhExterior(cfop) && !FLUXO_MATRIZ_SUPORTA_EXTERIOR) {
    return {
      ok: false,
      mensagem: TEXTO_AJUDA_EXTERIOR_INDISPONIVEL,
    };
  }

  if (!cfopCompativelComTpNf(cfop, params.tpNf)) {
    return {
      ok: false,
      mensagem:
        params.tpNf === "1"
          ? `CFOP ${cfop} é de entrada e não pode ser usado em NF-e de saída.`
          : `CFOP ${cfop} é de saída e não pode ser usado em NF-e de entrada.`,
    };
  }

  if (!cfopCompativelComDestino(cfop, params.tipoDestino)) {
    const rotulo =
      params.tipoDestino === "interna" ? "interna" : "interestadual";
    return {
      ok: false,
      mensagem: `CFOP ${cfop} não corresponde a uma operação ${rotulo}.`,
    };
  }

  const tipo = texto(params.tipoOperacaoInterno);
  const finNfe = texto(params.finNfe);

  if (
    tipoRejeitaCfopDevolucaoOuRetorno(tipo, finNfe) &&
    cfopCatalogadoComoDevolucaoOuRetorno(cfop)
  ) {
    return {
      ok: false,
      mensagem: `CFOP ${cfop} é exclusivo de devolução/retorno e não se aplica a esta natureza.`,
    };
  }

  if (
    tipoExigeCfopDevolucaoOuRetorno(tipo, finNfe) &&
    !cfopCatalogadoComoDevolucaoOuRetorno(cfop)
  ) {
    return {
      ok: false,
      mensagem: `CFOP ${cfop} não é de devolução/retorno. Esta natureza exige um CFOP compatível com a finalidade 4.`,
    };
  }

  return { ok: true };
}

export function textoAjudaRegrasCfop(params: {
  tpNf?: string;
  tipoOperacaoInterno?: string;
}) {
  const partes = [TEXTO_AJUDA_REGRAS_CFOP];
  if (params.tpNf === "0") {
    partes.push(TEXTO_AJUDA_CFOP_ENTRADA);
  } else {
    partes.push(TEXTO_AJUDA_CFOP_SAIDA);
  }
  partes.push(TEXTO_AJUDA_EXTERIOR_INDISPONIVEL);

  const tipo = texto(params.tipoOperacaoInterno);
  if (tipo === "devolucao_fornecedor") {
    partes.push(
      "Devolução de compra usa matriz própria, sem herdar CFOP de venda."
    );
  } else if (tipo === "devolucao_venda") {
    partes.push(
      "Devolução de venda usa matriz própria de entrada, sem herdar CFOP de venda."
    );
  } else if (tipo === "venda") {
    partes.push(
      "Nesta natureza de venda, não use CFOP exclusivo de devolução."
    );
  }

  return partes.join(" ");
}

export type IdentidadeNaturezaCadastro = {
  tipoOperacaoInterno: CodigoTipoOperacaoInterno;
  tpNf: TpNf;
  finNfe: FinNfeSuportada;
};
