import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { resolverRaizAgente } from "./raiz.mjs";
import {
  diagnosticarBibliotecaPayGo,
  GerenciadorPgWeb,
  localizarTefNativo,
  NOME_TEF_ANTIGO,
  NOME_TEF_NATIVO,
  nomeExecutavelTef,
} from "./tef.mjs";
import { carregarVersao } from "./versao.mjs";

const raizPacote = resolverRaizAgente();
const versao = carregarVersao(raizPacote).version;

function ler(relativo) {
  return readFileSync(path.join(raizPacote, relativo), "utf8");
}

test("a versão 1.3.40 distribui a PGWebLib x64 e não distribui o agente Pascal", () => {
  assert.equal(versao, "1.3.40");
  assert.equal(nomeExecutavelTef(versao), "");
  assert.equal(nomeExecutavelTef("1.3.16"), "");
  assert.equal(NOME_TEF_NATIVO, "");
  const pacote = JSON.parse(ler("tef-pacote.json"));
  const manifesto = JSON.parse(ler("version.json"));
  assert.equal(pacote.executavel, undefined);
  assert.equal(pacote.dll, "bin/tef/PGWebLib.dll");
  assert.equal(pacote.dllVersao, "4.1.50.924");
  assert.equal(manifesto.agenteTef, "");
  assert.equal(pacote.pontoProducao, "6696546");
  assert.equal(pacote.terminalLogico, "117473");
  const build = ler("installer/build.ps1");
  assert.doesNotMatch(build, /UltraPDVTef_/);
  assert.doesNotMatch(build, /lazbuild/);
  assert.match(build, /PGWebLib\.dll/);
  const hashDe = (relativo) =>
    createHash("sha256").update(readFileSync(path.join(raizPacote, relativo))).digest("hex").toUpperCase();
  for (const legado of [
    "bin/tef/UltraPDVTef.exe",
    "bin/tef/UltraPDVTef_1313.exe",
    "bin/tef/UltraPDVTef_1316.exe",
    "bin/tef/UltraPDVTef_137.exe",
    "bin/tef/UltraPDVTef_138.exe",
    "bin/tef/UltraPDVTef_139.exe",
    "bin/tef/UltraPDVTef_NOVO.exe",
  ]) {
    assert.equal(existsSync(path.join(raizPacote, legado)), false, legado);
  }
  assert.equal(
    hashDe("bin/tef/PGWebLib.dll"),
    "D17AC81323396AE172648935B0B797B74705B1CA01C9AE0CD3B2FF78119D4220"
  );
  const nsi = ler("installer/ultrapdv-connector.nsi");
  const preparar = ler("src/tef-preparar-pasta.mjs");
  assert.equal(nsi.includes("UltraPDV-TEF"), false);
  assert.match(nsi, /PGWebLib\.dll/);
  assert.equal(preparar.includes("UltraPDV-TEF"), false);
  assert.equal(nsi.includes("certificado.crt"), false);
  assert.doesNotMatch(nsi, /Delete\s+"[^"]*tef-pasta\.json"/);
  assert.match(ler("src/tef.mjs"), /validarPastaConfirmada/);
  assert.match(ler("src/tef.mjs"), /mensagemRetornoBiblioteca/);
  const fontePasta = ler("src/tef-pasta.mjs");
  const inicioValidacao = fontePasta.indexOf("export async function validarPastaConfirmada");
  const fimValidacao = fontePasta.indexOf("export async function testarGravacaoOperacional");
  const validacao = fontePasta.slice(inicioValidacao, fimValidacao);
  assert.equal(validacao.includes("testarGravacaoPasta"), false);
  assert.equal(validacao.includes("icacls"), false);
  assert.match(validacao, /A validação do Connector/);
  assert.match(preparar, /instalarPastaPadrao/);
  assert.doesNotMatch(preparar, /validarPastaConfirmada/);
  const servidor = ler("src/server.mjs");
  assert.match(servidor, /cobrancaBloqueadaPorRecuperacao/);
  assert.match(servidor, /TEF_TRANSACAO_PENDENTE/);
  assert.match(servidor, /\/tef\/pasta/);
  const pasta = ler("src/tef-pasta.mjs");
  assert.match(pasta, /SUBPASTAS_OPERACIONAIS/);
  assert.match(pasta, /path\.win32\.join\("Data", "Backup"\)/);
  assert.match(pasta, /whoami\.exe/);
  assert.match(pasta, /contaProcessoTef/);
});

