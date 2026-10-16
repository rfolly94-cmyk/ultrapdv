import fs from "node:fs/promises";
import path from "node:path";

import { pastaConfigMaquina } from "./config-local.mjs";
import { cnpjAutorizado, servidorAutorizado } from "./tef.mjs";

export function arquivoVinculoTef(env = process.env) {
  return path.join(pastaConfigMaquina(env), "tef-vinculo.json");
}

function texto(valor) {
  return typeof valor === "string" ? valor.trim() : "";
}

export function validarVinculoTef(dados) {
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
    return { ok: false, erro: "Payload recusado." };
  }
  const permitidos = [
    "empresaId",
    "terminalCodigo",
    "dispositivoId",
    "estabelecimento",
    "pontoCaptura",
    "terminalId",
    "ambiente",
    "cnpj",
    "servidor",
  ];
  if (Object.keys(dados).some((chave) => !permitidos.includes(chave))) {
    return { ok: false, erro: "Payload recusado." };
  }
  const empresaId = texto(dados.empresaId);
  const terminalCodigo = texto(dados.terminalCodigo);
  const dispositivoId = texto(dados.dispositivoId);
  const estabelecimento = texto(dados.estabelecimento).slice(0, 40);
  const pontoCaptura = texto(dados.pontoCaptura).slice(0, 40);
  const terminalId = texto(dados.terminalId).toLowerCase();
  const ambiente = texto(dados.ambiente);
  const cnpj = cnpjAutorizado(dados.cnpj);
  const servidor = servidorAutorizado(dados.servidor);
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(empresaId) || !uuid.test(dispositivoId)) {
    return { ok: false, erro: "Identificação do terminal inválida." };
  }
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(terminalCodigo)) {
    return { ok: false, erro: "Código do terminal inválido." };
  }
  if (estabelecimento && /[\r\n]/.test(estabelecimento)) {
    return { ok: false, erro: "Estabelecimento inválido." };
  }
  if (terminalId && !uuid.test(terminalId)) {
    return { ok: false, erro: "Identificação do terminal inválida." };
  }
  if (ambiente && ambiente !== "homologacao" && ambiente !== "producao") {
    return { ok: false, erro: "Ambiente do terminal inválido." };
  }
  if (texto(dados.cnpj) && !cnpj) {
    return { ok: false, erro: "CNPJ do estabelecimento inválido." };
  }
  if (texto(dados.servidor) && !servidor) {
    return { ok: false, erro: "Servidor PayGo inválido." };
  }
  const vinculo = { empresaId, terminalCodigo, dispositivoId, estabelecimento, pontoCaptura };
  if (terminalId) {
    vinculo.terminalId = terminalId;
  }
  if (ambiente === "homologacao" || ambiente === "producao") {
    vinculo.ambiente = ambiente;
  }
  if (cnpj) {
    vinculo.cnpj = cnpj;
  }
  if (servidor) {
    vinculo.servidor = servidor;
  }
  return { ok: true, vinculo };
}

export function vinculoConfere(vinculo, headers = {}) {
  if (!vinculo) {
    return { ok: true, exigido: false };
  }
  const empresa = texto(headers["x-ultrapdv-empresa"]);
  const terminal = texto(headers["x-ultrapdv-terminal"]);
  if (
    empresa !== vinculo.empresaId ||
    terminal !== vinculo.terminalCodigo
  ) {
    return {
      ok: false,
      erro: "Terminal TEF vinculado a outra empresa.",
    };
  }
  const estabelecimento = texto(headers["x-ultrapdv-estabelecimento"]);
  if (
    vinculo.estabelecimento &&
    estabelecimento &&
    estabelecimento !== vinculo.estabelecimento
  ) {
    return {
      ok: false,
      erro: "O estabelecimento PayGo não confere com o terminal vinculado.",
    };
  }
  return { ok: true, exigido: true };
}

export function apresentarVinculoTef(vinculo) {
  if (!vinculo) {
    return { vinculado: false };
  }
  return {
    vinculado: true,
    empresaId: vinculo.empresaId,
    terminalCodigo: vinculo.terminalCodigo,
    estabelecimento: vinculo.estabelecimento || "",
    pontoCaptura: vinculo.pontoCaptura || "",
    ambiente: vinculo.ambiente || "",
    servidor: vinculo.servidor || "",
    cnpjInformado: Boolean(vinculo.cnpj),
  };
}

export async function lerVinculoTef(arquivo, fsApi = fs) {
  let bruto;
  try {
    bruto = await fsApi.readFile(arquivo, "utf8");
  } catch (erro) {
    if (erro?.code === "ENOENT") {
      return null;
    }
    return null;
  }
  try {
    const validado = validarVinculoTef(JSON.parse(bruto));
    return validado.ok ? validado.vinculo : null;
  } catch {
    return null;
  }
}

export async function gravarVinculoTef(arquivo, vinculo, fsApi = fs) {
  const validado = validarVinculoTef(vinculo);
  if (!validado.ok) {
    throw new Error(validado.erro);
  }
  await fsApi.mkdir(path.dirname(arquivo), { recursive: true });
  const temporario = `${arquivo}.${process.pid}.tmp`;
  await fsApi.writeFile(
    temporario,
    `${JSON.stringify(validado.vinculo)}\n`,
    "utf8"
  );
  try {
    await fsApi.rename(temporario, arquivo);
  } catch (erro) {
    if (erro?.code !== "EEXIST" && erro?.code !== "EPERM") {
      throw erro;
    }
    const antigo = `${arquivo}.antigo`;
    await fsApi.rename(arquivo, antigo);
    await fsApi.rename(temporario, arquivo);
    await fsApi.unlink(antigo).catch(() => {});
  }
}

export async function removerVinculoTef(arquivo, fsApi = fs) {
  try {
    await fsApi.unlink(arquivo);
  } catch (erro) {
    if (erro?.code !== "ENOENT") {
      throw erro;
    }
  }
}
