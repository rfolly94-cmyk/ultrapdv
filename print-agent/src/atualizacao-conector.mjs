import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { avaliarBloqueioCiclo } from "./conector-ciclo.mjs";

export const CODIGO_ATUALIZACAO_BLOQUEADA = 76;
export const CODIGO_ATUALIZACAO_ILEGIVEL = 77;
export const CODIGO_ATUALIZACAO_PERMISSAO = 78;

const MENSAGENS_ATUALIZACAO = Object.freeze({
  ocioso: "Nenhuma transacao pendente.",
  ausente: "Nenhuma transacao pendente. O arquivo consultado nao existe.",
  encerrado: "O journal encontrado esta encerrado. Nenhuma transacao pendente.",
  transacao: "Ha transacao financeira ativa. A atualizacao foi cancelada e nenhum arquivo foi alterado.",
  confirmacao: "Ha confirmacao financeira pendente. A atualizacao foi cancelada e nenhum arquivo foi alterado.",
  desconhecido: "Ha resultado financeiro desconhecido. A atualizacao foi cancelada e nenhum arquivo foi alterado.",
  sessao: "A sessao nativa ainda esta aberta. A atualizacao foi cancelada e nenhum arquivo foi alterado.",
  ocupacao: "O PinPad esta em uso. A atualizacao foi cancelada e nenhum arquivo foi alterado.",
  ilegivel: "Um journal nao pode ser lido. A atualizacao foi cancelada e nenhum arquivo foi alterado.",
  permissao: "Nao foi possivel ler o journal por falta de permissao. A atualizacao foi cancelada e nenhum arquivo foi alterado.",
});

const ARQUIVOS_PACOTE = [
  "version.json",
  "app",
  "launcher",
  "bin/tef/PGWebLib.dll",
  "bin/tef/UltraPDVTef_1316.exe",
];

export function mensagemAtualizacao(motivo) {
  return MENSAGENS_ATUALIZACAO[motivo] ?? MENSAGENS_ATUALIZACAO.ilegivel;
}

export function codigoAtualizacao(motivo, permitido) {
  if (permitido) return 0;
  if (motivo === "permissao") return CODIGO_ATUALIZACAO_PERMISSAO;
  if (motivo === "ilegivel") return CODIGO_ATUALIZACAO_ILEGIVEL;
  return CODIGO_ATUALIZACAO_BLOQUEADA;
}

export function classificarJournalAtualizacao(journal) {
  if (!journal) return { permitido: true, motivo: "ausente", preservarJournal: true };
  if (journal.permissao === true) {
    return { permitido: false, motivo: "permissao", preservarJournal: true };
  }
  if (journal.ilegivel === true) {
    return { permitido: false, motivo: "ilegivel", preservarJournal: true };
  }
  const status = String(journal.status ?? "");
  if (status === "aguardando_decisao" || status === "aguardando_confirmacao") {
    return { permitido: false, motivo: "confirmacao", preservarJournal: true };
  }
  const bloqueio = avaliarBloqueioCiclo({ journal });
  if (!bloqueio.permitido) return bloqueio;
  if (!status) return { permitido: true, motivo: "ausente", preservarJournal: true };
  return { permitido: true, motivo: "encerrado", preservarJournal: true };
}

export function juntarBloqueios(itens) {
  return (
    itens.find((item) => item?.permitido === false) ?? {
      permitido: true,
      motivo: "ocioso",
      preservarJournal: true,
    }
  );
}

async function lerJournal(arquivo, fsApi) {
  try {
    const bruto = await fsApi.readFile(arquivo, "utf8");
    const json = JSON.parse(bruto);
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return { ilegivel: true };
    }
    return {
      status: typeof json.status === "string" ? json.status : "",
      resultado: typeof json.resultado === "string" ? json.resultado : "",
      sessaoNativa: json.sessaoNativa === "residente" ? "residente" : "",
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error?.code === "EPERM" || error?.code === "EACCES" || error?.code === "EBUSY") {
      return { permissao: true };
    }
    return { ilegivel: true };
  }
}

export function arquivosFinanceiros(env = process.env) {
  const programData = String(env.PROGRAMDATA || "").trim()
    || path.win32.join(env.SystemRoot || "C:\\Windows", "..", "ProgramData");
  const local = String(env.LOCALAPPDATA || "").trim()
    || path.win32.join(os.homedir(), "AppData", "Local");
  const base = path.win32.join(programData, "UltraPDV");
  const homologacao = path.win32.join(local, "UltraPDV", "conector-homologacao");
  return [
    path.win32.join(base, "tef-pendencia.json"),
    path.win32.join(homologacao, "tef-pendencia.json"),
    path.win32.join(homologacao, "tef-journal-venda-100.json"),
    path.win32.join(homologacao, "tef-journal-teste-nativo.json"),
  ];
}

export async function avaliarAtualizacaoNoDisco(env = process.env, fsApi = fs) {
  const lidos = [];
  for (const arquivo of arquivosFinanceiros(env)) {
    lidos.push(classificarJournalAtualizacao(await lerJournal(arquivo, fsApi)));
  }
  return juntarBloqueios(lidos);
}

