import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  CODIGOS_TEF,
  GerenciadorTefNativo,
  NOME_TEF_NATIVO,
  observacaoEvidenciaInstalacao,
} from "./tef.mjs";
import { mensagemEvidenciaInstalacao } from "./tef-prova.mjs";

const empresa = "11111111-1111-4111-8111-111111111111";
const dispositivo = "33333333-3333-4333-8333-333333333333";
const terminal = "44444444-4444-4444-8444-444444444444";

function par() {
  const gerado = generateKeyPairSync("ed25519");
  return {
    publica: gerado.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privada: gerado.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function autorizado(chave, parcial = {}) {
  return {
    empresaId: empresa,
    dispositivoId: dispositivo,
    dispositivoLocal: dispositivo,
    terminalId: terminal,
    pontoCaptura: "200001",
    estabelecimento: "LOJA NOVA",
    ambiente: "homologacao",
    cnpj: "11222333000181",
    servidor: "tef.cliente.example:31735",
    chavePrivada: chave.privada,
    ...parcial,
  };
}

function resultadoNativo(parcial = {}) {
  return {
    sucessoChamada: true,
    sucessoTransacao: true,
    operacao: "PWOPER_INSTALL",
    codigoOperacao: 1,
    observacaoBiblioteca: true,
    pontoNaoExistia: true,
    retornoSetEnvironment: 0,
    instalacaoConcluida: true,
    pontoCaptura: "200001",
    ambiente: "homologacao",
    cnpj: "11222333000181",
    servidor: "tef.cliente.example:31735",
    estabelecimento: "LOJA NOVA",
    mensagem: "Ponto de captura instalado",
    rede: "",
    nsu: "",
    finalizacao: "",
    ...parcial,
  };
}

function criarProcesso() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = {
    partes: [],
    write(chunk) {
      this.partes.push(String(chunk));
      return true;
    },
    end() {},
  };
  proc.pid = 5151;
  proc.exitCode = null;
  proc.kill = () => {
    proc.simularSaida(1);
    return true;
  };
  proc.simularSaida = (code = 0) => {
    if (proc.exitCode != null) {
      return;
    }
    proc.exitCode = code;
    proc.emit("exit", code);
  };
  proc.emitirStdout = (texto) => {
    proc.stdout.emit("data", Buffer.from(texto));
  };
  return proc;
}

function criarGerenciador() {
  const processos = [];
  const arquivoPendencia = path.join(
    os.tmpdir(),
    `ultrapdv-evidencia-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );
  const arquivoPasta = path.join(
    os.tmpdir(),
    `ultrapdv-evidencia-pasta-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );
  let seq = 0;
  const gerenciador = new GerenciadorTefNativo({
    arquivoPendencia,
    arquivoPasta,
    localizar: async () => ({ encontrado: true, caminho: "C:\\UltraPDV\\ensaio-tef.exe" }),
    spawn: () => {
      const proc = criarProcesso();
      processos.push(proc);
      setImmediate(() => proc.emit("spawn"));
      return proc;
    },
    registrarLog: async () => {},
    criarId: () => {
      seq += 1;
      return `id-${seq}`;
    },
    agendar: () => ({ cancelado: false }),
    cancelarAgendamento: (item) => {
      if (item) {
        item.cancelado = true;
      }
    },
    limiteEncerramentoMs: 20,
    instalacaoAutomatica: false,
    listarDiretorioBiblioteca: async () => [],
  });
  return { gerenciador, processos, arquivoPendencia };
}

async function ate(condicao) {
  const inicio = Date.now();
  while (Date.now() - inicio < 1000) {
    if (condicao()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condição de teste não aconteceu");
}

function ultimaLinha(proc) {
  const linhas = proc.stdin.partes.join("").split(/\r?\n/).filter((linha) => linha.trim());
  return JSON.parse(linhas[linhas.length - 1]);
}

async function deixarInicializado(gerenciador, processos, identidade = null) {
  const pendente = gerenciador.inicializar(identidade);
  await ate(() => processos.length === 1 && processos[0].stdin.partes.length === 1);
  const proc = processos[0];
  const pedido = ultimaLinha(proc);
  const diretorio = pedido.dados?.diretorio;
  proc.emitirStdout(
    `${JSON.stringify({
      id: pedido.id,
      ok: true,
      resultado: {
        inicializado: true,
        ...(diretorio ? { diretorioBiblioteca: diretorio } : {}),
      },
      erro: null,
    })}\n`
  );
  await pendente;
  return proc;
}

function conferir(chave, evidencia) {
  return verify(
    null,
    Buffer.from(mensagemEvidenciaInstalacao(evidencia.campos)),
    createPublicKey(chave.publica),
    Buffer.from(evidencia.assinatura, "base64")
  );
}

test("instalação nova em homologação e produção assina só a observação da biblioteca", () => {
  const chave = par();
  const homologacao = observacaoEvidenciaInstalacao(
    resultadoNativo(),
    autorizado(chave),
    "55555555-5555-4555-8555-555555555555"
  );
  const producao = observacaoEvidenciaInstalacao(
    resultadoNativo({ ambiente: "producao", pontoCaptura: "300002" }),
    autorizado(chave, { ambiente: "producao", pontoCaptura: "300002" }),
    "56565656-5656-4565-8565-565656565656"
  );
  assert.equal(homologacao.ambienteSolicitado, "homologacao");
  assert.equal(producao.ambienteSolicitado, "producao");
  assert.notEqual(homologacao.instalacaoId, producao.instalacaoId);
});

test("falha de ambiente, de instalação, ponto existente ou resposta simulada não gera evidência", () => {
  const chave = par();
  const base = autorizado(chave);
  const id = "55555555-5555-4555-8555-555555555555";
  assert.equal(
    observacaoEvidenciaInstalacao(resultadoNativo({ retornoSetEnvironment: -1 }), base, id),
    null
  );
  assert.equal(
    observacaoEvidenciaInstalacao(resultadoNativo({ instalacaoConcluida: false, sucessoTransacao: false }), base, id),
    null
  );
  assert.equal(
    observacaoEvidenciaInstalacao(resultadoNativo({ pontoNaoExistia: false, observacaoBiblioteca: false }), base, id),
    null
  );
  assert.equal(
    observacaoEvidenciaInstalacao(
      resultadoNativo({ observacaoBiblioteca: false, sucessoTransacao: true }),
      base,
      id
    ),
    null
  );
  assert.equal(
    observacaoEvidenciaInstalacao(resultadoNativo({ instalacaoId: id }), base, id),
    null
  );
  assert.equal(observacaoEvidenciaInstalacao(resultadoNativo({ cnpj: "22333444000181" }), base, id), null);
  assert.equal(
    observacaoEvidenciaInstalacao(resultadoNativo({ servidor: "outro.example:443" }), base, id),
    null
  );
  assert.equal(
    observacaoEvidenciaInstalacao(resultadoNativo({ estabelecimento: "OUTRA LOJA" }), base, id),
    null
  );
  assert.equal(observacaoEvidenciaInstalacao(resultadoNativo(), null, id), null);
  assert.equal(
    observacaoEvidenciaInstalacao(
      resultadoNativo(),
      autorizado(chave, { dispositivoLocal: "34343434-3434-4343-8343-343434343434" }),
      id
    ),
    null
  );
});

test("o instalar() assina homologação e produção e recusa assinatura alterada", async () => {
  const chave = par();
  const homologacaoAutorizada = autorizado(chave);
  const { gerenciador, processos } = criarGerenciador();
  const proc = await deixarInicializado(gerenciador, processos, homologacaoAutorizada);
  const homologacao = gerenciador.instalar(homologacaoAutorizada);
  await ate(() => proc.stdin.partes.length === 2);
  const pedidoHomologacao = ultimaLinha(proc);
  assert.equal(pedidoHomologacao.dados.ambiente, "homologacao");
  assert.equal(pedidoHomologacao.dados.pontoCaptura, "200001");
  assert.equal(pedidoHomologacao.dados.cnpj, "11222333000181");
  assert.equal(pedidoHomologacao.dados.servidor, "tef.cliente.example:31735");
  assert.equal(JSON.stringify(pedidoHomologacao).includes("117473"), false);
  proc.emitirStdout(
    `${JSON.stringify({
      id: pedidoHomologacao.id,
      ok: true,
      resultado: resultadoNativo(),
      erro: null,
    })}\n`
  );
  const respostaHomologacao = await homologacao;
  assert.equal(respostaHomologacao.ok, true);
  assert.equal(respostaHomologacao.evidencia.campos.ambiente, "homologacao");
  assert.equal(conferir(chave, respostaHomologacao.evidencia), true);
  assert.equal(
    conferir(chave, {
      ...respostaHomologacao.evidencia,
      assinatura: `${respostaHomologacao.evidencia.assinatura.slice(0, -2)}aa`,
    }),
    false
  );

  const outraEmpresa = "22222222-2222-4222-8222-222222222222";
  const producaoAutorizada = autorizado(chave, {
    empresaId: outraEmpresa,
    ambiente: "producao",
    pontoCaptura: "300002",
    cnpj: "22333444000181",
    servidor: "tef.outra.example:443",
    estabelecimento: "OUTRA LOJA",
  });
  const troca = await gerenciador.instalar(producaoAutorizada);
  assert.equal(troca.ok, false);
  assert.equal(troca.codigo, CODIGOS_TEF.OPERACAO_NAO_PERMITIDA);
  assert.equal(troca.evidencia, null);
  assert.equal(proc.stdin.partes.length, 2);

  const producao = criarGerenciador();
  const procProducao = await deixarInicializado(
    producao.gerenciador,
    producao.processos,
    producaoAutorizada
  );
  const pedidoProducaoPendente = producao.gerenciador.instalar(producaoAutorizada);
  await ate(() => procProducao.stdin.partes.length === 2);
  const pedidoProducao = ultimaLinha(procProducao);
  procProducao.emitirStdout(
    `${JSON.stringify({
      id: pedidoProducao.id,
      ok: true,
      resultado: resultadoNativo({
        ambiente: "producao",
        pontoCaptura: "300002",
        cnpj: "22333444000181",
        servidor: "tef.outra.example:443",
        estabelecimento: "OUTRA LOJA",
      }),
      erro: null,
    })}\n`
  );
  const respostaProducao = await pedidoProducaoPendente;
  assert.equal(respostaProducao.evidencia.campos.ambiente, "producao");
  assert.equal(respostaProducao.evidencia.campos.pontoCaptura, "300002");
  assert.equal(respostaProducao.evidencia.campos.empresaId, outraEmpresa);
  assert.notEqual(
    respostaHomologacao.evidencia.campos.instalacaoId,
    respostaProducao.evidencia.campos.instalacaoId
  );
  await fs.rm(producao.arquivoPendencia, { force: true });
});

test("credencial ausente, interrupção e pendência financeira não assinam nem repetem a instalação", async () => {
  const chave = par();
  const semCredencial = criarGerenciador();
  const procSemCredencial = await deixarInicializado(
    semCredencial.gerenciador,
    semCredencial.processos
  );
  const cru = await semCredencial.gerenciador.instalar(null);
  assert.equal(cru.ok, false);
  assert.equal(cru.codigo, CODIGOS_TEF.OPERACAO_NAO_PERMITIDA);
  assert.equal(cru.evidencia, null);
  assert.equal(procSemCredencial.stdin.partes.length, 1);
  assert.equal(procSemCredencial.stdin.partes.join("").includes('"acao":"instalar"'), false);

  const interrompido = criarGerenciador();
  const credencial = autorizado(chave);
  const procInterrompido = await deixarInicializado(
    interrompido.gerenciador,
    interrompido.processos,
    credencial
  );
  const queda = interrompido.gerenciador.instalar(credencial);
  await ate(() => procInterrompido.stdin.partes.length === 2);
  procInterrompido.simularSaida(1);
  const respostaQueda = await queda;
  assert.equal(respostaQueda.ok, false);
  assert.equal(respostaQueda.codigo, CODIGOS_TEF.PROCESSO_ENCERRADO);
  assert.equal(respostaQueda.evidencia, null);

  const pendente = criarGerenciador();
  const procPendente = await deixarInicializado(
    pendente.gerenciador,
    pendente.processos,
    autorizado(chave)
  );
  const venda = pendente.gerenciador.pagar({ identificador: "VENDA-1", valor: 10 });
  await ate(() => procPendente.stdin.partes.length === 2);
  const pedidoVenda = ultimaLinha(procPendente);
  procPendente.emitirStdout(
    `${JSON.stringify({
      id: pedidoVenda.id,
      ok: true,
      resultado: {
        sucessoTransacao: true,
        confirmar: true,
        rede: "CIELO",
        nsu: "123456",
        finalizacao: "ABC",
        valor: 10,
      },
      erro: null,
    })}\n`
  );
  await venda;
  const linhas = procPendente.stdin.partes.length;
  const bloqueio = await pendente.gerenciador.instalar(autorizado(chave));
  assert.equal(bloqueio.codigo, CODIGOS_TEF.TRANSACAO_PENDENTE);
  assert.equal(bloqueio.evidencia, null);
  assert.equal(procPendente.stdin.partes.length, linhas);
  await fs.rm(pendente.arquivoPendencia, { force: true });
  await fs.rm(semCredencial.arquivoPendencia, { force: true });
  await fs.rm(interrompido.arquivoPendencia, { force: true });
});

test("ausência de parâmetros, outra empresa, outro ponto e outro ambiente não instalam", async () => {
  const chave = par();
  const base = autorizado(chave);
  const { gerenciador, processos, arquivoPendencia } = criarGerenciador();
  const proc = await deixarInicializado(gerenciador, processos, base);
  assert.deepEqual(ultimaLinha(proc).dados, {
    pontoCaptura: "200001",
    ambiente: "homologacao",
    cnpj: "11222333000181",
    servidor: "tef.cliente.example:31735",
    estabelecimento: "LOJA NOVA",
    diretorio: "sandbox",
  });

  const semParametros = await gerenciador.inicializar({ pontoCaptura: "200001" });
  assert.equal(semParametros.codigo, CODIGOS_TEF.DADOS_INVALIDOS);
  assert.equal(proc.stdin.partes.length, 1);

  const semCnpj = await gerenciador.instalar(autorizado(chave, { cnpj: "" }));
  assert.equal(semCnpj.codigo, CODIGOS_TEF.DADOS_INVALIDOS);
  assert.equal(semCnpj.evidencia, null);

  const semCredencial = await gerenciador.instalar(autorizado(chave, { chavePrivada: "" }));
  assert.equal(semCredencial.codigo, CODIGOS_TEF.OPERACAO_NAO_PERMITIDA);
  assert.equal(semCredencial.evidencia, null);

  const outroPonto = await gerenciador.instalar(autorizado(chave, { pontoCaptura: "300002" }));
  assert.equal(outroPonto.codigo, CODIGOS_TEF.OPERACAO_NAO_PERMITIDA);
  assert.equal(outroPonto.evidencia, null);

  const outroAmbiente = await gerenciador.instalar(autorizado(chave, { ambiente: "producao" }));
  assert.equal(outroAmbiente.codigo, CODIGOS_TEF.OPERACAO_NAO_PERMITIDA);
  assert.equal(outroAmbiente.evidencia, null);

  const outraEmpresa = await gerenciador.inicializar(
    autorizado(chave, {
      empresaId: "22222222-2222-4222-8222-222222222222",
      pontoCaptura: "300002",
      ambiente: "producao",
      cnpj: "22333444000181",
      servidor: "tef.outra.example:443",
      estabelecimento: "OUTRA LOJA",
    })
  );
  assert.equal(outraEmpresa.codigo, CODIGOS_TEF.OPERACAO_NAO_PERMITIDA);
  assert.equal(proc.stdin.partes.length, 1);

  const instalacao = gerenciador.instalar(base);
  await ate(() => proc.stdin.partes.length === 2);
  const pedido = ultimaLinha(proc);
  proc.emitirStdout(
    `${JSON.stringify({
      id: pedido.id,
      ok: true,
      resultado: resultadoNativo({ cnpj: "22333444000181" }),
      erro: null,
    })}\n`
  );
  const divergente = await instalacao;
  assert.equal(divergente.ok, true);
  assert.equal(divergente.evidencia, null);
  assert.equal(proc.stdin.partes.length, 2);
  await fs.rm(arquivoPendencia, { force: true });
});
