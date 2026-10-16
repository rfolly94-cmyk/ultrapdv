import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assumirExecucao,
  conduzirImpressaoPdv,
  confirmacaoFinanceiraPendente,
  enfileirarImpressaoAutomatica,
  filaImpressaoVazia,
  gravarFilaImpressaoPdv,
  iniciarImpressaoSemBloquear,
  lerFilaImpressaoPdv,
  planejarPosVenda,
  recuperarFilaImpressaoPdv,
  registrarResultadoImpressao,
  solicitarReimpressao,
  type ArmazenamentoImpressao,
  type FilaImpressaoPdv,
} from "./impressao-fila";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "../..");
const VENDA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMISSAO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function memoria() {
  let fila = filaImpressaoVazia();
  const emCurso = new Set<string>();
  return {
    emCurso,
    ler: () => fila,
    gravar: (proxima: FilaImpressaoPdv) => {
      fila = proxima;
    },
  };
}

function armazenamento(): ArmazenamentoImpressao & { texto: () => string | null } {
  let valor: string | null = null;
  return {
    getItem: () => valor,
    setItem: (_chave, texto) => {
      valor = texto;
    },
    texto: () => valor,
  };
}

test("impressão lenta libera o caixa antes do conector terminar", async () => {
  const eventos: string[] = [];
  let concluir = () => {};
  const pendente = new Promise<void>((resolver) => {
    concluir = resolver;
  });
  const plano = planejarPosVenda({
    houveTef: true,
    confirmacaoLiberada: true,
    confirmacaoOk: true,
    emitirNfce: true,
    nfceAutorizada: true,
    documentoDisponivel: true,
  });
  const corrida = iniciarImpressaoSemBloquear({
    liberarCaixa: plano.liberarCaixa,
    aoLiberar: () => eventos.push("liberado"),
    imprimir: plano.imprimirEmSegundoPlano
      ? async () => {
          eventos.push("inicio-impressao");
          await pendente;
          eventos.push("fim-impressao");
        }
      : null,
  });
  assert.deepEqual(eventos, ["liberado", "inicio-impressao"]);
  concluir();
  await corrida.impressao;
  assert.deepEqual(eventos, ["liberado", "inicio-impressao", "fim-impressao"]);
});

test("falha do Connector grava falhou e não imprime de novo", async () => {
  const base = memoria();
  let chamadas = 0;
  const enfileirado = enfileirarImpressaoAutomatica(base.ler(), {
    vendaId: VENDA,
    emissaoId: EMISSAO,
    documento: "danfe_nfce",
    agora: "2026-10-14T12:00:00.000Z",
  });
  base.gravar(enfileirado.fila);
  const primeiro = await conduzirImpressaoPdv({
    ler: base.ler,
    gravar: base.gravar,
    trabalho: enfileirado.trabalho,
    emCurso: base.emCurso,
    agora: () => "2026-10-14T12:00:01.000Z",
    imprimir: async () => {
      chamadas += 1;
      return { ok: false, erro: "Connector indisponível" };
    },
  });
  assert.equal(primeiro.aplicado, true);
  assert.equal(primeiro.trabalho.estado, "falhou");
  assert.equal(chamadas, 1);
  const repetido = enfileirarImpressaoAutomatica(base.ler(), {
    vendaId: VENDA,
    emissaoId: EMISSAO,
    documento: "danfe_nfce",
    agora: "2026-10-14T12:00:02.000Z",
  });
  assert.equal(repetido.iniciar, false);
  assert.equal(chamadas, 1);
});

