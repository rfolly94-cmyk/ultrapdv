import { cnpjCredenciadoraPayGo } from "@/lib/fiscal/tef/credenciadoras-paygo";
import type { DecisaoAmbientePagamento } from "@/lib/pdv/tef/ambiente-transacao";
import { dadosFiscaisProvaTef } from "@/lib/pdv/tef/prova";
import {
  decidirModalidadeOficial,
  MENSAGEM_MODALIDADE_INDETERMINADA,
} from "@/lib/pdv/tef/modalidade-efetiva";
import {
  classificarPendenciaTef,
  decidirRecuperacao,
  interpretarResultadoConector,
  resultadoPixPayGo,
  STATUS_TEF_ABERTOS,
  type ModalidadeTef,
  type ResultadoConectorTef,
  type StatusTef,
} from "./regras";

export type OperacaoTef = {
  id: string;
  empresaId: string;
  terminalId: string;
  identificador: string;
  idempotencyKey: string;
  modalidade: ModalidadeTef;
  modalidadeSolicitada?: ModalidadeTef | null;
  modalidadeEfetiva?: ModalidadeTef | null;
  tipoCartaoPayGo?: number | null;
  valorCentavos: number;
  status: StatusTef;
  nsu: string | null;
  autorizacao: string | null;
  rede: string | null;
  finalizacao: string | null;
  vendaId: string | null;
  teste: boolean;
  desafio: string;
  usuarioId: string;
  segredoVinculoHash: string;
  vendaIdempotencyKey: string;
  bandeiraNome?: string | null;
  cnpjCredenciadora?: string | null;
  cnpjRecebedor?: string | null;
  instituicao?: string | null;
  ambienteEfetivo?: "producao" | "homologacao" | "desconhecido" | "";
  pontoEfetivo?: string;
  hostEfetivo?: string;
  comprovanteSha256?: string;
  motivoAmbiente?: string;
};

export type TerminalTef = {
  id: string;
  empresaId: string;
  codigo: string;
  dispositivoId: string;
  ativo: boolean;
  chavePublica: string;
  estabelecimento: string;
  pontoCaptura: string;
  revogadaEm: string | null;
};

export type VendaTef = {
  id: string;
  empresaId: string;
  idempotencyKey: string;
};

export type MemoriaTef = {
  plataformaHabilitada: boolean;
  configuracoes: Record<
    string,
    {
      habilitado: boolean;
      ambiente: "homologacao" | "producao";
      estabelecimento: string;
      pontoCaptura: string;
    }
  >;
  terminais: TerminalTef[];
  operacoes: OperacaoTef[];
  vendas: VendaTef[];
  sequencia: number;
  criarId?: () => string;
};

export function memoriaTefVazia(): MemoriaTef {
  return {
    plataformaHabilitada: false,
    configuracoes: {},
    terminais: [],
    operacoes: [],
    vendas: [],
    sequencia: 1,
  };
}

function proximoId(memoria: MemoriaTef, prefixo: string) {
  if (memoria.criarId) {
    return memoria.criarId();
  }
  const id = `${prefixo}-${memoria.sequencia}`;
  memoria.sequencia += 1;
  return id;
}

function copiaOperacao(operacao: OperacaoTef): OperacaoTef {
  return { ...operacao };
}

export function operacoesParaGravar(
  antes: OperacaoTef[],
  depois: OperacaoTef[],
  empresaId: string
) {
  const origem = new Map(
    antes.filter((item) => item.empresaId === empresaId).map((item) => [item.id, item])
  );
  return depois
    .filter((item) => item.empresaId === empresaId)
    .filter((item) => {
      const anterior = origem.get(item.id);
      return !anterior || JSON.stringify(anterior) !== JSON.stringify(item);
    })
    .map(copiaOperacao);
}

function erro(codigo: string, mensagem: string) {
  return { ok: false as const, codigo, erro: mensagem };
}

function acharDaEmpresa(memoria: MemoriaTef, empresaId: string, operacaoId: string) {
  return (
    memoria.operacoes.find(
      (item) => item.id === operacaoId && item.empresaId === empresaId
    ) ?? null
  );
}

