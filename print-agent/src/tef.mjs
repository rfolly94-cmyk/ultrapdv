import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { registrarLog } from "./log.mjs";
import { assinarEvidenciaInstalacao } from "./tef-prova.mjs";
import { resolverRaizAgente } from "./raiz.mjs";
import {
  arquivoPendenciaTef,
  gravarPendenciaTef,
  lerPendenciaTef,
  montarJournalPagamento,
  montarRegistroPendencia,
  promoverJournalDecisao,
  removerPendenciaTef,
  STATUS_JOURNAL_TEF,
} from "./tef-pendencia.mjs";

export const NOME_TEF_NATIVO = "UltraPDVTef_NOVO.exe";
export const MENSAGEM_TEF_NAO_INSTALADO =
  "Módulo nativo TEF ainda não está instalado/configurado.";
export const MENSAGEM_TEF_OCUPADO =
  "TEF ocupado. Já existe uma operação em andamento.";
export const MENSAGEM_TEF_TIMEOUT = "Tempo esgotado na operação TEF.";
export const MENSAGEM_TEF_PROCESSO_ENCERRADO = "Processo nativo TEF encerrou.";
export const MENSAGEM_TEF_NAO_INICIALIZADO = "TEF não inicializado.";
export const MENSAGEM_TEF_DADOS_INVALIDOS = "Dados do pagamento inválidos.";
export const MENSAGEM_TEF_TRANSACAO_PENDENTE =
  "Existe transação TEF aprovada aguardando confirmação ou desfazimento.";
export const MENSAGEM_TEF_RECONCILIACAO =
  "O processo TEF encerrou com transação aprovada sem terceira perna. O estado em memória foi limpo e a transação financeira não foi confirmada nem desfeita.";
export const MENSAGEM_TEF_PERSISTENCIA_FALHOU =
  "Não foi possível gravar o estado do TEF. O pagamento não foi enviado.";
export const MENSAGEM_TEF_RECONCILIACAO_NECESSARIA =
  "Resultado financeiro do TEF desconhecido. Novo pagamento está bloqueado até a reconciliação.";
export const MENSAGEM_TEF_PINPAD_OCUPADO =
  "Terminal ocupado com operação financeira.";
export const MENSAGEM_TEF_PINPAD_NAO_INICIALIZADO =
  "Comunicação indisponível. O PayGoWeb não será reiniciado por este diagnóstico.";
export const MENSAGEM_TEF_INSTALACAO_BLOQUEADA =
  "A instalação de um ponto novo exige vínculo, credencial e parâmetros autorizados.";
export const MENSAGEM_TEF_PARAMETROS_AUSENTES =
  "A instalação de um ponto novo exige ponto, ambiente, CNPJ, servidor e estabelecimento autorizados.";
export const MENSAGEM_TEF_IDENTIDADE_DIVERGENTE =
  "O processo TEF já está vinculado a outro ponto, empresa ou ambiente.";

export const ESTADOS_PROCESSO_TEF = Object.freeze([
  "nao_instalado",
  "parado",
  "iniciando",
  "executando",
  "erro",
]);

export const CODIGOS_TEF = Object.freeze({
  NAO_INSTALADO: "TEF_NAO_INSTALADO",
  OCUPADO: "TEF_OCUPADO",
  TIMEOUT: "TEF_TIMEOUT",
  PROCESSO_ENCERRADO: "TEF_PROCESSO_ENCERRADO",
  PAYLOAD_RECUSADO: "TEF_PAYLOAD_RECUSADO",
  OPERACAO_NAO_PERMITIDA: "TEF_OPERACAO_NAO_PERMITIDA",
  NAO_INICIALIZADO: "TEF_NAO_INICIALIZADO",
  DADOS_INVALIDOS: "TEF_DADOS_INVALIDOS",
  TRANSACAO_PENDENTE: "TEF_TRANSACAO_PENDENTE",
  PERSISTENCIA_FALHOU: "TEF_PERSISTENCIA_FALHOU",
  RECONCILIACAO_NECESSARIA: "TEF_RECONCILIACAO_NECESSARIA",
});

/** Timeout por operação. Ações futuras ficam centralizadas e ainda não são aceitas. */
export const TIMEOUTS_TEF_MS = Object.freeze({
  status: 5000,
  inicializacao: 30000,
  teste: 60000,
  pagamento: 300000,
  cancelamento: 300000,
  instalacao: 300000,
  confirmacao: 60000,
  desfazimento: 60000,
  pinpad: 20000,
});

const ACOES_TEF_PERMITIDAS = new Set([
  "teste",
  "inicializar",
  "pagamento",
  "instalar",
  "confirmar",
  "desfazer",
  "pinpad-diagnostico",
  "pinpad-testar-comunicacao",
]);
const ACOES_TEF_RESOLVEM_PENDENCIA = new Set([
  "pagamento",
  "instalar",
  "cancelamento",
  "cancelar",
  "administrativa",
  "administrativo",
]);
const CAMPOS_HTTP_TEF_PROIBIDOS = [
  "comando",
  "command",
  "path",
  "arquivo",
  "executavel",
  "shell",
  "args",
  "cwd",
];
const LIMITE_BUFFER_STDOUT = 1024 * 1024;
const LIMITE_ENCERRAMENTO_MS = 700;

function exeTefPermitido(caminho) {
  return (
    path.basename(String(caminho ?? "")).toLowerCase() ===
    NOME_TEF_NATIVO.toLowerCase()
  );
}

function possuiCampo(objeto, campo) {
  return Object.prototype.hasOwnProperty.call(objeto, campo);
}

function textoChunk(chunk) {
  if (typeof chunk === "string") {
    return chunk;
  }
  if (Buffer.isBuffer(chunk)) {
    return chunk.toString("utf8");
  }
  return String(chunk ?? "");
}

export function candidatosTefNativo(env = process.env, raiz = resolverRaizAgente()) {
  const installDir = String(env.ULTRAPDV_INSTALL_DIR ?? "").trim();
  const programFiles = String(env.ProgramFiles ?? "C:\\Program Files").trim();
  const programFilesX86 = String(
    env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)"
  ).trim();

  const lista = [
    path.join(raiz, "bin", "tef", NOME_TEF_NATIVO),
    installDir ? path.join(installDir, "bin", "tef", NOME_TEF_NATIVO) : "",
    path.join(programFiles, "UltraPDV Connector", "bin", "tef", NOME_TEF_NATIVO),
    path.join(
      programFilesX86,
      "UltraPDV Connector",
      "bin",
      "tef",
      NOME_TEF_NATIVO
    ),
  ].filter((item) => item.length > 0);

  return [...new Set(lista)];
}

export async function localizarTefNativo(
  env = process.env,
  access = fs.access,
  raiz = resolverRaizAgente()
) {
  for (const candidato of candidatosTefNativo(env, raiz)) {
    if (!exeTefPermitido(candidato)) {
      continue;
    }
    try {
      await access(candidato);
      return { encontrado: true, caminho: candidato };
    } catch {
      continue;
    }
  }

  return { encontrado: false, caminho: null };
}

export function validarPayloadHttpTef(payload, acaoRota = "teste") {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, erro: "Payload recusado." };
  }
  if (CAMPOS_HTTP_TEF_PROIBIDOS.some((campo) => possuiCampo(payload, campo))) {
    return { ok: false, erro: "Payload recusado." };
  }
  if (possuiCampo(payload, "acao")) {
    if (payload.acao !== acaoRota || !ACOES_TEF_PERMITIDAS.has(payload.acao)) {
      return { ok: false, erro: "Operação TEF não permitida." };
    }
  }
  return { ok: true };
}

export function validarDadosPagamento(dados) {
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
    return {
      ok: false,
      codigo: CODIGOS_TEF.DADOS_INVALIDOS,
      erro: MENSAGEM_TEF_DADOS_INVALIDOS,
    };
  }
  if (CAMPOS_HTTP_TEF_PROIBIDOS.some((campo) => possuiCampo(dados, campo))) {
    return {
      ok: false,
      codigo: CODIGOS_TEF.PAYLOAD_RECUSADO,
      erro: "Payload recusado.",
    };
  }
  for (const chave of Object.keys(dados)) {
    if (chave !== "identificador" && chave !== "valor") {
      return {
        ok: false,
        codigo: CODIGOS_TEF.PAYLOAD_RECUSADO,
        erro: "Payload recusado.",
      };
    }
  }
  const identificador =
    typeof dados.identificador === "string" ? dados.identificador.trim() : "";
  if (!identificador) {
    return {
      ok: false,
      codigo: CODIGOS_TEF.DADOS_INVALIDOS,
      erro: "Identificador do pagamento é obrigatório.",
    };
  }
  if (typeof dados.valor !== "number" || !Number.isFinite(dados.valor) || dados.valor <= 0) {
    return {
      ok: false,
      codigo: CODIGOS_TEF.DADOS_INVALIDOS,
      erro: "Valor do pagamento deve ser maior que zero.",
    };
  }
  const centavos = Math.round((dados.valor + Number.EPSILON) * 100);
  if (centavos <= 0 || Math.abs(dados.valor * 100 - centavos) > 0.001) {
    return {
      ok: false,
      codigo: CODIGOS_TEF.DADOS_INVALIDOS,
      erro: "Valor do pagamento deve ser maior que zero.",
    };
  }
  return {
    ok: true,
    identificador,
    valor: centavos / 100,
  };
}

