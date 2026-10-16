import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  SCRIPT_SELETOR_PASTA,
  classificarFalhaArquivo,
  copiarBackupIntegro,
  criarServicoPastaTef,
  descreverRetornoPwInit,
  aplicarMigracao,
  auditarAcl,
  avaliarMigracao,
  concederAcessoProcesso,
  contaProcessoTef,
  diretorioPaiPersistido,
  diretoriosOperacionais,
  payloadSalvarPermitido,
  planejarDiretorioInicial,
  entradasAclDiretorio,
  instalarPastaPadrao,
  prepararDiretoriosOperacionais,
  registrarResultadoAtivacao,
  testarGravacaoOperacional,
  testarGravacaoPasta,
  validarPastaConfirmada,
  validarPastaLocal,
  verificarSeletorInterativo,
} from "./tef-pasta.mjs";
import { prepararPastaPadraoInstalador } from "./tef-preparar-pasta.mjs";
import { GerenciadorTefNativo, NOME_TEF_NATIVO } from "./tef.mjs";

const raizRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function ambiente(extra = {}) {
  return {
    caminho: "D:\\dados\\PayGo",
    ambiente: "producao",
    raizExecutavel: "D:\\agente\\bin\\tef",
    producaoPai: "D:\\ProgramData\\UltraPDV\\TEF\\Producao",
    sandboxPai: "D:\\agente\\bin\\tef\\TEF",
    programFiles: ["D:\\Program Files", "D:\\Program Files (x86)"],
    tipoUnidade: "local",
    ...extra,
  };
}

test("rejeita rede, sistema, Program Files e caminho arbitrário", () => {
  const base = ambiente();
  assert.equal(validarPastaLocal({ ...base, caminho: "\\\\servidor\\pasta" }).ok, false);
  assert.equal(validarPastaLocal({ ...base, caminho: "D:\\dados\\..\\Windows" }).ok, false);
  assert.equal(validarPastaLocal({ ...base, caminho: "pasta-relativa" }).ok, false);
  assert.equal(validarPastaLocal({ ...base, caminho: "D:\\Windows\\Temp" }).ok, false);
  assert.equal(validarPastaLocal({ ...base, caminho: "D:\\Windows\\System32\\config" }).ok, false);
  assert.equal(validarPastaLocal({ ...base, caminho: "D:\\Program Files\\PayGo" }).ok, false);
  assert.match(validarPastaLocal({ ...base, tipoUnidade: "rede" }).mensagem, /rede/);
  const ok = validarPastaLocal(base);
  assert.equal(ok.ok, true);
  assert.equal(ok.efetivo, "D:\\dados\\PayGo\\PGWeb");
  assert.equal(ok.pronto, false);
});

test("produção e homologação ficam isoladas", () => {
  const producaoDentro = validarPastaLocal(
    ambiente({ caminho: "D:\\agente\\bin\\tef\\TEF\\cliente" })
  );
  assert.equal(producaoDentro.ok, false);
  const sandboxDentro = validarPastaLocal(
    ambiente({
      ambiente: "homologacao",
      caminho: "D:\\ProgramData\\UltraPDV\\TEF\\Producao\\cliente",
    })
  );
  assert.equal(sandboxDentro.ok, false);
  const recomendada = validarPastaLocal(
    ambiente({
      ambiente: "homologacao",
      caminho: "D:\\Program Files\\UltraPDV Connector\\bin\\tef\\TEF",
      sandboxPai: "D:\\Program Files\\UltraPDV Connector\\bin\\tef\\TEF",
      programFiles: ["D:\\Program Files"],
      permitirProgramFilesExato: true,
    })
  );
  assert.equal(recomendada.ok, true);
  const escolhida = validarPastaLocal(
    ambiente({
      ambiente: "homologacao",
      caminho: "D:\\Program Files\\UltraPDV Connector\\bin\\tef\\TEF",
      sandboxPai: "D:\\Program Files\\UltraPDV Connector\\bin\\tef\\TEF",
      programFiles: ["D:\\Program Files"],
      permitirProgramFilesExato: false,
    })
  );
  assert.equal(escolhida.ok, false);
});

test("o retorno de PW_iInit é exibido e o teste de gravação não marca pronto", async () => {
  const init = descreverRetornoPwInit(-2485, "");
  assert.equal(init.texto, "-2485 PWRET_WRITERR");
  assert.equal(init.pronto, false);
  assert.equal(classificarFalhaArquivo({ code: "EACCES" }).codigo, "permissao");
  assert.equal(classificarFalhaArquivo({ code: "EBUSY" }).codigo, "bloqueio");
  assert.equal(classificarFalhaArquivo({ code: "EIO" }).codigo, "interno");
  const falha = await testarGravacaoPasta("D:\\dados", {
    mkdir: async () => {},
    writeFile: async () => {
      const erro = new Error("acesso");
      erro.code = "EACCES";
      throw erro;
    },
    unlink: async () => {},
  });
  assert.equal(falha.ok, false);
  assert.equal(falha.pronto, false);
  assert.equal(falha.codigo, "permissao");
});

test("o navegador não escolhe o caminho e a falha mantém a pasta antiga", async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-pasta-"));
  const arquivo = path.join(raiz, "tef-pasta.json");
  const antiga = path.join(raiz, "antiga");
  const nova = path.join(raiz, "nova");
  await fs.mkdir(antiga, { recursive: true });
  await fs.writeFile(
    arquivo,
    `${JSON.stringify({ versao: 1, producao: { pai: antiga, efetivo: path.join(antiga, "PGWeb") } })}\n`,
    "utf8"
  );
  let dialogos = 0;
  const fsApi = {
    mkdir: fs.mkdir,
    readFile: fs.readFile,
    rename: fs.rename,
    unlink: fs.unlink,
    readdir: fs.readdir,
    access: fs.access,
    copyFile: fs.copyFile,
    writeFile: async (alvo, dados, encoding) => {
      if (String(alvo).includes(path.join("nova", "PGWeb"))) {
        const erro = new Error("acesso");
        erro.code = "EACCES";
        throw erro;
      }
      return fs.writeFile(alvo, dados, encoding);
    },
  };
  const servico = criarServicoPastaTef({
    arquivo,
    raizExecutavel: path.join(raiz, "agente"),
    producaoPai: path.join(raiz, "recomendada"),
    sandboxPai: path.join(raiz, "sandbox"),
    programFiles: [path.join(raiz, "Program Files")],
    classificarUnidade: async () => "local",
    destinoBackup: path.join(raiz, "backup"),
    restringir: async () => ({ ok: true }),
    abrirSeletor: async () => {
      dialogos += 1;
      return { caminho: nova };
    },
    fsApi,
  });
  const bloqueado = await servico.escolher(
    { ambiente: "producao", inicializado: true },
    {}
  );
  assert.equal(bloqueado.ok, false);
  assert.equal(dialogos, 0);
  const pendente = await servico.salvar(
    {
      ambiente: "producao",
      journal: { status: "pagamento_em_andamento" },
    },
    { confirmar: true, usarRecomendada: true }
  );
  assert.equal(pendente.ok, false);
  assert.match(pendente.mensagem, /pendente/);
  const recuperacao = await servico.salvar(
    {
      ambiente: "producao",
      recuperacao: { sucessoTransacao: true, cancelada: false },
    },
    { confirmar: true, usarRecomendada: true }
  );
  assert.equal(recuperacao.ok, false);
  assert.equal(payloadSalvarPermitido({ confirmar: true, selecaoId: "abc", caminho: nova }), false);
  const escolha = await servico.escolher({ ambiente: "producao" }, { caminho: nova });
  assert.equal(escolha.ok, false);
  assert.equal(dialogos, 0);
  const aberta = await servico.escolher({ ambiente: "producao" }, {});
  assert.equal(aberta.ok, true);
  assert.equal(aberta.pronto, false);
  assert.equal(aberta.efetivo, path.join(nova, "PGWeb"));
  const recusada = await servico.salvar(
    { ambiente: "producao" },
    { confirmar: true, selecaoId: aberta.selecaoId, caminho: path.join(raiz, "outra") }
  );
  assert.equal(recusada.ok, false);
  const gravacao = await servico.salvar(
    { ambiente: "producao" },
    { confirmar: true, selecaoId: aberta.selecaoId }
  );
  assert.equal(gravacao.codigo, "permissao");
  const mantido = JSON.parse(await fs.readFile(arquivo, "utf8"));
  assert.equal(mantido.producao.pai, antiga);
});