test("fechar a janela durante a impressão não perde o trabalho nem reenvia sozinho", () => {
  const enfileirado = enfileirarImpressaoAutomatica(filaImpressaoVazia(), {
    vendaId: VENDA,
    emissaoId: EMISSAO,
    documento: "danfe_nfce",
    agora: "2026-10-14T12:00:00.000Z",
  });
  const assumido = assumirExecucao(
    enfileirado.fila,
    enfileirado.trabalho.id,
    new Set(),
    "2026-10-14T12:00:01.000Z"
  );
  assert.ok(assumido);
  const disco = armazenamento();
  gravarFilaImpressaoPdv(assumido.fila, disco);
  const recuperado = recuperarFilaImpressaoPdv(
    lerFilaImpressaoPdv(disco),
    "2026-10-14T12:05:00.000Z"
  );
  assert.equal(recuperado.retomar.length, 0);
  assert.equal(recuperado.interrompidos.length, 1);
  assert.equal(recuperado.interrompidos[0]?.estado, "falhou");
  assert.match(recuperado.interrompidos[0]?.erro ?? "", /Reimprima/);
  const outra = enfileirarImpressaoAutomatica(recuperado.fila, {
    vendaId: VENDA,
    emissaoId: EMISSAO,
    documento: "danfe_nfce",
    agora: "2026-10-14T12:05:01.000Z",
  });
  assert.equal(outra.iniciar, false);
});

test("resposta atrasada não troca o resultado nem imprime outra vez", () => {
  const enfileirado = enfileirarImpressaoAutomatica(filaImpressaoVazia(), {
    vendaId: VENDA,
    emissaoId: EMISSAO,
    documento: "danfe_nfce",
    agora: "2026-10-14T12:00:00.000Z",
  });
  const assumido = assumirExecucao(
    enfileirado.fila,
    enfileirado.trabalho.id,
    new Set(),
    "2026-10-14T12:00:01.000Z"
  );
  assert.ok(assumido);
  const concluido = registrarResultadoImpressao(assumido.fila, {
    id: assumido.trabalho.id,
    execucao: assumido.execucao,
    ok: true,
    agora: "2026-10-14T12:00:02.000Z",
  });
  assert.equal(concluido.aplicado, true);
  const atrasada = registrarResultadoImpressao(concluido.fila, {
    id: assumido.trabalho.id,
    execucao: assumido.execucao,
    ok: false,
    erro: "timeout antigo",
    agora: "2026-10-14T12:00:09.000Z",
  });
  assert.equal(atrasada.aplicado, false);
  assert.equal(atrasada.trabalho?.estado, "concluido");
  const execucaoErrada = registrarResultadoImpressao(concluido.fila, {
    id: assumido.trabalho.id,
    execucao: assumido.execucao + 1,
    ok: false,
    agora: "2026-10-14T12:00:10.000Z",
  });
  assert.equal(execucaoErrada.aplicado, false);
});

test("cliques repetidos não duplicam e a reimpressão explícita espera o término", () => {
  const primeiro = enfileirarImpressaoAutomatica(filaImpressaoVazia(), {
    vendaId: VENDA,
    emissaoId: EMISSAO,
    documento: "danfe_nfce",
    agora: "2026-10-14T12:00:00.000Z",
  });
  const segundo = enfileirarImpressaoAutomatica(primeiro.fila, {
    vendaId: VENDA,
    emissaoId: EMISSAO,
    documento: "danfe_nfce",
    agora: "2026-10-14T12:00:01.000Z",
  });
  assert.equal(segundo.iniciar, false);
  assert.equal(segundo.fila.trabalhos.length, 1);
  const assumido = assumirExecucao(primeiro.fila, primeiro.trabalho.id, new Set(), "t2");
  assert.ok(assumido);
  const durante = solicitarReimpressao(assumido.fila, {
    vendaId: VENDA,
    emissaoId: EMISSAO,
    documento: "danfe_nfce",
    agora: "t3",
  });
  assert.equal(durante.iniciar, false);
  const concluido = registrarResultadoImpressao(assumido.fila, {
    id: primeiro.trabalho.id,
    execucao: assumido.execucao,
    ok: true,
    agora: "t4",
  });
  const reimpressao = solicitarReimpressao(concluido.fila, {
    vendaId: VENDA,
    emissaoId: EMISSAO,
    documento: "danfe_nfce",
    agora: "t5",
  });
  assert.equal(reimpressao.iniciar, true);
  assert.equal(reimpressao.trabalho?.origem, "reimpressao");
  assert.notEqual(reimpressao.trabalho?.id, primeiro.trabalho.id);
  assert.equal(reimpressao.trabalho?.vendaId, VENDA);
  assert.equal(reimpressao.trabalho?.emissaoId, EMISSAO);
});

