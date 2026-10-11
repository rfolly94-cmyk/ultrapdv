import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  aplicarRespostaMenu,
  classificarFormaTef,
  decidirRecuperacao,
  sanitizarParaLog,
  validarPagamentoMisto,
} from "./regras";
import {
  iniciarOperacao,
  liberarConfirmacao,
  listarPendencias,
  marcarConfirmada,
  marcarDesfeita,
  memoriaTefVazia,
  operacoesParaGravar,
  pedirDesfazimento,
  registrarResultado,
  salvarConfigEmpresa,
  vincularVenda,
  type MemoriaTef,
  type OperacaoTef,
} from "./orquestracao";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const EMPRESA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMPRESA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DISPOSITIVO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function preparar(empresaId = EMPRESA_A): MemoriaTef {
  const memoria = memoriaTefVazia();
  memoria.plataformaHabilitada = true;
  salvarConfigEmpresa(memoria, empresaId, {
    habilitado: true,
    ambiente: "homologacao",
    estabelecimento: "LOJA-A",
    pontoCaptura: "001",
  });
  return memoria;
}

function aprovar(memoria: MemoriaTef, operacaoId: string) {
  return registrarResultado(memoria, {
    empresaId: EMPRESA_A,
    operacaoId,
    provaValida: true,
    resultado: {
      sucessoTransacao: true,
      nsu: "998877",
      codigoAutorizacao: "AUT01",
      rede: "CIELO",
      codigoFinalizacao: "FIN01",
      valor: 25,
      confirmar: true,
      precisaConfirmacao: true,
    },
  });
}

function iniciarPadrao(
  memoria: MemoriaTef,
  extra: Partial<Parameters<typeof iniciarOperacao>[1]> = {}
) {
  return iniciarOperacao(memoria, {
    empresaId: EMPRESA_A,
    dispositivoId: DISPOSITIVO,
    terminalCodigo: "CX01",
    modalidade: "debito",
    valorCentavos: 2500,
    identificador: "op-venda-1",
    idempotencyKey: "idem-1",
    ...extra,
  });
}

test("aprovação exige NSU, autorização e confirmação pendente no valor certo", () => {
  const memoria = preparar();
  const inicio = iniciarPadrao(memoria);
  assert.equal(inicio.ok, true);
  if (!inicio.ok) {
    return;
  }
  const aprovado = aprovar(memoria, inicio.operacaoId);
  assert.equal(aprovado.ok, true);
  if (!aprovado.ok) {
    return;
  }
  assert.equal(aprovado.status, "autorizada");
  assert.equal(memoria.operacoes[0]?.nsu, "998877");
});

test("recusa, cancelamento e timeout não liberam confirmação", () => {
  const memoria = preparar();
  const inicio = iniciarPadrao(memoria);
  assert.equal(inicio.ok, true);
  if (!inicio.ok) {
    return;
  }
  const recusa = registrarResultado(memoria, {
    empresaId: EMPRESA_A,
    operacaoId: inicio.operacaoId,
    provaValida: true,
    resultado: { sucessoTransacao: false },
  });
  assert.equal(recusa.ok && recusa.status, "recusada");
  memoria.vendas.push({
    id: "venda-1",
    empresaId: EMPRESA_A,
    idempotencyKey: "venda-idem",
  });
  assert.equal(
    liberarConfirmacao(memoria, {
      empresaId: EMPRESA_A,
      operacaoId: inicio.operacaoId,
      vendaId: "venda-1",
    }).ok,
    false
  );

  const cancelada = preparar();
  const inicioCancelado = iniciarPadrao(cancelada, { idempotencyKey: "idem-c" });
  assert.equal(inicioCancelado.ok, true);
  if (!inicioCancelado.ok) {
    return;
  }
  registrarResultado(cancelada, {
    empresaId: EMPRESA_A,
    operacaoId: inicioCancelado.operacaoId,
    provaValida: true,
    resultado: { sucessoTransacao: false, cancelada: true },
  });
  assert.equal(cancelada.operacoes[0]?.status, "cancelada");

  const estourou = preparar();
  const inicioTimeout = iniciarPadrao(estourou, { idempotencyKey: "idem-t" });
  assert.equal(inicioTimeout.ok, true);
  if (!inicioTimeout.ok) {
    return;
  }
  registrarResultado(estourou, {
    empresaId: EMPRESA_A,
    operacaoId: inicioTimeout.operacaoId,
    provaValida: true,
    resultado: { codigo: "TEF_TIMEOUT" },
  });
  assert.equal(estourou.operacoes[0]?.status, "timeout");
  assert.equal(
    decidirRecuperacao({
      empresaId: EMPRESA_A,
      operacao: estourou.operacoes[0] ?? null,
      existeVenda: false,
    }).confirmar,
    false
  );
});

