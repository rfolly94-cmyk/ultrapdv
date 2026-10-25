import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import {
  PGWEB_SHA256,
  PGWEB_VERSAO,
  arquiteturaPe,
  verificarDllPgWeb,
} from "./tef-dll.mjs";
import { avaliarMigracao, pastaLegadaPayGo, planejarDiretorioInicial } from "./tef-pasta.mjs";
import { GerenciadorTefNativo } from "./tef.mjs";
import { resolverRaizAgente } from "./raiz.mjs";

function pe(machine) {
  const buffer = Buffer.alloc(0x80);
  buffer.writeUInt16LE(0x5a4d, 0);
  buffer.writeUInt32LE(0x40, 0x3c);
  buffer.writeUInt16LE(machine, 0x44);
  return buffer;
}

test("a DLL ausente, x86, versão errada, hash divergente e assinatura inválida bloqueiam o uso", async () => {
  const ausente = await verificarDllPgWeb("C:\\agente", {
    ler: async () => {
      const erro = new Error("ausente");
      erro.code = "ENOENT";
      throw erro;
    },
  });
  assert.equal(ausente.ok, false);
  assert.equal(ausente.encontrada, false);

  const x86 = await verificarDllPgWeb("C:\\agente", {
    ler: async () => pe(0x14c),
  });
  assert.equal(x86.arquitetura, "x86");
  assert.equal(x86.ok, false);

  const versao = pe(0x8664);
  const errada = await verificarDllPgWeb("C:\\agente", { ler: async () => versao });
  assert.match(errada.mensagem, /4\.1\.50\.924/);

  const corpo = Buffer.concat([
    pe(0x8664),
    Buffer.from(PGWEB_VERSAO, "utf16le"),
  ]);
  const hash = await verificarDllPgWeb("C:\\agente", { ler: async () => corpo });
  assert.equal(hash.integridade, false);

  const oficial = await fs.readFile(path.join(resolverRaizAgente(), "bin/tef/PGWebLib.dll"));
  assert.equal(createHash("sha256").update(oficial).digest("hex"), PGWEB_SHA256);
  const assinaturaInvalida = await verificarDllPgWeb("C:\\agente", {
    ler: async () => oficial,
    assinar: async () => ({ ok: false, assinatura: "invalida" }),
  });
  assert.equal(assinaturaInvalida.integridade, true);
  assert.equal(assinaturaInvalida.assinatura, "invalida");
  assert.equal(assinaturaInvalida.ok, false);
  assert.equal(arquiteturaPe(pe(0x8664)), "x64");
});

test("perfil antigo em UltraPDV-TEF ou ProgramData PayGo não é aberto pela biblioteca nova", async () => {
  assert.equal(pastaLegadaPayGo("C:\\UltraPDV-TEF\\Producao"), true);
  assert.equal(pastaLegadaPayGo("C:\\ProgramData\\PayGo\\PGWebLib"), true);
  assert.equal(pastaLegadaPayGo("C:\\ProgramData\\UltraPDV\\TEF\\Producao"), false);
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-tef-legado-"));
  const arquivo = path.join(pasta, "tef-pasta.json");
  try {
    await fs.writeFile(
      arquivo,
      JSON.stringify({
        versao: 2,
        producao: {
          pai: "C:\\UltraPDV-TEF\\Producao",
          efetivo: "C:\\UltraPDV-TEF\\Producao\\PGWeb",
          confirmadaEm: "2026-10-15T18:20:46.372Z",
        },
      })
    );
    const plano = await planejarDiretorioInicial({
      ambiente: "producao",
      arquivo,
      paiPadrao: "C:\\ProgramData\\UltraPDV\\TEF\\Producao",
    });
    assert.equal(plano.legadoPreservado, true);
    assert.equal(plano.diretorioPai, "");
    assert.equal(plano.tentativa, false);
    assert.equal(plano.adiada, false);
  } finally {
    await fs.rm(pasta, { recursive: true, force: true });
  }
});

