export const MENSAGEM_TEF_PLATAFORMA_DESLIGADA =
  "O TEF está indisponível. A plataforma ainda não liberou o uso, então o pinpad não será acionado.";

export const MENSAGEM_CARTAO_MANUAL_BLOQUEADO =
  "Esta empresa está configurada para TEF. A venda não pode ser concluída como cartão manual.";

export const MENSAGEM_CARTAO_MANUAL_EXIGE_ESCOLHA =
  "Confirme a operação manual autorizada por esta empresa para registrar o cartão sem o pinpad. A NFC-e não será emitida sem os dados reais da transação.";

export const MENSAGEM_CARTAO_SEM_AUTORIZACAO_TEF =
  "Pagamento com cartão sem TEF autorizado. A venda não foi registrada como cartão pago.";

export const MENSAGEM_TEF_FALHA_SEM_FALLBACK =
  "A cobrança TEF não foi concluída. A venda não foi registrada como cartão manual.";

export const MENSAGEM_CONSULTA_TEF_FALHOU =
  "Não foi possível consultar o TEF. O cartão não foi registrado.";

export const MENSAGEM_CARTAO_NO_PINPAD =
  "Cartão de débito e crédito será cobrado no pinpad deste computador.";

export type PoliticaCartaoTef = {
  plataformaHabilitada: boolean;
  empresaHabilitada: boolean;
  permitirOperacaoManual: boolean;
};

export type ParcelaCartaoCheckout = {
  modalidade: "debito" | "credito" | null;
  tefOperacaoId?: string | null;
  operacaoManual?: boolean;
};

export function tefOperacional(politica: PoliticaCartaoTef) {
  return politica.plataformaHabilitada && politica.empresaHabilitada;
}

export function mensagemPainelCartao(politica: PoliticaCartaoTef) {
  if (!politica.empresaHabilitada) {
    return null;
  }
  if (!politica.plataformaHabilitada) {
    return politica.permitirOperacaoManual
      ? `${MENSAGEM_TEF_PLATAFORMA_DESLIGADA} Se for registrar cartão, confirme a operação manual autorizada por esta empresa.`
      : `${MENSAGEM_TEF_PLATAFORMA_DESLIGADA} ${MENSAGEM_CARTAO_MANUAL_BLOQUEADO}`;
  }
  return politica.permitirOperacaoManual
    ? `${MENSAGEM_CARTAO_NO_PINPAD} A operação manual só vale se for confirmada nesta venda.`
    : MENSAGEM_CARTAO_NO_PINPAD;
}

export function operacaoManualAceita(
  politica: PoliticaCartaoTef,
  parcela: ParcelaCartaoCheckout
) {
  return Boolean(
    parcela.modalidade &&
      parcela.operacaoManual === true &&
      politica.empresaHabilitada &&
      politica.permitirOperacaoManual &&
      !parcela.tefOperacaoId
  );
}

/**
 * No checkout, a autorização ainda não existe: o pinpad precisa ser chamado antes.
 * Na finalização da venda, a mesma parcela sem operação continua bloqueada.
 */
export function avaliarCartaoAntesDaCobranca(
  politica: PoliticaCartaoTef,
  parcelas: ParcelaCartaoCheckout[]
): { ok: true; cobrarNoPinpad: boolean } | { ok: false; erro: string } {
  const decisao = decidirParcelasCartao(politica, parcelas, "cobranca");
  if (!decisao.ok) {
    return decisao;
  }
  return { ok: true, cobrarNoPinpad: decisao.cobrarNoPinpad };
}

export function avaliarParcelasCartao(
  politica: PoliticaCartaoTef,
  parcelas: ParcelaCartaoCheckout[]
): { ok: true } | { ok: false; erro: string } {
  const decisao = decidirParcelasCartao(politica, parcelas, "finalizacao");
  if (!decisao.ok) {
    return decisao;
  }
  return { ok: true };
}

function decidirParcelasCartao(
  politica: PoliticaCartaoTef,
  parcelas: ParcelaCartaoCheckout[],
  fase: "cobranca" | "finalizacao"
): { ok: true; cobrarNoPinpad: boolean } | { ok: false; erro: string } {
  let cobrarNoPinpad = false;
  for (const parcela of parcelas) {
    if (!parcela.modalidade) {
      if (parcela.tefOperacaoId) {
        return {
          ok: false,
          erro: "Somente débito ou crédito usam identificação TEF.",
        };
      }
      continue;
    }

    if (parcela.tefOperacaoId && parcela.operacaoManual) {
      return {
        ok: false,
        erro: "A operação manual não pode reutilizar uma autorização TEF.",
      };
    }

    if (!politica.empresaHabilitada) {
      if (parcela.tefOperacaoId) {
        return { ok: false, erro: "TEF não está habilitado nesta empresa." };
      }
      continue;
    }

    if (tefOperacional(politica)) {
      if (operacaoManualAceita(politica, parcela)) {
        continue;
      }
      if (!parcela.tefOperacaoId) {
        if (fase === "cobranca" && parcela.operacaoManual !== true) {
          cobrarNoPinpad = true;
          continue;
        }
        return { ok: false, erro: MENSAGEM_CARTAO_SEM_AUTORIZACAO_TEF };
      }
      continue;
    }

    if (parcela.tefOperacaoId) {
      return { ok: false, erro: MENSAGEM_TEF_PLATAFORMA_DESLIGADA };
    }
    if (operacaoManualAceita(politica, parcela)) {
      continue;
    }
    if (politica.permitirOperacaoManual) {
      return {
        ok: false,
        erro: `${MENSAGEM_TEF_PLATAFORMA_DESLIGADA}\n${MENSAGEM_CARTAO_MANUAL_EXIGE_ESCOLHA}`,
      };
    }
    return {
      ok: false,
      erro: `${MENSAGEM_TEF_PLATAFORMA_DESLIGADA}\n${MENSAGEM_CARTAO_MANUAL_BLOQUEADO}`,
    };
  }

  return { ok: true, cobrarNoPinpad };
}

/**
 * Repete só o que a operação TEF realmente guardou.
 * Bandeira, CNPJ da credenciadora e CNPJ do recebedor não são inventados.
 */
export function camposFiscaisDaTransacaoTef(
  operacao: {
    nsu?: string | null;
    autorizacao?: string | null;
    rede?: string | null;
  } | null
  | undefined
) {
  const autorizacao = String(operacao?.autorizacao ?? "").trim();
  const nsu = String(operacao?.nsu ?? "").trim();
  return {
    tipo_integracao: null as string | null,
    cnpj_credenciadora: null as string | null,
    bandeira: null as string | null,
    autorizacao: autorizacao || null,
    nsu: nsu || null,
    cnpj_receb: null as string | null,
  };
}