test("menus sucessivos só aceitam a solicitação que ainda está na tela", () => {
  const primeiro = { solicitacaoId: "menu-1", opcoes: ["Cielo", "Rede"] };
  assert.equal(
    aplicarRespostaMenu(primeiro, { solicitacaoId: "menu-1", indice: 1 }).aplicar,
    true
  );
  const segundo = { solicitacaoId: "menu-2", opcoes: ["Débito", "Crédito"] };
  assert.equal(
    aplicarRespostaMenu(segundo, { solicitacaoId: "menu-1", indice: 0 }).aplicar,
    false
  );
  assert.equal(
    aplicarRespostaMenu(segundo, { solicitacaoId: "menu-2", indice: 0 }).aplicar,
    true
  );
});

test("pagamento misto exige TEF autorizado só na parcela de cartão", () => {
  const operacoes = [
    {
      id: "op-debito",
      empresaId: EMPRESA_A,
      modalidade: "debito" as const,
      valorCentavos: 1500,
      status: "autorizada" as const,
      vendaId: null,
      teste: false,
      nsu: "1",
      autorizacao: "A",
    },
  ];
  assert.equal(
    validarPagamentoMisto(
      [
        { modalidade: null, valorCentavos: 1000, permiteTroco: true },
        {
          modalidade: "debito",
          valorCentavos: 1500,
          tefOperacaoId: "op-debito",
          permiteTroco: false,
        },
      ],
      operacoes,
      EMPRESA_A
    ).ok,
    true
  );
  assert.equal(
    validarPagamentoMisto(
      [{ modalidade: "credito", valorCentavos: 1500, permiteTroco: false }],
      operacoes,
      EMPRESA_A
    ).ok,
    false
  );
  assert.equal(
    validarPagamentoMisto(
      [
        {
          modalidade: "debito",
          valorCentavos: 1500,
          tefOperacaoId: "op-debito",
          permiteTroco: true,
        },
      ],
      operacoes,
      EMPRESA_A
    ).ok,
    false
  );
});

test("empresa B não lê, confirma nem desfaz operação da empresa A", () => {
  const memoria = preparar();
  const inicio = iniciarPadrao(memoria);
  assert.equal(inicio.ok, true);
  if (!inicio.ok) {
    return;
  }
  aprovar(memoria, inicio.operacaoId);
  const antes = JSON.stringify(memoria.operacoes);
  assert.equal(
    registrarResultado(memoria, {
      empresaId: EMPRESA_B,
      operacaoId: inicio.operacaoId,
      resultado: { sucessoTransacao: false },
    }).ok,
    false
  );
  assert.equal(
    liberarConfirmacao(memoria, {
      empresaId: EMPRESA_B,
      operacaoId: inicio.operacaoId,
      vendaId: "venda-x",
    }).ok,
    false
  );
  assert.equal(
    pedirDesfazimento(memoria, {
      empresaId: EMPRESA_B,
      operacaoId: inicio.operacaoId,
    }).ok,
    false
  );
  assert.deepEqual(listarPendencias(memoria, EMPRESA_B), []);
  assert.equal(JSON.stringify(memoria.operacoes), antes);
  assert.equal(
    operacoesParaGravar(
      JSON.parse(antes) as OperacaoTef[],
      memoria.operacoes,
      EMPRESA_B
    ).length,
    0
  );
});

