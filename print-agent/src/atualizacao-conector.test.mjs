import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  aplicarPacoteAtualizacao,
  avaliarAtualizacaoNoDisco,
  classificarJournalAtualizacao,
} from "./atualizacao-conector.mjs";
import { arquiteturaPe, PGWEB_SHA256 } from "./tef-dll.mjs";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function montarInstalacao(base, { pendencia = null, journal = null } = {}) {
  const instalacao = path.join(base, "instalacao");
  const pacote = path.join(base, "pacote");
  const backup = path.join(base, "backup");
  const dados = path.join(base, "dados");
  await mkdir(path.join(instalacao, "app"), { recursive: true });
  await mkdir(path.join(instalacao, "launcher"), { recursive: true });
  await mkdir(path.join(pacote, "app"), { recursive: true });
  await mkdir(path.join(pacote, "launcher"), { recursive: true });
  await mkdir(path.join(dados, "UltraPDV", "TEF", "Producao", "PGWeb", "Data"), { recursive: true });
  await mkdir(path.join(dados, "local", "UltraPDV", "conector-homologacao"), { recursive: true });
  await writeFile(path.join(instalacao, "app", "server.mjs"), "versao-antiga\n", "utf8");
  await writeFile(path.join(instalacao, "launcher", "start.vbs"), "antigo\n", "utf8");
  await writeFile(path.join(instalacao, "version.json"), '{"version":"1.3.19"}\n', "utf8");
  await writeFile(path.join(pacote, "app", "server.mjs"), "versao-nova\n", "utf8");
  await writeFile(path.join(pacote, "launcher", "start.vbs"), "supervisor\n", "utf8");
  await writeFile(path.join(pacote, "launcher", "supervisor.ps1"), "ULTRAPDV_SUPERVISOR\n", "utf8");
  await writeFile(path.join(pacote, "version.json"), '{"version":"1.3.20"}\n', "utf8");
  const config = { preferredPort: 18185, activePort: 18185, lastPrinter: "Caixa" };
  await writeFile(
    path.join(dados, "UltraPDV", "print-agent.json"),
    `${JSON.stringify(config)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(dados, "UltraPDV", "device.json"),
    '{"dispositivoId":"11111111-1111-4111-8111-111111111111"}\n',
    "utf8"
  );
  await writeFile(
    path.join(dados, "UltraPDV", "TEF", "Producao", "PGWeb", "Data", "certificado.crt"),
    "certificado-preservado",
    "utf8"
  );
  await writeFile(
    path.join(dados, "UltraPDV", "TEF", "Producao", "PGWeb", "Data", "check.pos"),
    "ponto-preservado",
    "utf8"
  );
  if (pendencia) {
    await writeFile(
      path.join(dados, "UltraPDV", "tef-pendencia.json"),
      `${JSON.stringify(pendencia)}\n`,
      "utf8"
    );
  }
  if (journal) {
    await writeFile(
      path.join(dados, "local", "UltraPDV", "conector-homologacao", "tef-journal-venda-100.json"),
      `${JSON.stringify(journal)}\n`,
      "utf8"
    );
  }
  return { instalacao, pacote, backup, dados };
}

test("transação ativa e resultado desconhecido impedem a atualização", () => {
  assert.equal(classificarJournalAtualizacao({ status: "resultado_desconhecido" }).motivo, "desconhecido");
  assert.equal(classificarJournalAtualizacao({ status: "pagamento_em_andamento" }).motivo, "transacao");
  assert.equal(classificarJournalAtualizacao({ status: "aguardando_decisao" }).motivo, "confirmacao");
  assert.equal(classificarJournalAtualizacao({ status: "aguardando_decisao" }).permitido, false);
  assert.equal(classificarJournalAtualizacao({ ilegivel: true }).motivo, "ilegivel");
  assert.equal(classificarJournalAtualizacao({ permissao: true }).motivo, "permissao");
  assert.equal(classificarJournalAtualizacao(null).motivo, "ausente");
  assert.equal(classificarJournalAtualizacao(null).permitido, true);
  assert.equal(classificarJournalAtualizacao({ status: "sem_autorizacao", resultado: "erro" }).motivo, "encerrado");
  assert.equal(classificarJournalAtualizacao({ status: "sessao_tecnica_incompleta" }).permitido, true);
  assert.equal(classificarJournalAtualizacao({ status: "concluida" }).permitido, true);
});

test("a atualização em diretório temporário preserva porta, dispositivo e arquivos financeiros", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "ultrapdv-atualizacao-"));
  try {
    const pastas = await montarInstalacao(base);
    const aplicado = await aplicarPacoteAtualizacao({ ...pastas, verificar: async () => true });
    assert.equal(aplicado.ok, true);
    assert.equal(aplicado.dadosPreservados, true);
    assert.equal(await readFile(path.join(pastas.instalacao, "app", "server.mjs"), "utf8"), "versao-nova\n");
    const config = JSON.parse(await readFile(path.join(pastas.dados, "UltraPDV", "print-agent.json"), "utf8"));
    assert.equal(config.preferredPort, 18185);
    assert.equal(config.activePort, 18185);
    assert.equal(config.lastPrinter, "Caixa");
    assert.match(
      await readFile(path.join(pastas.dados, "UltraPDV", "device.json"), "utf8"),
      /11111111-1111-4111-8111-111111111111/
    );
    assert.equal(
      await readFile(path.join(pastas.dados, "UltraPDV", "TEF", "Producao", "PGWeb", "Data", "certificado.crt"), "utf8"),
      "certificado-preservado"
    );
    assert.equal(
      await readFile(path.join(pastas.dados, "UltraPDV", "TEF", "Producao", "PGWeb", "Data", "check.pos"), "utf8"),
      "ponto-preservado"
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("falha depois da cópia restaura o Connector anterior e não mexe nos dados", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "ultrapdv-rollback-"));
  try {
    const pastas = await montarInstalacao(base);
    const aplicado = await aplicarPacoteAtualizacao({ ...pastas, verificar: async () => false });
    assert.equal(aplicado.ok, false);
    assert.equal(aplicado.motivo, "rollback");
    assert.equal(aplicado.dadosPreservados, true);
    assert.equal(await readFile(path.join(pastas.instalacao, "app", "server.mjs"), "utf8"), "versao-antiga\n");
    assert.equal(await readFile(path.join(pastas.instalacao, "version.json"), "utf8"), '{"version":"1.3.19"}\n');
    await assert.rejects(readFile(path.join(pastas.instalacao, "launcher", "supervisor.ps1"), "utf8"));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("pendência desconhecida não altera o diretório instalado", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "ultrapdv-bloqueio-"));
  try {
    const pastas = await montarInstalacao(base, { pendencia: { status: "resultado_desconhecido" } });
    const aplicado = await aplicarPacoteAtualizacao({ ...pastas, verificar: async () => true });
    assert.equal(aplicado.ok, false);
    assert.equal(aplicado.alterou, false);
    assert.equal(aplicado.motivo, "desconhecido");
    assert.equal(await readFile(path.join(pastas.instalacao, "app", "server.mjs"), "utf8"), "versao-antiga\n");
    const ativo = await montarInstalacao(path.join(base, "ativo"), {
      journal: { status: "pagamento_em_andamento" },
    });
    const bloqueado = await aplicarPacoteAtualizacao({ ...ativo, verificar: async () => true });
    assert.equal(bloqueado.motivo, "transacao");
    assert.equal(bloqueado.alterou, false);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("o pacote aponta o supervisor para o servidor novo e a PGWebLib x64 conferida", async () => {
  const inicio = await readFile(path.join(raiz, "launcher", "start.vbs"), "utf8");
  const supervisor = await readFile(path.join(raiz, "launcher", "supervisor.ps1"), "utf8");
  const nsi = await readFile(path.join(raiz, "installer", "ultrapdv-connector.nsi"), "utf8");
  assert.match(inicio, /supervisor\.ps1/);
  assert.match(inicio, /server\.mjs/);
  assert.doesNotMatch(inicio, /18281/);
  assert.match(supervisor, /ULTRAPDV_INSTALL_DIR = \$Diretorio/);
  assert.match(supervisor, /Remove-Item Env:ULTRAPDV_CONFIG_DIR/);
  assert.match(nsi, /--bloquear/);
  assert.match(nsi, /conector-ciclo\.mjs/);
  assert.match(nsi, /portas\.mjs/);
  assert.match(nsi, /A verificacao financeira nao iniciou/);
  assert.doesNotMatch(nsi, /ausencia de transacao pendente/);
  assert.match(nsi, /supervisor\.ps1/);
  const dll = await readFile(path.join(raiz, "bin", "tef", "PGWebLib.dll"));
  assert.equal(arquiteturaPe(dll), "x64");
  assert.equal(createHash("sha256").update(dll).digest("hex"), PGWEB_SHA256);
  const avisos = await readFile(path.join(raiz, "THIRD-PARTY-NOTICES.txt"), "utf8");
  assert.match(avisos, /SETIS Automacao e Sistemas Ltda/);
  assert.match(avisos, /OpenSSL/);
  assert.match(avisos, /koffi/);
  const carregador = (await import("koffi")).default;
  assert.equal(typeof carregador.load, "function");
  assert.equal(
    (await readFile(path.join(raiz, "node_modules", "@koromix", "koffi-win32-x64", "win32_x64", "koffi.node"))).length > 0,
    true
  );
});

test("journal encerrado libera a atualização e journal ilegível não altera o programa", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "ultrapdv-historico-"));
  try {
    const historico = await montarInstalacao(base, {
      journal: { status: "sem_autorizacao", resultado: "erro" },
    });
    const aplicado = await aplicarPacoteAtualizacao({ ...historico, verificar: async () => true });
    assert.equal(aplicado.ok, true);
    assert.equal(aplicado.dadosPreservados, true);
    const ilegivel = await montarInstalacao(path.join(base, "ilegivel"));
    await writeFile(path.join(ilegivel.dados, "UltraPDV", "tef-pendencia.json"), "{", "utf8");
    const recusado = await aplicarPacoteAtualizacao({ ...ilegivel, verificar: async () => true });
    assert.equal(recusado.ok, false);
    assert.equal(recusado.alterou, false);
    assert.equal(recusado.motivo, "ilegivel");
    assert.equal(await readFile(path.join(ilegivel.instalacao, "app", "server.mjs"), "utf8"), "versao-antiga\n");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("permissão negada não é arquivo ausente nem resultado desconhecido", async () => {
  const leitura = {
    async readFile() {
      const erro = new Error("acesso");
      erro.code = "EPERM";
      throw erro;
    },
  };
  const resultado = await avaliarAtualizacaoNoDisco(
    { PROGRAMDATA: "C:\\Temp\\dados", LOCALAPPDATA: "C:\\Temp\\local" },
    leitura
  );
  assert.equal(resultado.motivo, "permissao");
  assert.equal(resultado.permitido, false);
});

test("a verificação isolada só conclui quando os módulos locais acompanham o script", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "ultrapdv-verificacao-"));
  const vazio = path.join(base, "vazio");
  const completo = path.join(base, "completo");
  const dados = path.join(base, "dados");
  const local = path.join(base, "local");
  try {
    await mkdir(vazio, { recursive: true });
    await mkdir(completo, { recursive: true });
    await mkdir(dados, { recursive: true });
    await mkdir(local, { recursive: true });
    await copyFile(path.join(raiz, "src", "atualizacao-conector.mjs"), path.join(vazio, "atualizacao-conector.mjs"));
    const incompleto = spawnSync(process.execPath, ["atualizacao-conector.mjs", "--bloquear"], { cwd: vazio, encoding: "utf8" });
    assert.equal(incompleto.status, 1);
    assert.match(incompleto.stderr, /conector-ciclo\.mjs/);
    for (const nome of ["atualizacao-conector.mjs", "conector-ciclo.mjs", "portas.mjs"]) {
      await copyFile(path.join(raiz, "src", nome), path.join(completo, nome));
    }
    const livre = spawnSync(process.execPath, ["atualizacao-conector.mjs", "--bloquear"], {
      cwd: completo,
      encoding: "utf8",
      env: { ...process.env, PROGRAMDATA: dados, LOCALAPPDATA: local },
    });
    assert.equal(livre.status, 0);
    assert.match(livre.stdout, /Nenhuma transacao pendente/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