function publica(operacao: OperacaoTef) {
  return {
    operacaoId: operacao.id,
    identificador: operacao.identificador,
    valorCentavos: operacao.valorCentavos,
    valor: operacao.valorCentavos / 100,
    modalidade: operacao.modalidade,
    modalidadeSolicitada: operacao.modalidadeSolicitada ?? operacao.modalidade,
    modalidadeEfetiva: operacao.modalidadeEfetiva ?? null,
    avisoModalidade:
      operacao.modalidadeEfetiva &&
      operacao.modalidadeEfetiva !== (operacao.modalidadeSolicitada ?? operacao.modalidade)
        ? operacao.modalidadeEfetiva === "credito"
          ? "Pagamento aprovado no crédito"
          : "Pagamento aprovado no débito"
        : "",
    status: operacao.status,
    terminalId: operacao.terminalId,
    teste: operacao.teste,
    diagnostico: operacao.motivoAmbiente || "",
    proibirDesfazimento: operacao.status === "reconciliacao" || operacao.teste === true,
    jaAutorizada: operacao.status === "autorizada" || operacao.status === "vinculada",
  };
}

function respostaOperacao(operacao: OperacaoTef, repetida: boolean) {
  return { ok: true as const, repetida, ...publica(operacao) };
}

function bloqueioAmbienteReceita(operacao: OperacaoTef) {
  if (operacao.ambienteEfetivo === "producao" && !operacao.teste) {
    return null;
  }
  if (operacao.teste || operacao.ambienteEfetivo === "homologacao") {
    return "Esta transação é de homologação e não pode compor uma venda nem uma NFC-e de produção.";
  }
  return "Esta transação TEF não foi comprovada como produção. A venda não foi finalizada. Abra Configurações, Financeiro, TEF para o diagnóstico.";
}

export function salvarConfigEmpresa(
  memoria: MemoriaTef,
  empresaId: string,
  config: MemoriaTef["configuracoes"][string]
) {
  memoria.configuracoes[empresaId] = { ...config };
  return { ok: true as const };
}

export function vincularTerminal(
  memoria: MemoriaTef,
  input: {
    empresaId: string;
    dispositivoId: string;
    codigo: string;
    chavePublica?: string;
    estabelecimento?: string;
    pontoCaptura?: string;
  }
) {
  const ativoDeOutra = memoria.terminais.find(
    (item) =>
      item.ativo &&
      item.dispositivoId === input.dispositivoId &&
      item.empresaId !== input.empresaId
  );
  if (ativoDeOutra) {
    return erro(
      "TERMINAL_OUTRA_EMPRESA",
      "Este terminal já está vinculado a outra empresa."
    );
  }
  const proprio = memoria.terminais.find(
    (item) =>
      item.dispositivoId === input.dispositivoId && item.empresaId === input.empresaId
  );
  if (proprio) {
    if (
      input.chavePublica &&
      proprio.chavePublica &&
      proprio.chavePublica !== input.chavePublica
    ) {
      return erro(
        "TERMINAL_OUTRA_EMPRESA",
        "A chave deste terminal não confere com o cadastro."
      );
    }
    proprio.ativo = true;
    proprio.codigo = input.codigo;
    if (input.chavePublica) {
      proprio.chavePublica = input.chavePublica;
    }
    if (
      input.estabelecimento &&
      proprio.estabelecimento &&
      input.estabelecimento !== proprio.estabelecimento
    ) {
      return erro(
        "ESTABELECIMENTO_DIVERGENTE",
        "O estabelecimento PayGo deste terminal não confere com a empresa."
      );
    }
    if (input.estabelecimento) {
      proprio.estabelecimento = input.estabelecimento;
    }
    if (input.pontoCaptura) {
      proprio.pontoCaptura = input.pontoCaptura;
    }
    return { ok: true as const, terminal: proprio };
  }
  const terminal: TerminalTef = {
    id: proximoId(memoria, "terminal"),
    empresaId: input.empresaId,
    codigo: input.codigo,
    dispositivoId: input.dispositivoId,
    ativo: true,
    chavePublica: input.chavePublica ?? "",
    estabelecimento: input.estabelecimento ?? "",
    pontoCaptura: input.pontoCaptura ?? "",
    revogadaEm: null,
  };
  memoria.terminais.push(terminal);
  return { ok: true as const, terminal };
}

