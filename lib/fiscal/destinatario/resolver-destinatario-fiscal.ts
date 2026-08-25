import type {
  ConsumidorFinalNfe,
  IndicadorIeDestinatarioNfe,
} from "@/lib/fiscal/geranet/montar-payload-nfe";
import type {
  OrigemDocumentoDestinatario,
  TipoDocumentoDestinatario,
} from "./documento";
import { somenteDigitosDocumento } from "./documento";

export const MENSAGEM_NAO_CONTRIBUINTE_CONSUMIDOR_FINAL =
  "Operação com destinatário não contribuinte e sem consumidor final. A SEFAZ pode rejeitar esta combinação; revise as informações fiscais da operação se não for o caso pretendido.";

export const INDICADORES_IE_DESTINATARIO = ["1", "2", "9"] as const;

export type DestinatarioFiscalResolvido = {
  indicadorIEdestinatario: IndicadorIeDestinatarioNfe;
  consumidorFinal: ConsumidorFinalNfe;
};

export type OrigemConsumidorFinalFiscal =
  | "operacao"
  | "origem_pdv"
  | "manual"
  | "cadastro";

export type OrigemVendaDestinatario = "pdv" | "nfe_manual";

export type SnapshotDestinatarioFiscal = {
  consumidorFinal: boolean | null;
  consumidorFinalDefinido: boolean;
  origem: OrigemConsumidorFinalFiscal | null;
  indicadorIe: IndicadorIeDestinatarioNfe | null;
  documentoNumero: string | null;
  documentoTipo: TipoDocumentoDestinatario | null;
  documentoOrigem: OrigemDocumentoDestinatario | null;
  documentoDefinido: boolean;
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function ufExterior(uf?: string | null) {
  const valor = texto(uf).toUpperCase();
  return valor === "EX" || valor === "EXTERIOR";
}

export function flagConsumidorFinal(valor: unknown) {
  if (valor === true || valor === 1 || valor === "1") {
    return true;
  }
  if (valor === false || valor === 0 || valor === "0" || valor == null) {
    return false;
  }
  return Boolean(valor);
}

export function normalizarIndicadorIeDestinatario(
  valor: unknown,
  fallbackContribuinteIcms?: boolean | null
): IndicadorIeDestinatarioNfe {
  const codigo = texto(valor);
  if (codigo === "1" || codigo === "2" || codigo === "9") {
    return codigo;
  }
  return fallbackContribuinteIcms ? "1" : "9";
}

export function indicadorIeParaContribuinteIcms(
  indicador: IndicadorIeDestinatarioNfe
) {
  return indicador === "1";
}

export function ieDestinatarioParaGeranet(params: {
  indicadorIEdestinatario: IndicadorIeDestinatarioNfe;
  inscricaoEstadual?: string | null;
}) {
  const ie = texto(params.inscricaoEstadual);
  if (params.indicadorIEdestinatario === "1") {
    return ie;
  }
  if (params.indicadorIEdestinatario === "2") {
    return ie && ie.toUpperCase() !== "ISENTO" ? ie : "ISENTO";
  }
  return "";
}

/**
 * Fiscal > Nova NF-e emite sempre modelo 55.
 * Consumidor final não escolhe NFC-e; o PDV continua decidindo 65 no próprio fluxo.
 */
export function modeloDocumentoNfeOperacao(_params?: {
  tipoOperacaoInterno?: string | null;
  consumidorFinal?: boolean;
  vendaId?: string | null;
}): "55" {
  return "55";
}

export function lerSnapshotDestinatarioFiscal(
  snapshot: unknown
): SnapshotDestinatarioFiscal {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {
      consumidorFinal: null,
      consumidorFinalDefinido: false,
      origem: null,
      indicadorIe: null,
      documentoNumero: null,
      documentoTipo: null,
      documentoOrigem: null,
      documentoDefinido: false,
    };
  }
  const bruto = snapshot as Record<string, unknown>;
  const origemBruta = texto(bruto.consumidor_final_origem);
  const origem: OrigemConsumidorFinalFiscal | null =
    origemBruta === "operacao" ||
    origemBruta === "origem_pdv" ||
    origemBruta === "manual" ||
    origemBruta === "cadastro"
      ? origemBruta
      : null;
  const indicador = texto(bruto.indicador_ie_destinatario);
  const tipoBruto = texto(bruto.destinatario_documento_tipo);
  const origemDocBruta = texto(bruto.destinatario_documento_origem);
  const numero = somenteDigitosDocumento(bruto.destinatario_documento) || null;
  return {
    consumidorFinal:
      bruto.consumidor_final == null
        ? null
        : flagConsumidorFinal(bruto.consumidor_final),
    consumidorFinalDefinido: bruto.consumidor_final != null,
    origem,
    indicadorIe:
      indicador === "1" || indicador === "2" || indicador === "9"
        ? indicador
        : null,
    documentoNumero: numero,
    documentoTipo: tipoBruto === "cpf" || tipoBruto === "cnpj" ? tipoBruto : null,
    documentoOrigem:
      origemDocBruta === "cpf_na_nota" || origemDocBruta === "cliente"
        ? origemDocBruta
        : null,
    documentoDefinido: Object.prototype.hasOwnProperty.call(
      bruto,
      "destinatario_documento"
    ),
  };
}