test("troca de empresa no meio do pagamento não confirma no contexto novo", () => {
  const memoria = preparar();
  salvarConfigEmpresa(memoria, EMPRESA_B, {
    habilitado: true,
    ambiente: "homologacao",
    estabelecimento: "LOJA-B",
    pontoCaptura: "002",
  });
  const inicio = iniciarPadrao(memoria);
  assert.equal(inicio.ok, true);
  if (!inicio.ok) {
    return;
  }
  aprovar(memoria, inicio.operacaoId);
  memoria.vendas.push({
    id: "venda-b",
    empresaId: EMPRESA_B,
    idempotencyKey: "idem-b",
  });
  assert.equal(
    vincularVenda(memoria, {
      empresaId: EMPRESA_B,
      operacaoId: inicio.operacaoId,
      vendaId: "venda-b",
    }).ok,
    false
  );
  assert.equal(memoria.operacoes[0]?.empresaId, EMPRESA_A);
  assert.equal(memoria.operacoes[0]?.vendaId, null);
  assert.equal(memoria.operacoes[0]?.status, "autorizada");
});

test("dois caixas não ocupam o mesmo terminal ao mesmo tempo", () => {
  const memoria = preparar();
  assert.equal(iniciarPadrao(memoria).ok, true);
  const segundo = iniciarPadrao(memoria, {
    identificador: "op-venda-2",
    idempotencyKey: "idem-2",
  });
  assert.equal(segundo.ok, false);
  if (segundo.ok) {
    return;
  }
  assert.equal(segundo.codigo, "TERMINAL_OCUPADO");
  assert.equal(memoria.operacoes.length, 1);
});

test("o mesmo dispositivo não atende duas empresas", () => {
  const memoria = preparar();
  salvarConfigEmpresa(memoria, EMPRESA_B, {
    habilitado: true,
    ambiente: "producao",
    estabelecimento: "LOJA-B",
    pontoCaptura: "009",
  });
  assert.equal(iniciarPadrao(memoria).ok, true);
  const outra = iniciarOperacao(memoria, {
    empresaId: EMPRESA_B,
    dispositivoId: DISPOSITIVO,
    terminalCodigo: "CX09",
    modalidade: "credito",
    valorCentavos: 1000,
    identificador: "op-b",
    idempotencyKey: "idem-b",
  });
  assert.equal(outra.ok, false);
  if (outra.ok) {
    return;
  }
  assert.equal(outra.codigo, "TERMINAL_OUTRA_EMPRESA");
  assert.equal(
    memoria.operacoes.some((item) => item.empresaId === EMPRESA_B),
    false
  );
});

test("confirmação de teste não liquida a transação", () => {
  const memoria = preparar();
  const inicio = iniciarPadrao(memoria, { identificador: "TESTE0009" });
  assert.equal(inicio.ok, true);
  if (!inicio.ok) {
    return;
  }
  aprovar(memoria, inicio.operacaoId);
  memoria.vendas.push({
    id: "venda-1",
    empresaId: EMPRESA_A,
    idempotencyKey: "idem-venda",
  });
  assert.equal(
    vincularVenda(memoria, {
      empresaId: EMPRESA_A,
      operacaoId: inicio.operacaoId,
      vendaId: "venda-1",
    }).ok,
    false
  );
  assert.equal(
    liberarConfirmacao(memoria, {
      empresaId: EMPRESA_A,
      operacaoId: inicio.operacaoId,
      vendaId: "venda-1",
    }).ok,
    false
  );
  assert.equal(memoria.operacoes[0]?.status, "autorizada");
});