test("a cópia confere o conteúdo e não substitui .pos", async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-backup-"));
  const origem = path.join(raiz, "PGWeb");
  const destino = path.join(raiz, "backup");
  await fs.mkdir(origem, { recursive: true });
  await fs.writeFile(path.join(origem, "nota.pos"), "original", "utf8");
  await fs.mkdir(destino, { recursive: true });
  await fs.writeFile(path.join(destino, "nota.pos"), "existente", "utf8");
  const conflito = await copiarBackupIntegro(origem, destino, fs);
  assert.equal(conflito.ok, false);
  assert.match(conflito.mensagem, /\.pos/);
  assert.equal(await fs.readFile(path.join(origem, "nota.pos"), "utf8"), "original");
  assert.equal(await fs.readFile(path.join(destino, "nota.pos"), "utf8"), "existente");

  const destinoNovo = path.join(raiz, "backup-novo");
  const fsDivergente = {
    ...fs,
    copyFile: async (_origem, alvo) => {
      await fs.mkdir(path.dirname(alvo), { recursive: true });
      await fs.writeFile(alvo, "alterado", "utf8");
    },
  };
  const divergente = await copiarBackupIntegro(origem, destinoNovo, fsDivergente);
  assert.equal(divergente.ok, false);
  assert.match(divergente.mensagem, /não conferiu/);
  assert.equal(await fs.readFile(path.join(origem, "nota.pos"), "utf8"), "original");
});

test("salvar só persiste depois da validação e conserva o .pos", async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-salvar-"));
  const antiga = path.join(raiz, "antiga");
  const nova = path.join(raiz, "nova");
  const arquivo = path.join(raiz, "tef-pasta.json");
  await fs.mkdir(path.join(antiga, "PGWeb"), { recursive: true });
  await fs.writeFile(path.join(antiga, "PGWeb", "nota.pos"), "original", "utf8");
  await fs.writeFile(path.join(antiga, "PGWeb", "certificado.crt"), "certificado", "utf8");
  await fs.mkdir(nova, { recursive: true });
  const destino = path.join(raiz, "backup");
  const servico = criarServicoPastaTef({
    arquivo,
    raizExecutavel: path.join(raiz, "agente"),
    producaoPai: antiga,
    sandboxPai: path.join(raiz, "sandbox"),
    programFiles: [path.join(raiz, "Program Files")],
    classificarUnidade: async () => "local",
    destinoBackup: destino,
    carimbo: "fixo",
    restringir: async () => ({ ok: true }),
    abrirSeletor: async () => ({ caminho: nova }),
    fsApi: fs,
  });
  const escolha = await servico.escolher({ ambiente: "producao" }, {});
  const salva = await servico.salvar(
    { ambiente: "producao" },
    { confirmar: true, selecaoId: escolha.selecaoId }
  );
  assert.equal(salva.ok, true);
  assert.equal(salva.pronto, false);
  assert.equal(salva.efetivo, path.join(nova, "PGWeb"));
  const registro = JSON.parse(await fs.readFile(arquivo, "utf8"));
  assert.equal(registro.ativacao.producao.estado, "preparada");
  assert.equal(registro.ativacao.producao.pai, nova);
  assert.equal(registro.producao, null);
  assert.equal(await fs.readFile(path.join(antiga, "PGWeb", "nota.pos"), "utf8"), "original");
  assert.equal(await fs.readFile(path.join(destino, "nota.pos"), "utf8"), "original");
  const consulta = await servico.consultar({
    ambiente: "producao",
    diretorioTrabalho: path.join(antiga, "PGWeb"),
    retornoPwInit: -2485,
    retornoPwInitNome: "PWRET_WRITERR",
  });
  assert.equal(consulta.pronto, false);
  assert.equal(consulta.agente.retornoPwInit.texto, "-2485 PWRET_WRITERR");
  assert.equal(
    await diretorioPaiPersistido({
      ambiente: "producao",
      arquivo,
      paiPadrao: antiga,
    }),
    ""
  );
  const promovida = await registrarResultadoAtivacao({
    arquivo,
    ambiente: "producao",
    solicitado: true,
    efetivoEsperado: path.join(nova, "PGWeb"),
    sucesso: true,
    diretorioObservado: path.join(nova, "PGWeb") + "\\",
    retornoPwInit: 0,
    retornoPwInitNome: "PWRET_OK",
  });
  assert.equal(promovida.promovida, true);
  assert.equal(
    await diretorioPaiPersistido({
      ambiente: "producao",
      arquivo,
      paiPadrao: antiga,
    }),
    nova
  );
});

test("o seletor e o agente não apagam dados nem iniciam cobrança", async () => {
  assert.match(SCRIPT_SELETOR_PASTA, /BrowseForFolder/);
  assert.equal(SCRIPT_SELETOR_PASTA.includes("${"), false);
  const fonte = await fs.readFile(path.join(raizRepo, "print-agent", "src", "tef-pasta.mjs"), "utf8");
  assert.equal(fonte.includes("PW_iInit"), false);
  assert.equal(fonte.includes("PWOPER_"), false);
  const agente = await fs.readFile(path.join(raizRepo, "tef-agent", "UltraPDVTef.lpr"), "utf8");
  const inicio = agente.indexOf("function AplicarDiretorioBiblioteca");
  const fim = agente.indexOf("function PedidoInformaIdentidade");
  const rotina = agente.slice(inicio, fim);
  assert.match(rotina, /nao cria, copia nem apaga arquivos/);
  assert.equal(rotina.includes("DeleteFile"), false);
  assert.match(rotina, /diretorioPai|PaiExplicito/);
  const inicioInit = agente.indexOf("procedure InicializarTEF");
  const fimInit = agente.indexOf("function TextoComprovante");
  const inicializacao = agente.slice(inicioInit, fimInit);
  assert.equal(inicializacao.includes("PWOPER_INSTALL"), false);
  assert.equal(inicializacao.includes("EfetuarPagamento"), false);
  assert.equal(inicializacao.includes("Desfazer"), false);
  assert.match(inicializacao, /diretorioPai/);
  assert.match(inicializacao, /DiretorioPwInitObservado/);
  assert.match(fonte, /windowsHide: false/);
  const tela = await fs.readFile(
    path.join(raizRepo, "components", "pdv", "tef-pasta-form.tsx"),
    "utf8"
  );
  assert.match(tela, /Escolher pasta/);
  assert.match(tela, /Usar pasta recomendada/);
  assert.match(tela, /Salvar e validar/);
  const servidor = await fs.readFile(path.join(raizRepo, "print-agent", "src", "server.mjs"), "utf8");
  assert.match(servidor, /\/tef\/pasta\/escolher/);
  assert.match(servidor, /x-ultrapdv-dispositivo/);
  const acesso = await fs.readFile(
    path.join(raizRepo, "app", "api", "pdv", "tef", "pasta", "acesso", "route.ts"),
    "utf8"
  );
  assert.match(acesso, /caminho/);
  assert.equal(acesso.includes("PW_iInit"), false);
});