export function iniciarOperacao(
  memoria: MemoriaTef,
  pedido: {
    empresaId: string;
    dispositivoId: string;
    terminalCodigo: string;
    modalidade: ModalidadeTef;
    valorCentavos: number;
    identificador: string;
    idempotencyKey: string;
    teste?: boolean;
    usuarioId?: string;
    desafio?: string;
    segredoVinculoHash?: string;
    vinculoSegredo?: string;
    chavePublica?: string;
    estabelecimento?: string;
    pontoCaptura?: string;
    exigirTerminalPareado?: boolean;
    grupoVenda?: string;
  }
) {
  if (!memoria.plataformaHabilitada) {
    return erro("TEF_DESABILITADO", "TEF não está habilitado na plataforma.");
  }
  const config = memoria.configuracoes[pedido.empresaId];
  if (!config?.habilitado) {
    return erro("TEF_DESABILITADO", "TEF não está habilitado nesta empresa.");
  }
  if (!Number.isInteger(pedido.valorCentavos) || pedido.valorCentavos <= 0) {
    return erro("DADOS_INVALIDOS", "Valor do pagamento deve ser maior que zero.");
  }
  if (pedido.exigirTerminalPareado) {
    const pareado = memoria.terminais.find(
      (item) =>
        item.ativo &&
        item.dispositivoId === pedido.dispositivoId &&
        item.empresaId === pedido.empresaId &&
        !item.revogadaEm
    );
    if (!pareado) {
      return erro(
        "TERMINAL_NAO_PAREADO",
        "Este computador ainda não foi autorizado pelo estabelecimento."
      );
    }
  }
  const terminal = vincularTerminal(memoria, {
    empresaId: pedido.empresaId,
    dispositivoId: pedido.dispositivoId,
    codigo: pedido.terminalCodigo,
    chavePublica: pedido.chavePublica,
    estabelecimento: pedido.estabelecimento,
    pontoCaptura: pedido.pontoCaptura,
  });
  if (!terminal.ok) {
    return terminal;
  }

  const existente = memoria.operacoes.find(
    (item) =>
      item.empresaId === pedido.empresaId &&
      item.idempotencyKey === pedido.idempotencyKey
  );
  if (existente) {
    if (
      existente.status === "desconhecida" ||
      existente.status === "reconciliacao" ||
      existente.status === "desfazimento_pendente"
    ) {
      return erro(
        "RECONCILIACAO",
        "Existe transação TEF pendente de reconciliação. Não inicie outra cobrança."
      );
    }
    if (!STATUS_TEF_ABERTOS.includes(existente.status)) {
      return erro(
        "IDEMPOTENCIA",
        "Esta tentativa de TEF já foi encerrada. Inicie outra cobrança."
      );
    }
    return {
      ok: true as const,
      repetida: true,
      recuperada: true,
      parear: true,
      emAndamento: existente.status === "iniciada",
      cobrarDeNovo: false,
      terminalCodigo: terminal.terminal.codigo,
      desafio: "",
      vinculoSegredo: "",
      ...publica(existente),
    };
  }

  const aberta = memoria.operacoes.find((item) => {
    if (item.empresaId !== pedido.empresaId) {
      return false;
    }
    const mesmoTerminal = item.terminalId === terminal.terminal.id;
    const mesmoGrupo =
      Boolean(pedido.grupoVenda) && item.vendaIdempotencyKey === pedido.grupoVenda;
    if (!mesmoTerminal && !mesmoGrupo) {
      return false;
    }
    return (
      item.status === "iniciada" ||
      item.status === "autorizada" ||
      item.status === "vinculada" ||
      item.status === "desconhecida" ||
      item.status === "desfazimento_pendente" ||
      item.status === "reconciliacao"
    );
  });
  if (aberta) {
    const mesmoGrupo =
      Boolean(pedido.grupoVenda) && aberta.vendaIdempotencyKey === pedido.grupoVenda;
    if (mesmoGrupo) {
      return {
        ok: true as const,
        repetida: true,
        recuperada: true,
        parear: false,
        emAndamento: aberta.status === "iniciada",
        cobrarDeNovo: false,
        terminalCodigo: terminal.terminal.codigo,
        desafio: "",
        vinculoSegredo: "",
        ...publica(aberta),
      };
    }
    return erro(
      "TERMINAL_OCUPADO",
      "Este terminal TEF já está em uma operação."
    );
  }

  const operacao: OperacaoTef = {
    id: proximoId(memoria, "op"),
    empresaId: pedido.empresaId,
    terminalId: terminal.terminal.id,
    identificador: pedido.identificador,
    idempotencyKey: pedido.idempotencyKey,
    modalidade: pedido.modalidade,
    modalidadeSolicitada: pedido.modalidade,
    modalidadeEfetiva: null,
    tipoCartaoPayGo: null,
    valorCentavos: pedido.valorCentavos,
    status: "iniciada",
    nsu: null,
    autorizacao: null,
    rede: null,
    finalizacao: null,
    vendaId: null,
    teste: pedido.teste === true || /^teste/i.test(pedido.identificador),
    desafio: pedido.desafio ?? "",
    usuarioId: pedido.usuarioId ?? "",
    segredoVinculoHash: pedido.segredoVinculoHash ?? "",
    vendaIdempotencyKey: pedido.grupoVenda ?? "",
  };
  memoria.operacoes.push(operacao);
  return {
    ok: true as const,
    repetida: false,
    recuperada: false,
    parear: true,
    emAndamento: false,
    cobrarDeNovo: true,
    terminalCodigo: terminal.terminal.codigo,
    desafio: operacao.desafio,
    vinculoSegredo: pedido.vinculoSegredo ?? "",
    ...publica(operacao),
  };
}

