import { classificarFormaTef, type FormaTef } from "@/lib/pdv/tef/regras";

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

export function mensagemCobrancaNaoConcluida(mensagemHost: string) {
  const texto = mensagemHost.replace(/\s+/g, " ").trim();
  const base = texto || "A captura não concluiu.";
  if (base.includes(MENSAGEM_TEF_FALHA_SEM_FALLBACK)) return base;
  return `${base} ${MENSAGEM_TEF_FALHA_SEM_FALLBACK}`;
}

export const MENSAGEM_CONSULTA_TEF_FALHOU =
  "Não foi possível consultar o TEF. O cartão não foi registrado.";

export const MENSAGEM_CARTAO_NO_PINPAD =
  "Cartão de débito e crédito será cobrado no pinpad deste computador.";

export const MENSAGEM_SIMULACAO_TEF =
  "Simulação TEF. O PinPad e o PayGo não foram acionados. Nenhuma cobrança foi feita, a venda não foi finalizada e nenhum pagamento foi registrado.";

export const MENSAGEM_HABILITAR_TEF =
  "Débito e crédito estão vinculados ao TEF. O TEF desta empresa está desligado. Em Configurações, Financeiro, TEF, marque Habilitar TEF e salve. A venda não foi registrada como pagamento comum.";

const ROTULOS_CONSULTA_HOMOLOGACAO: Record<string, string> = {
  leitura: "Falha de leitura",
  autenticacao: "Falha de autenticação",
  comunicacao: "Falha de comunicação",
  pendencia: "Pendência",
  recuperar: "Pendência",
  bloqueio_seguranca: "Bloqueio de homologação",
  perfil: "Ambiente",
};

export function mensagemConsultaHomologacao(acao: string, mensagem: string) {
  const textoMensagem = mensagem.trim();
  const rotulo = ROTULOS_CONSULTA_HOMOLOGACAO[acao] ?? "";
  if (!rotulo) return textoMensagem;
  if (textoMensagem.startsWith(`${rotulo}:`)) return textoMensagem;
  return textoMensagem ? `${rotulo}: ${textoMensagem}` : `${rotulo}.`;
}

export type PoliticaCartaoTef = {
  plataformaHabilitada: boolean;
  empresaHabilitada: boolean;
  permitirOperacaoManual: boolean;
  ambiente?: "" | "homologacao" | "producao";
};

export type ParcelaCartaoCheckout = {
  modalidade: "debito" | "credito" | "pix" | null;
  tefOperacaoId?: string | null;
  operacaoManual?: boolean;
};

export function tefOperacional(politica: PoliticaCartaoTef) {
  return politica.plataformaHabilitada && politica.empresaHabilitada;
}

export function mensagemPainelCartao(politica: PoliticaCartaoTef) {
  if (!politica.empresaHabilitada) {
    if (politica.ambiente === "homologacao" || politica.ambiente === "producao") {
      return MENSAGEM_HABILITAR_TEF;
    }
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
      if (parcela.tefOperacaoId || parcela.modalidade) {
        if (politica.ambiente === "homologacao" || politica.ambiente === "producao") {
          return { ok: false, erro: MENSAGEM_HABILITAR_TEF };
        }
      }
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

export function cartaoVinculadoSemHabilitacao(input: {
  ambiente: string;
  empresaHabilitada: boolean;
  formas: FormaTef[];
}) {
  const ambienteDefinido = input.ambiente === "homologacao" || input.ambiente === "producao";
  return (
    ambienteDefinido &&
    !input.empresaHabilitada &&
    input.formas.some((forma) => classificarFormaTef(forma) != null)
  );
}

export function motivoBloqueioTef(input: {
  habilitado: boolean;
  ambiente: string;
  cobrancaRealBloqueada: boolean;
}) {
  if (!input.habilitado && (input.ambiente === "homologacao" || input.ambiente === "producao")) {
    return "O TEF está desligado. Débito e crédito vinculados não podem ser recebidos até marcar Habilitar TEF e salvar em Configurações, Financeiro, TEF.";
  }
  if (input.habilitado && input.cobrancaRealBloqueada && input.ambiente === "homologacao") {
    return "O TEF está habilitado em Homologação. PWOPER_SALE não é enviado enquanto ABI_COMPROVADO e LAYOUT_HOMOLOGADO não tiverem evidência de venda na DLL.";
  }
  if (input.habilitado && input.cobrancaRealBloqueada) {
    return "A cobrança TEF real permanece bloqueada até a homologação do layout da PGWebLib.";
  }
  return "";
}

export function selecionarParcelasTef<T extends { modalidade: "debito" | "credito" | "pix" | null }>(input: {
  parcelas: T[];
  cobrarNoPinpad: boolean;
  tefHabilitado: boolean;
  ambiente: string;
  cobrancaRealBloqueada: boolean;
}) {
  const cartao = input.parcelas.filter(
    (parcela) => parcela.modalidade === "debito" || parcela.modalidade === "credito" || parcela.modalidade === "pix"
  );
  if (!input.cobrarNoPinpad || !input.tefHabilitado) {
    return { simular: false, prepararNativo: false, parcelas: [] as T[] };
  }
  const prepararNativo =
    input.ambiente === "homologacao" && input.cobrancaRealBloqueada && cartao.length > 0;
  return { simular: false, prepararNativo, parcelas: cartao };
}