function processoFalso() {
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
  proc.killed = false;
  proc.exitCode = null;
  proc.pid = 4242;
  proc.kill = () => {
    proc.killed = true;
    proc.exitCode = 1;
    proc.emit("exit", 1, null);
    return true;
  };
  proc.emitirStdout = (texto) => {
    proc.stdout.emit("data", Buffer.from(texto));
  };
  return proc;
}

function criarGerenciadorPasta(arquivoPasta, extras = {}) {
  const processos = [];
  const gerenciador = new GerenciadorTefNativo({
    arquivoPasta,
    arquivoPendencia: path.join(path.dirname(arquivoPasta), "pendencia.json"),
    localizar: async () => ({
      encontrado: true,
      caminho: `C:\\connector\\bin\\tef\\${NOME_TEF_NATIVO}`,
    }),
    spawn: () => {
      const proc = processoFalso();
      processos.push(proc);
      setImmediate(() => proc.emit("spawn"));
      return proc;
    },
    registrarLog: async () => {},
    criarId: () => `id-${processos.length + 1}`,
    agendar: () => ({ cancelado: false }),
    cancelarAgendamento: () => {},
    limiteEncerramentoMs: 40,
    classificarUnidadePasta: async () => "local",
    restringirPasta: async () => ({ ok: true }),
    instalacaoAutomatica: false,
    ...extras,
  });
  return { gerenciador, processos };
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

function responderInit(proc, resultado, ok = true) {
  const pedido = JSON.parse(proc.stdin.partes.join("").trim().split(/\n/u).at(-1));
  proc.emitirStdout(
    `${JSON.stringify({
      id: pedido.id,
      ok,
      resultado,
      erro: ok ? null : "TEF_INICIALIZACAO_FALHOU: gravacao",
    })}\n`
  );
  return pedido;
}

test("a migração copia só o que falta e interrompe arquivo divergente", async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-migracao-"));
  const origem = path.join(raiz, "atual");
  const destino = path.join(raiz, "nova");
  await fs.mkdir(origem, { recursive: true });
  await fs.mkdir(path.join(origem, "Log"), { recursive: true });
  await fs.writeFile(path.join(origem, "certificado.crt"), "certificado", "utf8");
  await fs.writeFile(path.join(origem, "nota.pos"), "original", "utf8");
  await fs.writeFile(path.join(origem, "Log", "paygo.log"), "nao copiar", "utf8");
  await fs.mkdir(destino, { recursive: true });
  await fs.writeFile(path.join(destino, "nota.pos"), "diferente", "utf8");
  const conflito = await avaliarMigracao(origem, destino, fs, "producao");
  assert.equal(conflito.ok, false);
  assert.match(conflito.mensagem, /diferentes/);
  assert.match(conflito.mensagem, /reinstalado/);
  assert.equal(await fs.readFile(path.join(destino, "nota.pos"), "utf8"), "diferente");
  assert.equal(await fs.readFile(path.join(origem, "nota.pos"), "utf8"), "original");

  await fs.writeFile(path.join(destino, "nota.pos"), "original", "utf8");
  const plano = await avaliarMigracao(origem, destino, fs, "producao");
  assert.equal(plano.ok, true);
  assert.deepEqual(plano.iguais, ["nota.pos"]);
  assert.equal(plano.copiar.length, 1);
  assert.equal(plano.copiar[0].relativo, "certificado.crt");
  const acl = [];
  const aplicada = await aplicarMigracao(plano, fs, async (arquivo) => {
    acl.push(arquivo);
    return auditarAcl("NT AUTHORITY\\SYSTEM:(F)\nBUILTIN\\Administrators:(F)\ncaixa:(M)");
  });
  assert.equal(aplicada.ok, true);
  assert.equal(acl.length, 1);
  assert.equal(await fs.readFile(path.join(destino, "certificado.crt"), "utf8"), "certificado");
  assert.equal(await fs.readFile(path.join(destino, "nota.pos"), "utf8"), "original");
  assert.equal(await fs.readFile(path.join(origem, "certificado.crt"), "utf8"), "certificado");
  await fs.access(path.join(destino, "Log", "paygo.log")).then(
    () => {
      throw new Error("log copiado");
    },
    () => {}
  );
  assert.equal(auditarAcl("Everyone:(F)").ok, false);
});

test("acesso negado em PGWeb\\Data preserva certificado, .pos, log e pendência", async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-data-"));
  const paiAtual = path.join(raiz, "atual");
  const paiNovo = path.join(raiz, "nova");
  const origem = path.join(paiAtual, "PGWeb");
  const destino = path.join(paiNovo, "PGWeb");
  const pendencia = path.join(raiz, "tef-pendencia.json");
  await fs.mkdir(path.join(origem, "Data", "Backup"), { recursive: true });
  await fs.mkdir(path.join(origem, "Log"), { recursive: true });
  await fs.writeFile(path.join(origem, "certificado.crt"), "certificado", "utf8");
  await fs.writeFile(path.join(origem, "Data", "nota.pos"), "original", "utf8");
  await fs.writeFile(path.join(origem, "Log", "paygo.log"), "log", "utf8");
  await fs.mkdir(path.join(destino, "Data"), { recursive: true });
  await fs.writeFile(path.join(destino, "Data", "nota.pos"), "original", "utf8");
  await fs.writeFile(pendencia, "{\"status\":\"aguardando_decisao\"}\n", "utf8");
  const arquivo = path.join(raiz, "tef-pasta.json");
  await fs.writeFile(
    arquivo,
    `${JSON.stringify({
      versao: 2,
      producao: {
        pai: paiAtual,
        efetivo: origem,
        confirmadaEm: "2026-10-14T00:00:00.000Z",
      },
      ativacao: {
        producao: { estado: "preparada", pai: paiNovo, efetivo: destino },
      },
    })}\n`,
    "utf8"
  );
  const fsApi = {
    ...fs,
    writeFile: async (alvo, dados, encoding) => {
      if (String(alvo).includes(`${path.sep}Data${path.sep}`)) {
        const erro = new Error("acesso");
        erro.code = "EACCES";
        throw erro;
      }
      return fs.writeFile(alvo, dados, encoding);
    },
  };
  const plano = await planejarDiretorioInicial({
    arquivo,
    fsApi,
    ambiente: "producao",
    paiPadrao: path.join(raiz, "padrao"),
    raizExecutavel: path.join(raiz, "agente"),
    producaoPai: path.join(raiz, "padrao"),
    sandboxPai: path.join(raiz, "sandbox"),
    programFiles: [],
    classificarUnidade: async () => "local",
    restringir: async () => ({ ok: true }),
    conceder: async () => ({ ok: true }),
    restringirDiretorio: async () => ({ ok: true }),
  });
  assert.equal(plano.ok, false);
  assert.equal(plano.pronto, false);
  assert.equal(plano.codigo, "permissao");
  assert.match(plano.mensagem, /PGWeb\\Data/);
  assert.equal(await fs.readFile(path.join(destino, "Data", "nota.pos"), "utf8"), "original");
  assert.equal(await fs.readFile(path.join(origem, "certificado.crt"), "utf8"), "certificado");
  assert.equal(await fs.readFile(path.join(origem, "Log", "paygo.log"), "utf8"), "log");
  assert.equal(await fs.readFile(pendencia, "utf8"), "{\"status\":\"aguardando_decisao\"}\n");
  await fs.access(path.join(destino, "certificado.crt")).then(
    () => {
      throw new Error("cópia mantida depois da falha");
    },
    () => {}
  );
  const gravado = JSON.parse(await fs.readFile(arquivo, "utf8"));
  assert.equal(gravado.producao.pai, paiAtual);
  assert.equal(gravado.ativacao.producao.estado, "recusada");
});

