import { STATUS_JOURNAL_TEF } from "./tef-pendencia.mjs";
import { ABI_COMPROVADO, LAYOUT_HOMOLOGADO } from "./tef-pgweb.mjs";

const ABERTOS = new Set([
  "iniciada",
  "autorizada",
  "vinculada",
  "desconhecida",
  "desfazimento_pendente",
  "reconciliacao",
  "aguardando_confirmacao",
  "aguardando_captura",
]);

const JOURNAL_PENDENTE = new Set([
  STATUS_JOURNAL_TEF.PAGAMENTO_EM_ANDAMENTO,
  STATUS_JOURNAL_TEF.AGUARDANDO_DECISAO,
  STATUS_JOURNAL_TEF.RESULTADO_DESCONHECIDO,
  "aguardando_confirmacao",
  "aguardando_captura",
]);

export function diretorioHomologacaoExclusivo(diretorio) {
  const normal = String(diretorio ?? "").replaceAll("/", "\\").toLowerCase();
  if (!normal.includes("\\homologacao\\") || normal.includes("\\producao\\") || normal.includes("\\paygo\\")) {
    return "";
  }
  return String(diretorio);
}

function recusa(acao, mensagem) {
  return {
    ok: false,
    enviarComando: false,
    acao,
    mensagem,
    chamadas: [],
    pagamentoRecebido: false,
    podeFinalizar: false,
  };
}

export function prepararVendaHomologacao(input = {}) {
  if (input.ambiente === "producao" || !diretorioHomologacaoExclusivo(input.diretorio)) {
    return recusa(
      "perfil",
      "Somente o diretório de homologação pode preparar a venda. O perfil de produção não foi usado e nenhum comando foi enviado."
    );
  }
  const journal = input.journal;
  if (journal?.status === "sessao_tecnica_perdida_antes_da_captura" || journal?.status === "sessao_nativa_perdida_sem_autorizacao") {
    if (journal.serverPndValor !== "0" || journal.autorizacaoFinanceira === true || journal.retomavel === true) {
      return recusa("recuperar", "A sessão perdida não está encerrada com SERVERPND 0. Nenhum comando foi enviado.");
    }
    if (journal.correlationId && journal.correlationId === input.idempotencyKey) {
      return recusa("repetida", "A sessão nativa perdida foi encerrada. A mesma chave não foi reenviada.");
    }
  }
  if (journal?.status === "sessao_tecnica_incompleta") {
    if (journal.serverPndValor !== "0") {
      return recusa("recuperar", "A pendência remota continua bloqueando. Nenhum comando foi enviado.");
    }
    if (journal.correlationId && journal.correlationId === input.idempotencyKey) {
      return recusa("repetida", "Esta sessão técnica já foi encerrada. A mesma chave não foi reenviada.");
    }
  }
  if (journal && JOURNAL_PENDENTE.has(journal.status)) {
    return recusa(
      "recuperar",
      "Há transação no journal deste terminal. Recupere antes de cobrar. Nenhum comando financeiro foi enviado."
    );
  }
  const sessoes = Array.isArray(input.sessoes) ? input.sessoes : [];
  const outra = sessoes.find(
    (item) =>
      item?.empresaId === input.empresaId &&
      item?.terminalCodigo === input.terminalCodigo &&
      ABERTOS.has(item?.status) &&
      item?.idempotencyKey !== input.idempotencyKey
  );
  if (outra) {
    return recusa("duplicada", "Há outra operação neste terminal. Nenhuma cobrança foi iniciada.");
  }
  const mesma = sessoes.find(
    (item) =>
      item?.empresaId === input.empresaId &&
      item?.idempotencyKey === input.idempotencyKey &&
      ABERTOS.has(item?.status)
  );
  if (mesma) {
    return recusa("repetida", "Esta cobrança já está registrada. O comando não foi repetido.");
  }
  if (ABI_COMPROVADO !== true || LAYOUT_HOMOLOGADO !== true) {
    return recusa(
      "bloqueio_seguranca",
      "PWOPER_SALE não foi enviado. ABI_COMPROVADO e LAYOUT_HOMOLOGADO continuam sem evidência de venda na DLL."
    );
  }
  return {
    ok: true,
    enviarComando: true,
    acao: "pronto",
    mensagem: "A pré-validação passou. PW_iNewTransac ainda não foi chamado.",
    chamadas: [],
    pagamentoRecebido: false,
    podeFinalizar: false,
  };
}

export async function executarVendaHomologacao(preparo, transporte) {
  if (!preparo?.enviarComando) {
    return preparo ?? recusa("ausente", "Não há venda preparada. Nenhum comando foi enviado.");
  }
  if (transporte && typeof transporte === "object") {
    return recusa(
      "nao_enviado",
      "A pré-validação passou, mas PW_iNewTransac não foi chamado nesta etapa."
    );
  }
  return recusa("nao_enviado", "PW_iNewTransac não foi chamado nesta etapa.");
}