export function escolherSnapshotDestinatario(params: {
  snapshotOperacao?: unknown;
  snapshotVenda?: unknown;
}): SnapshotDestinatarioFiscal {
  const daOperacao = lerSnapshotDestinatarioFiscal(params.snapshotOperacao);
  if (daOperacao.consumidorFinalDefinido || daOperacao.indicadorIe) {
    return daOperacao;
  }
  return lerSnapshotDestinatarioFiscal(params.snapshotVenda);
}

export function defaultConsumidorFinalOperacao(params: {
  modelo?: string | null;
  tipoOperacaoInterno?: string | null;
  origemVenda?: OrigemVendaDestinatario | null;
  indicadorIEdestinatario?: IndicadorIeDestinatarioNfe;
  consumidorFinalCadastro?: boolean | string | null;
}): boolean {
  const modelo = texto(params.modelo) || "55";
  if (modelo === "65") {
    return true;
  }
  const tipo = texto(params.tipoOperacaoInterno);
  if (tipo === "transferencia") {
    return false;
  }
  if (tipo === "bonificacao") {
    if (params.consumidorFinalCadastro != null) {
      return flagConsumidorFinal(params.consumidorFinalCadastro);
    }
    return params.indicadorIEdestinatario === "9";
  }
  if (
    tipo === "venda" ||
    params.origemVenda === "pdv" ||
    params.origemVenda === "nfe_manual"
  ) {
    return true;
  }
  if (params.consumidorFinalCadastro != null) {
    return flagConsumidorFinal(params.consumidorFinalCadastro);
  }
  return true;
}

export function snapshotDestinatarioParaPersistir(params: {
  consumidorFinal: boolean;
  origem: OrigemConsumidorFinalFiscal;
  indicadorIe: IndicadorIeDestinatarioNfe;
  documento?: {
    numero: string | null;
    tipo: TipoDocumentoDestinatario | null;
    origem: OrigemDocumentoDestinatario | null;
  } | null;
}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    consumidor_final: params.consumidorFinal,
    consumidor_final_origem: params.origem,
    indicador_ie_destinatario: params.indicadorIe,
  };

  if (params.documento === undefined) {
    return base;
  }

  if (params.documento === null) {
    return {
      ...base,
      destinatario_documento: null,
      destinatario_documento_tipo: null,
      destinatario_documento_origem: null,
    };
  }

  return {
    ...base,
    destinatario_documento: params.documento.numero,
    destinatario_documento_tipo: params.documento.tipo,
    destinatario_documento_origem: params.documento.origem,
  };
}

/**
 * NFC-e 65: documento e flags vêm do snapshot congelado.
 * Não consulta o cadastro atual do cliente.
 */
export function camposClienteNfceGeranet(snapshot: unknown) {
  const snap = lerSnapshotDestinatarioFiscal(snapshot);
  const flags = resolverDestinatarioFiscalNfe({
    modelo: "65",
    origemVenda: "pdv",
    contribuinteIcms: false,
    indicadorIeSnapshot: snap.indicadorIe,
    consumidorFinalSnapshot: snap.consumidorFinal,
    consumidorFinalDefinidoNoSnapshot: snap.consumidorFinalDefinido,
  });

  return {
    cpf: snap.documentoTipo === "cpf" ? snap.documentoNumero ?? "" : "",
    cnpj: snap.documentoTipo === "cnpj" ? snap.documentoNumero ?? "" : "",
    consumidorFinal: flags.consumidorFinal,
    indicadorIEdestinatario: flags.indicadorIEdestinatario,
  };
}

/**
 * Fonte única de indIEDest / indFinal para Validar, preview e Emitir.
 *
 * Prioridade indFinal:
 * 1. valor já persistido no snapshot da operação/venda
 * 2. default da origem (PDV/venda varejista = 1; transferência = 0)
 * 3. sugestão do cadastro do cliente
 * 4. fallback seguro na criação
 *
 * Prioridade indIEDest:
 * 1. snapshot da operação
 * 2. cadastro (indicador_ie_destinatario 1/2/9)
 * 3. contribuinte_icms legado (true→1, false→9)
 */
