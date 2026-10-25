import assert from "node:assert/strict";
import test from "node:test";

import { ABI_COMPROVADO, LAYOUT_HOMOLOGADO } from "./tef-pgweb.mjs";
import { executarVendaHomologacao, prepararVendaHomologacao } from "./tef-executor-homologacao.mjs";

const DIRETORIO = "C:\\UltraPDV\\TEF\\Homologacao\\PGWeb";

function pedido(extra = {}) {
  return {
    ambiente: "homologacao",
    diretorio: DIRETORIO,
    empresaId: "empresa-a",
    terminalCodigo: "terminal-a",
    idempotencyKey: "idem-1",
    valorCentavos: 100,
    modalidade: "debito",
    journal: null,
    sessoes: [],
    ...extra,
  };
}

function transporte() {
  const chamadas = [];
  return {
    chamadas,
    async PW_iNewTransac() {
      chamadas.push("PW_iNewTransac");
      return 0;
    },
    async PW_iExecTransac() {
      chamadas.push("PW_iExecTransac");
      return 0;
    },
    async PW_iConfirmation() {
      chamadas.push("PW_iConfirmation");
      return 0;
    },
  };
}

test("journal pendente e duplicidade impedem o comando antes da DLL", async () => {
  const recuperacao = prepararVendaHomologacao(
    pedido({ journal: { status: "pagamento_em_andamento" } })
  );
  assert.equal(recuperacao.acao, "recuperar");
  assert.equal(recuperacao.enviarComando, false);
  const duplicada = prepararVendaHomologacao(
    pedido({
      sessoes: [
        {
          empresaId: "empresa-a",
          terminalCodigo: "terminal-a",
          idempotencyKey: "idem-antiga",
          status: "autorizada",
        },
      ],
    })
  );
  assert.equal(duplicada.acao, "duplicada");
  const repetida = prepararVendaHomologacao(
    pedido({
      sessoes: [
        {
          empresaId: "empresa-a",
          terminalCodigo: "terminal-a",
          idempotencyKey: "idem-1",
          status: "iniciada",
        },
      ],
    })
  );
  assert.equal(repetida.acao, "repetida");
  const outraEmpresa = prepararVendaHomologacao(
    pedido({
      sessoes: [
        {
          empresaId: "empresa-b",
          terminalCodigo: "terminal-a",
          idempotencyKey: "idem-b",
          status: "autorizada",
        },
      ],
    })
  );
  assert.equal(outraEmpresa.acao, "bloqueio_seguranca");
});

test("sessão técnica encerrada não bloqueia outra chave e a pendência remota continua bloqueando", async () => {
  const encerrado = prepararVendaHomologacao(
    pedido({
      idempotencyKey: "chave-nova",
      journal: {
        status: "sessao_tecnica_incompleta",
        correlationId: "chave-antiga",
        serverPndValor: "0",
      },
    })
  );
  assert.equal(encerrado.acao, "bloqueio_seguranca");
  assert.equal(encerrado.enviarComando, false);
  const repetida = prepararVendaHomologacao(
    pedido({
      idempotencyKey: "chave-antiga",
      journal: {
        status: "sessao_tecnica_incompleta",
        correlationId: "chave-antiga",
        serverPndValor: "0",
      },
    })
  );
  assert.equal(repetida.acao, "repetida");
  const remota = prepararVendaHomologacao(
    pedido({
      journal: {
        status: "sessao_tecnica_incompleta",
        correlationId: "outra",
        serverPndValor: "1",
      },
    })
  );
  assert.equal(remota.acao, "recuperar");
  assert.equal(remota.enviarComando, false);
  const perdida = prepararVendaHomologacao(
    pedido({
      idempotencyKey: "dc891000-31d5-4cb1-8d44-567c11d0abc9",
      journal: {
        status: "sessao_nativa_perdida_sem_autorizacao",
        correlationId: "dc891000-31d5-4cb1-8d44-567c11d0abc9",
        serverPndValor: "0",
        retomavel: false,
      },
    })
  );
  assert.equal(perdida.acao, "repetida");
  assert.equal(perdida.enviarComando, false);
  const outraChave = prepararVendaHomologacao(
    pedido({
      idempotencyKey: "chave-nova",
      journal: {
        status: "sessao_nativa_perdida_sem_autorizacao",
        correlationId: "dc891000-31d5-4cb1-8d44-567c11d0abc9",
        serverPndValor: "0",
        retomavel: false,
      },
    })
  );
  assert.equal(outraChave.acao, "bloqueio_seguranca");
  const spy = transporte();
  await executarVendaHomologacao(encerrado, spy);
  assert.deepEqual(spy.chamadas, []);
  assert.equal(ABI_COMPROVADO, false);
  assert.equal(LAYOUT_HOMOLOGADO, false);
});

test("journal técnico desconhecido bloqueia antes de qualquer comando", () => {
  const tecnico = prepararVendaHomologacao(
    pedido({ journal: { status: "resultado_desconhecido", transacaoIniciada: true } })
  );
  assert.equal(tecnico.acao, "recuperar");
  assert.equal(tecnico.enviarComando, false);
  assert.equal(tecnico.pagamentoRecebido, false);
});

test("produção é recusada e a DLL não recebe PWOPER_SALE", async () => {
  assert.equal(ABI_COMPROVADO, false);
  assert.equal(LAYOUT_HOMOLOGADO, false);
  const producao = prepararVendaHomologacao(
    pedido({ diretorio: "C:\\UltraPDV\\TEF\\Producao\\PGWeb", ambiente: "producao" })
  );
  assert.equal(producao.acao, "perfil");
  const bloqueio = prepararVendaHomologacao(pedido());
  assert.equal(bloqueio.acao, "bloqueio_seguranca");
  assert.equal(bloqueio.enviarComando, false);
  const spy = transporte();
  const executado = await executarVendaHomologacao(bloqueio, spy);
  const pronto = prepararVendaHomologacao(pedido());
  pronto.enviarComando = true;
  const retido = await executarVendaHomologacao(pronto, spy);
  assert.equal(executado.enviarComando, false);
  assert.equal(retido.acao, "nao_enviado");
  assert.deepEqual(spy.chamadas, []);
});
