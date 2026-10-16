export const STATUS_TEF = [
  "iniciada",
  "autorizada",
  "recusada",
  "cancelada",
  "timeout",
  "desconhecida",
  "vinculada",
  "confirmada",
  "desfeita",
  "desfazimento_pendente",
  "reconciliacao",
] as const;

export type StatusTef = (typeof STATUS_TEF)[number];

export const STATUS_TEF_ABERTOS: readonly StatusTef[] = [
  "iniciada",
  "autorizada",
  "vinculada",
  "desconhecida",
  "desfazimento_pendente",
  "reconciliacao",
];

export type ModalidadeTef = "debito" | "credito";

export type FormaTef = {
  codigo?: string | null;
  nome?: string | null;
  tipo?: string | null;
  codigo_fiscal?: string | null;
  permite_fiado?: boolean | null;
};

const CHAVES_SENSIVEIS =
  /pan|pin|senha|cvv|cvc|trilha|track|numero.?cartao|cartao.?numero|validade|emv|chip|private.?key|chave.?privada|certificado|csc|segredo|secret|authorization|bearer/i;

export function classificarFormaTef(forma: FormaTef | null | undefined): ModalidadeTef | null {
  if (!forma || forma.permite_fiado === true) {
    return null;
  }
  const chave = `${forma.codigo ?? ""} ${forma.tipo ?? ""} ${forma.nome ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (
    chave.includes("pix") ||
    chave.includes("dinheiro") ||
    chave.includes("fiado") ||
    chave.includes("vale")
  ) {
    return null;
  }
  const fiscal = String(forma.codigo_fiscal ?? "").trim();
  const debito = chave.includes("debito") || fiscal === "04" || fiscal === "4";
  const credito = chave.includes("credito") || fiscal === "03" || fiscal === "3";
  if (debito && credito) {
    return null;
  }
  if (debito) {
    return "debito";
  }
  if (credito) {
    return "credito";
  }
  return null;
}

export function sanitizarParaLog(valor: unknown): unknown {
  if (Array.isArray(valor)) {
    return valor.map((item) => sanitizarParaLog(item));
  }
  if (!valor || typeof valor !== "object") {
    return valor;
  }
  const saida: Record<string, unknown> = {};
  for (const [chave, item] of Object.entries(valor)) {
    if (CHAVES_SENSIVEIS.test(chave)) {
      continue;
    }
    saida[chave] = sanitizarParaLog(item);
  }
  return saida;
}

export type ResultadoConectorTef = {
  sucessoTransacao?: boolean;
  nsu?: string | null;
  autorizacao?: string | null;
  codigoAutorizacao?: string | null;
  rede?: string | null;
  finalizacao?: string | null;
  codigoFinalizacao?: string | null;
  valor?: number | null;
  confirmar?: boolean;
  precisaConfirmacao?: boolean;
  transacaoPendenteConfirmacao?: boolean;
  cancelada?: boolean;
  canceladoOperador?: boolean;
  codigo?: string | null;
  teste?: boolean;
  nomeBandeiraPadrao?: string | null;
  nomeCartao?: string | null;
  bandeira?: string | null;
  cnpjCredenciadora?: string | null;
  cnpjRecebedor?: string | null;
  instituicao?: string | null;
  tipoCartao?: number | null;
};

export type InterpretacaoTef = {
  status: StatusTef;
  nsu: string | null;
  autorizacao: string | null;
  rede: string | null;
  finalizacao: string | null;
  teste: boolean;
};

function texto(valor: unknown) {
  return typeof valor === "string" ? valor.trim() : "";
}

function contemPix(valor: string | null | undefined) {
  const normal = texto(valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /(^|[^a-z0-9])pix([^a-z0-9]|$)/.test(normal);
}

/** PIX PayGo identifica a rede no retorno. O código de autorização não é fabricado. */
export function resultadoPixPayGo(resultado: ResultadoConectorTef | null | undefined) {
  return (
    contemPix(resultado?.rede) ||
    contemPix(resultado?.instituicao) ||
    contemPix(resultado?.nomeBandeiraPadrao)
  );
}

export function interpretarResultadoConector(
  resultado: ResultadoConectorTef | null | undefined,
  esperado: { valorCentavos: number; identificador: string },
  provaValida = false
): InterpretacaoTef {
  const teste =
    resultado?.teste === true || /^teste/i.test(esperado.identificador);
  const nsu = texto(resultado?.nsu) || null;
  const autorizacao =
    texto(resultado?.autorizacao) || texto(resultado?.codigoAutorizacao) || null;
  const rede = texto(resultado?.rede) || null;
  const finalizacao =
    texto(resultado?.finalizacao) || texto(resultado?.codigoFinalizacao) || null;
  const base = { nsu, autorizacao, rede, finalizacao, teste };

  if (resultado?.codigo === "TEF_TIMEOUT") {
    return { ...base, status: provaValida ? "timeout" : "desconhecida" };
  }
  if (resultado?.cancelada === true || resultado?.canceladoOperador === true) {
    return { ...base, status: provaValida ? "cancelada" : "desconhecida" };
  }
  if (
    !resultado ||
    (resultado.sucessoTransacao !== true && resultado.sucessoTransacao !== false)
  ) {
    return { ...base, status: "desconhecida" };
  }
  if (resultado.sucessoTransacao === false) {
    return { ...base, status: provaValida ? "recusada" : "desconhecida" };
  }

  const centavos = Number.isFinite(Number(resultado.valor))
    ? Math.round(Number(resultado.valor) * 100)
    : null;
  const precisa =
    resultado.confirmar === true ||
    resultado.precisaConfirmacao === true ||
    resultado.transacaoPendenteConfirmacao === true;
  const autorizacaoObrigatoria = !resultadoPixPayGo(resultado);
  if (
    !nsu ||
    !rede ||
    !finalizacao ||
    !precisa ||
    (autorizacaoObrigatoria && !autorizacao) ||
    centavos !== esperado.valorCentavos ||
    provaValida !== true
  ) {
    return { ...base, status: "desconhecida" };
  }
  return { ...base, status: "autorizada" };
}

export function aplicarRespostaMenu(
  menuAtual: { solicitacaoId: string; opcoes: string[] } | null,
  resposta: { solicitacaoId?: string; indice?: number }
) {
  if (!menuAtual) {
    return { aplicar: false as const, motivo: "sem_menu" };
  }
  if (!resposta.solicitacaoId || resposta.solicitacaoId !== menuAtual.solicitacaoId) {
    return { aplicar: false as const, motivo: "menu_substituido" };
  }
  if (
    !Number.isInteger(resposta.indice) ||
    Number(resposta.indice) < 0 ||
    Number(resposta.indice) >= menuAtual.opcoes.length
  ) {
    return { aplicar: false as const, motivo: "indice" };
  }
  return { aplicar: true as const };
}

export type ParcelaPagamentoTef = {
  modalidade: ModalidadeTef | null;
  valorCentavos: number;
  tefOperacaoId?: string | null;
  permiteTroco?: boolean;
  usuarioId?: string;
  segredoVinculoHash?: string;
};

export type ProvaTef = {
  id: string;
  empresaId: string;
  modalidade: ModalidadeTef;
  valorCentavos: number;
  status: StatusTef;
  vendaId: string | null;
  teste: boolean;
  nsu: string | null;
  autorizacao: string | null;
  rede?: string | null;
  instituicao?: string | null;
  nomeBandeiraPadrao?: string | null;
  usuarioId?: string;
  segredoVinculoHash?: string;
  terminalId?: string;
  ambienteEfetivo?: string | null;
};

export function validarPagamentoMisto(
  parcelas: ParcelaPagamentoTef[],
  operacoes: ProvaTef[],
  empresaId: string
) {
  const usados = new Set<string>();
  for (const parcela of parcelas) {
    if (!parcela.modalidade) {
      if (parcela.tefOperacaoId) {
        return {
          ok: false as const,
          erro: "Somente débito ou crédito usam identificação TEF.",
        };
      }
      continue;
    }
    if (parcela.permiteTroco) {
      return {
        ok: false as const,
        erro: "Cartão TEF não permite troco.",
      };
    }
    const operacao = operacoes.find((item) => item.id === parcela.tefOperacaoId);
    if (
      !operacao ||
      operacao.empresaId !== empresaId ||
      usados.has(operacao.id)
    ) {
      return {
        ok: false as const,
        erro: "Pagamento com cartão sem TEF autorizado.",
      };
    }
    usados.add(operacao.id);
    if (operacao.teste || operacao.status !== "autorizada" || operacao.vendaId) {
      return {
        ok: false as const,
        erro: "Pagamento com cartão sem TEF autorizado.",
      };
    }
    if (
      (operacao.usuarioId && operacao.usuarioId !== parcela.usuarioId) ||
      (operacao.segredoVinculoHash &&
        operacao.segredoVinculoHash !== parcela.segredoVinculoHash)
    ) {
      return {
        ok: false as const,
        erro: "Esta autorização TEF pertence a outro caixa.",
      };
    }
    const pix = resultadoPixPayGo({
      rede: operacao.rede,
      instituicao: operacao.instituicao,
      nomeBandeiraPadrao: operacao.nomeBandeiraPadrao,
    });
    if (
      operacao.modalidade !== parcela.modalidade ||
      operacao.valorCentavos !== parcela.valorCentavos ||
      !operacao.nsu ||
      (!pix && !operacao.autorizacao)
    ) {
      return {
        ok: false as const,
        erro: "O TEF autorizado não confere com o pagamento.",
      };
    }
    if (operacao.ambienteEfetivo !== "producao") {
      return {
        ok: false as const,
        erro: "Pagamento com cartão sem comprovação de produção do TEF.",
      };
    }
  }
  return { ok: true as const, operacaoIds: [...usados] };
}

export function decidirRecuperacao(input: {
  empresaId: string;
  operacao: {
    empresaId: string;
    status: StatusTef;
    vendaId: string | null;
    teste: boolean;
    nsu?: string | null;
    rede?: string | null;
    finalizacao?: string | null;
  } | null;
  existeVenda: boolean;
}) {
  const operacao = input.operacao;
  if (!operacao || operacao.empresaId !== input.empresaId) {
    return { acao: "negar" as const, confirmar: false, cobrarDeNovo: false };
  }
  if (operacao.status === "desconhecida" || operacao.status === "reconciliacao") {
    const identificada =
      operacao.status === "desconhecida" &&
      !operacao.vendaId &&
      !input.existeVenda &&
      Boolean(texto(operacao.rede) && texto(operacao.nsu) && texto(operacao.finalizacao));
    if (identificada) {
      return { acao: "desfazer" as const, confirmar: false, cobrarDeNovo: false };
    }
    return { acao: "reconciliar" as const, confirmar: false, cobrarDeNovo: false };
  }
  if (operacao.teste) {
    return { acao: "desfazer" as const, confirmar: false, cobrarDeNovo: false };
  }
  if (operacao.status === "vinculada" && operacao.vendaId && input.existeVenda) {
    return { acao: "confirmar" as const, confirmar: true, cobrarDeNovo: false };
  }
  if (operacao.status === "autorizada" && input.existeVenda && !operacao.vendaId) {
    return { acao: "vincular" as const, confirmar: false, cobrarDeNovo: false };
  }
  if (operacao.status === "autorizada" && !operacao.vendaId && !input.existeVenda) {
    return { acao: "desfazer" as const, confirmar: false, cobrarDeNovo: false };
  }
  if (
    operacao.status === "timeout" ||
    operacao.status === "recusada" ||
    operacao.status === "cancelada" ||
    operacao.status === "desfeita"
  ) {
    return { acao: "encerrada" as const, confirmar: false, cobrarDeNovo: true };
  }
  return { acao: "aguardar" as const, confirmar: false, cobrarDeNovo: false };
}
