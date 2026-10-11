import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { pastaConfigMaquina } from "./config-local.mjs";
import { hashCodigoPareamento } from "./tef-prova.mjs";

const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const VALIDADE_MS = 10 * 60 * 1000;
const MAX_TENTATIVAS = 5;

export function arquivoPareamentoTef(env = process.env) {
  return path.join(pastaConfigMaquina(env), "tef-pareamento.json");
}

export function gerarCodigoPareamento(aleatorio = randomBytes(10)) {
  let codigo = "";
  for (let indice = 0; indice < 10; indice += 1) {
    codigo += ALFABETO[aleatorio[indice] % ALFABETO.length];
  }
  return codigo;
}

function novoPareamento(agora = Date.now()) {
  const codigo = gerarCodigoPareamento();
  return {
    codigo,
    codigoHash: hashCodigoPareamento(codigo),
    expiraEm: agora + VALIDADE_MS,
    tentativas: 0,
    consumido: false,
  };
}

export function garantirPareamento(atual, agora = Date.now()) {
  if (
    atual &&
    atual.consumido !== true &&
    Number(atual.expiraEm) > agora &&
    Number(atual.tentativas) < MAX_TENTATIVAS &&
    atual.codigo
  ) {
    return atual;
  }
  return novoPareamento(agora);
}

export function conferirCodigoPareamento(atual, codigo, agora = Date.now()) {
  if (!atual || atual.consumido === true || Number(atual.expiraEm) <= agora) {
    return { ok: false, erro: "O código de pareamento expirou. Gere outro no Connector." };
  }
  if (Number(atual.tentativas) >= MAX_TENTATIVAS) {
    return { ok: false, erro: "Muitas tentativas. Gere outro código no Connector." };
  }
  const informado = hashCodigoPareamento(codigo);
  if (!codigo || informado !== atual.codigoHash) {
    return {
      ok: false,
      erro: "Código de pareamento inválido.",
      atual: { ...atual, tentativas: Number(atual.tentativas) + 1 },
    };
  }
  return { ok: true, atual };
}

export function consumirPareamento(atual) {
  return { ...atual, consumido: true, codigo: "" };
}

export async function lerPareamentoTef(arquivo, fsApi = fs) {
  try {
    const json = JSON.parse(await fsApi.readFile(arquivo, "utf8"));
    if (!json?.codigoHash) {
      return null;
    }
    return json;
  } catch (erro) {
    if (erro?.code === "ENOENT") {
      return null;
    }
    return null;
  }
}

export async function gravarPareamentoTef(arquivo, pareamento, fsApi = fs) {
  await fsApi.mkdir(path.dirname(arquivo), { recursive: true });
  const temporario = `${arquivo}.${process.pid}.tmp`;
  await fsApi.writeFile(temporario, `${JSON.stringify(pareamento)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    await fsApi.rename(temporario, arquivo);
  } catch (erro) {
    if (erro?.code !== "EEXIST" && erro?.code !== "EPERM") {
      throw erro;
    }
    await fsApi.writeFile(arquivo, `${JSON.stringify(pareamento)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fsApi.unlink(temporario).catch(() => {});
  }
}