test("pendência depois de reinício não confirma sem venda", () => {
  const memoria = preparar();
  const inicio = iniciarPadrao(memoria);
  assert.equal(inicio.ok, true);
  if (!inicio.ok) {
    return;
  }
  aprovar(memoria, inicio.operacaoId);
  const reidratada = structuredClone(memoria);
  const recuperacao = decidirRecuperacao({
    empresaId: EMPRESA_A,
    operacao: reidratada.operacoes[0] ?? null,
    existeVenda: false,
  });
  assert.equal(recuperacao.acao, "desfazer");
  assert.equal(recuperacao.confirmar, false);
  const desfazer = pedirDesfazimento(reidratada, {
    empresaId: EMPRESA_A,
    operacaoId: inicio.operacaoId,
  });
  assert.equal(desfazer.ok && desfazer.executar, "desfazer");
  const marcada = marcarDesfeita(reidratada, {
    empresaId: EMPRESA_A,
    operacaoId: inicio.operacaoId,
    sucesso: false,
    provaValida: true,
  });
  assert.equal(marcada.ok, true);
  assert.equal(reidratada.operacoes[0]?.status, "reconciliacao");

  const desconhecida = preparar();
  const inicioDesconhecido = iniciarPadrao(desconhecida, {
    idempotencyKey: "idem-d",
  });
  assert.equal(inicioDesconhecido.ok, true);
  if (!inicioDesconhecido.ok) {
    return;
  }
  registrarResultado(desconhecida, {
    empresaId: EMPRESA_A,
    operacaoId: inicioDesconhecido.operacaoId,
    resultado: { sucessoTransacao: true, valor: 25 },
  });
  assert.equal(desconhecida.operacoes[0]?.status, "desconhecida");
  const aposReinicio = decidirRecuperacao({
    empresaId: EMPRESA_A,
    operacao: structuredClone(desconhecida).operacoes[0] ?? null,
    existeVenda: false,
  });
  assert.equal(aposReinicio.acao, "reconciliar");
  assert.equal(aposReinicio.confirmar, false);
  assert.equal(aposReinicio.cobrarDeNovo, false);
});

test("confirmação só ocorre depois da venda vinculada à mesma empresa", () => {
  const memoria = preparar();
  const inicio = iniciarPadrao(memoria);
  assert.equal(inicio.ok, true);
  if (!inicio.ok) {
    return;
  }
  aprovar(memoria, inicio.operacaoId);
  assert.equal(
    liberarConfirmacao(memoria, {
      empresaId: EMPRESA_A,
      operacaoId: inicio.operacaoId,
      vendaId: "venda-1",
    }).ok,
    false
  );
  memoria.vendas.push({
    id: "venda-1",
    empresaId: EMPRESA_A,
    idempotencyKey: "idem-venda",
  });
  assert.equal(
    vincularVenda(memoria, {
      empresaId: EMPRESA_A,
      operacaoId: inicio.operacaoId,
      vendaId: "venda-1",
    }).ok,
    true
  );
  const liberada = liberarConfirmacao(memoria, {
    empresaId: EMPRESA_A,
    operacaoId: inicio.operacaoId,
    vendaId: "venda-1",
  });
  assert.equal(liberada.ok, true);
  if (!liberada.ok) {
    return;
  }
  assert.equal(
    marcarConfirmada(memoria, {
      empresaId: EMPRESA_A,
      operacaoId: inicio.operacaoId,
      rede: liberada.rede,
      nsu: liberada.nsu,
      finalizacao: liberada.finalizacao,
      provaValida: true,
    }).ok,
    true
  );
  assert.equal(memoria.operacoes[0]?.status, "confirmada");
});

test("venda já gravada impede desfazimento automático", () => {
  const memoria = preparar();
  const inicio = iniciarPadrao(memoria);
  assert.equal(inicio.ok, true);
  if (!inicio.ok) {
    return;
  }
  aprovar(memoria, inicio.operacaoId);
  memoria.vendas.push({
    id: "venda-1",
    empresaId: EMPRESA_A,
    idempotencyKey: "idem-venda",
  });
  const pedido = pedirDesfazimento(memoria, {
    empresaId: EMPRESA_A,
    operacaoId: inicio.operacaoId,
    idempotencyKeyVenda: "idem-venda",
  });
  assert.equal(pedido.ok && pedido.executar, "nenhum");
  assert.equal(memoria.operacoes[0]?.status, "reconciliacao");
});