function dentro(raiz, alvo) {
  const base = path.resolve(raiz);
  const candidato = path.resolve(alvo);
  return candidato === base || candidato.startsWith(base + path.sep);
}

async function listarArquivos(raiz, fsApi) {
  const saida = [];
  async function visitar(atual) {
    let entradas;
    try {
      entradas = await fsApi.readdir(atual, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entrada of entradas) {
      const completo = path.join(atual, entrada.name);
      if (!dentro(raiz, completo)) continue;
      if (entrada.isDirectory()) {
        await visitar(completo);
      } else if (entrada.isFile()) {
        saida.push(completo);
      }
    }
  }
  await visitar(raiz);
  return saida;
}

async function hashArquivo(arquivo, fsApi) {
  const { createHash } = await import("node:crypto");
  const dados = await fsApi.readFile(arquivo);
  return createHash("sha256").update(dados).digest("hex");
}

async function retrato(raiz, fsApi) {
  const mapa = new Map();
  for (const arquivo of await listarArquivos(raiz, fsApi)) {
    mapa.set(path.relative(raiz, arquivo), await hashArquivo(arquivo, fsApi));
  }
  return mapa;
}

function igual(antes, depois) {
  if (antes.size !== depois.size) return false;
  for (const [nome, hash] of antes) {
    if (depois.get(nome) !== hash) return false;
  }
  return true;
}

async function copiarRelativo(origemRaiz, destinoRaiz, relativo, fsApi) {
  const origem = path.resolve(origemRaiz, relativo);
  const destino = path.resolve(destinoRaiz, relativo);
  if (!dentro(origemRaiz, origem) || !dentro(destinoRaiz, destino)) {
    throw new Error("Caminho de atualizacao fora do diretorio permitido.");
  }
  await fsApi.mkdir(path.dirname(destino), { recursive: true });
  await fsApi.copyFile(origem, destino);
}

export async function aplicarPacoteAtualizacao({
  instalacao,
  pacote,
  backup,
  dados,
  verificar = async () => true,
  fsApi = fs,
} = {}) {
  const bloqueio = await avaliarAtualizacaoNoDisco(
    {
      PROGRAMDATA: dados,
      LOCALAPPDATA: path.join(dados, "local"),
    },
    fsApi
  );
  if (!bloqueio.permitido) {
    return { ok: false, alterou: false, motivo: bloqueio.motivo, preservarJournal: true };
  }
  const antes = await retrato(dados, fsApi);
  const existentes = new Set();
  for (const relativo of ARQUIVOS_PACOTE) {
    const raizItem = path.resolve(instalacao, relativo);
    if (!dentro(instalacao, raizItem)) {
      return { ok: false, alterou: false, motivo: "caminho", preservarJournal: true };
    }
    const info = await fsApi.stat(raizItem).catch(() => null);
    if (!info) continue;
    const arquivos = info.isDirectory() ? await listarArquivos(raizItem, fsApi) : [raizItem];
    for (const arquivo of arquivos) {
      const relativoArquivo = path.relative(instalacao, arquivo);
      existentes.add(relativoArquivo);
      await copiarRelativo(instalacao, backup, relativoArquivo, fsApi);
    }
  }
  const adicionados = [];
  try {
    for (const relativo of ARQUIVOS_PACOTE) {
      const origem = path.resolve(pacote, relativo);
      if (!dentro(pacote, origem)) throw new Error("pacote");
      const info = await fsApi.stat(origem).catch(() => null);
      if (!info) continue;
      const arquivos = info.isDirectory() ? await listarArquivos(origem, fsApi) : [origem];
      for (const arquivo of arquivos) {
        const relativoArquivo = path.relative(pacote, arquivo);
        if (!existentes.has(relativoArquivo)) adicionados.push(relativoArquivo);
        await copiarRelativo(pacote, instalacao, relativoArquivo, fsApi);
      }
    }
    const conferido = await verificar();
    if (conferido !== true) throw new Error("verificacao");
  } catch {
    for (const relativo of adicionados) {
      const alvo = path.resolve(instalacao, relativo);
      if (dentro(instalacao, alvo)) await fsApi.rm(alvo, { force: true });
    }
    for (const relativo of existentes) {
      await copiarRelativo(backup, instalacao, relativo, fsApi);
    }
    const depois = await retrato(dados, fsApi);
    return {
      ok: false,
      alterou: false,
      motivo: "rollback",
      preservarJournal: true,
      dadosPreservados: igual(antes, depois),
    };
  }
  const depois = await retrato(dados, fsApi);
  return {
    ok: true,
    alterou: true,
    motivo: "ocioso",
    preservarJournal: true,
    dadosPreservados: igual(antes, depois),
  };
}

const executadoDireto = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (executadoDireto && process.argv.includes("--bloquear")) {
  const resultado = await avaliarAtualizacaoNoDisco();
  process.stdout.write(`${mensagemAtualizacao(resultado.motivo)}\n`);
  process.exit(codigoAtualizacao(resultado.motivo, resultado.permitido));
}