test("migração interrompida não apaga nem substitui arquivos existentes", async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-interrupcao-"));
  const origem = path.join(raiz, "atual");
  const destino = path.join(raiz, "nova");
  await fs.mkdir(origem, { recursive: true });
  await fs.mkdir(destino, { recursive: true });
  await fs.writeFile(path.join(origem, "certificado.crt"), "certificado", "utf8");
  await fs.writeFile(path.join(origem, "assinatura.sig"), "assinatura", "utf8");
  await fs.writeFile(path.join(origem, "nota.pos"), "original", "utf8");
  await fs.writeFile(path.join(destino, "nota.pos"), "original", "utf8");
  await fs.writeFile(path.join(destino, "antigo.pos"), "preservar", "utf8");
  const plano = await avaliarMigracao(origem, destino, fs, "producao");
  assert.equal(plano.ok, true);
  assert.deepEqual(plano.copiar.map((item) => item.relativo).sort(), ["assinatura.sig", "certificado.crt"]);

  let copias = 0;
  const interrompida = await aplicarMigracao(plano, {
    ...fs,
    copyFile: async (origemArquivo, alvo, flag) => {
      copias += 1;
      if (copias > 1) {
        const erro = new Error("copia");
        erro.code = "EIO";
        throw erro;
      }
      return fs.copyFile(origemArquivo, alvo, flag);
    },
  }, async () => ({ ok: true }));
  assert.equal(interrompida.ok, false);
  assert.match(interrompida.mensagem, /apagado/);
  assert.equal(await fs.readFile(path.join(destino, "nota.pos"), "utf8"), "original");
  assert.equal(await fs.readFile(path.join(destino, "antigo.pos"), "utf8"), "preservar");
  assert.equal(await fs.readFile(path.join(origem, "certificado.crt"), "utf8"), "certificado");
  await fs.access(path.join(destino, "certificado.crt")).then(
    () => {
      throw new Error("cópia parcial permaneceu");
    },
    () => {}
  );
  await fs.access(path.join(destino, "assinatura.sig")).then(
    () => {
      throw new Error("arquivo divergente foi gravado");
    },
    () => {}
  );

  let diretorios = 0;
  const semPasta = await aplicarMigracao(plano, {
    ...fs,
    mkdir: async (...args) => {
      diretorios += 1;
      if (diretorios > 1) {
        const erro = new Error("mkdir");
        erro.code = "EACCES";
        throw erro;
      }
      return fs.mkdir(...args);
    },
  }, async () => ({ ok: true }));
  assert.equal(semPasta.ok, false);
  assert.equal(await fs.readFile(path.join(destino, "antigo.pos"), "utf8"), "preservar");

  const semHash = await aplicarMigracao(plano, {
    ...fs,
    readFile: async (arquivo, encoding) => {
      if (String(arquivo).endsWith("assinatura.sig") && String(arquivo).startsWith(destino)) {
        const erro = new Error("hash");
        erro.code = "EIO";
        throw erro;
      }
      return fs.readFile(arquivo, encoding);
    },
  }, async () => ({ ok: true }));
  assert.equal(semHash.ok, false);
  assert.match(semHash.mensagem, /apagado/);
  assert.equal(await fs.readFile(path.join(destino, "nota.pos"), "utf8"), "original");
  await fs.access(path.join(destino, "certificado.crt")).then(
    () => {
      throw new Error("cópia sem hash permaneceu");
    },
    () => {}
  );

  const semAcl = await aplicarMigracao(plano, fs, async (arquivo) => {
    if (String(arquivo).endsWith("assinatura.sig")) {
      return { ok: false, mensagem: "ACL recusada." };
    }
    return { ok: true };
  });
  assert.equal(semAcl.ok, false);
  assert.equal(semAcl.codigo, "permissao");
  assert.equal(await fs.readFile(path.join(destino, "antigo.pos"), "utf8"), "preservar");
  await fs.access(path.join(destino, "certificado.crt")).then(
    () => {
      throw new Error("cópia sem ACL permaneceu");
    },
    () => {}
  );
});

test("homologação não é migrada e a ACL usa o SID do processo TEF", async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-homolog-"));
  const origem = path.join(raiz, "sandbox", "PGWeb");
  const destino = path.join(raiz, "outra", "PGWeb");
  await fs.mkdir(origem, { recursive: true });
  await fs.writeFile(path.join(origem, "certificado.crt"), "sandbox", "utf8");
  const plano = await avaliarMigracao(origem, destino, fs, "homologacao");
  assert.equal(plano.homologacaoPreservada, true);
  assert.equal(plano.copiar.length, 0);
  assert.equal(await fs.readFile(path.join(origem, "certificado.crt"), "utf8"), "sandbox");
  const preparada = await prepararDiretoriosOperacionais(destino, {
    fsApi: {
      ...fs,
      mkdir: async () => {
        throw new Error("não deveria criar pasta de homologação");
      },
    },
    ambiente: "homologacao",
  });
  assert.equal(preparada.preservada, true);
  await fs.access(destino).then(
    () => {
      throw new Error("homologação foi criada");
    },
    () => {}
  );

  const sid = "S-1-5-21-1-2-3-1001";
  const chamadas = [];
  const acl = await concederAcessoProcesso(
    path.join(destino, "Data"),
    async (comando, args) => {
      chamadas.push([comando, args]);
      return `S-1-5-21-1-2-3-1001:(OI)(CI)(M)\nNT AUTHORITY\\SYSTEM:(OI)(CI)(F)\nBUILTIN\\Administrators:(OI)(CI)(F)`;
    },
    { uid: sid, username: "caixa" }
  );
  assert.equal(acl.ok, true);
  assert.equal(chamadas[0][1].includes("/inheritance:r"), false);
  assert.equal(chamadas[0][1].includes(`*${sid}:(OI)(CI)(M)`), true);
  assert.equal(chamadas[0][1].includes("caixa:(M)"), false);
  assert.equal(chamadas[0][1].some((item) => /everyone|todos|users:\\(f\\)/i.test(item)), false);
  assert.equal(contaProcessoTef({ uid: sid }), `*${sid}`);
  assert.equal(contaProcessoTef({ uid: 1000, username: "caixa" }), "");

  const pai = path.join(raiz, "personalizada");
  const efetivo = path.join(pai, "PGWeb");
  assert.deepEqual(diretoriosOperacionais(efetivo), [
    efetivo,
    path.join(efetivo, "Data"),
    path.join(efetivo, "Data", "Backup"),
    path.join(efetivo, "Log"),
  ]);
  const agente = readFileSync(path.join(raizRepo, "tef-agent", "UltraPDVTef.lpr"), "utf8");
  const inicio = agente.indexOf("procedure InicializarTEF");
  const chamada = agente.indexOf("if not AplicarDiretorioBiblioteca(", inicio);
  const inicializar = agente.indexOf("TEF.Inicializar;", chamada);
  assert.ok(chamada > 0 && chamada < inicializar);
  assert.match(agente.slice(chamada, inicializar), /TextoDados\(Dados, 'diretorioPai'\)/);
  assert.match(agente, /Biblioteca := IncludeTrailingPathDelimiter\(Pai\) \+ 'PGWeb'/);
});

