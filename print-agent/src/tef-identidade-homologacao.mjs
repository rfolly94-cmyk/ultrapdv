import path from "node:path";

import { pastaConectorHomologacao } from "./homologacao-servidor.mjs";
import {
  conferirCodigoPareamento,
  consumirPareamento,
  garantirPareamento,
  gravarPareamentoTef,
  lerPareamentoTef,
} from "./tef-pareamento.mjs";
import { assinarPareamentoTef, hashCodigoPareamento, lerOuCriarChaveTef } from "./tef-prova.mjs";

export function diretorioIdentidadeHomologacao(env = process.env) {
  const isolada = String(env.ULTRAPDV_CONFIG_DIR ?? "").trim();
  const diretorio = isolada || pastaConectorHomologacao(env);
  const normal = diretorio.replaceAll("/", "\\").toLowerCase();
  if (!normal.includes("\\conector-homologacao")) return "";
  if (normal.includes("\\programdata\\") || normal.includes("\\producao\\") || normal.includes("\\paygo\\")) {
    return "";
  }
  return diretorio;
}

export function arquivoChaveHomologacao(env = process.env) {
  const diretorio = diretorioIdentidadeHomologacao(env);
  if (!diretorio) return "";
  return path.win32.join(diretorio, "tef-chave-homologacao.json");
}

function arquivoPareamentoHomologacao(env = process.env) {
  const diretorio = diretorioIdentidadeHomologacao(env);
  if (!diretorio) return "";
  return path.win32.join(diretorio, "tef-pareamento-homologacao.json");
}

function publico(chave) {
  return { chavePublica: chave.publica, chaveId: chave.id };
}

export async function emitirIdentidadeHomologacao(deps = {}) {
  const env = deps.env ?? process.env;
  const arquivo = arquivoChaveHomologacao(env);
  const pareamento = arquivoPareamentoHomologacao(env);
  if (!arquivo || !pareamento) {
    return {
      ok: false,
      codigo: "DIRETORIO_PRODUCAO",
      erro: "A identidade de homologação não usa a pasta do Connector financeiro.",
    };
  }
  const lerChave = deps.lerOuCriar ?? lerOuCriarChaveTef;
  const chave = await lerChave(arquivo, deps.fs);
  const atual = await (deps.lerPareamento ?? lerPareamentoTef)(pareamento, deps.fs);
  const emitido = garantirPareamento(atual);
  await (deps.gravarPareamento ?? gravarPareamentoTef)(pareamento, emitido, deps.fs);
  return { ok: true, ...publico(chave), codigo: emitido.codigo, expiraEm: emitido.expiraEm };
}

export async function apresentarIdentidadeHomologacao(pedido = {}, deps = {}) {
  const env = deps.env ?? process.env;
  const arquivo = arquivoChaveHomologacao(env);
  const pareamento = arquivoPareamentoHomologacao(env);
  if (!arquivo || !pareamento) {
    return {
      ok: false,
      codigo: "DIRETORIO_PRODUCAO",
      erro: "A identidade de homologação não usa a pasta do Connector financeiro.",
    };
  }
  const lerArquivo = deps.lerChave ?? (async (caminho, fsApi) => {
    const fsPadrao = fsApi ?? (await import("node:fs/promises"));
    const bruto = JSON.parse(await fsPadrao.readFile(caminho, "utf8"));
    if (!bruto?.publica || !bruto?.privada) return null;
    return bruto;
  });
  const chave = await lerArquivo(arquivo, deps.fs);
  if (!chave?.privada || !chave?.publica) {
    return { ok: false, codigo: "CHAVE_AUSENTE", erro: "Gere a identidade de homologação antes de vinculá-la." };
  }
  const atual = await (deps.lerPareamento ?? lerPareamentoTef)(pareamento, deps.fs);
  const conferencia = conferirCodigoPareamento(atual, pedido.codigo);
  if (!conferencia.ok) {
    if (conferencia.atual) {
      await (deps.gravarPareamento ?? gravarPareamentoTef)(pareamento, conferencia.atual, deps.fs);
    }
    return { ok: false, codigo: "CODIGO_INVALIDO", erro: conferencia.erro };
  }
  await (deps.gravarPareamento ?? gravarPareamentoTef)(pareamento, consumirPareamento(atual), deps.fs);
  const dispositivoId = String(pedido.dispositivoId ?? "").trim();
  return {
    ok: true,
    ...publico(chave),
    dispositivoId,
    assinaturaPareamento: assinarPareamentoTef(chave.privada, hashCodigoPareamento(pedido.codigo), dispositivoId),
  };
}
