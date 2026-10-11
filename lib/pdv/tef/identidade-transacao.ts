export type TransacaoTefIdentificavel = {
  id: string;
  empresaId: string;
  nsu: string | null;
  rede: string | null;
  finalizacao: string | null;
  valorCentavos: number;
  terminalId?: string | null;
  autorizacao?: string | null;
};

function texto(valor: string | null | undefined) {
  return String(valor ?? "").trim();
}

/**
 * NSU de cartão se repete entre redes, adquirentes e dias.
 * O end-to-end do PIX é único na prática, mas ocupa a mesma coluna.
 * A cobrança PIX C6 já tem unicidade própria em cobrancas_pix (empresa_id, e2eid).
 * Não criar UNIQUE (empresa_id, nsu) em tef_operacoes.
 * A reconciliação só segue quando empresa, rede, NSU, finalização e valor
 * apontam para uma única operação. Terminal entra quando foi informado.
 */
export function casarTransacaoTef(
  candidatos: TransacaoTefIdentificavel[],
  pedido: Omit<TransacaoTefIdentificavel, "id">
) {
  if (!texto(pedido.nsu) || !texto(pedido.rede) || !texto(pedido.finalizacao)) {
    return { resultado: "insuficiente" as const };
  }
  if (!Number.isInteger(pedido.valorCentavos) || pedido.valorCentavos <= 0) {
    return { resultado: "insuficiente" as const };
  }

  const compativeis = candidatos.filter((item) => {
    if (item.empresaId !== pedido.empresaId) {
      return false;
    }
    if (texto(item.nsu) !== texto(pedido.nsu)) {
      return false;
    }
    if (texto(item.rede) !== texto(pedido.rede)) {
      return false;
    }
    if (texto(item.finalizacao) !== texto(pedido.finalizacao)) {
      return false;
    }
    if (item.valorCentavos !== pedido.valorCentavos) {
      return false;
    }
    if (pedido.terminalId && item.terminalId !== pedido.terminalId) {
      return false;
    }
    if (texto(pedido.autorizacao) && texto(item.autorizacao) !== texto(pedido.autorizacao)) {
      return false;
    }
    return true;
  });

  if (compativeis.length === 1) {
    return { resultado: "unica" as const, operacao: compativeis[0] };
  }
  if (compativeis.length === 0) {
    return { resultado: "nao_encontrada" as const };
  }
  return { resultado: "ambigua" as const, quantidade: compativeis.length };
}