test("venda encontrada pela reserva é confirmada e não desfeita", () => {
  const memoria = preparar();
  const inicio = iniciarPadrao(memoria, { grupoVenda: "idem-venda" });
  assert.equal(inicio.ok, true);
  if (!inicio.ok) {
    return;
  }
  aprovar(memoria, inicio.operacaoId);
  memoria.vendas.push({
    id: "venda-1",
    empresaId: EMPRESA_A,
    idempotencyKey: "idem-venda",
  });
  const pedido = pedirDesfazimento(memoria, {
    empresaId: EMPRESA_A,
    operacaoId: inicio.operacaoId,
    idempotencyKeyVenda: "idem-venda",
    vendaIdEncontrada: "venda-1",
  });
  assert.equal(pedido.ok && pedido.executar, "confirmar");
  assert.equal(memoria.operacoes[0]?.status, "vinculada");
  assert.equal(memoria.operacoes[0]?.vendaId, "venda-1");
});

test("estabelecimento diferente não reutiliza o terminal", () => {
  const memoria = preparar();
  const primeiro = iniciarPadrao(memoria, {
    estabelecimento: "LOJA-A",
    pontoCaptura: "001",
  });
  assert.equal(primeiro.ok, true);
  const segundo = iniciarPadrao(memoria, {
    idempotencyKey: "idem-2",
    identificador: "op-venda-2",
    estabelecimento: "LOJA-B",
    pontoCaptura: "001",
  });
  assert.equal(segundo.ok, false);
  if (segundo.ok) {
    return;
  }
  assert.equal(segundo.codigo, "ESTABELECIMENTO_DIVERGENTE");
});

test("log de TEF não conserva PAN, PIN nem trilha", () => {
  const limpo = sanitizarParaLog({
    nsu: "998877",
    pan: "4111111111111111",
    pin: "1234",
    trilha2: "dados",
    valor: 10,
  }) as Record<string, unknown>;
  assert.equal(limpo.nsu, "998877");
  assert.equal(limpo.valor, 10);
  assert.equal("pan" in limpo, false);
  assert.equal("pin" in limpo, false);
  assert.equal("trilha2" in limpo, false);
});

test("débito e crédito entram no TEF; dinheiro e PIX permanecem fora", () => {
  assert.equal(
    classificarFormaTef({ nome: "Cartão de Débito", codigo: "DEBITO" }),
    "debito"
  );
  assert.equal(
    classificarFormaTef({ nome: "Cartão de Crédito", codigo_fiscal: "03" }),
    "credito"
  );
  assert.equal(classificarFormaTef({ nome: "Dinheiro", codigo: "DINHEIRO" }), null);
  assert.equal(classificarFormaTef({ nome: "PIX", codigo: "PIX" }), null);
  assert.equal(classificarFormaTef({ nome: "Cartão", permite_fiado: true }), null);
});

test("reenvio da mesma cobrança não cria outra operação", () => {
  const memoria = preparar();
  const primeira = iniciarPadrao(memoria);
  assert.equal(primeira.ok, true);
  const segunda = iniciarPadrao(memoria);
  assert.equal(segunda.ok, true);
  if (!primeira.ok || !segunda.ok) {
    return;
  }
  assert.equal(segunda.repetida, true);
  assert.equal(segunda.emAndamento, true);
  assert.equal(segunda.operacaoId, primeira.operacaoId);
  assert.equal(memoria.operacoes.length, 1);
});

test("NSU informado sem prova não autoriza nem libera o terminal", () => {
  const memoria = preparar();
  const inicio = iniciarPadrao(memoria, {
    usuarioId: "usuario-a",
    segredoVinculoHash: "hash-a",
  });
  assert.equal(inicio.ok, true);
  if (!inicio.ok) {
    return;
  }
  const forjado = registrarResultado(memoria, {
    empresaId: EMPRESA_A,
    operacaoId: inicio.operacaoId,
    resultado: {
      sucessoTransacao: true,
      nsu: "998877",
      codigoAutorizacao: "AUT01",
      rede: "CIELO",
      codigoFinalizacao: "FIN01",
      valor: 25,
      confirmar: true,
    },
  });
  assert.equal(forjado.ok && forjado.status, "desconhecida");
  assert.equal(memoria.operacoes[0]?.nsu, null);
  const recusaFalsa = preparar();
  const inicioRecusa = iniciarPadrao(recusaFalsa, { idempotencyKey: "idem-falsa" });
  assert.equal(inicioRecusa.ok, true);
  if (!inicioRecusa.ok) {
    return;
  }
  registrarResultado(recusaFalsa, {
    empresaId: EMPRESA_A,
    operacaoId: inicioRecusa.operacaoId,
    resultado: { sucessoTransacao: false },
  });
  assert.equal(recusaFalsa.operacoes[0]?.status, "desconhecida");
  assert.equal(
    iniciarPadrao(recusaFalsa, { idempotencyKey: "idem-nova" }).ok,
    false
  );
});