test("confirmação ou conciliação financeira impede liberar o caixa", () => {
  assert.equal(
    confirmacaoFinanceiraPendente({
      houveTef: true,
      confirmacaoLiberada: false,
      confirmacaoOk: false,
    }),
    true
  );
  const plano = planejarPosVenda({
    houveTef: true,
    confirmacaoLiberada: true,
    confirmacaoOk: false,
    emitirNfce: true,
    nfceAutorizada: true,
    documentoDisponivel: true,
  });
  assert.equal(plano.liberarCaixa, false);
  assert.equal(plano.imprimirEmSegundoPlano, true);
  const semTef = planejarPosVenda({
    houveTef: false,
    confirmacaoLiberada: false,
    confirmacaoOk: false,
    emitirNfce: true,
    nfceAutorizada: true,
    documentoDisponivel: true,
  });
  assert.equal(semTef.liberarCaixa, true);
});

test("resposta da mesma execução conclui o trabalho interrompido sem imprimir de novo", async () => {
  const base = memoria();
  let chamadas = 0;
  let concluir = () => {};
  const espera = new Promise<void>((resolver) => {
    concluir = resolver;
  });
  const enfileirado = enfileirarImpressaoAutomatica(base.ler(), {
    vendaId: VENDA,
    emissaoId: EMISSAO,
    documento: "danfe_nfce",
    agora: "2026-10-14T12:00:00.000Z",
  });
  base.gravar(enfileirado.fila);
  const corrida = conduzirImpressaoPdv({
    ler: base.ler,
    gravar: base.gravar,
    trabalho: enfileirado.trabalho,
    emCurso: base.emCurso,
    agora: () => "2026-10-14T12:00:02.000Z",
    imprimir: async () => {
      chamadas += 1;
      await espera;
      return { ok: true };
    },
  });
  const recuperado = recuperarFilaImpressaoPdv(base.ler(), "2026-10-14T12:00:01.000Z");
  base.gravar(recuperado.fila);
  assert.equal(recuperado.retomar.length, 0);
  assert.equal(recuperado.interrompidos[0]?.estado, "falhou");
  concluir();
  const fim = await corrida;
  assert.equal(fim.aplicado, true);
  assert.equal(fim.trabalho.estado, "concluido");
  assert.equal(chamadas, 1);
  const outra = enfileirarImpressaoAutomatica(base.ler(), {
    vendaId: VENDA,
    emissaoId: EMISSAO,
    documento: "danfe_nfce",
    agora: "2026-10-14T12:00:03.000Z",
  });
  assert.equal(outra.iniciar, false);
});

test("o F2 publica a liberação sem aguardar a impressão e não reaproveita a chave da venda", () => {
  const shell = readFileSync(join(raiz, "components/pdv/pdv-shell.tsx"), "utf8");
  const nfce = shell.indexOf('relogio.medir("nfce_emissao"');
  const depoisDaNfce = shell.slice(nfce);
  const liberacao = depoisDaNfce.indexOf("iniciarImpressaoSemBloquear");
  const resumo = depoisDaNfce.indexOf("publicarResumo");
  assert.ok(nfce > 0);
  assert.ok(liberacao > 0);
  assert.ok(resumo > liberacao);
  assert.doesNotMatch(shell, /await tentarImpressaoPosVenda/);
  assert.match(shell, /chavesTefRef\.current = \{\}/);
  assert.match(shell, /idempotencyRef\.current =\s*null/);
  assert.match(shell, /if \(!manterBloqueioFinanceiro\)/);
});