export function registrarResultado(
  memoria: MemoriaTef,
  input: {
    empresaId: string;
    operacaoId: string;
    resultado: ResultadoConectorTef | null;
    provaValida?: boolean;
    origem?: DecisaoAmbientePagamento;
    modalidadeOficial?: {
      provaValida: boolean;
      tipoCartao: unknown;
    };
  }
) {
  const operacao = acharDaEmpresa(memoria, input.empresaId, input.operacaoId);
  if (!operacao) {
    return erro("NAO_ENCONTRADA", "Operação TEF não encontrada.");
  }
  if (operacao.status !== "iniciada") {
    return respostaOperacao(operacao, true);
  }
  const provaValida = input.provaValida === true;
  const interpretado = interpretarResultadoConector(
    input.resultado,
    {
      valorCentavos: operacao.valorCentavos,
      identificador: operacao.identificador,
    },
    provaValida
  );
  operacao.status = interpretado.status;
  const autorizada = provaValida && interpretado.status === "autorizada";
  operacao.nsu = provaValida ? interpretado.nsu : null;
  operacao.autorizacao = provaValida ? interpretado.autorizacao : null;
  operacao.rede = provaValida ? interpretado.rede : null;
  operacao.finalizacao = provaValida ? interpretado.finalizacao : null;
  const fiscal = dadosFiscaisProvaTef(input.resultado);
  operacao.bandeiraNome = provaValida ? fiscal.bandeira || null : null;
  operacao.cnpjCredenciadora = !provaValida
    ? null
    : fiscal.cnpjCredenciadora.length === 14
      ? fiscal.cnpjCredenciadora
      : autorizada
        ? cnpjCredenciadoraPayGo(interpretado.rede)
        : null;
  operacao.cnpjRecebedor =
    provaValida && fiscal.cnpjRecebedor.length === 14 ? fiscal.cnpjRecebedor : null;
  operacao.instituicao = provaValida ? fiscal.instituicao || null : null;
  if (interpretado.status === "autorizada") {
    const origem = input.origem;
    const efeito = origem?.efeito ?? "desconhecido";
    operacao.ambienteEfetivo = efeito;
    operacao.pontoEfetivo = origem?.ponto ?? "";
    operacao.hostEfetivo = origem?.host ?? "";
    operacao.comprovanteSha256 = origem?.hash ?? "";
    operacao.motivoAmbiente = (origem?.diagnostico || origem?.motivo || "").slice(0, 400);
    if (efeito === "producao") {
      operacao.status = "autorizada";
      operacao.teste = /^teste/i.test(operacao.identificador);
    } else if (efeito === "homologacao" && origem?.fluxoTeste === true) {
      operacao.status = "autorizada";
      operacao.teste = true;
    } else {
      operacao.status = "reconciliacao";
      operacao.teste = false;
      if (!operacao.motivoAmbiente) {
        operacao.motivoAmbiente =
          "O ambiente desta transação não foi comprovado. A venda e a NFC-e não foram concluídas. Não cobre novamente. Abra Configurações, Financeiro, TEF para o diagnóstico do terminal.";
      }
    }
    if (operacao.status === "autorizada") {
      const pix = resultadoPixPayGo(input.resultado);
      if (!input.modalidadeOficial) {
        if (!pix) {
          operacao.status = "reconciliacao";
          operacao.teste = false;
          operacao.modalidadeEfetiva = null;
          operacao.tipoCartaoPayGo = null;
          operacao.motivoAmbiente = MENSAGEM_MODALIDADE_INDETERMINADA;
        }
      } else {
        const decisao = decidirModalidadeOficial({
          solicitada: operacao.modalidadeSolicitada ?? operacao.modalidade,
          tipoCartao: input.modalidadeOficial.tipoCartao,
          provaValida: input.modalidadeOficial.provaValida,
          pix,
        });
        operacao.modalidadeSolicitada = decisao.modalidadeSolicitada;
        operacao.modalidadeEfetiva = decisao.modalidadeEfetiva;
        operacao.tipoCartaoPayGo = decisao.tipoCartao;
        if (decisao.conciliacao) {
          operacao.status = "reconciliacao";
          operacao.teste = false;
          operacao.motivoAmbiente = decisao.motivo ?? "";
        } else if (decisao.modalidadeEfetiva) {
          operacao.modalidade = decisao.modalidadeEfetiva;
        }
      }
    }
  }
  return respostaOperacao(operacao, false);
}