test("perfil antigo não é copiado e a produção nova usa somente ProgramData", async () => {
  const migracao = await avaliarMigracao(
    "C:\\UltraPDV-TEF\\Producao\\PGWeb",
    "C:\\ProgramData\\UltraPDV\\TEF\\Producao\\PGWeb",
    {
      readdir: async () => {
        throw new Error("a pasta antiga não deve ser lida");
      },
    },
    "producao"
  );
  assert.equal(migracao.semInstalacao, true);
  assert.deepEqual(migracao.copiar, []);

  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-tef-novo-"));
  const arquivo = path.join(pasta, "tef-pasta.json");
  const processos = [];
  const paisPreparados = [];
  try {
    await fs.writeFile(
      arquivo,
      JSON.stringify({
        versao: 2,
        producao: {
          pai: "C:\\UltraPDV-TEF\\Producao",
          efetivo: "C:\\UltraPDV-TEF\\Producao\\PGWeb",
          confirmadaEm: "2026-10-15T18:20:46.372Z",
        },
      })
    );
    const gerenciador = new GerenciadorTefNativo({
      arquivo,
      arquivoPendencia: path.join(pasta, "pendencia.json"),
      localizar: async () => ({
        encontrado: true,
        caminho: "D:\\connector\\bin\\tef\\UltraPDVTef_1316.exe",
      }),
      spawn: () => {
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
        proc.pid = 7;
        proc.kill = () => true;
        processos.push(proc);
        setImmediate(() => proc.emit("spawn"));
        return proc;
      },
      registrarLog: async () => {},
      criarId: () => "id-1",
      agendar: () => ({ cancelado: false }),
      cancelarAgendamento: () => {},
      limiteEncerramentoMs: 20,
      env: { PROGRAMDATA: pasta },
      listarDiretorioBiblioteca: async () => [],
      instalarPastaPadrao: async ({ pai }) => {
        paisPreparados.push(pai);
        return { ok: true, pronto: false, diretorioPai: pai };
      },
    });
    const pendente = gerenciador.inicializar({
      empresaId: "11111111-1111-4111-8111-111111111111",
      dispositivoId: "33333333-3333-4333-8333-333333333333",
      dispositivoLocal: "33333333-3333-4333-8333-333333333333",
      terminalId: "44444444-4444-4444-8444-444444444444",
      pontoCaptura: "200001",
      estabelecimento: "LOJA NOVA",
      ambiente: "producao",
      cnpj: "11222333000181",
      servidor: "tef.cliente.example:31735",
    });
    const inicio = Date.now();
    while (processos.length < 1 && Date.now() - inicio < 1000) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(processos.length, 1);
    const pedido = JSON.parse(processos[0].stdin.partes.join("").trim());
    assert.equal(pedido.acao, "inicializar");
    assert.equal(pedido.dados.diretorio, "producao");
    assert.match(pedido.dados.diretorioPai, /\\TEF\\Producao\\perfis\\[0-9a-f-]{36}$/i);
    assert.equal(/\\UltraPDV-TEF\\/i.test(pedido.dados.diretorioPai), false);
    assert.equal(JSON.stringify(pedido).includes("UltraPDV-TEF"), false);
    assert.equal(path.win32.normalize(paisPreparados[0]), path.win32.normalize(pedido.dados.diretorioPai));
    processos[0].stdout.emit(
      "data",
      Buffer.from(
        `${JSON.stringify({
          id: pedido.id,
          ok: true,
          resultado: { inicializado: true, diretorioBiblioteca: "producao" },
          erro: null,
        })}\n`
      )
    );
    const resposta = await pendente;
    assert.equal(resposta.ok, true);
    assert.equal(resposta.tef?.biblioteca?.cobrancaPermitida === true, false);
    const original = JSON.parse(await fs.readFile(arquivo, "utf8"));
    assert.equal(original.producao.pai, "C:\\UltraPDV-TEF\\Producao");
  } finally {
    await fs.rm(pasta, { recursive: true, force: true });
  }
});

test("arquivos já existentes em ProgramData bloqueiam a abertura e não são apagados", async () => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-tef-ocupada-"));
  const arquivo = path.join(pasta, "tef-pasta.json");
  let preparou = false;
  let spawnou = false;
  try {
    await fs.writeFile(
      arquivo,
      JSON.stringify({
        versao: 2,
        producao: {
          pai: "C:\\UltraPDV-TEF\\Producao",
          efetivo: "C:\\UltraPDV-TEF\\Producao\\PGWeb",
          confirmadaEm: "2026-10-15T18:20:46.372Z",
        },
      })
    );
    const gerenciador = new GerenciadorTefNativo({
      arquivo,
      arquivoPendencia: path.join(pasta, "pendencia.json"),
      env: { PROGRAMDATA: pasta },
      localizar: async () => ({
        encontrado: true,
        caminho: "D:\\connector\\bin\\tef\\UltraPDVTef_1316.exe",
      }),
      spawn: () => {
        spawnou = true;
        throw new Error("não deveria iniciar");
      },
      registrarLog: async () => {},
      listarDiretorioBiblioteca: async (alvo) =>
        String(alvo).endsWith("Data") ? ["certificado.crt"] : ["Data"],
      instalarPastaPadrao: async () => {
        preparou = true;
        return { ok: true };
      },
    });
    const resposta = await gerenciador.inicializar({
      empresaId: "11111111-1111-4111-8111-111111111111",
      dispositivoId: "33333333-3333-4333-8333-333333333333",
      dispositivoLocal: "33333333-3333-4333-8333-333333333333",
      terminalId: "44444444-4444-4444-8444-444444444444",
      pontoCaptura: "200001",
      estabelecimento: "LOJA NOVA",
      ambiente: "producao",
      cnpj: "11222333000181",
      servidor: "tef.cliente.example:31735",
    });
    assert.equal(resposta.ok, false);
    assert.match(resposta.erro, /não será reutilizada/);
    assert.equal(preparou, false);
    assert.equal(spawnou, false);
  } finally {
    await fs.rm(pasta, { recursive: true, force: true });
  }
});