export function validarDadosDecisao(dados) {
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
    return {
      ok: false,
      codigo: CODIGOS_TEF.DADOS_INVALIDOS,
      erro: "Dados da confirmação inválidos.",
    };
  }
  if (CAMPOS_HTTP_TEF_PROIBIDOS.some((campo) => possuiCampo(dados, campo))) {
    return {
      ok: false,
      codigo: CODIGOS_TEF.PAYLOAD_RECUSADO,
      erro: "Payload recusado.",
    };
  }
  for (const chave of Object.keys(dados)) {
    if (chave !== "rede" && chave !== "nsu" && chave !== "finalizacao") {
      return {
        ok: false,
        codigo: CODIGOS_TEF.PAYLOAD_RECUSADO,
        erro: "Payload recusado.",
      };
    }
  }
  const rede = typeof dados.rede === "string" ? dados.rede.trim() : "";
  const nsu = typeof dados.nsu === "string" ? dados.nsu.trim() : "";
  const finalizacao = typeof dados.finalizacao === "string" ? dados.finalizacao.trim() : "";
  if (!rede || !nsu || !finalizacao) {
    return {
      ok: false,
      codigo: CODIGOS_TEF.DADOS_INVALIDOS,
      erro: "Rede, NSU e finalização são obrigatórios.",
    };
  }
  return { ok: true, rede, nsu, finalizacao };
}

function aguardaDecisao(resultado) {
  if (!resultado || typeof resultado !== "object") {
    return false;
  }
  if (resultado.transacaoPendenteConfirmacao === true) {
    return true;
  }
  if (resultado.transacaoPendenteConfirmacao === false) {
    return false;
  }
  return (
    resultado.sucessoTransacao === true &&
    (resultado.confirmar === true || resultado.precisaConfirmacao === true)
  );
}

function resultadoConhecidoSemPendencia(resultado) {
  if (!resultado || typeof resultado !== "object" || Array.isArray(resultado)) {
    return false;
  }
  if (aguardaDecisao(resultado)) {
    return false;
  }
  return resultado.sucessoTransacao === true || resultado.sucessoTransacao === false;
}

function pendenciaCorresponde(journal, detectada, resultado) {
  const idJournal = textoPerna(journal?.identificador);
  const idDetectado = textoPerna(detectada?.identificador);
  if (Number(resultado?.pendenciasDetectadas) > 1) {
    return Boolean(idJournal && idDetectado && idJournal === idDetectado);
  }
  if (idJournal && idDetectado && idJournal !== idDetectado) {
    return false;
  }
  const rede = textoPerna(journal?.rede);
  const nsu = textoPerna(journal?.nsu);
  const finalizacao = textoPerna(journal?.finalizacao);
  if (rede && nsu && finalizacao) {
    return (
      rede === textoPerna(detectada?.rede) &&
      nsu === textoPerna(detectada?.nsu) &&
      finalizacao === textoPerna(detectada?.finalizacao)
    );
  }
  return true;
}

function textoPerna(valor) {
  return typeof valor === "string" ? valor.trim() : "";
}

const CAMPOS_PONTO_NOVO = [
  "pontoCaptura",
  "ambiente",
  "cnpj",
  "servidor",
  "estabelecimento",
];

function digitosCnpj(valor) {
  return String(valor ?? "").replace(/\D/g, "");
}