test("inicialização usa a pasta padrão, a personalizada e preserva a anterior se PW_iInit falhar", async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-init-pasta-"));
  const arquivo = path.join(raiz, "tef-pasta.json");
  const padrao = criarGerenciadorPasta(arquivo);
  const inicioPadrao = padrao.gerenciador.inicializar();
  await ate(() => padrao.processos[0]?.stdin.partes.length === 1);
  const pedidoPadrao = responderInit(padrao.processos[0], {
    inicializado: true,
    diretorioBiblioteca: "sandbox",
    diretorioTrabalho: "C:\\connector\\bin\\tef\\TEF\\PGWeb\\",
    diretorioPwInit: "C:\\connector\\bin\\tef\\TEF\\PGWeb\\",
    retornoPwInit: 0,
    retornoPwInitNome: "PWRET_OK",
  });
  assert.equal(pedidoPadrao.acao, "inicializar");
  assert.equal(pedidoPadrao.dados.diretorioPai, undefined);
  assert.equal(pedidoPadrao.dados.valor, undefined);
  assert.equal(pedidoPadrao.dados.credencial, undefined);
  assert.equal((await inicioPadrao).ok, true);
  assert.equal(padrao.processos[0].stdin.partes.length, 1);

  const personalizada = path.join(raiz, "personalizada");
  await fs.mkdir(personalizada, { recursive: true });
  await fs.writeFile(
    arquivo,
    `${JSON.stringify({
      versao: 2,
      ativacao: {
        sandbox: { estado: "preparada", pai: personalizada, efetivo: path.join(personalizada, "PGWeb") },
      },
    })}\n`,
    "utf8"
  );
  const custom = criarGerenciadorPasta(arquivo);
  const inicioCustom = custom.gerenciador.inicializar();
  await ate(() => custom.processos[0]?.stdin.partes.length === 1);
  const pedidoCustom = responderInit(custom.processos[0], {
    inicializado: true,
    diretorioBiblioteca: "sandbox",
    diretorioTrabalho: `${path.join(personalizada, "PGWeb")}\\`,
    diretorioPwInit: `${path.join(personalizada, "PGWeb")}\\`,
    retornoPwInit: 0,
    retornoPwInitNome: "PWRET_OK",
  });
  assert.equal(pedidoCustom.dados.diretorioPai, personalizada);
  assert.equal(pedidoCustom.acao, "inicializar");
  const respostaCustom = await inicioCustom;
  assert.equal(respostaCustom.ok, true);
  assert.equal(respostaCustom.tef.diretorioPwInit, `${path.join(personalizada, "PGWeb")}\\`);
  const reinicio = criarGerenciadorPasta(arquivo);
  const deNovo = reinicio.gerenciador.inicializar();
  await ate(() => reinicio.processos[0]?.stdin.partes.length === 1);
  const pedidoReinicio = responderInit(reinicio.processos[0], {
    inicializado: true,
    diretorioBiblioteca: "sandbox",
    diretorioPwInit: `${path.join(personalizada, "PGWeb")}\\`,
    diretorioTrabalho: `${path.join(personalizada, "PGWeb")}\\`,
    retornoPwInit: 0,
    retornoPwInitNome: "PWRET_OK",
  });
  assert.equal(pedidoReinicio.dados.diretorioPai, personalizada);
  assert.equal((await deNovo).ok, true);

  const outra = path.join(raiz, "outra");
  await fs.writeFile(
    arquivo,
    `${JSON.stringify({
      versao: 2,
      sandbox: {
        pai: personalizada,
        efetivo: path.join(personalizada, "PGWeb"),
        confirmadaEm: "2026-10-14T00:00:00.000Z",
      },
      ativacao: {
        sandbox: { estado: "preparada", pai: outra, efetivo: path.join(outra, "PGWeb") },
      },
    })}\n`,
    "utf8"
  );
  const falha = criarGerenciadorPasta(arquivo);
  const inicioFalha = falha.gerenciador.inicializar();
  await ate(() => falha.processos[0]?.stdin.partes.length === 1);
  const pedidoFalha = responderInit(
    falha.processos[0],
    {
      inicializado: false,
      diretorioBiblioteca: "sandbox",
      diretorioTrabalho: `${path.join(outra, "PGWeb")}\\`,
      diretorioPwInit: `${path.join(outra, "PGWeb")}\\`,
      retornoPwInit: -2485,
      retornoPwInitNome: "PWRET_WRITERR",
    },
    false
  );
  assert.equal(pedidoFalha.dados.diretorioPai, outra);
  const respostaFalha = await inicioFalha;
  assert.equal(respostaFalha.ok, false);
  assert.match(respostaFalha.erro, /-2485 PWRET_WRITERR/);
  assert.equal(falha.processos[0].stdin.partes.length, 1);
  const gravado = JSON.parse(await fs.readFile(arquivo, "utf8"));
  assert.equal(gravado.sandbox.pai, personalizada);
  assert.equal(gravado.ativacao.sandbox.estado, "recusada");
  assert.equal(gravado.ativacao.sandbox.retornoPwInit, -2485);
  const depois = criarGerenciadorPasta(arquivo);
  const inicioDepois = depois.gerenciador.inicializar();
  await ate(() => depois.processos[0]?.stdin.partes.length === 1);
  const pedidoDepois = responderInit(depois.processos[0], {
    inicializado: true,
    diretorioBiblioteca: "sandbox",
    diretorioPwInit: `${path.join(personalizada, "PGWeb")}\\`,
    diretorioTrabalho: `${path.join(personalizada, "PGWeb")}\\`,
    retornoPwInit: 0,
    retornoPwInitNome: "PWRET_OK",
  });
  assert.equal(pedidoDepois.dados.diretorioPai, personalizada);
  assert.equal((await inicioDepois).ok, true);
});

test("transação pendente não troca a pasta e o seletor exige sessão interativa", async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-bloqueio-pasta-"));
  const arquivo = path.join(raiz, "tef-pasta.json");
  const nova = path.join(raiz, "nova");
  await fs.writeFile(
    arquivo,
    `${JSON.stringify({
      versao: 2,
      ativacao: { sandbox: { estado: "preparada", pai: nova, efetivo: path.join(nova, "PGWeb") } },
    })}\n`,
    "utf8"
  );
  const { gerenciador, processos } = criarGerenciadorPasta(arquivo);
  gerenciador.transacaoPendente = { identificador: "pendente" };
  const inicio = gerenciador.inicializar();
  await ate(() => processos[0]?.stdin.partes.length === 1);
  const pedido = responderInit(processos[0], {
    inicializado: true,
    diretorioBiblioteca: "sandbox",
    diretorioPwInit: "C:\\connector\\bin\\tef\\TEF\\PGWeb\\",
    retornoPwInit: 0,
    retornoPwInitNome: "PWRET_OK",
  });
  assert.equal(pedido.dados.diretorioPai, undefined);
  assert.equal((await inicio).ok, true);
  const gravado = JSON.parse(await fs.readFile(arquivo, "utf8"));
  assert.equal(gravado.ativacao.sandbox.estado, "preparada");
  const ocupada = await verificarSeletorInterativo({
    consultarSessao: async () => ({ interativa: false, sessao: 0, cscript: true }),
  });
  assert.match(ocupada.mensagem, /sessão interativa/);
  const livre = await verificarSeletorInterativo({
    consultarSessao: async () => ({ interativa: true, sessao: 2, cscript: true }),
  });
  assert.equal(livre.ok, true);
  const semDialogo = await planejarDiretorioInicial({
    arquivo,
    ambiente: "homologacao",
    paiPadrao: "C:\\connector\\bin\\tef\\TEF",
    bloqueado: true,
    classificarUnidade: async () => "local",
    restringir: async () => ({ ok: true }),
    producaoPai: "C:\\ProgramData\\UltraPDV\\TEF\\Producao",
    sandboxPai: "C:\\connector\\bin\\tef\\TEF",
  });
  assert.equal(semDialogo.adiada, true);
  assert.equal(semDialogo.diretorioPai, "");
});