export function vincularVenda(
  memoria: MemoriaTef,
  input: {
    empresaId: string;
    operacaoId: string;
    vendaId: string;
    usuarioId?: string;
    segredoVinculoHash?: string;
  }
) {
  const operacao = acharDaEmpresa(memoria, input.empresaId, input.operacaoId);
  if (!operacao) {
    return erro("NAO_ENCONTRADA", "Operação TEF não encontrada.");
  }
  const venda = memoria.vendas.find((item) => item.id === input.vendaId);
  if (!venda || venda.empresaId !== input.empresaId) {
    return erro("VENDA_INVALIDA", "A venda não pertence à empresa desta operação.");
  }
  if (operacao.teste || operacao.status === "confirmada") {
    return erro(
      "CONFIRMACAO_BLOQUEADA",
      "Esta transação TEF não pode ser vinculada à venda."
    );
  }
  const ambienteVenda = bloqueioAmbienteReceita(operacao);
  if (ambienteVenda) {
    return erro("CONFIRMACAO_BLOQUEADA", ambienteVenda);
  }
  if (operacao.vendaId && operacao.vendaId !== input.vendaId) {
    return erro("CONFLITO", "A operação TEF já está vinculada a outra venda.");
  }
  if (operacao.status !== "autorizada" && operacao.status !== "vinculada") {
    return erro(
      "CONFIRMACAO_BLOQUEADA",
      "Só é possível vincular um TEF autorizado."
    );
  }
  if (
    (operacao.usuarioId && operacao.usuarioId !== input.usuarioId) ||
    (operacao.segredoVinculoHash &&
      operacao.segredoVinculoHash !== input.segredoVinculoHash)
  ) {
    return erro(
      "CONFIRMACAO_BLOQUEADA",
      "Esta autorização TEF pertence a outro caixa."
    );
  }
  operacao.vendaId = input.vendaId;
  operacao.status = "vinculada";
  return { ok: true as const, ...publica(operacao) };
}