export function resolverDestinatarioFiscalNfe(params: {
  modelo?: string | null;
  tipoOperacaoInterno?: string | null;
  origemVenda?: OrigemVendaDestinatario | null;
  contribuinteIcms?: boolean | null;
  indicadorIeCadastro?: string | null;
  indicadorIeSnapshot?: string | null;
  consumidorFinalCadastro?: boolean | string | null;
  consumidorFinalSnapshot?: boolean | string | null;
  consumidorFinalDefinidoNoSnapshot?: boolean;
}): DestinatarioFiscalResolvido {
  const modelo = texto(params.modelo) || "55";
  const indicadorIEdestinatario = normalizarIndicadorIeDestinatario(
    params.indicadorIeSnapshot ?? params.indicadorIeCadastro,
    params.contribuinteIcms
  );

  if (modelo === "65") {
    return {
      indicadorIEdestinatario,
      consumidorFinal: "1",
    };
  }

  const consumidorFinalDefinido =
    params.consumidorFinalDefinidoNoSnapshot === true ||
    (params.consumidorFinalDefinidoNoSnapshot !== false &&
      params.consumidorFinalSnapshot != null);

  const consumidorFinalBooleano = consumidorFinalDefinido
    ? flagConsumidorFinal(params.consumidorFinalSnapshot)
    : defaultConsumidorFinalOperacao({
        modelo,
        tipoOperacaoInterno: params.tipoOperacaoInterno,
        origemVenda: params.origemVenda,
        indicadorIEdestinatario,
        consumidorFinalCadastro: params.consumidorFinalCadastro,
      });

  return {
    indicadorIEdestinatario,
    consumidorFinal: consumidorFinalBooleano ? "1" : "0",
  };
}

export function resolverDestinatarioFiscalDaOrigem(params: {
  modelo?: string | null;
  tipoOperacaoInterno?: string | null;
  origemVenda?: OrigemVendaDestinatario | null;
  snapshotOperacao?: unknown;
  snapshotVenda?: unknown;
  contribuinteIcms?: boolean | null;
  indicadorIeCadastro?: string | null;
  consumidorFinalCadastro?: boolean | string | null;
}): DestinatarioFiscalResolvido {
  const snap = escolherSnapshotDestinatario({
    snapshotOperacao: params.snapshotOperacao,
    snapshotVenda: params.snapshotVenda,
  });
  return resolverDestinatarioFiscalNfe({
    modelo: params.modelo,
    tipoOperacaoInterno: params.tipoOperacaoInterno,
    origemVenda: params.origemVenda,
    contribuinteIcms: params.contribuinteIcms,
    indicadorIeCadastro: params.indicadorIeCadastro,
    indicadorIeSnapshot: snap.indicadorIe,
    consumidorFinalCadastro: params.consumidorFinalCadastro,
    consumidorFinalSnapshot: snap.consumidorFinal,
    consumidorFinalDefinidoNoSnapshot: snap.consumidorFinalDefinido,
  });
}

export function origemSnapshotAInicializar(params: {
  origemVenda?: OrigemVendaDestinatario | null;
  tipoOperacaoInterno?: string | null;
}): OrigemConsumidorFinalFiscal {
  if (params.origemVenda === "pdv") {
    return "origem_pdv";
  }
  return "operacao";
}

/**
 * Aviso estrutural — não trava a emissão.
 * Sem o conjunto completo de regras SEFAZ (idDest, tpNF, exceções),
 * 9+0 não pode ser uma recusa local universal.
 */
export function alertaNaoContribuinteConsumidorFinal(params: {
  modelo?: string | null;
  tipoOperacaoInterno?: string | null;
  indicadorIEdestinatario?: string | null;
  consumidorFinal?: string | boolean | null;
  ufDestinatario?: string | null;
}): { codigo: string; mensagem: string } | null {
  const tipo = texto(params.tipoOperacaoInterno);
  if (tipo === "transferencia") {
    return null;
  }

  const modelo = texto(params.modelo) || "55";
  if (modelo === "65") {
    return null;
  }

  if (ufExterior(params.ufDestinatario)) {
    return null;
  }

  const indicador = texto(params.indicadorIEdestinatario);
  const consumidorFinal = flagConsumidorFinal(params.consumidorFinal);

  if (indicador === "9" && !consumidorFinal) {
    return {
      codigo: "consumidor_final",
      mensagem: MENSAGEM_NAO_CONTRIBUINTE_CONSUMIDOR_FINAL,
    };
  }

  return null;
}

/** @deprecated use alertaNaoContribuinteConsumidorFinal — não bloqueia emissão. */
export function pendenciaNaoContribuinteConsumidorFinal(
  params: Parameters<typeof alertaNaoContribuinteConsumidorFinal>[0]
) {
  return alertaNaoContribuinteConsumidorFinal(params);
}