test("instalação limpa cria as quatro pastas e não chama mkdir recursivo numa pasta existente", async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-limpa-"));
  const pai = path.join(raiz, "Producao");
  const efetivo = path.join(pai, "PGWeb");
  const criadas = [];
  const fsApi = {
    ...fs,
    mkdir: async (alvo, opcoes) => {
      criadas.push({ alvo: String(alvo), recursivo: opcoes?.recursive === true });
      return fs.mkdir(alvo, opcoes);
    },
  };
  const resultado = await instalarPastaPadrao({
    pai,
    fsApi,
    conceder: async () => ({ ok: true }),
    restringirDiretorio: async () => ({ ok: true }),
    listarAcl: async () => "",
  });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.diretorioPai, pai);
  assert.equal(criadas.some((item) => item.recursivo && String(item.alvo).endsWith("PGWeb")), false);
  for (const relativo of ["", "Data", path.join("Data", "Backup"), "Log"]) {
    await fs.access(relativo ? path.join(efetivo, relativo) : efetivo);
  }
  const restos = await fs.readdir(efetivo);
  assert.equal(restos.includes("certificado.crt"), false);
  assert.equal(restos.some((nome) => nome.endsWith(".pos")), false);
});

test("atualização preserva arquivo existente e não recria a pasta com mkdir", async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-atualiza-"));
  const pai = path.join(raiz, "Producao");
  const efetivo = path.join(pai, "PGWeb");
  await fs.mkdir(path.join(efetivo, "Data", "Backup"), { recursive: true });
  await fs.mkdir(path.join(efetivo, "Log"), { recursive: true });
  await fs.writeFile(path.join(efetivo, "certificado.crt"), "certificado", "utf8");
  await fs.writeFile(path.join(efetivo, "Data", "nota.pos"), "original", "utf8");
  await fs.writeFile(path.join(efetivo, "Log", "paygo.log"), "log", "utf8");
  let mkdirOperacional = 0;
  const concedidos = [];
  const restritos = [];
  const resultado = await prepararDiretoriosOperacionais(efetivo, {
    fsApi: {
      ...fs,
      mkdir: async () => {
        mkdirOperacional += 1;
        throw new Error("mkdir desnecessário");
      },
    },
    conceder: async (pasta) => {
      concedidos.push(pasta);
      return { ok: true };
    },
    restringirDiretorio: async (pasta) => {
      restritos.push(pasta);
      return { ok: true };
    },
  });
  assert.equal(resultado.ok, true);
  assert.equal(mkdirOperacional, 0);
  assert.equal(restritos.length, 0);
  assert.equal(concedidos.length, 4);
  assert.equal(await fs.readFile(path.join(efetivo, "Data", "nota.pos"), "utf8"), "original");
  assert.equal(await fs.readFile(path.join(efetivo, "certificado.crt"), "utf8"), "certificado");
  assert.equal(await fs.readFile(path.join(efetivo, "Log", "paygo.log"), "utf8"), "log");
});

test("acesso negado e falha ao criar diretório identificam a pasta, a operação e o código", async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-diag-"));
  const efetivo = path.join(raiz, "PGWeb");
  await fs.mkdir(path.join(efetivo, "Data"), { recursive: true });
  await fs.writeFile(path.join(efetivo, "Data", "nota.pos"), "original", "utf8");
  const negado = await prepararDiretoriosOperacionais(efetivo, {
    fsApi: {
      ...fs,
      access: async (alvo) => {
        if (String(alvo).endsWith(`${path.sep}Data`)) {
          const erro = new Error("acesso");
          erro.code = "EACCES";
          throw erro;
        }
        return fs.access(alvo);
      },
    },
    conceder: async () => ({ ok: true }),
    restringirDiretorio: async () => ({ ok: true }),
    listarAcl: async () => "BUILTIN\\Administrators:(DENY)(W)",
  });
  assert.equal(negado.ok, false);
  assert.equal(negado.operacao, "access");
  assert.equal(negado.codigoErro, "EACCES");
  assert.match(negado.mensagem, /PGWeb\\Data/);
  assert.match(negado.mensagem, /access, EACCES/);
  assert.match(negado.mensagem, /negação/);
  assert.match(negado.mensagem, /intervenção administrativa/);
  assert.equal(await fs.readFile(path.join(efetivo, "Data", "nota.pos"), "utf8"), "original");

  const semBackup = await prepararDiretoriosOperacionais(efetivo, {
    fsApi: {
      ...fs,
      mkdir: async (alvo) => {
        if (String(alvo).includes(`${path.sep}Backup`)) {
          const erro = new Error("criar");
          erro.code = "EPERM";
          throw erro;
        }
        return fs.mkdir(alvo);
      },
    },
    conceder: async () => ({ ok: true }),
    restringirDiretorio: async () => ({ ok: true }),
    listarAcl: async () => "NT AUTHORITY\\SYSTEM:(OI)(CI)(F)",
  });
  assert.equal(semBackup.ok, false);
  assert.equal(semBackup.operacao, "mkdir");
  assert.equal(semBackup.codigoErro, "EPERM");
  assert.match(semBackup.mensagem, /PGWeb\\Data\\Backup/);
  assert.match(semBackup.mensagem, /mkdir, EPERM/);
  assert.match(semBackup.mensagem, /intervenção administrativa/);
  assert.equal(await fs.readFile(path.join(efetivo, "Data", "nota.pos"), "utf8"), "original");
  await fs.access(path.join(efetivo, "Data", "Backup")).then(
    () => {
      throw new Error("backup foi criado");
    },
    () => {}
  );
});

test("a ACL da pasta usa o SID do processo e a sessão interativa, sem Todos e sem remover negação", async () => {
  const sid = "S-1-5-21-1-2-3-1001";
  const chamadas = [];
  const acl = await concederAcessoProcesso(
    "D:\\dados\\PGWeb\\Data",
    async (comando, args) => {
      chamadas.push(args);
      return "NT AUTHORITY\\SYSTEM:(OI)(CI)(F)\nBUILTIN\\Administrators:(OI)(CI)(F)\n*S-1-5-4:(OI)(CI)(M)";
    },
    { uid: sid, username: "caixa" }
  );
  assert.equal(acl.ok, true);
  const grant = chamadas[0].join(" ");
  assert.equal(grant.includes("/inheritance:r"), false);
  assert.equal(grant.includes("/remove"), false);
  assert.equal(grant.includes("/deny"), false);
  assert.equal(grant.includes("*S-1-5-18:(OI)(CI)(F)"), true);
  assert.equal(grant.includes("*S-1-5-32-544:(OI)(CI)(F)"), true);
  assert.equal(grant.includes("*S-1-5-4:(OI)(CI)(M)"), true);
  assert.equal(grant.includes(`*${sid}:(OI)(CI)(M)`), true);
  assert.equal(/S-1-1-0|S-1-5-32-545|everyone|todos/iu.test(grant), false);
  const semConta = entradasAclDiretorio("");
  assert.equal(semConta.includes("*S-1-5-4:(OI)(CI)(M)"), true);
  assert.equal(semConta.some((item) => item.includes("caixa")), false);
});