export function reservarOperacoesParaVenda(
  memoria: MemoriaTef,
  input: {
    empresaId: string;
    usuarioId: string;
    idempotencyKey: string;
    operacaoIds: string[];
  }
) {
  const alvos: OperacaoTef[] = [];
  for (const operacaoId of input.operacaoIds) {
    const operacao = acharDaEmpresa(memoria, input.empresaId, operacaoId);
    if (!operacao || operacao.status !== "autorizada" || operacao.vendaId || operacao.teste) {
      return erro(
        "CONFIRMACAO_BLOQUEADA",
        "Há pagamento com cartão sem TEF autorizado para esta venda."
      );
    }
    const ambienteReserva = bloqueioAmbienteReceita(operacao);
    if (ambienteReserva) {
      return erro("CONFIRMACAO_BLOQUEADA", ambienteReserva);
    }
    if (operacao.usuarioId && operacao.usuarioId !== input.usuarioId) {
      return erro(
        "CONFIRMACAO_BLOQUEADA",
        "Esta autorização TEF pertence a outro caixa."
      );
    }
    if (
      operacao.vendaIdempotencyKey &&
      operacao.vendaIdempotencyKey !== input.idempotencyKey
    ) {
      return erro("CONFLITO", "Esta autorização TEF já está reservada para outra venda.");
    }
    alvos.push(operacao);
  }
  for (const operacao of alvos) {
    operacao.vendaIdempotencyKey = input.idempotencyKey;
  }
  return { ok: true as const };
}

export function liberarConfirmacao(
  memoria: MemoriaTef,
  input: { empresaId: string; operacaoId: string; vendaId: string }
) {
  const operacao = acharDaEmpresa(memoria, input.empresaId, input.operacaoId);
  if (!operacao) {
    return erro("NAO_ENCONTRADA", "Operação TEF não encontrada.");
  }
  const venda = memoria.vendas.find((item) => item.id === input.vendaId);
  const recuperacao = decidirRecuperacao({
    empresaId: input.empresaId,
    operacao,
    existeVenda: Boolean(venda && venda.empresaId === input.empresaId),
  });
  if (
    !recuperacao.confirmar ||
    operacao.vendaId !== input.vendaId ||
    !operacao.rede ||
    !operacao.nsu ||
    !operacao.finalizacao
  ) {
    return erro(
      "CONFIRMACAO_BLOQUEADA",
      "A confirmação financeira do TEF não foi liberada."
    );
  }
  return {
    ok: true as const,
    confirmar: true as const,
    rede: operacao.rede,
    nsu: operacao.nsu,
    finalizacao: operacao.finalizacao,
    autorizacao: operacao.autorizacao,
    identificador: operacao.identificador,
    valorCentavos: operacao.valorCentavos,
    desafio: operacao.desafio,
  };
}

export function marcarConfirmada(
  memoria: MemoriaTef,
  input: {
    empresaId: string;
    operacaoId: string;
    rede: string;
    nsu: string;
    finalizacao: string;
    provaValida?: boolean;
  }
) {
  const operacao = acharDaEmpresa(memoria, input.empresaId, input.operacaoId);
  if (!operacao || operacao.status !== "vinculada" || operacao.teste || !operacao.vendaId) {
    return erro("CONFIRMACAO_BLOQUEADA", "A confirmação financeira do TEF não foi liberada.");
  }
  const ambienteConfirmacao = bloqueioAmbienteReceita(operacao);
  if (ambienteConfirmacao) {
    return erro("CONFIRMACAO_BLOQUEADA", ambienteConfirmacao);
  }
  if (input.provaValida !== true) {
    return erro(
      "CONFIRMACAO_BLOQUEADA",
      "A confirmação TEF não tem prova do terminal."
    );
  }
  if (
    operacao.rede !== input.rede ||
    operacao.nsu !== input.nsu ||
    operacao.finalizacao !== input.finalizacao
  ) {
    return erro("CONFLITO", "A confirmação não confere com a autorização registrada.");
  }
  operacao.status = "confirmada";
  return { ok: true as const, ...publica(operacao) };
}

