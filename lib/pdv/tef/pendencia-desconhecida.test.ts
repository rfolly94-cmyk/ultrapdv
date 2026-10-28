import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classificarPendenciaTef } from "./regras";
import {
  iniciarOperacao,
  listarPendencias,
  memoriaTefVazia,
  pedirDesfazimento,
  recuperarSimulacao,
  salvarConfigEmpresa,
  type MemoriaTef,
} from "./orquestracao";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const EMPRESA_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMPRESA_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CHAVE = "2bdce519-9fb2-4c7a-9e3e-c81025b1e7e5";
const CHAVE_VENDA = "f4142f44-5df9-4a13-95ae-4be5fb3bf166";

function memoria(): MemoriaTef {
  const atual = memoriaTefVazia();
  atual.plataformaHabilitada = true;
  salvarConfigEmpresa(atual, EMPRESA_A, {
    habilitado: true,
    ambiente: "homologacao",
    estabelecimento: "LOJA-A",
    pontoCaptura: "001",
  });
  return atual;
}

function pendenciaDesconhecida(atual: MemoriaTef, extra: { teste?: boolean; empresaId?: string } = {}) {
  const inicio = iniciarOperacao(atual, {
    empresaId: extra.empresaId ?? EMPRESA_A,
    dispositivoId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    terminalCodigo: "CX01",
    modalidade: "debito",
    valorCentavos: 5500,
    identificador: "86a8d369-b974-4f2c-9e00-48ca5308bdfc",
    idempotencyKey: CHAVE,
    teste: extra.teste === true,
  });
  assert.equal(inicio.ok, true);
  const operacao = atual.operacoes[0];
  assert.ok(operacao);
  operacao.status = "desconhecida";
  operacao.teste = extra.teste === true;
  operacao.nsu = null;
  operacao.autorizacao = null;
  operacao.rede = null;
  operacao.finalizacao = null;
  operacao.vendaId = null;
  operacao.vendaIdempotencyKey = CHAVE_VENDA;
  operacao.ambienteEfetivo = "";
  operacao.motivoAmbiente = "";
  return operacao;
}

test("resultado desconhecido do Connector não é simulação nem autorização", () => {
  const classe = classificarPendenciaTef({
    status: "desconhecida",
    teste: false,
    nsu: "",
    rede: "",
    finalizacao: "",
  });
  assert.equal(classe.origem, "conector");
  assert.equal(classe.simulacao, false);
  assert.equal(classe.recuperarNoCaixa, false);
  assert.match(classe.rotulo, /sem autorização comprovada/);
});

test("recuperar a pendência desconhecida não confirma, não desfaz e não altera o registro", () => {
  const atual = memoria();
  const operacao = pendenciaDesconhecida(atual);
  const pedido = pedirDesfazimento(atual, {
    empresaId: EMPRESA_A,
    operacaoId: operacao.id,
  });
  assert.equal(pedido.ok, true);
  if (pedido.ok) {
    assert.equal(pedido.executar, "nenhum");
  }
  assert.equal(operacao.status, "desconhecida");
  assert.equal(operacao.idempotencyKey, CHAVE);
  assert.equal(operacao.vendaIdempotencyKey, CHAVE_VENDA);
  assert.equal(operacao.vendaId, null);
  assert.equal(atual.operacoes.length, 1);
  const lista = listarPendencias(atual, EMPRESA_A);
  assert.equal(lista.length, 1);
  assert.equal(lista[0]?.recuperarNoCaixa, false);
  assert.equal(lista[0]?.simulacao, false);
  assert.equal(listarPendencias(atual, EMPRESA_B).length, 0);
});

test("simulação desconhecida recupera uma vez, preserva idempotência e some da lista", () => {
  const atual = memoria();
  const operacao = pendenciaDesconhecida(atual, { teste: true });
  const primeira = recuperarSimulacao(atual, {
    empresaId: EMPRESA_A,
    operacaoId: operacao.id,
  });
  assert.equal(primeira.ok, true);
  if (primeira.ok) {
    assert.equal(primeira.repetida, false);
    assert.equal(primeira.idempotencyKey, CHAVE);
  }
  assert.equal(operacao.status, "cancelada");
  assert.equal(operacao.teste, true);
  assert.equal(operacao.idempotencyKey, CHAVE);
  const segunda = recuperarSimulacao(atual, {
    empresaId: EMPRESA_A,
    operacaoId: operacao.id,
  });
  assert.equal(segunda.ok, true);
  if (segunda.ok) {
    assert.equal(segunda.repetida, true);
    assert.equal(segunda.idempotencyKey, CHAVE);
  }
  assert.equal(atual.operacoes.length, 1);
  assert.equal(listarPendencias(atual, EMPRESA_A).length, 0);
});

test("outra empresa e uma pendência real não recuperam a simulação", () => {
  const atual = memoria();
  const operacao = pendenciaDesconhecida(atual, { teste: true });
  const cruzada = recuperarSimulacao(atual, {
    empresaId: EMPRESA_B,
    operacaoId: operacao.id,
  });
  assert.equal(cruzada.ok, false);
  assert.equal(operacao.status, "desconhecida");
  operacao.teste = false;
  const real = recuperarSimulacao(atual, {
    empresaId: EMPRESA_A,
    operacaoId: operacao.id,
  });
  assert.equal(real.ok, false);
  if (!real.ok) {
    assert.equal(real.codigo, "NAO_SIMULADA");
  }
  assert.equal(operacao.status, "desconhecida");
  assert.equal(operacao.idempotencyKey, CHAVE);
});

test("o caixa não envia resultado desconhecido para confirmação ou desfazimento", () => {
  const shell = readFileSync(join(raiz, "components/pdv/pdv-shell.tsx"), "utf8");
  assert.match(shell, /Cobrança bloqueada\. A pendência permanece/);
  assert.equal(shell.includes("/api/pdv/tef/recuperar-simulacao"), false);
  assert.equal(shell.includes("Recuperar pendência TEF"), false);
  assert.match(shell, /if \(!resultadoMotor\.pagamentoRecebido\)/);
  assert.doesNotMatch(shell, /PW_iConfirmation/);
});