test("falha de gravação preserva o financeiro e a tentativa seguinte recupera a pasta", async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-recupera-"));
  const pai = path.join(raiz, "Producao");
  const efetivo = path.join(pai, "PGWeb");
  await fs.mkdir(path.join(efetivo, "Data"), { recursive: true });
  await fs.writeFile(path.join(efetivo, "Data", "nota.pos"), "original", "utf8");
  const fsFalha = {
    ...fs,
    writeFile: async (alvo, dados, encoding) => {
      if (String(alvo).includes(`${path.sep}Data${path.sep}`)) {
        const erro = new Error("acesso");
        erro.code = "EACCES";
        throw erro;
      }
      return fs.writeFile(alvo, dados, encoding);
    },
  };
  const falha = await instalarPastaPadrao({
    pai,
    fsApi: fsFalha,
    conceder: async () => ({ ok: true }),
    restringirDiretorio: async () => ({ ok: true }),
  });
  assert.equal(falha.ok, false);
  assert.match(falha.mensagem, /PGWeb\\Data/);
  assert.equal(await fs.readFile(path.join(efetivo, "Data", "nota.pos"), "utf8"), "original");
  const ok = await instalarPastaPadrao({
    pai,
    fsApi: fs,
    conceder: async () => ({ ok: true }),
    restringirDiretorio: async () => ({ ok: true }),
  });
  assert.equal(ok.ok, true);
  assert.equal(await fs.readFile(path.join(efetivo, "Data", "nota.pos"), "utf8"), "original");
  await fs.access(path.join(efetivo, "certificado.crt")).then(
    () => {
      throw new Error("certificado foi criado");
    },
    () => {}
  );
});

test("pasta confirmada inicia sem arquivo temporário e a biblioteca informa o próprio código", async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-confirmada-"));
  const programData = path.join(raiz, "ProgramData");
  const pai = path.join(raiz, "UltraPDV-TEF", "Producao");
  const efetivo = path.join(pai, "PGWeb");
  await fs.mkdir(path.join(efetivo, "Data", "Backup"), { recursive: true });
  await fs.mkdir(path.join(efetivo, "Log"), { recursive: true });
  await fs.writeFile(path.join(efetivo, "Data", "nota.pos"), "original", "utf8");
  await fs.writeFile(path.join(efetivo, "certificado.crt"), "certificado", "utf8");
  await fs.writeFile(path.join(efetivo, "assinatura.sig"), "assinatura", "utf8");
  const arquivo = path.join(raiz, "tef-pasta.json");
  await fs.writeFile(
    arquivo,
    `${JSON.stringify({
      versao: 2,
      producao: {
        pai,
        efetivo,
        salvoEm: "2026-10-15T18:18:40.153Z",
        confirmadaEm: "2026-10-15T18:20:46.372Z",
      },
      ativacao: { producao: null },
    })}\n`,
    "utf8"
  );
  let escritasNoPgWeb = 0;
  const direta = await validarPastaConfirmada({
    pai,
    efetivoEsperado: efetivo,
    efetivoRegistrado: efetivo,
    fsApi: {
      ...fs,
      writeFile: async (alvo, dados, encoding) => {
        if (String(alvo).includes(`${path.sep}PGWeb${path.sep}`)) {
          escritasNoPgWeb += 1;
        }
        return fs.writeFile(alvo, dados, encoding);
      },
    },
  });
  assert.equal(direta.ok, true);
  assert.equal(escritasNoPgWeb, 0);
  assert.equal(direta.diretorioPai, path.win32.normalize(pai));
  assert.equal(await fs.readFile(path.join(efetivo, "Data", "nota.pos"), "utf8"), "original");
  assert.equal(await fs.readFile(path.join(efetivo, "certificado.crt"), "utf8"), "certificado");
  const identidade = {
    empresaId: "11111111-1111-4111-8111-111111111111",
    dispositivoId: "33333333-3333-4333-8333-333333333333",
    dispositivoLocal: "33333333-3333-4333-8333-333333333333",
    terminalId: "44444444-4444-4444-8444-444444444444",
    pontoCaptura: "200001",
    estabelecimento: "LOJA",
    ambiente: "producao",
    cnpj: "11222333000181",
    servidor: "tef.cliente.example:31735",
  };
  let concessoes = 0;
  const liberado = criarGerenciadorPasta(arquivo, {
    instalacaoAutomatica: true,
    env: { PROGRAMDATA: programData },
    concederPasta: async () => {
      concessoes += 1;
      return { ok: false, mensagem: "icacls não deveria rodar" };
    },
    restringirDiretorioPasta: async () => {
      concessoes += 1;
      return { ok: false, mensagem: "icacls não deveria rodar" };
    },
    listarDiretorioBiblioteca: async () => ["certificado.crt", "nota.pos"],
  });
  const inicio = liberado.gerenciador.inicializar(identidade);
  await ate(() => liberado.processos[0]?.stdin.partes.length === 1);
  const pedido = responderInit(liberado.processos[0], {
    inicializado: true,
    diretorioBiblioteca: "producao",
    diretorioPwInit: `${efetivo}\\`,
    diretorioTrabalho: `${efetivo}\\`,
    retornoPwInit: 0,
    retornoPwInitNome: "PWRET_OK",
  });
  assert.equal(pedido.acao, "inicializar");
  assert.equal(pedido.dados.diretorio, "producao");
  assert.equal(pedido.dados.diretorioPai, pai);
  assert.equal(pedido.dados.credencial, undefined);
  assert.equal(concessoes, 0);
  const sucesso = await inicio;
  assert.equal(sucesso.ok, true);
  assert.equal(sucesso.tef.inicializado, true);
  assert.equal(sucesso.tef.retornoPwInit, 0);
  assert.notEqual(sucesso.tef.biblioteca?.cobrancaPermitida, true);
  assert.equal(liberado.processos[0].stdin.partes.length, 1);
  assert.equal(await fs.readFile(path.join(efetivo, "assinatura.sig"), "utf8"), "assinatura");

  await fs.rm(path.join(efetivo, "Log"), { recursive: true, force: true });
  const semLog = await validarPastaConfirmada({ pai, efetivoEsperado: efetivo });
  assert.equal(semLog.ok, false);
  assert.match(semLog.mensagem, /validação do Connector não encontrou PGWeb\\Log/);
  assert.match(semLog.mensagem, /PGWebLib não foi chamada/);
  const recusaAusente = criarGerenciadorPasta(arquivo, {
    instalacaoAutomatica: true,
    env: { PROGRAMDATA: programData },
    listarDiretorioBiblioteca: async () => [],
  });
  const ausente = await recusaAusente.gerenciador.inicializar(identidade);
  assert.equal(ausente.ok, false);
  assert.match(ausente.erro, /validação do Connector/);
  assert.equal(recusaAusente.processos.length, 0);
  await fs.mkdir(path.join(efetivo, "Log"), { recursive: true });

  const adulterado = await validarPastaConfirmada({
    pai,
    efetivoEsperado: efetivo,
    efetivoRegistrado: path.join(raiz, "outra", "PGWeb"),
  });
  assert.equal(adulterado.ok, false);
  assert.match(adulterado.mensagem, /caminho salvo não corresponde/);
  const arquivoAdulterado = path.join(raiz, "tef-pasta-adulterada.json");
  await fs.writeFile(
    arquivoAdulterado,
    `${JSON.stringify({
      versao: 2,
      producao: {
        pai,
        efetivo: path.join(raiz, "outra", "PGWeb"),
        confirmadaEm: "2026-10-15T18:20:46.372Z",
      },
      ativacao: { producao: null },
    })}\n`,
    "utf8"
  );
  const gerenciadorAdulterado = criarGerenciadorPasta(arquivoAdulterado, {
    instalacaoAutomatica: true,
    env: { PROGRAMDATA: programData },
    listarDiretorioBiblioteca: async () => [],
  });
  const recusaCaminho = await gerenciadorAdulterado.gerenciador.inicializar(identidade);
  assert.equal(recusaCaminho.ok, false);
  assert.match(recusaCaminho.erro, /validação do Connector/);
  assert.equal(gerenciadorAdulterado.processos.length, 0);

  const biblioteca = criarGerenciadorPasta(arquivo, {
    instalacaoAutomatica: true,
    env: { PROGRAMDATA: programData },
    concederPasta: async () => {
      concessoes += 1;
      return { ok: true };
    },
    listarDiretorioBiblioteca: async () => [],
  });
  const inicioBiblioteca = biblioteca.gerenciador.inicializar(identidade);
  await ate(() => biblioteca.processos[0]?.stdin.partes.length === 1);
  responderInit(biblioteca.processos[0], {
    inicializado: true,
    diretorioBiblioteca: "producao",
    diretorioPwInit: `${efetivo}\\`,
    retornoPwInit: -2485,
    retornoPwInitNome: "PWRET_WRITERR",
  });
  const falhaBiblioteca = await inicioBiblioteca;
  assert.equal(falhaBiblioteca.ok, false);
  assert.match(falhaBiblioteca.erro, /Código -2485 PWRET_WRITERR/);
  assert.equal(falhaBiblioteca.erro.includes(efetivo), true);
  assert.equal(falhaBiblioteca.tef.inicializado, false);
  assert.equal(falhaBiblioteca.tef.retornoPwInit, -2485);
  assert.equal(concessoes, 0);
  const pago = await biblioteca.gerenciador.pagar({ identificador: "VENDA", valor: 1 });
  assert.equal(pago.ok, false);
  assert.equal(await fs.readFile(path.join(efetivo, "Data", "nota.pos"), "utf8"), "original");
  assert.equal(await fs.readFile(path.join(efetivo, "certificado.crt"), "utf8"), "certificado");
});