export function pedirDesfazimento(
  memoria: MemoriaTef,
  input: {
    empresaId: string;
    operacaoId: string;
    idempotencyKeyVenda?: string | null;
    usuarioId?: string;
    vendaIdEncontrada?: string | null;
  }
) {
  const operacao = acharDaEmpresa(memoria, input.empresaId, input.operacaoId);
  if (!operacao) {
    return erro("NAO_ENCONTRADA", "Operação TEF não encontrada.");
  }
  if (
    input.usuarioId &&
    operacao.usuarioId &&
    input.usuarioId !== operacao.usuarioId
  ) {
    return erro(
      "CONFIRMACAO_BLOQUEADA",
      "Esta operação TEF pertence a outro caixa."
    );
  }
  const existeVenda = memoria.vendas.some(
    (venda) =>
      venda.empresaId === input.empresaId &&
      (venda.id === operacao.vendaId ||
        (input.idempotencyKeyVenda &&
          venda.idempotencyKey === input.idempotencyKeyVenda))
  );
  const recuperacao = decidirRecuperacao({
    empresaId: input.empresaId,
    operacao,
    existeVenda,
  });
  if (operacao.status === "desconhecida" && (!operacao.rede || !operacao.nsu || !operacao.finalizacao)) {
    return {
      ok: true as const,
      executar: "nenhum" as const,
      erro: operacao.teste
        ? "Pendência de simulação sem autorização. Nenhuma confirmação ou desfazimento foi executado."
        : "Resultado desconhecido do Connector, sem autorização comprovada. Nenhuma confirmação, desfazimento ou alteração foi feita.",
    };
  }
  if (
    recuperacao.acao === "confirmar" &&
    operacao.rede &&
    operacao.nsu &&
    operacao.finalizacao
  ) {
    return {
      ok: true as const,
      executar: "confirmar" as const,
      rede: operacao.rede,
      nsu: operacao.nsu,
      finalizacao: operacao.finalizacao,
      autorizacao: operacao.autorizacao,
      identificador: operacao.identificador,
      valorCentavos: operacao.valorCentavos,
      desafio: operacao.desafio,
    };
  }
  if (recuperacao.acao === "vincular" && input.vendaIdEncontrada) {
    operacao.vendaId = input.vendaIdEncontrada;
    operacao.status = "vinculada";
    if (!operacao.rede || !operacao.nsu || !operacao.finalizacao) {
      operacao.status = "reconciliacao";
      return {
        ok: true as const,
        executar: "nenhum" as const,
        erro: "A venda existe, mas o TEF não tem dados para confirmar. Não cobre novamente.",
      };
    }
    return {
      ok: true as const,
      executar: "confirmar" as const,
      rede: operacao.rede,
      nsu: operacao.nsu,
      finalizacao: operacao.finalizacao,
      autorizacao: operacao.autorizacao,
      identificador: operacao.identificador,
      valorCentavos: operacao.valorCentavos,
      desafio: operacao.desafio,
    };
  }
  if (recuperacao.acao === "reconciliar" || existeVenda) {
    if (operacao.status !== "confirmada" && operacao.status !== "desfeita") {
      operacao.status = "reconciliacao";
    }
    return {
      ok: true as const,
      executar: "nenhum" as const,
      erro: "A transação ficou para reconciliação. Não confirme nem cobre de novo.",
    };
  }
  if (recuperacao.acao !== "desfazer") {
    return {
      ok: true as const,
      executar: "nenhum" as const,
    };
  }
  if (!operacao.rede || !operacao.nsu || !operacao.finalizacao) {
    operacao.status = "reconciliacao";
    return {
      ok: true as const,
      executar: "nenhum" as const,
      erro: "Não há dados para desfazer. A transação ficou para reconciliação.",
    };
  }
  operacao.status = "desfazimento_pendente";
  return {
    ok: true as const,
    executar: "desfazer" as const,
    rede: operacao.rede,
    nsu: operacao.nsu,
    finalizacao: operacao.finalizacao,
    autorizacao: operacao.autorizacao,
    identificador: operacao.identificador,
    valorCentavos: operacao.valorCentavos,
    desafio: operacao.desafio,
  };
}