test("outro caixa da mesma empresa não vincula a autorização", () => {
  const memoria = preparar();
  const inicio = iniciarPadrao(memoria, {
    usuarioId: "usuario-a",
    segredoVinculoHash: "hash-a",
  });
  assert.equal(inicio.ok, true);
  if (!inicio.ok) {
    return;
  }
  aprovar(memoria, inicio.operacaoId);
  memoria.vendas.push({
    id: "venda-1",
    empresaId: EMPRESA_A,
    idempotencyKey: "idem-venda",
  });
  assert.equal(
    vincularVenda(memoria, {
      empresaId: EMPRESA_A,
      operacaoId: inicio.operacaoId,
      vendaId: "venda-1",
      usuarioId: "usuario-b",
      segredoVinculoHash: "hash-a",
    }).ok,
    false
  );
  assert.equal(
    vincularVenda(memoria, {
      empresaId: EMPRESA_A,
      operacaoId: inicio.operacaoId,
      vendaId: "venda-1",
      usuarioId: "usuario-a",
      segredoVinculoHash: "hash-errada",
    }).ok,
    false
  );
  assert.equal(memoria.operacoes[0]?.vendaId, null);
});

test("venda vinculada retoma a confirmação e não fica presa em desfazimento", () => {
  const memoria = preparar();
  const inicio = iniciarPadrao(memoria);
  assert.equal(inicio.ok, true);
  if (!inicio.ok) {
    return;
  }
  aprovar(memoria, inicio.operacaoId);
  memoria.vendas.push({
    id: "venda-1",
    empresaId: EMPRESA_A,
    idempotencyKey: "idem-venda",
  });
  assert.equal(
    vincularVenda(memoria, {
      empresaId: EMPRESA_A,
      operacaoId: inicio.operacaoId,
      vendaId: "venda-1",
    }).ok,
    true
  );
  const retomada = pedirDesfazimento(memoria, {
    empresaId: EMPRESA_A,
    operacaoId: inicio.operacaoId,
  });
  assert.equal(retomada.ok && retomada.executar, "confirmar");
  assert.equal(memoria.operacoes[0]?.status, "vinculada");
  assert.equal(
    marcarConfirmada(memoria, {
      empresaId: EMPRESA_A,
      operacaoId: inicio.operacaoId,
      rede: "CIELO",
      nsu: "998877",
      finalizacao: "FIN01",
    }).ok,
    false
  );
  assert.equal(memoria.operacoes[0]?.status, "vinculada");
});

test("dois cartões do mesmo valor permanecem operações distintas", () => {
  const operacoes = [
    {
      id: "op-1",
      empresaId: EMPRESA_A,
      modalidade: "credito" as const,
      valorCentavos: 1000,
      status: "autorizada" as const,
      vendaId: null,
      teste: false,
      nsu: "1",
      autorizacao: "A",
    },
    {
      id: "op-2",
      empresaId: EMPRESA_A,
      modalidade: "credito" as const,
      valorCentavos: 1000,
      status: "autorizada" as const,
      vendaId: null,
      teste: false,
      nsu: "2",
      autorizacao: "B",
    },
  ];
  const avaliacao = validarPagamentoMisto(
    [
      {
        modalidade: "credito",
        valorCentavos: 1000,
        tefOperacaoId: "op-1",
        permiteTroco: false,
      },
      {
        modalidade: "credito",
        valorCentavos: 1000,
        tefOperacaoId: "op-2",
        permiteTroco: false,
      },
    ],
    operacoes,
    EMPRESA_A
  );
  assert.equal(avaliacao.ok, true);
  if (!avaliacao.ok) {
    return;
  }
  assert.deepEqual(avaliacao.operacaoIds, ["op-1", "op-2"]);
});