test("pendência financeira não prepara outra pasta nem apaga o .pos", async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-pendencia-pasta-"));
  const programData = path.join(raiz, "ProgramData");
  const efetivo = path.join(programData, "UltraPDV", "TEF", "Producao", "PGWeb");
  await fs.mkdir(path.join(efetivo, "Data"), { recursive: true });
  await fs.writeFile(path.join(efetivo, "Data", "nota.pos"), "original", "utf8");
  let preparou = 0;
  const { gerenciador, processos } = criarGerenciadorPasta(path.join(raiz, "tef-pasta.json"), {
    instalacaoAutomatica: true,
    env: { PROGRAMDATA: programData },
    instalarPastaPadrao: async () => {
      preparou += 1;
      return { ok: true, diretorioPai: path.join(programData, "UltraPDV", "TEF", "Producao") };
    },
    listarDiretorioBiblioteca: async () => [],
  });
  gerenciador.transacaoPendente = { identificador: "pendente", status: "aguardando_decisao" };
  const inicio = gerenciador.inicializar({
    empresaId: "11111111-1111-4111-8111-111111111111",
    dispositivoId: "33333333-3333-4333-8333-333333333333",
    dispositivoLocal: "33333333-3333-4333-8333-333333333333",
    terminalId: "44444444-4444-4444-8444-444444444444",
    pontoCaptura: "200001",
    estabelecimento: "LOJA",
    ambiente: "producao",
    cnpj: "11222333000181",
    servidor: "tef.cliente.example:31735",
  });
  await ate(() => processos[0]?.stdin.partes.length === 1);
  const pedido = responderInit(processos[0], {
    inicializado: true,
    diretorioBiblioteca: "producao",
    retornoPwInit: 0,
    retornoPwInitNome: "PWRET_OK",
  });
  assert.equal(preparou, 0);
  assert.equal(pedido.dados.diretorioPai, undefined);
  assert.equal((await inicio).ok, true);
  assert.equal(await fs.readFile(path.join(efetivo, "Data", "nota.pos"), "utf8"), "original");
  const pago = await gerenciador.pagar({ identificador: "VENDA", valor: 1 });
  assert.equal(pago.ok, false);
});

test("a pasta padrão é enviada ao agente só depois do teste de gravação", async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-padrao-"));
  const programData = path.join(raiz, "ProgramData");
  const pai = path.join(programData, "UltraPDV", "TEF", "Producao");
  const efetivo = path.join(pai, "PGWeb");
  await fs.mkdir(path.join(efetivo, "Data"), { recursive: true });
  await fs.writeFile(path.join(efetivo, "Data", "nota.pos"), "original", "utf8");
  const identidade = {
    empresaId: "11111111-1111-4111-8111-111111111111",
    dispositivoId: "33333333-3333-4333-8333-333333333333",
    dispositivoLocal: "33333333-3333-4333-8333-333333333333",
    terminalId: "44444444-4444-4444-8444-444444444444",
    pontoCaptura: "200001",
    estabelecimento: "LOJA",
    ambiente: "producao",
    cnpj: "11222333000181",
    servidor: "tef.cliente.example:31735",
  };
  const bloqueado = criarGerenciadorPasta(path.join(raiz, "tef-pasta.json"), {
    instalacaoAutomatica: true,
    env: { PROGRAMDATA: programData },
    fsPendencia: {
      ...fs,
      writeFile: async (alvo, dados, encoding) => {
        if (String(alvo).includes(`${path.sep}PGWeb${path.sep}`)) {
          const erro = new Error("acesso");
          erro.code = "EACCES";
          throw erro;
        }
        return fs.writeFile(alvo, dados, encoding);
      },
    },
    concederPasta: async () => ({ ok: true }),
    restringirDiretorioPasta: async () => ({ ok: true }),
    listarDiretorioBiblioteca: async () => [],
  });
  const recusa = await bloqueado.gerenciador.inicializar(identidade);
  assert.equal(recusa.ok, false);
  assert.match(recusa.erro, /PGWeb/);
  assert.equal(bloqueado.processos.length, 0);
  assert.equal(await fs.readFile(path.join(efetivo, "Data", "nota.pos"), "utf8"), "original");

  const liberado = criarGerenciadorPasta(path.join(raiz, "tef-pasta.json"), {
    instalacaoAutomatica: true,
    env: { PROGRAMDATA: programData },
    concederPasta: async () => ({ ok: true }),
    restringirDiretorioPasta: async () => ({ ok: true }),
    listarDiretorioBiblioteca: async () => [],
  });
  const inicio = liberado.gerenciador.inicializar(identidade);
  await ate(() => liberado.processos[0]?.stdin.partes.length === 1);
  const pedido = responderInit(liberado.processos[0], {
    inicializado: true,
    diretorioBiblioteca: "producao",
    diretorioPwInit: `${efetivo}\\`,
    diretorioTrabalho: `${efetivo}\\`,
    retornoPwInit: 0,
    retornoPwInitNome: "PWRET_OK",
  });
  assert.equal(pedido.dados.diretorioPai, pai);
  const semProgramData = await prepararPastaPadraoInstalador({});
  assert.equal(semProgramData.ok, false);
  assert.match(semProgramData.mensagem, /ProgramData/);
  assert.equal(pedido.acao, "inicializar");
  assert.equal((await inicio).ok, true);
  assert.equal(await fs.readFile(path.join(efetivo, "Data", "nota.pos"), "utf8"), "original");
});