export function recuperarSimulacao(
  memoria: MemoriaTef,
  input: { empresaId: string; operacaoId: string }
) {
  const operacao = acharDaEmpresa(memoria, input.empresaId, input.operacaoId);
  if (!operacao) {
    return erro("NAO_ENCONTRADA", "Operação TEF não encontrada.");
  }
  if (!operacao.teste) {
    return erro(
      "NAO_SIMULADA",
      "Esta pendência não é simulação. O registro financeiro não foi alterado."
    );
  }
  if (operacao.status === "cancelada") {
    return {
      ok: true as const,
      repetida: true,
      status: "cancelada" as const,
      idempotencyKey: operacao.idempotencyKey,
    };
  }
  if (operacao.status !== "desconhecida" && operacao.status !== "iniciada") {
    return erro(
      "RECUPERACAO_BLOQUEADA",
      "Esta simulação não admite recuperação automática. O registro não foi alterado."
    );
  }
  operacao.status = "cancelada";
  operacao.motivoAmbiente =
    "Recuperação da simulação. Histórico e idempotência preservados. Nenhuma cobrança foi confirmada ou desfeita.";
  return {
    ok: true as const,
    repetida: false,
    status: "cancelada" as const,
    idempotencyKey: operacao.idempotencyKey,
  };
}

export function marcarDesfeita(
  memoria: MemoriaTef,
  input: {
    empresaId: string;
    operacaoId: string;
    sucesso: boolean;
    provaValida?: boolean;
  }
) {
  const operacao = acharDaEmpresa(memoria, input.empresaId, input.operacaoId);
  if (!operacao) {
    return erro("NAO_ENCONTRADA", "Operação TEF não encontrada.");
  }
  if (operacao.vendaId) {
    return erro(
      "RECONCILIACAO",
      "A venda já existe. O TEF não foi desfeito automaticamente."
    );
  }
  if (input.provaValida !== true) {
    operacao.status = "reconciliacao";
    return erro(
      "RECONCILIACAO",
      "O desfazimento não tem prova do terminal."
    );
  }
  operacao.status = input.sucesso ? "desfeita" : "reconciliacao";
  return { ok: true as const, ...publica(operacao) };
}

export function marcarPendenciaAdministrativa(
  memoria: MemoriaTef,
  input: { empresaId: string; operacaoId: string; motivo: string }
) {
  const operacao = acharDaEmpresa(memoria, input.empresaId, input.operacaoId);
  if (!operacao) {
    return erro("NAO_ENCONTRADA", "Operação TEF não encontrada.");
  }
  if (operacao.status === "reconciliacao") {
    if (!operacao.motivoAmbiente && input.motivo) {
      operacao.motivoAmbiente = input.motivo.slice(0, 400);
    }
    return { ok: true as const, ...publica(operacao) };
  }
  if (operacao.status !== "autorizada" || operacao.vendaId) {
    return erro(
      "CONFIRMACAO_BLOQUEADA",
      "Esta operação não admite pendência administrativa."
    );
  }
  operacao.status = "reconciliacao";
  operacao.teste = false;
  operacao.motivoAmbiente = input.motivo.slice(0, 400);
  return { ok: true as const, ...publica(operacao) };
}

export function listarPendencias(memoria: MemoriaTef, empresaId: string) {
  return memoria.operacoes
    .filter(
      (item) =>
        item.empresaId === empresaId && STATUS_TEF_ABERTOS.includes(item.status)
    )
    .map((item) => ({
      id: item.id,
      status: item.status,
      valorCentavos: item.valorCentavos,
      modalidade: item.modalidade,
      modalidadeSolicitada: item.modalidadeSolicitada ?? item.modalidade,
      modalidadeEfetiva: item.modalidadeEfetiva ?? null,
      tipoCartaoPayGo: item.tipoCartaoPayGo ?? null,
      diagnostico: item.motivoAmbiente || "",
      vendaIdempotencyKey: item.vendaIdempotencyKey,
      proibirDesfazimento: item.status === "reconciliacao" || item.teste === true,
      ...classificarPendenciaTef(item),
      vendaId: item.vendaId,
      identificador: item.identificador,
      terminalId: item.terminalId,
    }));
}
