import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ENTRADAS = ["server.mjs", "stop.mjs", "verify.mjs", "identidade.mjs", "tef-preparar-pasta.mjs"];
const ATIVOS = ["pagina-status.html"];
const MODULOS_TEF = [
  "tef.mjs",
  "tef-pendencia.mjs",
  "tef-vinculo.mjs",
  "tef-prova.mjs",
  "tef-pareamento.mjs",
  "tef-recuperacao.mjs",
  "tef-pasta.mjs",
];
const ARQUIVOS_PROGRAMDATA = [
  "print-agent.json",
  "tef-chave.json",
  "tef-pendencia.json",
  "tef-recuperacao.json",
  "tef-vinculo.json",
  "tef-pareamento.json",
  "tef-biblioteca.json",
  "tef-pasta.json",
];

const IMPORT_LOCAL =
  /(?:from\s+|import\s*\(\s*)["'](\.[^"']+)["']/g;

export function importsLocais(fonte) {
  return [...String(fonte).matchAll(IMPORT_LOCAL)].map((item) => item[1]);
}

export function resolverGrafo(pastaSrc) {
  const raiz = path.resolve(pastaSrc);
  const vistos = new Set();
  const fila = [...ENTRADAS];
  while (fila.length > 0) {
    const nome = fila.pop().replaceAll("\\", "/");
    if (vistos.has(nome)) {
      continue;
    }
    if (nome.endsWith(".test.mjs") || nome.includes("/")) {
      throw new Error(`Modulo recusado no instalador: ${nome}`);
    }
    const arquivo = path.join(raiz, nome);
    if (!fs.existsSync(arquivo)) {
      throw new Error(`Modulo ausente: ${nome}`);
    }
    vistos.add(nome);
    const fonte = fs.readFileSync(arquivo, "utf8");
    for (const especificador of importsLocais(fonte)) {
      if (!especificador.endsWith(".mjs")) {
        throw new Error(`Import local sem .mjs em ${nome}: ${especificador}`);
      }
      const destino = path.resolve(path.dirname(arquivo), especificador);
      const relativo = path.relative(raiz, destino);
      if (relativo.startsWith("..") || path.isAbsolute(relativo)) {
        throw new Error(`Import fora de src em ${nome}: ${especificador}`);
      }
      fila.push(relativo);
    }
  }
  for (const nome of MODULOS_TEF) {
    if (!vistos.has(nome)) {
      throw new Error(`Modulo TEF obrigatorio fora do grafo: ${nome}`);
    }
  }
  for (const nome of ATIVOS) {
    if (!fs.existsSync(path.join(raiz, nome))) {
      throw new Error(`Ativo ausente: ${nome}`);
    }
  }
  return [...vistos, ...ATIVOS].sort();
}

export function verificarImportsEmpacotados(pastaApp) {
  const pasta = path.resolve(pastaApp);
  const erros = [];
  for (const nome of [...ENTRADAS, ...MODULOS_TEF, ...ATIVOS]) {
    if (!fs.existsSync(path.join(pasta, nome))) {
      erros.push(`ausente no pacote: ${nome}`);
    }
  }
  const pedidos = [];
  for (const nome of fs.readdirSync(pasta).filter((item) => item.endsWith(".mjs"))) {
    const fonte = fs.readFileSync(path.join(pasta, nome), "utf8");
    for (const especificador of importsLocais(fonte)) {
      pedidos.push({ nome, especificador });
    }
  }
  if (erros.length > 0) {
    throw new Error(erros.join("\n"));
  }
  const verificador = path.join(pasta, "._resolver_imports.mjs");
  const codigo = `
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const pedidos = ${JSON.stringify(pedidos)};
const erros = [];
for (const item of pedidos) {
  try {
    const caminho = fileURLToPath(import.meta.resolve(item.especificador));
    if (!fs.existsSync(caminho)) {
      erros.push(item.nome + " -> " + item.especificador + " nao existe");
    }
  } catch (error) {
    erros.push(item.nome + " -> " + item.especificador + ": " + (error && error.message ? error.message : "falha"));
  }
}
if (erros.length > 0) {
  process.stderr.write(erros.join("\\n") + "\\n");
  process.exit(1);
}
`;
  fs.writeFileSync(verificador, codigo, "utf8");
  try {
    const resultado = spawnSync(process.execPath, [verificador], {
      cwd: pasta,
      encoding: "utf8",
    });
    if (resultado.status !== 0) {
      throw new Error(
        (resultado.stderr || resultado.stdout || "Imports do pacote nao resolveram.").trim()
      );
    }
  } finally {
    fs.rmSync(verificador, { force: true });
  }
}

function linhasDeComando(trecho) {
  return String(trecho)
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter((linha) => linha && !linha.startsWith(";"));
}

export function auditarInstaladorNsi(texto) {
  const fonte = String(texto);
  const partes = fonte.split(/Section "Uninstall"/);
  const instalacao = partes[0] ?? "";
  const desinstalacao = partes[1] ?? "";
  const erros = [];
  if (partes.length < 2) {
    erros.push("Secao de desinstalacao nao encontrada.");
  }
  for (const linha of linhasDeComando(instalacao)) {
    if (/\bDelete\b|\bRMDir\b/.test(linha)) {
      erros.push(`A instalacao nao pode apagar arquivos: ${linha}`);
    }
  }
  if (/RMDir\s+\/r\s+"\$1\\UltraPDV"/.test(fonte)) {
    erros.push("O instalador apagaria a pasta ProgramData do UltraPDV.");
  }
  for (const linha of linhasDeComando(desinstalacao)) {
    for (const nome of ARQUIVOS_PROGRAMDATA) {
      if (nome !== "print-agent.json" && linha.includes(nome)) {
        erros.push(`A desinstalacao apagaria ${nome}.`);
      }
    }
  }
  if (!instalacao.includes("${STAGING_DIR}\\app\\*.mjs")) {
    erros.push("O instalador nao copia todos os modulos de app.");
  }
  if (!instalacao.includes("${TEF_EXE_NAME}")) {
    erros.push("O instalador nao inclui o executavel TEF versionado.");
  }
  if (fonte.includes("UltraPDVTef_NOVO.exe")) {
    erros.push("O instalador ainda grava ou apaga o executavel TEF antigo.");
  }
  if (instalacao.includes("UltraPDVTef.exe")) {
    erros.push("O instalador referencia o executavel TEF sem versao.");
  }
  if (/PGWeb|TSTKEY|certificado\.crt|\.pos\b/.test(instalacao)) {
    erros.push("O instalador empacotaria dados locais do PayGo.");
  }
  if (!instalacao.includes("BackupConnectorAnterior")) {
    erros.push("A atualizacao nao guarda a copia anterior do Connector.");
  }
  if (!instalacao.includes("tef-pacote.json")) {
    erros.push("O instalador nao publica o inventario do pacote TEF.");
  }
  if (/RMDir\s+\/r\s+"\$INSTDIR"/.test(fonte)) {
    erros.push("A desinstalacao apagaria a pasta inteira, inclusive a PGWebLib.");
  }
  if (!/RMDir\s+"\$INSTDIR\\bin\\tef"/.test(desinstalacao)) {
    erros.push("A desinstalacao precisa manter o diretorio de trabalho da PGWebLib.");
  }
  if (erros.length > 0) {
    throw new Error(erros.join("\n"));
  }
}

function usarCli() {
  const [comando, alvo] = process.argv.slice(2);
  if (comando === "--list") {
    for (const nome of resolverGrafo(alvo)) {
      process.stdout.write(`${nome}\n`);
    }
    return;
  }
  if (comando === "--verificar") {
    try {
      verificarImportsEmpacotados(alvo);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : "Falha"}\n`);
      process.exitCode = 1;
    }
    return;
  }
  if (comando === "--auditar-nsi") {
    try {
      auditarInstaladorNsi(fs.readFileSync(alvo, "utf8"));
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : "Falha"}\n`);
      process.exitCode = 1;
    }
    return;
  }
  process.stderr.write("Uso: --list <src> | --verificar <app> | --auditar-nsi <nsi>\n");
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  usarCli();
}