export function cnpjAutorizado(valor) {
  const digitos = digitosCnpj(valor);
  if (!/^\d{14}$/.test(digitos)) {
    return "";
  }
  const digito = (base, pesos) => {
    const soma = pesos.reduce((total, peso, indice) => total + Number(base[indice]) * peso, 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const primeiro = digito(digitos.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const segundo = digito(digitos.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return Number(digitos[12]) === primeiro && Number(digitos[13]) === segundo ? digitos : "";
}

export function servidorAutorizado(valor) {
  const texto = String(valor ?? "").trim();
  if (!texto || texto.length > 200 || /\s|\/\//.test(texto)) {
    return "";
  }
  const separador = texto.lastIndexOf(":");
  if (separador < 1 || separador === texto.length - 1) {
    return "";
  }
  const host = texto.slice(0, separador);
  const porta = Number(texto.slice(separador + 1));
  if (
    !/^[A-Za-z0-9.-]+$/.test(host) ||
    host.startsWith(".") ||
    host.endsWith(".") ||
    host.includes("..") ||
    !Number.isInteger(porta) ||
    porta < 1 ||
    porta > 65535
  ) {
    return "";
  }
  return texto;
}

export function parametrosPontoNovo(dados) {
  if (dados == null) {
    return { ok: true, modo: "existente", dados: {} };
  }
  if (typeof dados !== "object" || Array.isArray(dados)) {
    return {
      ok: false,
      codigo: CODIGOS_TEF.PAYLOAD_RECUSADO,
      erro: "Payload recusado.",
    };
  }
  if (Object.keys(dados).some((chave) => !CAMPOS_PONTO_NOVO.includes(chave))) {
    return {
      ok: false,
      codigo: CODIGOS_TEF.PAYLOAD_RECUSADO,
      erro: "Payload recusado.",
    };
  }
  const informado = CAMPOS_PONTO_NOVO.some((chave) => {
    const valor = dados[chave];
    return valor != null && String(valor).trim() !== "";
  });
  if (!informado) {
    return { ok: true, modo: "existente", dados: {} };
  }
  const ponto = typeof dados.pontoCaptura === "string" ? dados.pontoCaptura.trim() : "";
  const ambiente = dados.ambiente === "homologacao" || dados.ambiente === "producao" ? dados.ambiente : "";
  const cnpj = cnpjAutorizado(dados.cnpj);
  const servidor = servidorAutorizado(dados.servidor);
  const estabelecimento =
    typeof dados.estabelecimento === "string" ? dados.estabelecimento.trim() : "";
  if (
    !/^\d{1,11}$/.test(ponto) ||
    !ambiente ||
    !cnpj ||
    !servidor ||
    estabelecimento.length < 1 ||
    estabelecimento.length > 40 ||
    /[\r\n]/.test(estabelecimento)
  ) {
    return {
      ok: false,
      codigo: CODIGOS_TEF.DADOS_INVALIDOS,
      erro: MENSAGEM_TEF_PARAMETROS_AUSENTES,
    };
  }
  return {
    ok: true,
    modo: "novo",
    dados: { pontoCaptura: ponto, ambiente, cnpj, servidor, estabelecimento },
  };
}

function camposPonto(autorizado) {
  return {
    pontoCaptura: autorizado?.pontoCaptura,
    ambiente: autorizado?.ambiente,
    cnpj: autorizado?.cnpj,
    servidor: autorizado?.servidor,
    estabelecimento: autorizado?.estabelecimento,
  };
}

function identidadeInicial(autorizado) {
  if (autorizado == null) {
    return { ok: true, dados: {}, identidade: { modo: "existente" } };
  }
  if (typeof autorizado !== "object" || Array.isArray(autorizado)) {
    return {
      ok: false,
      codigo: CODIGOS_TEF.PAYLOAD_RECUSADO,
      erro: "Payload recusado.",
    };
  }
  const pedido = parametrosPontoNovo(camposPonto(autorizado));
  if (!pedido.ok) {
    return pedido;
  }
  if (pedido.modo === "existente") {
    return { ok: true, dados: {}, identidade: { modo: "existente" } };
  }
  const empresaId = String(autorizado.empresaId ?? "").trim().toLowerCase();
  const dispositivoId = String(autorizado.dispositivoId ?? "").trim().toLowerCase();
  const terminalId = String(autorizado.terminalId ?? "").trim().toLowerCase();
  const dispositivoLocal = String(autorizado.dispositivoLocal ?? dispositivoId).trim().toLowerCase();
  if (
    !ID_EVIDENCIA.test(empresaId) ||
    !ID_EVIDENCIA.test(dispositivoId) ||
    !ID_EVIDENCIA.test(terminalId) ||
    dispositivoId !== dispositivoLocal
  ) {
    return {
      ok: false,
      codigo: CODIGOS_TEF.OPERACAO_NAO_PERMITIDA,
      erro: MENSAGEM_TEF_INSTALACAO_BLOQUEADA,
    };
  }
  return {
    ok: true,
    dados: pedido.dados,
    identidade: {
      modo: "novo",
      ...pedido.dados,
      empresaId,
      dispositivoId,
      terminalId,
    },
  };
}

function mesmaIdentidade(atual, pedido) {
  if (!atual || !pedido || atual.modo !== pedido.modo) {
    return false;
  }
  if (atual.modo === "existente") {
    return true;
  }
  return (
    atual.pontoCaptura === pedido.pontoCaptura &&
    atual.ambiente === pedido.ambiente &&
    atual.cnpj === pedido.cnpj &&
    atual.servidor === pedido.servidor &&
    atual.estabelecimento === pedido.estabelecimento &&
    atual.empresaId === pedido.empresaId &&
    atual.dispositivoId === pedido.dispositivoId &&
    atual.terminalId === pedido.terminalId
  );
}

export function autorizacaoDoVinculo(vinculo, dispositivoLocal, chavePrivada = "") {
  if (!vinculo || typeof vinculo !== "object" || Array.isArray(vinculo)) {
    return null;
  }
  if (String(vinculo.dispositivoId ?? "") !== String(dispositivoLocal ?? "")) {
    return null;
  }
  const pedido = parametrosPontoNovo(camposPonto(vinculo));
  if (!pedido.ok || pedido.modo !== "novo") {
    return null;
  }
  const autorizada = identidadeInicial({
    ...pedido.dados,
    empresaId: vinculo.empresaId,
    dispositivoId: vinculo.dispositivoId,
    dispositivoLocal,
    terminalId: vinculo.terminalId,
  });
  if (!autorizada.ok || autorizada.identidade.modo !== "novo") {
    return null;
  }
  return {
    ...autorizada.identidade,
    chavePrivada: typeof chavePrivada === "string" ? chavePrivada : "",
  };
}

function pedidoSemCorrelacao(pedido) {
  if (pedido == null || typeof pedido !== "object" || Array.isArray(pedido)) {
    return pedido;
  }
  if (!Object.prototype.hasOwnProperty.call(pedido, "id")) {
    return pedido;
  }
  const copia = { ...pedido };
  delete copia.id;
  return copia;
}

function montarPedidoTef(pedido) {
  if (pedido == null) {
    return { ok: true, acao: "teste" };
  }
  if (typeof pedido !== "object" || Array.isArray(pedido)) {
    return {
      ok: false,
      codigo: CODIGOS_TEF.PAYLOAD_RECUSADO,
      erro: "Payload recusado.",
    };
  }
  if (CAMPOS_HTTP_TEF_PROIBIDOS.some((campo) => possuiCampo(pedido, campo))) {
    return {
      ok: false,
      codigo: CODIGOS_TEF.PAYLOAD_RECUSADO,
      erro: "Payload recusado.",
    };
  }
  const chaves = Object.keys(pedido);
  for (const chave of chaves) {
    if (chave === "acao") {
      continue;
    }
    if (
      chave === "dados" &&
      (pedido.acao === "pagamento" ||
        pedido.acao === "confirmar" ||
        pedido.acao === "desfazer" ||
        pedido.acao === "instalar" ||
        pedido.acao === "inicializar")
    ) {
      continue;
    }
    return {
      ok: false,
      codigo: CODIGOS_TEF.PAYLOAD_RECUSADO,
      erro: "Payload recusado.",
    };
  }
  const acao = possuiCampo(pedido, "acao") ? pedido.acao : "teste";
  if (typeof acao !== "string" || !ACOES_TEF_PERMITIDAS.has(acao)) {
    return {
      ok: false,
      codigo: CODIGOS_TEF.OPERACAO_NAO_PERMITIDA,
      erro: "Operação TEF não permitida.",
    };
  }
  if (acao === "pagamento") {
    const dados = validarDadosPagamento(pedido.dados);
    if (!dados.ok) {
      return dados;
    }
    return {
      ok: true,
      acao,
      dados: {
        identificador: dados.identificador,
        valor: dados.valor,
      },
    };
  }
  if (acao === "confirmar" || acao === "desfazer") {
    const dados = validarDadosDecisao(pedido.dados);
    if (!dados.ok) {
      return dados;
    }
    return {
      ok: true,
      acao,
      dados: {
        rede: dados.rede,
        nsu: dados.nsu,
        finalizacao: dados.finalizacao,
      },
    };
  }
  if (acao === "instalar" || acao === "inicializar") {
    const pedidoPonto = parametrosPontoNovo(pedido.dados ?? {});
    if (!pedidoPonto.ok) {
      return pedidoPonto;
    }
    return { ok: true, acao, dados: pedidoPonto.dados };
  }
  return { ok: true, acao, dados: {} };
}

const ID_EVIDENCIA =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function observacaoEvidenciaInstalacao(resultado, autorizado, instalacaoId) {
  if (!resultado || typeof resultado !== "object" || Array.isArray(resultado)) {
    return null;
  }
  if (resultado.observacaoBiblioteca !== true) {
    return null;
  }
  if (resultado.pontoNaoExistia !== true || resultado.instalacaoConcluida !== true) {
    return null;
  }
  if (resultado.retornoSetEnvironment !== 0 || resultado.operacao !== "PWOPER_INSTALL") {
    return null;
  }
  if (resultado.instalacaoId || resultado.assinatura || resultado.evidencia) {
    return null;
  }
  if (!autorizado || typeof autorizado !== "object") {
    return null;
  }
  const empresaId = String(autorizado.empresaId ?? "").trim().toLowerCase();
  const dispositivoId = String(autorizado.dispositivoId ?? "").trim().toLowerCase();
  const dispositivoLocal = String(autorizado.dispositivoLocal ?? "").trim().toLowerCase();
  const terminalId = String(autorizado.terminalId ?? "").trim().toLowerCase();
  const ponto = String(resultado.pontoCaptura ?? "").trim();
  const estabelecimento = String(autorizado.estabelecimento ?? "").trim();
  const estabelecimentoObservado = String(resultado.estabelecimento ?? "").trim();
  const cnpj = digitosCnpj(resultado.cnpj);
  const cnpjEsperado = cnpjAutorizado(autorizado.cnpj);
  const servidor = String(resultado.servidor ?? "").trim();
  const servidorPedido = servidorAutorizado(autorizado.servidor);
  const ambiente = resultado.ambiente === "homologacao" || resultado.ambiente === "producao"
    ? resultado.ambiente
    : "";
  if (
    !ID_EVIDENCIA.test(empresaId) ||
    !ID_EVIDENCIA.test(dispositivoId) ||
    !ID_EVIDENCIA.test(terminalId) ||
    !ID_EVIDENCIA.test(String(instalacaoId ?? "").trim().toLowerCase()) ||
    dispositivoId !== dispositivoLocal ||
    !ponto ||
    ponto !== String(autorizado.pontoCaptura ?? "").trim() ||
    !estabelecimento ||
    estabelecimento.length > 40 ||
    estabelecimentoObservado !== estabelecimento ||
    !cnpjEsperado ||
    cnpj !== cnpjEsperado ||
    !servidorPedido ||
    servidor !== servidorPedido ||
    !ambiente ||
    ambiente !== autorizado.ambiente
  ) {
    return null;
  }
  return {
    empresaId,
    dispositivoId,
    terminalId,
    pontoCaptura: ponto,
    pontoInstalado: ponto,
    estabelecimento,
    ambienteSolicitado: ambiente,
    instalacaoId: String(instalacaoId).trim().toLowerCase(),
    pontoNaoExistia: true,
    retornoSetEnvironment: 0,
    instalacaoConcluida: true,
    vinculoAutorizado: true,
  };
}

export function apresentarStatusTef(tef = {}) {
  const processo = ESTADOS_PROCESSO_TEF.includes(tef?.processo)
    ? tef.processo
    : "nao_instalado";
  return {
    disponivel: processo === "executando",
    executavelEncontrado: tef?.executavelEncontrado === true,
    processo,
    inicializado: processo === "executando" && tef?.inicializado === true,
    transacaoPendenteConfirmacao: tef?.transacaoPendenteConfirmacao === true,
    reconciliacaoNecessaria: tef?.reconciliacaoNecessaria === true,
    // PW_iSetEnvironment grava o ambiente só antes da instalação do ponto.
    // A biblioteca não exporta consulta do ambiente em execução.
    ambienteEfetivo: null,
    situacaoAmbiente: "desconhecido",
  };
}

function timeoutDaAcao(acao) {
  if (acao === "inicializar") {
    return TIMEOUTS_TEF_MS.inicializacao;
  }
  if (acao === "pagamento") {
    return TIMEOUTS_TEF_MS.pagamento;
  }
  if (acao === "instalar") {
    return TIMEOUTS_TEF_MS.instalacao;
  }
  if (acao === "confirmar") {
    return TIMEOUTS_TEF_MS.confirmacao;
  }
  if (acao === "desfazer") {
    return TIMEOUTS_TEF_MS.desfazimento;
  }
  if (acao === "pinpad-diagnostico" || acao === "pinpad-testar-comunicacao") {
    return TIMEOUTS_TEF_MS.pinpad;
  }
  return TIMEOUTS_TEF_MS[acao];
}

function statusHttpDoCodigo(codigo) {
  switch (codigo) {
    case CODIGOS_TEF.NAO_INSTALADO:
    case CODIGOS_TEF.PROCESSO_ENCERRADO:
      return 503;
    case CODIGOS_TEF.OCUPADO:
    case CODIGOS_TEF.NAO_INICIALIZADO:
    case CODIGOS_TEF.TRANSACAO_PENDENTE:
    case CODIGOS_TEF.RECONCILIACAO_NECESSARIA:
      return 409;
    case CODIGOS_TEF.PERSISTENCIA_FALHOU:
      return 500;
    case CODIGOS_TEF.TIMEOUT:
      return 504;
    case CODIGOS_TEF.PAYLOAD_RECUSADO:
    case CODIGOS_TEF.OPERACAO_NAO_PERMITIDA:
    case CODIGOS_TEF.DADOS_INVALIDOS:
      return 400;
    default:
      return typeof codigo === "string" && codigo.startsWith("PINPAD_") ? 409 : 500;
  }
}

function spawnPadrao(arquivo, args) {
  return spawn(arquivo, Array.isArray(args) ? args : [], {
    windowsHide: true,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function ouvir(alvo, evento, fn) {
  if (alvo && typeof alvo.on === "function") {
    alvo.on(evento, fn);
  }
}

function esperarSaida(filho, ms) {
  if (!filho || filho.exitCode != null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let feito = false;
    const terminar = (valor) => {
      if (feito) {
        return;
      }
      feito = true;
      resolve(valor);
    };
    const timer = setTimeout(() => terminar(false), ms);
    filho.once("exit", () => {
      clearTimeout(timer);
      terminar(true);
    });
  });
}

/**
 * Processo residente do UltraPDVTef.exe.
 * stdin e stdout usam JSON Lines. stderr vai só para o log do Connector.
 * A saída do processo não dispara outro spawn.
 */
export class GerenciadorTefNativo {
  constructor(deps = {}) {
    this.localizar = deps.localizar ?? localizarTefNativo;
    this.spawn = deps.spawn ?? spawnPadrao;
    this.registrarLog = deps.registrarLog ?? registrarLog;
    this.criarId = deps.criarId ?? (() => randomUUID());
    this.agendar = deps.agendar ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancelarAgendamento =
      deps.cancelarAgendamento ?? ((timer) => clearTimeout(timer));
    this.limiteEncerramentoMs =
      Number(deps.limiteEncerramentoMs) > 0
        ? Number(deps.limiteEncerramentoMs)
        : LIMITE_ENCERRAMENTO_MS;
    this.estado = "parado";
    this.executavelEncontrado = false;
    this.caminho = null;
    this.menuInterativo = null;
    this.filho = null;
    this.buffer = "";
    this.pendente = null;
    this.encerramentoControlado = false;
    this.promessaEncerrar = null;
    this.codigoSaida = null;
    this.inicializado = false;
    this.identidadeProcesso = null;
    this.transacaoPendente = null;
    this.pendenciaIlegivel = false;
    this.arquivoPendencia = deps.arquivoPendencia ?? arquivoPendenciaTef();
    this.fsPendencia = deps.fsPendencia ?? fs;
    this.cargaPendencia = null;
    this.filaPendencia = Promise.resolve();
  }

  snapshot() {
    return apresentarStatusTef({
      disponivel: this.estado === "executando",
      executavelEncontrado: this.executavelEncontrado,
      processo: this.estado,
      inicializado: this.inicializado === true,
      transacaoPendenteConfirmacao:
        this.transacaoPendente != null || this.pendenciaIlegivel === true,
      reconciliacaoNecessaria:
        this.pendenciaIlegivel === true ||
        this.transacaoPendente?.reconciliacaoNecessaria === true,
    });
  }

  async garantirPendencia() {
    if (!this.cargaPendencia) {
      this.cargaPendencia = this.carregarPendencia();
    }
    await this.cargaPendencia;
    await this.filaPendencia;
  }

  async carregarPendencia() {
    const lido = await lerPendenciaTef(this.arquivoPendencia, this.fsPendencia);
    if (!lido.ok) {
      this.pendenciaIlegivel = true;
      this.transacaoPendente = {
        status: STATUS_JOURNAL_TEF.AGUARDANDO_DECISAO,
        ilegivel: true,
        reconciliacaoNecessaria: true,
      };
      return;
    }
    if (!lido.registro) {
      return;
    }
    this.pendenciaIlegivel = false;
    if (lido.registro.status === STATUS_JOURNAL_TEF.PAGAMENTO_EM_ANDAMENTO) {
      this.transacaoPendente = {
        ...lido.registro,
        status: STATUS_JOURNAL_TEF.RESULTADO_DESCONHECIDO,
        reconciliacaoNecessaria: true,
      };
      try {
        await this.gravarPendenciaAtual();
      } catch {
        // o arquivo antigo continua no disco; a memória já bloqueia pagamento
      }
      return;
    }
    this.transacaoPendente = {
      ...lido.registro,
      reconciliacaoNecessaria: true,
    };
    if (lido.registro.reconciliacaoNecessaria === true && lido.registro.status === STATUS_JOURNAL_TEF.RESULTADO_DESCONHECIDO) {
      return;
    }
    try {
      await this.gravarPendenciaAtual();
    } catch {
      // falha ao regravar não apaga o journal nem libera pagamento
    }
  }

  gravarPendenciaAtual() {
    const registro = this.transacaoPendente;
    if (!registro || registro.ilegivel) {
      return this.filaPendencia;
    }
    const copia = { ...registro };
    const tarefa = this.filaPendencia.then(() =>
      gravarPendenciaTef(this.arquivoPendencia, copia, this.fsPendencia)
    );
    this.filaPendencia = tarefa.then(
      () => undefined,
      () => undefined
    );
    return tarefa;
  }

  async marcarReconciliacao() {
    if (!this.transacaoPendente) {
      return;
    }
    this.transacaoPendente = {
      ...this.transacaoPendente,
      reconciliacaoNecessaria: true,
    };
    if (!this.transacaoPendente.ilegivel) {
      await this.gravarPendenciaAtual();
    }
  }

  async marcarResultadoDesconhecido() {
    if (!this.transacaoPendente || this.transacaoPendente.ilegivel) {
      return;
    }
    if (this.transacaoPendente.status === STATUS_JOURNAL_TEF.AGUARDANDO_DECISAO) {
      await this.marcarReconciliacao();
      return;
    }
    this.transacaoPendente = {
      ...this.transacaoPendente,
      status: STATUS_JOURNAL_TEF.RESULTADO_DESCONHECIDO,
      reconciliacaoNecessaria: true,
    };
    try {
      await this.gravarPendenciaAtual();
    } catch {
      // a memória segue bloqueada mesmo se o disco recusar a troca de status
    }
  }

  bloqueioAntesDeEnviar(acao, correlationId = "") {
    const temJournal = this.pendenciaIlegivel === true || this.transacaoPendente != null;
    if (!temJournal) {
      return null;
    }
    if (acao === "teste" || acao === "inicializar") {
      return null;
    }
    const status = this.transacaoPendente?.status;
    if (
      acao === "pagamento" &&
      status === STATUS_JOURNAL_TEF.PAGAMENTO_EM_ANDAMENTO &&
      correlationId &&
      correlationId === this.transacaoPendente?.correlationId
    ) {
      return null;
    }
    if (
      (acao === "confirmar" || acao === "desfazer") &&
      status === STATUS_JOURNAL_TEF.AGUARDANDO_DECISAO &&
      this.pendenciaIlegivel !== true
    ) {
      return null;
    }
    if (status === STATUS_JOURNAL_TEF.PAGAMENTO_EM_ANDAMENTO) {
      return {
        ok: false,
        codigo: CODIGOS_TEF.OCUPADO,
        erro: MENSAGEM_TEF_OCUPADO,
      };
    }
    if (status === STATUS_JOURNAL_TEF.RESULTADO_DESCONHECIDO) {
      return {
        ok: false,
        codigo: CODIGOS_TEF.RECONCILIACAO_NECESSARIA,
        erro: MENSAGEM_TEF_RECONCILIACAO_NECESSARIA,
      };
    }
    return {
      ok: false,
      codigo: CODIGOS_TEF.TRANSACAO_PENDENTE,
      erro:
        this.pendenciaIlegivel || this.transacaoPendente?.reconciliacaoNecessaria === true
          ? MENSAGEM_TEF_RECONCILIACAO
          : MENSAGEM_TEF_TRANSACAO_PENDENTE,
    };
  }

  async absorverPendenciaNativa(resultado) {
    if (!resultado || typeof resultado !== "object") {
      return;
    }
    const detectada = resultado.pendencia;
    const detectou =
      resultado.pendenciaDetectada === true ||
      resultado.pendenciaIncompleta === true ||
      (detectada && typeof detectada === "object" && !Array.isArray(detectada));
    if (!detectou) {
      return;
    }
    const rede = textoPerna(detectada?.rede);
    const nsu = textoPerna(detectada?.nsu);
    const finalizacao = textoPerna(detectada?.finalizacao);
    if (!rede || !nsu || !finalizacao || resultado.pendenciaIncompleta === true) {
      if (this.transacaoPendente && !this.pendenciaIlegivel) {
        await this.marcarResultadoDesconhecido();
        return;
      }
      this.pendenciaIlegivel = true;
      this.transacaoPendente = this.transacaoPendente ?? {
        status: STATUS_JOURNAL_TEF.AGUARDANDO_DECISAO,
        ilegivel: true,
        reconciliacaoNecessaria: true,
      };
      this.transacaoPendente = {
        ...this.transacaoPendente,
        reconciliacaoNecessaria: true,
      };
      return;
    }
    const journal = this.transacaoPendente;
    const incerto =
      journal &&
      (journal.status === STATUS_JOURNAL_TEF.RESULTADO_DESCONHECIDO ||
        journal.status === STATUS_JOURNAL_TEF.PAGAMENTO_EM_ANDAMENTO);
    if (incerto) {
      if (!pendenciaCorresponde(journal, detectada, resultado)) {
        await this.marcarResultadoDesconhecido();
        return;
      }
      this.pendenciaIlegivel = false;
      this.transacaoPendente = promoverJournalDecisao(
        { ...journal, reconciliacaoNecessaria: true },
        {
          rede,
          nsu,
          finalizacao,
          identificador: detectada.identificador,
          valor: detectada.valor,
        }
      );
      await this.gravarPendenciaAtual();
      return;
    }
    if (!journal || this.pendenciaIlegivel) {
      this.pendenciaIlegivel = false;
      this.transacaoPendente = montarRegistroPendencia({
        rede,
        nsu,
        finalizacao,
        identificador: detectada.identificador,
        valor: detectada.valor,
        reconciliacaoNecessaria: true,
      });
      await this.gravarPendenciaAtual();
      return;
    }
    const diferente =
      journal.rede !== rede ||
      journal.nsu !== nsu ||
      journal.finalizacao !== finalizacao ||
      Number(resultado.pendenciasDetectadas) > 1;
    if (diferente) {
      this.transacaoPendente = {
        ...journal,
        reconciliacaoNecessaria: true,
      };
      await this.gravarPendenciaAtual();
    }
  }

  async consultar() {
    await this.garantirPendencia();
    if (this.estado === "executando" && this.filho && this.filho.exitCode == null) {
      return this.snapshot();
    }
    if (this.estado === "iniciando" && this.filho) {
      return this.snapshot();
    }

    const local = await this.localizarSeguro();
    this.aplicarLocal(local);
    if (!this.executavelEncontrado) {
      this.estado = "nao_instalado";
    } else if (this.estado !== "erro") {
      this.estado = "parado";
    }
    return this.snapshot();
  }

  async testar() {
    const previo = await this.consultar();
    if (!previo.executavelEncontrado || previo.processo === "nao_instalado") {
      return {
        ok: false,
        statusHttp: 503,
        codigo: CODIGOS_TEF.NAO_INSTALADO,
        erro: MENSAGEM_TEF_NAO_INSTALADO,
        tef: previo,
      };
    }

    const resposta = await this.executar({ acao: "teste" });
    const tef = this.snapshot();
    if (resposta?.codigo && resposta.ok !== true) {
      return {
        ok: false,
        statusHttp: statusHttpDoCodigo(resposta.codigo),
        codigo: resposta.codigo,
        erro: resposta.erro,
        tef,
      };
    }
    return {
      ok: resposta?.ok === true,
      statusHttp: 200,
      erro: resposta?.ok === true ? undefined : resposta?.erro,
      resultado:
        resposta?.resultado && typeof resposta.resultado === "object"
          ? resposta.resultado
          : {},
      tef,
    };
  }

  async diagnosticarPinpad(testarComunicacao = false) {
    const acao = testarComunicacao
      ? "pinpad-testar-comunicacao"
      : "pinpad-diagnostico";
    if (this.pendente) {
      const financeira = ["pagamento", "confirmar", "desfazer", "instalar"].includes(
        this.pendente.acao
      );
      return {
        ok: false,
        statusHttp: 409,
        codigo: CODIGOS_TEF.OCUPADO,
        erro: financeira ? MENSAGEM_TEF_PINPAD_OCUPADO : MENSAGEM_TEF_OCUPADO,
        tef: this.snapshot(),
      };
    }
    const bloqueio = this.bloqueioAntesDeEnviar(acao);
    if (bloqueio) {
      const financeiro =
        bloqueio.codigo === CODIGOS_TEF.OCUPADO ||
        bloqueio.codigo === CODIGOS_TEF.TRANSACAO_PENDENTE ||
        bloqueio.codigo === CODIGOS_TEF.RECONCILIACAO_NECESSARIA;
      return {
        ok: false,
        statusHttp: statusHttpDoCodigo(bloqueio.codigo),
        codigo: bloqueio.codigo,
        erro: financeiro ? MENSAGEM_TEF_PINPAD_OCUPADO : bloqueio.erro,
        tef: this.snapshot(),
      };
    }
    const previo = await this.consultar();
    if (!previo.executavelEncontrado || previo.processo === "nao_instalado") {
      return {
        ok: false,
        statusHttp: 503,
        codigo: CODIGOS_TEF.NAO_INSTALADO,
        erro: MENSAGEM_TEF_NAO_INSTALADO,
        tef: previo,
      };
    }
    if (
      !(
        this.estado === "executando" &&
        this.filho &&
        this.filho.exitCode == null &&
        this.inicializado === true
      )
    ) {
      return {
        ok: false,
        statusHttp: 409,
        codigo: "PINPAD_PAYGO_NAO_INICIALIZADO",
        erro: MENSAGEM_TEF_PINPAD_NAO_INICIALIZADO,
        tef: this.snapshot(),
      };
    }
    const resposta = await this.executar({ acao });
    const tef = this.snapshot();
    const resultadoPinpad =
      resposta?.resultado && typeof resposta.resultado === "object"
        ? resposta.resultado
        : {};
    if (resposta?.codigo && resposta.ok !== true) {
      return {
        ok: false,
        statusHttp: statusHttpDoCodigo(resposta.codigo),
        codigo: resposta.codigo,
        erro: resposta.erro,
        resultado: resultadoPinpad,
        tef,
      };
    }
    return {
      ok: resposta?.ok === true,
      statusHttp: 200,
      erro: resposta?.ok === true ? undefined : resposta?.erro,
      resultado:
        resposta?.resultado && typeof resposta.resultado === "object"
          ? resposta.resultado
          : {},
      tef,
    };
  }

  async inicializar(autorizado = null) {
    const previo = await this.consultar();
    if (!previo.executavelEncontrado || previo.processo === "nao_instalado") {
      return {
        ok: false,
        statusHttp: 503,
        codigo: CODIGOS_TEF.NAO_INSTALADO,
        erro: MENSAGEM_TEF_NAO_INSTALADO,
        tef: previo,
      };
    }

    const identidade = identidadeInicial(autorizado);
    if (!identidade.ok) {
      return {
        ok: false,
        statusHttp: statusHttpDoCodigo(identidade.codigo),
        codigo: identidade.codigo,
        erro: identidade.erro,
        tef: previo,
      };
    }
    if (
      this.inicializado &&
      this.identidadeProcesso &&
      !mesmaIdentidade(this.identidadeProcesso, identidade.identidade)
    ) {
      return {
        ok: false,
        statusHttp: statusHttpDoCodigo(CODIGOS_TEF.OPERACAO_NAO_PERMITIDA),
        codigo: CODIGOS_TEF.OPERACAO_NAO_PERMITIDA,
        erro: MENSAGEM_TEF_IDENTIDADE_DIVERGENTE,
        tef: this.snapshot(),
      };
    }
    const resposta = await this.executar({ acao: "inicializar", dados: identidade.dados });
    if (
      resposta?.ok === true &&
      resposta?.resultado?.inicializado === true &&
      this.inicializado === true
    ) {
      this.identidadeProcesso = identidade.identidade;
    }
    if (resposta?.ok === true) {
      await this.absorverPendenciaNativa(resposta.resultado);
    }
    const tef = this.snapshot();
    if (resposta?.codigo && resposta.ok !== true) {
      return {
        ok: false,
        statusHttp: statusHttpDoCodigo(resposta.codigo),
        codigo: resposta.codigo,
        erro: resposta.erro,
        tef,
      };
    }
    return {
      ok: resposta?.ok === true,
      statusHttp: 200,
      erro: resposta?.ok === true ? undefined : resposta?.erro,
      resultado:
        resposta?.resultado && typeof resposta.resultado === "object"
          ? resposta.resultado
          : {},
      tef,
    };
  }

  async instalar(autorizado = null) {
    const previo = await this.consultar();
    if (!previo.executavelEncontrado || previo.processo === "nao_instalado") {
      return {
        ok: false,
        statusHttp: 503,
        codigo: CODIGOS_TEF.NAO_INSTALADO,
        erro: MENSAGEM_TEF_NAO_INSTALADO,
        tef: previo,
        evidencia: null,
      };
    }

    await this.garantirPendencia();
    const bloqueio = this.bloqueioAntesDeEnviar("instalar");
    if (bloqueio) {
      return {
        ok: false,
        statusHttp: statusHttpDoCodigo(bloqueio.codigo),
        codigo: bloqueio.codigo,
        erro: bloqueio.erro,
        tef: this.snapshot(),
        evidencia: null,
      };
    }

    if (!(this.estado === "executando" && this.filho && this.filho.exitCode == null && this.inicializado === true)) {
      return {
        ok: false,
        statusHttp: 409,
        codigo: CODIGOS_TEF.NAO_INICIALIZADO,
        erro: MENSAGEM_TEF_NAO_INICIALIZADO,
        tef: this.snapshot(),
        evidencia: null,
      };
    }

    const autorizada = identidadeInicial(autorizado);
    if (
      !autorizado ||
      typeof autorizado.chavePrivada !== "string" ||
      !autorizado.chavePrivada.trim() ||
      !autorizada.ok ||
      autorizada.identidade?.modo !== "novo" ||
      !this.identidadeProcesso ||
      !mesmaIdentidade(this.identidadeProcesso, autorizada.identidade)
    ) {
      const codigoRecusa =
        autorizada.ok === false
          ? autorizada.codigo
          : CODIGOS_TEF.OPERACAO_NAO_PERMITIDA;
      const erroRecusa =
        autorizada.ok === false
          ? autorizada.erro
          : this.identidadeProcesso &&
              autorizada.identidade?.modo === "novo" &&
              !mesmaIdentidade(this.identidadeProcesso, autorizada.identidade)
            ? MENSAGEM_TEF_IDENTIDADE_DIVERGENTE
            : MENSAGEM_TEF_INSTALACAO_BLOQUEADA;
      return {
        ok: false,
        statusHttp: statusHttpDoCodigo(codigoRecusa),
        codigo: codigoRecusa,
        erro: erroRecusa,
        tef: this.snapshot(),
        evidencia: null,
      };
    }
    const resposta = await this.executar({ acao: "instalar", dados: autorizada.dados });
    const tef = this.snapshot();
    const resultado =
      resposta?.resultado && typeof resposta.resultado === "object" && !Array.isArray(resposta.resultado)
        ? { ...resposta.resultado }
        : {};
    delete resultado.assinatura;
    delete resultado.evidencia;
    delete resultado.instalacaoId;
    let evidencia = null;
    if (resposta?.ok === true && autorizado?.chavePrivada) {
      const observacao = observacaoEvidenciaInstalacao(resultado, autorizado, randomUUID());
      const assinada = observacao
        ? assinarEvidenciaInstalacao(autorizado.chavePrivada, observacao)
        : null;
      if (assinada) {
        evidencia = {
          campos: assinada.campos,
          assinatura: assinada.assinatura,
        };
      }
    }
    if (resposta?.codigo && resposta.ok !== true) {
      return {
        ok: false,
        statusHttp: statusHttpDoCodigo(resposta.codigo),
        codigo: resposta.codigo,
        erro: resposta.erro,
        tef,
        evidencia: null,
      };
    }
    return {
      ok: resposta?.ok === true,
      statusHttp: 200,
      erro: resposta?.ok === true ? undefined : resposta?.erro,
      resultado,
      tef,
      evidencia,
    };
  }

  async pagar(entrada = {}) {
    const validado = validarDadosPagamento(entrada);
    const tefAtual = this.snapshot();
    if (!validado.ok) {
      return {
        ok: false,
        statusHttp: statusHttpDoCodigo(validado.codigo),
        codigo: validado.codigo,
        erro: validado.erro,
        tef: tefAtual,
      };
    }

    await this.garantirPendencia();
    const bloqueio = this.bloqueioAntesDeEnviar("pagamento");
    if (bloqueio) {
      return {
        ok: false,
        statusHttp: statusHttpDoCodigo(bloqueio.codigo),
        codigo: bloqueio.codigo,
        erro: bloqueio.erro,
        tef: this.snapshot(),
      };
    }

    if (!(this.estado === "executando" && this.filho && this.filho.exitCode == null && this.inicializado === true)) {
      const tef = await this.consultar();
      if (!tef.executavelEncontrado || tef.processo === "nao_instalado") {
        return {
          ok: false,
          statusHttp: 503,
          codigo: CODIGOS_TEF.NAO_INSTALADO,
          erro: MENSAGEM_TEF_NAO_INSTALADO,
          tef,
        };
      }
      return {
        ok: false,
        statusHttp: 409,
        codigo: CODIGOS_TEF.NAO_INICIALIZADO,
        erro: MENSAGEM_TEF_NAO_INICIALIZADO,
        tef: this.snapshot(),
      };
    }

    const correlationId = String(this.criarId());
    this.pendenciaIlegivel = false;
    this.transacaoPendente = montarJournalPagamento({
      identificador: validado.identificador,
      valor: validado.valor,
      correlationId,
    });
    try {
      await this.gravarPendenciaAtual();
    } catch {
      this.transacaoPendente = null;
      return {
        ok: false,
        statusHttp: statusHttpDoCodigo(CODIGOS_TEF.PERSISTENCIA_FALHOU),
        codigo: CODIGOS_TEF.PERSISTENCIA_FALHOU,
        erro: MENSAGEM_TEF_PERSISTENCIA_FALHOU,
        tef: this.snapshot(),
      };
    }

    const resposta = await this.executar({
      id: correlationId,
      acao: "pagamento",
      dados: {
        identificador: validado.identificador,
        valor: validado.valor,
      },
    });
    await this.concluirJournalPagamento(resposta);
    const tef = this.snapshot();
    if (resposta?.persistenciaFalhou === true) {
      return {
        ok: false,
        statusHttp: statusHttpDoCodigo(CODIGOS_TEF.PERSISTENCIA_FALHOU),
        codigo: CODIGOS_TEF.PERSISTENCIA_FALHOU,
        erro: MENSAGEM_TEF_PERSISTENCIA_FALHOU,
        resultado:
          resposta?.resultado && typeof resposta.resultado === "object"
            ? resposta.resultado
            : undefined,
        tef,
      };
    }
    if (
      resposta?.ok === true &&
      this.transacaoPendente?.status === STATUS_JOURNAL_TEF.RESULTADO_DESCONHECIDO
    ) {
      return {
        ok: false,
        statusHttp: statusHttpDoCodigo(CODIGOS_TEF.RECONCILIACAO_NECESSARIA),
        codigo: CODIGOS_TEF.RECONCILIACAO_NECESSARIA,
        erro: MENSAGEM_TEF_RECONCILIACAO_NECESSARIA,
        resultado:
          resposta?.resultado && typeof resposta.resultado === "object"
            ? resposta.resultado
            : {},
        tef,
      };
    }
    if (resposta?.codigo && resposta.ok !== true) {
      return {
        ok: false,
        statusHttp: statusHttpDoCodigo(resposta.codigo),
        codigo: resposta.codigo,
        erro: resposta.erro,
        tef,
      };
    }
    return {
      ok: resposta?.ok === true,
      statusHttp: 200,
      erro: resposta?.ok === true ? undefined : resposta?.erro,
      resultado:
        resposta?.resultado && typeof resposta.resultado === "object"
          ? resposta.resultado
          : {},
      tef,
    };
  }

  async confirmar(entrada = {}) {
    return this.decidir("confirmar", entrada);
  }

  async desfazer(entrada = {}) {
    return this.decidir("desfazer", entrada);
  }

  async decidir(acao, entrada = {}) {
    const validado = validarDadosDecisao(entrada);
    if (!validado.ok) {
      return {
        ok: false,
        statusHttp: statusHttpDoCodigo(validado.codigo),
        codigo: validado.codigo,
        erro: validado.erro,
        tef: this.snapshot(),
      };
    }

    await this.garantirPendencia();

    if (!this.transacaoPendente || this.pendenciaIlegivel) {
      return {
        ok: false,
        statusHttp: 400,
        codigo: CODIGOS_TEF.DADOS_INVALIDOS,
        erro: "Não há transação aguardando confirmação.",
        tef: this.snapshot(),
      };
    }

    if (
      this.transacaoPendente.rede !== validado.rede ||
      this.transacaoPendente.nsu !== validado.nsu ||
      this.transacaoPendente.finalizacao !== validado.finalizacao
    ) {
      return {
        ok: false,
        statusHttp: 400,
        codigo: CODIGOS_TEF.DADOS_INVALIDOS,
        erro: "A transação informada não é a que está pendente.",
        tef: this.snapshot(),
      };
    }

    if (
      acao === "confirmar" &&
      /^teste/i.test(textoPerna(this.transacaoPendente.identificador))
    ) {
      return {
        ok: false,
        statusHttp: 400,
        codigo: CODIGOS_TEF.OPERACAO_NAO_PERMITIDA,
        erro: "Transação de teste não pode ser confirmada.",
        tef: this.snapshot(),
      };
    }

    if (!(this.estado === "executando" && this.filho && this.filho.exitCode == null && this.inicializado === true)) {
      const tef = await this.consultar();
      if (!tef.executavelEncontrado || tef.processo === "nao_instalado") {
        return {
          ok: false,
          statusHttp: 503,
          codigo: CODIGOS_TEF.NAO_INSTALADO,
          erro: MENSAGEM_TEF_NAO_INSTALADO,
          tef,
        };
      }
      return {
        ok: false,
        statusHttp: 409,
        codigo: CODIGOS_TEF.NAO_INICIALIZADO,
        erro: MENSAGEM_TEF_NAO_INICIALIZADO,
        tef: this.snapshot(),
      };
    }

    const resposta = await this.executar({
      acao,
      dados: {
        rede: validado.rede,
        nsu: validado.nsu,
        finalizacao: validado.finalizacao,
      },
    });
    if (resposta?.ok === true) {
      const proxima = resposta.resultado?.proximaPendencia;
      if (proxima && typeof proxima === "object" && !Array.isArray(proxima) && textoPerna(proxima.rede)) {
        this.pendenciaIlegivel = false;
        this.transacaoPendente = montarRegistroPendencia({
          ...proxima,
          reconciliacaoNecessaria: true,
        });
        await this.gravarPendenciaAtual();
      } else {
        try {
          await this.filaPendencia;
          await removerPendenciaTef(this.arquivoPendencia, this.fsPendencia);
          this.transacaoPendente = null;
          this.pendenciaIlegivel = false;
        } catch {
          await this.marcarReconciliacao();
          return {
            ok: false,
            statusHttp: 409,
            codigo: CODIGOS_TEF.TRANSACAO_PENDENTE,
            erro: MENSAGEM_TEF_RECONCILIACAO,
            tef: this.snapshot(),
          };
        }
      }
    }
    const tef = this.snapshot();
    if (resposta?.codigo && resposta.ok !== true) {
      return {
        ok: false,
        statusHttp: statusHttpDoCodigo(resposta.codigo),
        codigo: resposta.codigo,
        erro: resposta.erro,
        tef,
      };
    }
    return {
      ok: resposta?.ok === true,
      statusHttp: 200,
      erro: resposta?.ok === true ? undefined : resposta?.erro,
      resultado:
        resposta?.resultado && typeof resposta.resultado === "object"
          ? resposta.resultado
          : {},
      tef,
    };
  }

  async concluirJournalPagamento(resposta) {
    const status = this.transacaoPendente?.status;
    if (!this.transacaoPendente || this.transacaoPendente.ilegivel) {
      return;
    }
    if (status === STATUS_JOURNAL_TEF.RESULTADO_DESCONHECIDO) {
      try {
        await this.gravarPendenciaAtual();
      } catch {
        // o journal anterior permanece e o próximo pagamento continua bloqueado
      }
      return;
    }
    if (status !== STATUS_JOURNAL_TEF.PAGAMENTO_EM_ANDAMENTO) {
      return;
    }
    const incerto =
      !resposta ||
      resposta.ok !== true ||
      resposta.codigo === CODIGOS_TEF.TIMEOUT ||
      resposta.codigo === CODIGOS_TEF.PROCESSO_ENCERRADO;
    if (incerto) {
      await this.marcarResultadoDesconhecido();
      return;
    }
    if (aguardaDecisao(resposta.resultado)) {
      const promovido = promoverJournalDecisao(this.transacaoPendente, resposta.resultado);
      if (!promovido.rede || !promovido.nsu || !promovido.finalizacao) {
        await this.marcarResultadoDesconhecido();
        return;
      }
      this.transacaoPendente = promovido;
      try {
        await this.gravarPendenciaAtual();
      } catch {
        this.transacaoPendente = { ...promovido, reconciliacaoNecessaria: true };
        try {
          await this.gravarPendenciaAtual();
        } catch {
          resposta.persistenciaFalhou = true;
        }
      }
      return;
    }
    if (resultadoConhecidoSemPendencia(resposta.resultado)) {
      try {
        await this.filaPendencia;
        await removerPendenciaTef(this.arquivoPendencia, this.fsPendencia);
        this.transacaoPendente = null;
        this.pendenciaIlegivel = false;
      } catch {
        await this.marcarResultadoDesconhecido();
        resposta.persistenciaFalhou = true;
      }
      return;
    }
    await this.marcarResultadoDesconhecido();
  }

  async executar(pedido = {}) {
    const idInformado =
      pedido && typeof pedido === "object" && typeof pedido.id === "string"
        ? pedido.id.trim()
        : "";
    const acaoPretendida =
      pedido && typeof pedido === "object" && typeof pedido.acao === "string"
        ? pedido.acao
        : "teste";
    if (ACOES_TEF_RESOLVEM_PENDENCIA.has(acaoPretendida)) {
      const bloqueioPrevio = this.bloqueioAntesDeEnviar(acaoPretendida, idInformado);
      if (bloqueioPrevio) {
        return bloqueioPrevio;
      }
    }
    const montado = montarPedidoTef(pedidoSemCorrelacao(pedido));
    if (!montado.ok) {
      return {
        ok: false,
        codigo: montado.codigo,
        erro: montado.erro,
      };
    }
    const bloqueio = this.bloqueioAntesDeEnviar(montado.acao, idInformado);
    if (bloqueio) {
      return bloqueio;
    }
    if (this.pendente) {
      return {
        ok: false,
        codigo: CODIGOS_TEF.OCUPADO,
        erro: MENSAGEM_TEF_OCUPADO,
      };
    }

    const id = idInformado || String(this.criarId());
    const promessa = new Promise((resolve) => {
      this.pendente = {
        id,
        acao: montado.acao,
        resolve,
        liquidado: false,
        timer: null,
      };
    });

    const iniciado = await this.iniciarSeParado();
    if (!this.pendente || this.pendente.id !== id) {
      return this.concluirInicializacao(montado.acao, promessa);
    }
    if (!iniciado.ok) {
      this.resolverPendente({
        ok: false,
        codigo: iniciado.codigo,
        erro: iniciado.erro,
        id,
      });
      return this.concluirInicializacao(montado.acao, promessa);
    }

    try {
      this.armarTimeout(id, montado.acao);
      this.escreverLinha(id, montado.acao, montado.dados);
    } catch {
      this.resolverPendente({
        ok: false,
        codigo: CODIGOS_TEF.PROCESSO_ENCERRADO,
        erro: MENSAGEM_TEF_PROCESSO_ENCERRADO,
        id,
      });
    }
    return this.concluirInicializacao(montado.acao, promessa);
  }

  concluirInicializacao(acao, promessa) {
    return promessa.then((resultado) => {
      if (
        acao === "inicializar" &&
        resultado?.ok === true &&
        resultado?.resultado?.inicializado === true &&
        this.estado === "executando" &&
        this.filho &&
        this.filho.exitCode == null
      ) {
        this.inicializado = true;
      }
      return resultado;
    });
  }

  async reiniciar() {
    await this.encerrar();
    if (this.estado === "erro") {
      this.estado = this.executavelEncontrado ? "parado" : "nao_instalado";
    }
    return this.iniciarSeParado();
  }

  async encerrar() {
    if (this.promessaEncerrar) {
      return this.promessaEncerrar;
    }
    this.promessaEncerrar = this.encerrarAgora().finally(() => {
      this.promessaEncerrar = null;
    });
    return this.promessaEncerrar;
  }

  async encerrarAgora() {
    const filho = this.filho;
    if (!filho || filho.exitCode != null) {
      this.filho = null;
      this.buffer = "";
      this.inicializado = false;
      this.identidadeProcesso = null;
      if (this.pendente) {
        this.resolverPendente({
          ok: false,
          codigo: CODIGOS_TEF.PROCESSO_ENCERRADO,
          erro: MENSAGEM_TEF_PROCESSO_ENCERRADO,
        });
      }
      if (this.estado !== "nao_instalado") {
        this.estado = this.executavelEncontrado ? "parado" : "nao_instalado";
      }
      return;
    }

    this.encerramentoControlado = true;
    const espera = esperarSaida(filho, this.limiteEncerramentoMs);
    try {
      filho.stdin?.end();
    } catch {
      // o processo pode já ter fechado o stdin
    }
    let saiu = await espera;
    if (!saiu && filho.exitCode == null) {
      try {
        filho.kill();
      } catch {
        // ignora falha ao sinalizar; a espera seguinte limita o tempo
      }
      saiu = await esperarSaida(filho, this.limiteEncerramentoMs);
      if (!saiu && filho.exitCode == null) {
        try {
          filho.kill("SIGKILL");
        } catch {
          // último recurso
        }
        await esperarSaida(filho, this.limiteEncerramentoMs);
      }
    }

    this.menuInterativo = null;
    this.filho = null;
    this.buffer = "";
    this.encerramentoControlado = false;
    if (this.estado !== "nao_instalado") {
      this.estado = this.executavelEncontrado ? "parado" : "nao_instalado";
    }
  }

  async iniciarSeParado() {
    if (this.filho && this.filho.exitCode == null && this.estado === "executando") {
      return { ok: true };
    }

    const local = await this.localizarSeguro();
    this.aplicarLocal(local);
    if (!this.executavelEncontrado) {
      this.estado = "nao_instalado";
      return {
        ok: false,
        codigo: CODIGOS_TEF.NAO_INSTALADO,
        erro: MENSAGEM_TEF_NAO_INSTALADO,
      };
    }

    this.estado = "iniciando";
    this.inicializado = false;
    this.identidadeProcesso = null;
    this.buffer = "";
    this.codigoSaida = null;
    this.encerramentoControlado = false;

    let filho;
    try {
      filho = this.spawn(this.caminho, [], {
        windowsHide: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      this.estado = "erro";
      this.filho = null;
      return {
        ok: false,
        codigo: CODIGOS_TEF.PROCESSO_ENCERRADO,
        erro: MENSAGEM_TEF_PROCESSO_ENCERRADO,
      };
    }
    if (!filho || typeof filho.on !== "function") {
      this.estado = "erro";
      this.filho = null;
      return {
        ok: false,
        codigo: CODIGOS_TEF.PROCESSO_ENCERRADO,
        erro: MENSAGEM_TEF_PROCESSO_ENCERRADO,
      };
    }

    this.filho = filho;
    this.ligarFilho(filho);

    return await new Promise((resolve) => {
      let liquidado = false;
      const fim = (valor) => {
        if (liquidado) {
          return;
        }
        liquidado = true;
        resolve(valor);
      };
      filho.once("spawn", () => {
        if (this.filho === filho) {
          this.estado = "executando";
        }
        fim({ ok: true });
      });
      filho.once("error", () => {
        if (this.filho === filho) {
          this.estado = "erro";
        }
        fim({
          ok: false,
          codigo: CODIGOS_TEF.PROCESSO_ENCERRADO,
          erro: MENSAGEM_TEF_PROCESSO_ENCERRADO,
        });
      });
      filho.once("exit", () => {
        fim({
          ok: false,
          codigo: CODIGOS_TEF.PROCESSO_ENCERRADO,
          erro: MENSAGEM_TEF_PROCESSO_ENCERRADO,
        });
      });
    });
  }

  ligarFilho(filho) {
    ouvir(filho.stdout, "data", (chunk) => {
      if (this.filho === filho) {
        this.receberStdout(chunk);
      }
    });
    ouvir(filho.stderr, "data", (chunk) => {
      if (this.filho !== filho) {
        return;
      }
      const texto = textoChunk(chunk).replace(/\s+/g, " ").trim();
      if (texto) {
        void this.registrar("tef-stderr", texto);
      }
    });
    ouvir(filho.stdin, "error", () => {});
    ouvir(filho.stdout, "error", () => {});
    ouvir(filho.stderr, "error", () => {});
    filho.once("exit", (code) => this.aoSair(filho, code));
    filho.on("error", () => {
      if (this.filho === filho && this.estado === "iniciando") {
        this.estado = "erro";
      }
    });
  }

  receberStdout(chunk) {
    this.buffer += textoChunk(chunk);
    if (this.buffer.length > LIMITE_BUFFER_STDOUT) {
      this.buffer = "";
      void this.registrar("tef-stdout-invalido", "buffer de stdout excedido");
      return;
    }
    const partes = this.buffer.split(/\r?\n/);
    this.buffer = partes.pop() ?? "";
    for (const linha of partes) {
      this.consumirLinha(linha);
    }
  }

  consultarMenuInterativo() {
    const menu = this.menuInterativo;
    if (!menu || !this.pendente || this.pendente.liquidado ||
        this.pendente.acao !== "pagamento" || this.pendente.id !== menu.id ||
        !this.filho || this.filho.exitCode != null ||
        Date.now() >= menu.expiraEm) {
      return null;
    }
    const { id, solicitacaoId, titulo, opcoes } = menu;
    return { id, solicitacaoId, titulo, opcoes: [...opcoes] };
  }

  responderMenuInterativo({ id, solicitacaoId, indice } = {}) {
    const menu = this.consultarMenuInterativo();
    if (!menu || !this.pendente || this.pendente.acao !== "pagamento" ||
        this.pendente.id !== menu.id || id !== menu.id ||
        solicitacaoId !== menu.solicitacaoId ||
        !Number.isInteger(indice) || indice < -1 || indice >= menu.opcoes.length ||
        !this.filho || this.filho.exitCode != null) {
      return { ok: false, erro: "Menu inexistente ou resposta invalida." };
    }
    // Consome a solicitação uma única vez, antes de enviar ao processo.
    this.menuInterativo = null;
    try {
      this.escreverLinha(menu.id, "menu_resposta", {
        solicitacaoId: menu.solicitacaoId, indice,
      });
      return { ok: true };
    } catch {
      void this.marcarResultadoDesconhecido();
      return { ok: false, erro: "Falha de comunicacao com o TEF." };
    }
  }

  consumirLinha(linha) {
    const bruto = String(linha ?? "").replace(/^\uFEFF/, "").trim();
    if (!bruto) {
      return;
    }
    let json;
    try {
      json = JSON.parse(bruto);
    } catch {
      void this.registrar("tef-stdout-invalido", bruto);
      return;
    }
    if (!json || typeof json !== "object" || Array.isArray(json) || typeof json.id !== "string") {
      void this.registrar("tef-stdout-invalido", bruto);
      return;
    }
    if (json.tipo === "menu" && typeof json.id === "string") {
      if (!this.pendente || this.pendente.acao !== "pagamento" ||
          json.id !== this.pendente.id || this.menuInterativo ||
          typeof json.solicitacaoId !== "string" || !json.solicitacaoId ||
          !Array.isArray(json.opcoes) || json.opcoes.length < 1 ||
          json.opcoes.length > 30 ||
          !json.opcoes.every((x) => typeof x === "string" && x.length <= 180)) {
        void this.registrar("tef-menu-invalido", "evento inesperado");
        return;
      }
      this.menuInterativo = {
        id: json.id,
        solicitacaoId: json.solicitacaoId,
        titulo: typeof json.titulo === "string" ? json.titulo.slice(0, 180) : "",
        opcoes: [...json.opcoes],
        expiraEm: Date.now() + 115000,
      };
      return;
    }
    if (typeof json.ok !== "boolean") {
      void this.registrar("tef-stdout-invalido", bruto);
      return;
    }
    if (!this.pendente || this.pendente.id !== json.id) {
      void this.registrar("tef-resposta-inesperada", `id=${json.id}`);
      return;
    }
    const resultado =
      json.resultado && typeof json.resultado === "object" && !Array.isArray(json.resultado)
        ? json.resultado
        : {};
    this.resolverPendente({
      ok: json.ok,
      id: json.id,
      resultado,
      ...(typeof json.codigo === "string" && /^[A-Z0-9_]{1,64}$/.test(json.codigo)
        ? { codigo: json.codigo }
        : {}),
      erro: json.ok
        ? null
        : typeof json.erro === "string" && json.erro.trim()
          ? json.erro.trim()
          : "Operação TEF recusada.",
    });
  }

  escreverLinha(id, acao, dados = {}) {
    const linha = `${JSON.stringify({
      id,
      versao: 1,
      acao,
      dados: dados && typeof dados === "object" && !Array.isArray(dados) ? dados : {},
    })}\n`;
    if (!this.filho || this.filho.exitCode != null ||
        !this.filho.stdin || this.filho.stdin.destroyed === true || this.filho.stdin.writable === false) {
      throw new Error("Canal TEF indisponivel");
    }
    this.filho.stdin.write(linha);
  }

  armarTimeout(id, acao) {
    const ms = timeoutDaAcao(acao);
    if (!this.pendente || this.pendente.id !== id || !Number.isFinite(ms)) {
      return;
    }
    this.pendente.timer = this.agendar(() => {
      if (!this.pendente || this.pendente.id !== id || this.pendente.liquidado) {
        return;
      }
      const acaoTimeout = this.pendente.acao;
      if (acaoTimeout === "pagamento") {
        void this.marcarResultadoDesconhecido();
      } else if (acaoTimeout === "confirmar" || acaoTimeout === "desfazer") {
        void this.marcarReconciliacao();
      }
      this.resolverPendente({
        ok: false,
        codigo: CODIGOS_TEF.TIMEOUT,
        erro: MENSAGEM_TEF_TIMEOUT,
        id,
      });
    }, ms);
  }

  resolverPendente(resultado) {
    const pendente = this.pendente;
    if (!pendente || pendente.liquidado) {
      return;
    }
    pendente.liquidado = true;
    this.menuInterativo = null;
    if (pendente.timer != null) {
      try {
        this.cancelarAgendamento(pendente.timer);
      } catch {
        // o cancelamento do timer não pode derrubar o Connector
      }
    }
    this.pendente = null;
    pendente.resolve(resultado);
  }

  aoSair(filho, code) {
    if (this.filho !== filho) {
      return;
    }
    if (this.transacaoPendente) {
      void this.marcarResultadoDesconhecido();
    }
    this.menuInterativo = null;
    this.inicializado = false;
    this.identidadeProcesso = null;
    const controlado = this.encerramentoControlado;
    this.codigoSaida = Number.isInteger(code) ? code : null;
    this.filho = null;
    this.buffer = "";
    if (controlado) {
      this.estado = this.executavelEncontrado ? "parado" : "nao_instalado";
      void this.registrar(
        "tef-encerrado",
        `code=${this.codigoSaida ?? ""}`
      );
    } else {
      this.estado = "erro";
      void this.registrar(
        "tef-processo-encerrado",
        `code=${this.codigoSaida ?? ""}`
      );
    }
    if (this.pendente) {
      this.resolverPendente({
        ok: false,
        codigo: CODIGOS_TEF.PROCESSO_ENCERRADO,
        erro: MENSAGEM_TEF_PROCESSO_ENCERRADO,
        code: this.codigoSaida,
      });
    }
  }

  aplicarLocal(local) {
    const caminho = local?.caminho;
    const ok = local?.encontrado === true && exeTefPermitido(caminho);
    this.executavelEncontrado = ok;
    this.caminho = ok ? caminho : null;
  }

  async localizarSeguro() {
    try {
      const achado = await this.localizar();
      if (achado && typeof achado === "object") {
        return achado;
      }
    } catch {
      // localização ausente vira módulo não instalado
    }
    return { encontrado: false, caminho: null };
  }

  async registrar(evento, detalhe) {
    try {
      const texto = String(detalhe ?? "");
      const diagnosticoInstalacao =
        evento === "tef-stderr" &&
        (texto.includes("[ACBrTEF][instalar]") ||
          texto.includes("[ACBrTEF][pagamento]"));
      await this.registrarLog(evento, detalhe, { diagnosticoInstalacao });
    } catch {
      // log nunca derruba o Connector
    }
  }
}

export async function statusTef({
  localizar = localizarTefNativo,
  arquivoPendencia,
} = {}) {
  const gerenciador = new GerenciadorTefNativo({ localizar, arquivoPendencia });
  return gerenciador.consultar();
}