test("dois cartões do mesmo grupo não disputam o terminal; outro grupo não reaproveita a autorização", () => {
  const memoria = preparar();
  const primeira = iniciarPadrao(memoria, { grupoVenda: "venda-1" });
  assert.equal(primeira.ok, true);
  if (!primeira.ok) {
    return;
  }
  aprovar(memoria, primeira.operacaoId);
  const segunda = iniciarPadrao(memoria, {
    grupoVenda: "venda-1",
    idempotencyKey: "idem-2",
    identificador: "op-venda-2",
  });
  assert.equal(segunda.ok, true);
  if (!segunda.ok) {
    return;
  }
  aprovar(memoria, segunda.operacaoId);
  const outraVenda = iniciarPadrao(memoria, {
    grupoVenda: "venda-2",
    idempotencyKey: "idem-3",
    identificador: "op-venda-3",
  });
  assert.equal(outraVenda.ok, false);
  if (outraVenda.ok) {
    return;
  }
  assert.equal(outraVenda.codigo, "TERMINAL_OCUPADO");
  assert.equal(memoria.operacoes.length, 2);
});

test("terminal sem pareamento não é criado na cobrança", () => {
  const memoria = preparar();
  const inicio = iniciarPadrao(memoria, { exigirTerminalPareado: true });
  assert.equal(inicio.ok, false);
  if (inicio.ok) {
    return;
  }
  assert.equal(inicio.codigo, "TERMINAL_NAO_PAREADO");
  assert.equal(memoria.terminais.length, 0);
});

test("a finalização consulta o TEF da empresa antes da RPC", () => {
  const action = readFileSync(join(raiz, "app/pdv/actions.ts"), "utf8");
  const rota = readFileSync(join(raiz, "app/api/pdv/tef/iniciar/route.ts"), "utf8");
  const servico = readFileSync(join(raiz, "lib/pdv/tef/servico.ts"), "utf8");
  const persistencia = readFileSync(join(raiz, "lib/pdv/tef/persistencia.ts"), "utf8");
  const migration = readFileSync(
    join(raiz, "supabase/migrations/20261010120000_tef_multiempresa.sql"),
    "utf8"
  );
  assert.ok(
    action.indexOf("validarTefNaFinalizacao") < action.indexOf("rpc_finalizar_venda")
  );
  assert.match(action, /vincularTefNaVenda/);
  assert.match(action, /validarPixNaFinalizacaoComercial/);
  assert.match(action, /p_idempotency_key/);
  assert.doesNotMatch(action, /tefOperacaoId:\s*pagamento\.tefOperacaoId/);
  assert.doesNotMatch(rota, /body\.empresaId|body\.empresa_id/);
  assert.match(servico, /resolverContextoAutorizadoEmpresa/);
  assert.doesNotMatch(servico, /sucesso:\s*body\.sucesso === true/);
  assert.match(persistencia, /verificarProvaTef/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /ux_tef_operacao_aberta_terminal/);
  assert.match(migration, /ux_tef_terminais_dispositivo_ativo/);
  assert.match(migration, /REVOKE ALL ON public\.tef_operacoes FROM anon, authenticated/);
  assert.match(migration, /tef_operacoes_venda_mesma_empresa/);
  assert.match(migration, /GRANT SELECT ON public\.tef_operacoes TO authenticated/);
  assert.match(migration, /tef_pareamentos/);
  assert.match(migration, /tef_chaves_revogadas/);
  assert.match(migration, /REFERENCES public.vendas \(id\)/);
  assert.match(migration, /tem_acesso_empresa/);
  assert.doesNotMatch(migration, /GRANT INSERT ON public\.tef_pareamentos TO authenticated/);
});
