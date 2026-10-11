import fs from "node:fs/promises";
import path from "node:path";

import { pastaConfigMaquina } from "./config-local.mjs";

export function arquivoRecuperacaoTef(env = process.env) {
  return path.join(pastaConfigMaquina(env), "tef-recuperacao.json");
}

function texto(valor) {
  return typeof valor === "string" ? valor.trim() : "";
}

export function registroRecuperacaoTef(dados = {}) {
  const identificador = texto(dados.identificador);
  const prova = texto(dados.prova);
  if (!identificador || !prova) {
    return null;
  }
  return {
    versao: 1,
    identificador,
    prova,
    nsu: texto(dados.nsu),
    autorizacao: texto(dados.autorizacao),
    rede: texto(dados.rede),
    finalizacao: texto(dados.finalizacao),
    valor: Number.isFinite(Number(dados.valor)) ? Number(dados.valor) : null,
    sucessoTransacao: dados.sucessoTransacao === true,
    codigo: texto(dados.codigo),
    bandeira: texto(dados.bandeira),
    cnpjCredenciadora: texto(dados.cnpjCredenciadora).replace(/\D/g, ""),
    cnpjRecebedor: texto(dados.cnpjRecebedor).replace(/\D/g, ""),
    instituicao: texto(dados.instituicao),
    nomeBandeiraPadrao: texto(dados.nomeBandeiraPadrao || dados.bandeira),
    confirmar: dados.confirmar === true,
    precisaConfirmacao: dados.precisaConfirmacao === true,
    transacaoPendenteConfirmacao: dados.transacaoPendenteConfirmacao === true,
    cancelada: dados.cancelada === true,
    gravadoEm: texto(dados.gravadoEm) || new Date().toISOString(),
  };
}

export async function lerRecuperacaoTef(arquivo, fsApi = fs) {
  try {
    const json = JSON.parse(await fsApi.readFile(arquivo, "utf8"));
    return registroRecuperacaoTef(json);
  } catch (erro) {
    if (erro?.code === "ENOENT") {
      return null;
    }
    return null;
  }
}

export async function gravarRecuperacaoTef(arquivo, registro, fsApi = fs) {
  const valido = registroRecuperacaoTef(registro);
  if (!valido) {
    throw new Error("Recuperação TEF incompleta.");
  }
  await fsApi.mkdir(path.dirname(arquivo), { recursive: true });
  const temporario = `${arquivo}.${process.pid}.tmp`;
  const handle = await fsApi.open(temporario, "w");
  try {
    await handle.writeFile(`${JSON.stringify(valido)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fsApi.rename(temporario, arquivo);
  } catch (erro) {
    if (erro?.code !== "EEXIST" && erro?.code !== "EPERM") {
      throw erro;
    }
    await fsApi.writeFile(arquivo, `${JSON.stringify(valido)}\n`, { encoding: "utf8", mode: 0o600 });
    await fsApi.unlink(temporario).catch(() => {});
  }
}

export async function removerRecuperacaoTef(arquivo, fsApi = fs) {
  try {
    await fsApi.unlink(arquivo);
  } catch (erro) {
    if (erro?.code !== "ENOENT") {
      throw erro;
    }
  }
}