test("o agente 1.3.5 e o executável antigo são rejeitados", async () => {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-agente-136-"));
  const pasta = path.join(raiz, "bin", "tef");
  const env = {
    ULTRAPDV_INSTALL_DIR: "",
    ProgramFiles: raiz,
    "ProgramFiles(x86)": raiz,
  };
  const access = async (candidato) => {
    await fs.access(candidato);
  };
  try {
    await fs.mkdir(pasta, { recursive: true });
    await fs.writeFile(path.join(pasta, NOME_TEF_ANTIGO), "antigo");
    await fs.writeFile(path.join(pasta, "UltraPDVTef_135.exe"), "anterior");
    const sem136 = await localizarTefNativo(env, access, raiz, versao);
    assert.equal(sem136.encontrado, false);
    assert.equal(sem136.antigoEncontrado, true);

    let spawnou = false;
    const gerenciador = new GerenciadorPgWeb({
      arquivoPendencia: path.join(raiz, "tef-pendencia.json"),
      versaoAgente: versao,
      localizar: async () => sem136,
      spawn: () => {
        spawnou = true;
        throw new Error("não deveria iniciar");
      },
      registrarLog: async () => {},
    });
    const bloqueado = await gerenciador.pagar({ identificador: "SIMULADO", valor: 1 });
    assert.equal(bloqueado.ok, false);
    assert.equal("agente" in bloqueado.tef, false);
    assert.equal(spawnou, false);

    await fs.writeFile(path.join(pasta, "UltraPDVTef_1316.exe"), "atual");
    const achou = await localizarTefNativo(env, access, raiz, versao);
    assert.equal(achou.encontrado, false);
    assert.equal(achou.caminho, null);
  } finally {
    await fs.rm(raiz, { recursive: true, force: true });
  }
});

test("pagamento sem evidência válida não inicia o agente", async () => {
  let spawnou = false;
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), "ultrapdv-sem-prova-"));
  const gerenciador = new GerenciadorPgWeb({
    arquivoPendencia: path.join(pasta, "tef-pendencia.json"),
    versaoAgente: versao,
    localizar: async () => ({
      encontrado: true,
      caminho: path.join(pasta, NOME_TEF_NATIVO),
    }),
    spawn: () => {
      spawnou = true;
      throw new Error("não deveria iniciar");
    },
    registrarLog: async () => {},
  });
  gerenciador.executavelEncontrado = true;
  gerenciador.caminho = path.join(pasta, NOME_TEF_NATIVO);
  gerenciador.estado = "executando";
  gerenciador.inicializado = true;
  gerenciador.filho = { exitCode: null };
  gerenciador.bibliotecaVisivel = true;
  gerenciador.observacaoBiblioteca = diagnosticarBibliotecaPayGo(null);
  const resposta = await gerenciador.pagar({ identificador: "SIMULADO", valor: 1 });
  assert.equal(resposta.ok, false);
  assert.equal(resposta.tef.biblioteca.cobrancaPermitida, false);
  assert.match(resposta.erro, /cobrança não foi iniciada/);
  assert.equal(spawnou, false);
  await fs.rm(pasta, { recursive: true, force: true });
});

test("o rodapé usa a versão recebida e a consulta da prova não leva chave privada", () => {
  const pagina = ler("src/pagina-status.html");
  assert.match(pagina, /id="rodapeConector"/);
  assert.match(pagina, /data\.version \|\| data\.versao/);
  assert.match(pagina, /id="agenteTef"/);
  assert.doesNotMatch(pagina, /1\.3\.\d+/);
  const servidor = ler("src/server.mjs");
  assert.match(servidor, /pathname === "\/tef\/biblioteca\/evidencia"/);
  assert.match(servidor, /versao: prova\.versao, campos: prova\.campos, assinatura: prova\.assinatura/);
  assert.doesNotMatch(servidor, /tef-chave\.json/);
});

test("o instalador acrescenta o agente novo, guarda backup e não apaga PayGo nem executáveis anteriores", () => {
  const nsi = ler("installer/ultrapdv-connector.nsi");
  const instalacao = nsi.split(/Section "Uninstall"/)[0];
  assert.match(instalacao, /Call StopConnector/);
  assert.match(instalacao, /Call BackupConnectorAnterior/);
  assert.doesNotMatch(instalacao, /TEF_EXE_NAME/);
  assert.match(instalacao, /File "\$\{STAGING_DIR\}\\bin\\tef\\PGWebLib\.dll"/);
  assert.equal(
    instalacao.match(/File "\$\{STAGING_DIR\}\\bin\\tef\\/g)?.length ?? 0,
    1
  );
  assert.doesNotMatch(nsi, /UltraPDVTef_\d+\.exe/);
  assert.doesNotMatch(nsi, /Rename[\s\S]*UltraPDVTef/);
  assert.match(instalacao, /Call RestaurarConnectorAnterior/);
  assert.match(nsi, /version\.json/);
  assert.match(nsi, /tef-biblioteca\.json/);
  assert.doesNotMatch(instalacao, /Delete[\s\S]*UltraPDVTef/);
  assert.doesNotMatch(nsi, /RMDir\s+\/r\s+"\$INSTDIR"/);
  assert.match(nsi, /RMDir "\$INSTDIR\\bin\\tef"/);
  assert.match(nsi, /icacls "\$INSTDIR\\bin\\tef\\producao"/);
  assert.match(nsi, /icacls "\$INSTDIR\\bin\\tef\\TEF"/);
  assert.doesNotMatch(instalacao, /Delete[\s\S]*producao/);
  const pacote = JSON.parse(ler("tef-pacote.json"));
  assert.equal(pacote.diretorioProducao, "C:/ProgramData/UltraPDV/TEF/Producao/PGWeb");
  assert.ok(pacote.preservar.includes("%PROGRAMDATA%\\UltraPDV\\TEF\\Producao"));
  assert.ok(pacote.preservar.includes("%PROGRAMDATA%\\UltraPDV\\tef-biblioteca.json"));
  assert.ok(pacote.preservar.includes("%PROGRAMDATA%\\UltraPDV\\tef-pendencia.json"));
});
