import type { CobrancaPixPublica, StatusCobrancaPix } from "./types";

export function linhaPublicaCobrancaPix(
  row: Record<string, unknown>
): CobrancaPixPublica {
  return {
    id: String(row.id),
    empresa_id: String(row.empresa_id),
    txid: row.txid ? String(row.txid) : null,
    valor: Number(row.valor),
    status: row.status as StatusCobrancaPix,
    provedor: row.provedor ? String(row.provedor) : null,
    ambiente: row.ambiente ? String(row.ambiente) : null,
    dados_publicos:
      row.dados_publicos && typeof row.dados_publicos === "object"
        ? (row.dados_publicos as Record<string, unknown>)
        : {},
    geranet_http_status:
      typeof row.geranet_http_status === "number"
        ? row.geranet_http_status
        : null,
    geranet_situacao: row.geranet_situacao
      ? String(row.geranet_situacao)
      : null,
    geranet_mensagem: row.geranet_mensagem
      ? String(row.geranet_mensagem)
      : null,
    expira_em: row.expira_em ? String(row.expira_em) : null,
    pago_em: row.pago_em ? String(row.pago_em) : null,
    cancelado_em: row.cancelado_em ? String(row.cancelado_em) : null,
    modo_pix: row.modo_pix ? String(row.modo_pix) : null,
    valor_pago:
      row.valor_pago == null || row.valor_pago === ""
        ? null
        : Number(row.valor_pago),
    checkout_key: row.checkout_key ? String(row.checkout_key) : null,
  };
}
