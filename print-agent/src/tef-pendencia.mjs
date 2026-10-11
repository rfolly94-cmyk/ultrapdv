import fs from "node:fs/promises";
import path from "node:path";

import { pastaConfigMaquina } from "./config-local.mjs";

export function arquivoPendenciaTef(env = process.env) {
  return path.join(pastaConfigMaquina(env), "tef-pendencia.json");
}

function texto(valor) {
  return typeof valor === "string" ? valor.trim() : "";
}

function numero(valor) {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

export const STATUS_JOURNAL_TEF = Object.freeze({
  PAGAMENTO_EM_ANDAMENTO: "pagamento_em_andamento",
  AGUARDANDO_DECISAO: "aguardando_decisao",
  RESULTADO_DESCONHECIDO: "resultado_desconhecido",
});

export function montarJournalPagamento(dados = {}) {
  const agora = texto(dados.dataHoraInicio) || new Date().toISOString();
  return {
    versao: 1,
    status: STATUS_JOURNAL_TEF.PAGAMENTO_EM_ANDAMENTO,
    identificador: texto(dados.identificador),
    valor: numero(dados.valor),
    dataHoraInicio: agora,
    correlationId: texto(dados.correlationId),
    reconciliacaoNecessaria: false,
    rede: "",
    nsu: "",
    finalizacao: "",
    registradoEm: texto(dados.registradoEm) || agora,
    confirmar: false,
    precisaConfirmacao: false,
  };
}

export function montarRegistroPendencia(dados = {}) {
  const registradoEm = texto(dados.registradoEm) || texto(dados.dataHoraInicio) || new Date().toISOString();
  return {
    versao: 1,
    status: STATUS_JOURNAL_TEF.AGUARDANDO_DECISAO,
    identificador: texto(dados.identificador),
    valor: numero(dados.valor),
    dataHoraInicio: texto(dados.dataHoraInicio) || registradoEm,
    correlationId: texto(dados.correlationId),
    rede: texto(dados.rede),
    nsu: texto(dados.nsu),
    finalizacao: texto(dados.finalizacao),
    registradoEm,
    reconciliacaoNecessaria: dados.reconciliacaoNecessaria === true,
    confirmar: true,
    precisaConfirmacao: true,
  };
}

export function promoverJournalDecisao(journal = {}, resultado = {}) {
  return montarRegistroPendencia({
    identificador: texto(resultado.identificador) || journal.identificador,
    valor: numero(resultado.valor) ?? journal.valor,
    dataHoraInicio: journal.dataHoraInicio,
    correlationId: journal.correlationId,
    rede: resultado.rede,
    nsu: resultado.nsu,
    finalizacao: resultado.finalizacao || resultado.codigoFinalizacao,
    registradoEm: journal.registradoEm || journal.dataHoraInicio,
    reconciliacaoNecessaria: journal.reconciliacaoNecessaria === true,
  });
}

function journalOperacao(json) {
  const identificador = texto(json.identificador);
  const valor = numero(json.valor);
  const dataHoraInicio = texto(json.dataHoraInicio) || texto(json.registradoEm);
  const correlationId = texto(json.correlationId);
  if (!identificador || valor == null || valor <= 0 || !dataHoraInicio || !correlationId) {
    return null;
  }
  return {
    versao: 1,
    status: json.status,
    identificador,
    valor,
    dataHoraInicio,
    correlationId,
    reconciliacaoNecessaria: json.reconciliacaoNecessaria === true,
    rede: texto(json.rede),
    nsu: texto(json.nsu),
    finalizacao: texto(json.finalizacao),
    registradoEm: texto(json.registradoEm) || dataHoraInicio,
    confirmar: json.confirmar === true,
    precisaConfirmacao: json.precisaConfirmacao === true,
  };
}

export function interpretarPendencia(textoBruto) {
  let json;
  try {
    json = JSON.parse(String(textoBruto ?? ""));
  } catch {
    return { ok: false, ilegivel: true };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, ilegivel: true };
  }
  if (json.status === STATUS_JOURNAL_TEF.AGUARDANDO_DECISAO) {
    const registro = montarRegistroPendencia(json);
    if (!registro.rede || !registro.nsu || !registro.finalizacao) {
      return { ok: false, ilegivel: true };
    }
    return { ok: true, registro };
  }
  if (
    json.status === STATUS_JOURNAL_TEF.PAGAMENTO_EM_ANDAMENTO ||
    json.status === STATUS_JOURNAL_TEF.RESULTADO_DESCONHECIDO
  ) {
    const registro = journalOperacao(json);
    if (!registro) {
      return { ok: false, ilegivel: true };
    }
    return { ok: true, registro };
  }
  return { ok: false, ilegivel: true };
}

export async function lerPendenciaTef(arquivo, fsApi = fs) {
  let bruto;
  try {
    bruto = await fsApi.readFile(arquivo, "utf8");
  } catch (erro) {
    if (erro?.code === "ENOENT") {
      return { ok: true, registro: null };
    }
    return { ok: false, ilegivel: true };
  }
  return interpretarPendencia(bruto);
}

export async function gravarPendenciaTef(arquivo, registro, fsApi = fs) {
  const pasta = path.dirname(arquivo);
  await fsApi.mkdir(pasta, { recursive: true });
  const temporario = `${arquivo}.${process.pid}.tmp`;
  const json = `${JSON.stringify(registro, null, 2)}\n`;
  const handle = await fsApi.open(temporario, "w");
  try {
    await handle.writeFile(json, "utf8");
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
    const antigo = `${arquivo}.antigo`;
    await fsApi.rename(arquivo, antigo);
    await fsApi.rename(temporario, arquivo);
    await fsApi.unlink(antigo).catch(() => {});
  }
}

export async function removerPendenciaTef(arquivo, fsApi = fs) {
  try {
    await fsApi.unlink(arquivo);
  } catch (erro) {
    if (erro?.code !== "ENOENT") {
      throw erro;
    }
  }
}
