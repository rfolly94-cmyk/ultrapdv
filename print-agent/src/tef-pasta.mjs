import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as constantesFs } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { pastaConfigMaquina } from "./config-local.mjs";
import { diretorioProducaoPgWeb } from "./tef-diretorio.mjs";

export const SCRIPT_SELETOR_PASTA = [
  "' Seletor local. O caminho nao vem do navegador.",
  "Set shell = CreateObject(\"Shell.Application\")",
  "Set pasta = shell.BrowseForFolder(0, \"Escolha a pasta de trabalho do PayGoWeb\", 65, 0)",
  "If pasta Is Nothing Then",
  "  WScript.Quit 2",
  "End If",
  "WScript.StdOut.Write pasta.Self.Path",
  "",
].join("\r\n");

const NOMES_PW = Object.freeze({
  0: "PWRET_OK",
  "-2485": "PWRET_WRITERR",
  "-2494": "PWRET_INVCALL",
});

const CHAVES_ESCOLHER = new Set();
const CHAVES_SALVAR = new Set(["confirmar", "selecaoId", "usarRecomendada"]);

export function arquivoPastaTef(env = process.env) {
  return path.join(pastaConfigMaquina(env), "tef-pasta.json");
}

export function pastaBackupTef(env = process.env, carimbo = "") {
  return path.join(
    pastaConfigMaquina(env),
    "backup-connector",
    "pasta-tef",
    carimbo
  );
}

function texto(valor) {
  return typeof valor === "string" ? valor.trim() : "";
}

function recusa(mensagem, codigo = "caminho") {
  return { ok: false, pronto: false, codigo, mensagem };
}

function mesmaPasta(esquerda, direita) {
  const normal = (valor) =>
    path.win32
      .normalize(texto(valor))
      .replace(/[\\/]+$/u, "")
      .toLowerCase();
  const a = normal(esquerda);
  const b = normal(direita);
  return Boolean(a) && a === b;
}

function dentroDe(caminho, base) {
  const raiz = texto(base);
  const alvo = texto(caminho);
  if (!raiz || !alvo) {
    return false;
  }
  const relativo = path.win32.relative(path.win32.resolve(raiz), path.win32.resolve(alvo));
  return (
    relativo === "" ||
    (relativo !== "" && !relativo.startsWith("..") && !path.win32.isAbsolute(relativo))
  );
}

function efetivoPgWeb(pai) {
  return path.win32.join(pai, "PGWeb");
}

export const SUBPASTAS_OPERACIONAIS = Object.freeze([
  "Data",
  path.win32.join("Data", "Backup"),
  "Log",
]);

export function diretoriosOperacionais(efetivo) {
  const base = path.win32.normalize(texto(efetivo));
  return [base, ...SUBPASTAS_OPERACIONAIS.map((relativo) => path.win32.join(base, relativo))];
}

export function contaProcessoTef(info = os.userInfo()) {
  const sid = String(info?.uid ?? "").trim();
  if (/^S-1-\d+(-\d+)+$/u.test(sid)) {
    return `*${sid}`;
  }
  return "";
}

export function sidDaSaida(saida) {
  const encontrado = String(saida ?? "").match(/S-1-\d+(?:-\d+)+/u);
  return encontrado ? encontrado[0] : "";
}

async function resolverContaProcesso(executar, info) {
  if (info) {
    return contaProcessoTef(info);
  }
  const direta = contaProcessoTef();
  if (direta) {
    return direta;
  }
  try {
    const sid = sidDaSaida(await executar("whoami.exe", ["/user"]));
    return sid ? `*${sid}` : "";
  } catch {
    return "";
  }
}

export function descreverRetornoPwInit(codigo, nome) {
  if (!Number.isFinite(Number(codigo))) {
    return null;
  }
  const numero = Math.round(Number(codigo));
  const informado = texto(nome);
  const rotulo = informado || NOMES_PW[String(numero)] || "";
  const exibicao = rotulo ? `${numero} ${rotulo}` : String(numero);
  let detalhe =
    "A biblioteca devolveu este código. O teste de gravação da pasta não torna o TEF pronto.";
  if (numero === -2485 || rotulo === "PWRET_WRITERR") {
    detalhe =
      "A biblioteca recusou a gravação. Sem outro detalhe do arquivo, não dá para separar permissão de arquivo bloqueado. O TEF não foi marcado como pronto.";
  } else if (numero === -2494 || rotulo === "PWRET_INVCALL") {
    detalhe =
      "A biblioteca recusou a chamada. Isso não é uma falha de permissão da pasta. O TEF não foi marcado como pronto.";
  }
  return {
    codigo: numero,
    nome: rotulo,
    texto: exibicao,
    detalhe,
    pronto: false,
  };
}

export function classificarFalhaArquivo(erro) {
  const codigo = texto(erro?.code).toUpperCase();
  if (codigo === "EACCES") {
    return {
      codigo: "permissao",
      mensagem:
        "O Connector não tem permissão para gravar nesta pasta. A pasta atual foi mantida.",
    };
  }
  if (codigo === "EPERM" || codigo === "EBUSY" || codigo === "ELOCKED") {
    return {
      codigo: "bloqueio",
      mensagem:
        "Um arquivo desta pasta está bloqueado. A pasta atual foi mantida.",
    };
  }
  return {
    codigo: "interno",
    mensagem:
      "Não foi possível testar a gravação nesta pasta. A pasta atual foi mantida.",
  };
}

export async function classificarUnidadeWindows(caminho) {
  const letra = String(caminho ?? "").slice(0, 2);
  if (!/^[a-zA-Z]:$/u.test(letra)) {
    return "desconhecida";
  }
  try {
    const saida = await executarComando("fsutil.exe", ["fsinfo", "drivetype", letra]);
    return classificarUnidadePorTexto(saida);
  } catch {
    return "desconhecida";
  }
}

export function classificarUnidadePorTexto(saida) {
  const textoSaida = String(saida ?? "").toLowerCase();
  if (
    textoSaida.includes("rede") ||
    textoSaida.includes("network") ||
    textoSaida.includes("remote")
  ) {
    return "rede";
  }
  if (
    textoSaida.includes("fixa") ||
    textoSaida.includes("fixo") ||
    textoSaida.includes("fixed") ||
    textoSaida.includes("remov") ||
    textoSaida.includes("ram")
  ) {
    return "local";
  }
  return "desconhecida";
}

export function validarPastaLocal({
  caminho,
  ambiente,
  raizExecutavel,
  producaoPai,
  sandboxPai,
  programFiles = [],
  permitirProgramFilesExato = false,
  tipoUnidade = "local",
} = {}) {
  const bruto = typeof caminho === "string" ? caminho : "";
  if (!bruto || bruto !== bruto.trim() || /[\0\r\n]/u.test(bruto)) {
    return recusa("Escolha uma pasta local.");
  }
  if (
    bruto.startsWith("\\\\") ||
    bruto.startsWith("//") ||
    bruto.includes("\\\\") ||
    bruto.includes("/")
  ) {
    return recusa("Pastas de rede não são aceitas.");
  }
  if (bruto.includes("..") || !/^[a-zA-Z]:\\[^\\].+/u.test(bruto)) {
    return recusa("Escolha uma pasta local, com letra de unidade.");
  }
  const resolvido = path.win32.resolve(bruto);
  if (!mesmaPasta(resolvido, bruto)) {
    return recusa("O caminho não foi aceito.");
  }
  if (tipoUnidade === "rede") {
    return recusa("Pastas de rede não são aceitas.");
  }
  if (tipoUnidade !== "local") {
    return recusa("Não foi possível confirmar que a pasta está em um disco local.");
  }
  const letra = `${resolvido.slice(0, 2)}\\`;
  const sistema = [
    path.win32.join(letra, "Windows"),
    path.win32.join(letra, "Windows", "System32"),
    path.win32.join(letra, "Windows", "SysWOW64"),
    ...programFiles.map((item) => texto(item)).filter(Boolean),
  ];
  const efetivo = efetivoPgWeb(resolvido);
  for (const base of sistema) {
    const permitido =
      permitirProgramFilesExato &&
      programFiles.some((item) => dentroDe(base, item) || mesmaPasta(base, item)) &&
      mesmaPasta(resolvido, sandboxPai);
    if (!permitido && (dentroDe(resolvido, base) || dentroDe(efetivo, base))) {
      return recusa("Pastas do Windows e de Program Files não são aceitas.");
    }
  }
  if (ambiente === "producao" && dentroDe(resolvido, sandboxPai)) {
    return recusa("A pasta de produção não pode ficar dentro da homologação.");
  }
  if (ambiente !== "producao" && dentroDe(resolvido, producaoPai)) {
    return recusa("A pasta de homologação não pode ficar dentro da produção.");
  }
  const raiz = texto(raizExecutavel);
  if (ambiente === "producao" && raiz && dentroDe(resolvido, path.win32.resolve(raiz))) {
    return recusa("A pasta de produção não pode ficar na pasta do Connector.");
  }
  return {
    ok: true,
    pronto: false,
    pai: resolvido,
    efetivo,
  };
}

export function payloadEscolherPermitido(corpo) {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    return false;
  }
  return Object.keys(corpo).every((chave) => CHAVES_ESCOLHER.has(chave));
}

export function payloadSalvarPermitido(corpo) {
  if (!corpo || typeof corpo !== "object" || Array.isArray(corpo)) {
    return false;
  }
  const chaves = Object.keys(corpo);
  if (!chaves.every((chave) => CHAVES_SALVAR.has(chave))) {
    return false;
  }
  if (corpo.confirmar !== true) {
    return false;
  }
  const temId = texto(corpo.selecaoId).length > 0;
  const recomendada = corpo.usarRecomendada === true;
  return temId !== recomendada;
}

export function motivoBloqueioPasta(ctx = {}) {
  if (ctx.inicializado === true) {
    return "A biblioteca PayGo está inicializada. A pasta não pode ser alterada agora.";
  }
  if (ctx.emUso === true) {
    return "A biblioteca PayGo está em uso. A pasta não pode ser alterada agora.";
  }
  if (ctx.journalIlegivel === true) {
    return "Não foi possível ler a pendência local. A pasta atual foi mantida.";
  }
  const status = texto(ctx.journal?.status);
  if (
    status === "pagamento_em_andamento" ||
    status === "aguardando_decisao" ||
    status === "resultado_desconhecido"
  ) {
    return "Há uma operação TEF pendente neste computador. A pasta não foi alterada.";
  }
  if (ctx.recuperacao?.sucessoTransacao === true && ctx.recuperacao?.cancelada !== true) {
    return "Há autorização TEF sem confirmação ou em conciliação. A pasta não foi alterada.";
  }
  return "";
}

async function lerRegistro(arquivo, fsApi) {
  try {
    const json = JSON.parse(await fsApi.readFile(arquivo, "utf8"));
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return { versao: 1 };
    }
    return json;
  } catch (erro) {
    if (erro?.code === "ENOENT") {
      return { versao: 1 };
    }
    throw erro;
  }
}

async function gravarRegistro(arquivo, registro, fsApi) {
  await fsApi.mkdir(path.dirname(arquivo), { recursive: true });
  const temporario = `${arquivo}.${process.pid}.tmp`;
  await fsApi.writeFile(temporario, `${JSON.stringify(registro, null, 2)}\n`, "utf8");
  try {
    await fsApi.rename(temporario, arquivo);
  } catch (erro) {
    if (erro?.code !== "EEXIST" && erro?.code !== "EPERM") {
      throw erro;
    }
    const antigo = `${arquivo}.antigo`;
    await fsApi.rename(arquivo, antigo);
    await fsApi.rename(temporario, arquivo);
  }
}

function chaveAmbiente(ambiente) {
  return ambiente === "producao" ? "producao" : "sandbox";
}

function paiConfirmado(registro, ambiente) {
  const slot = registro?.[chaveAmbiente(ambiente)];
  const pai = texto(slot?.pai);
  if (!pai || !slot?.confirmadaEm) {
    return "";
  }
  return pai;
}

export async function diretorioPaiPersistido({
  ambiente,
  arquivo,
  fsApi = fs,
  paiPadrao = "",
} = {}) {
  try {
    const json = JSON.parse(await fsApi.readFile(arquivo, "utf8"));
    const pai = paiConfirmado(json, ambiente);
    if (!pai || (paiPadrao && mesmaPasta(pai, paiPadrao))) {
      return "";
    }
    return pai;
  } catch {
    return "";
  }
}

function arquivoOperacional(relativo) {
  const normal = String(relativo ?? "").replaceAll("/", "\\").toLowerCase();
  const base = path.win32.basename(normal);
  if (!base || normal.includes("\\log\\") || base.endsWith(".log")) {
    return false;
  }
  return base === "certificado.crt" || base === "assinatura.sig" || base.endsWith(".pos");
}

export function auditarAcl(saida) {
  const textoSaida = String(saida ?? "").toLowerCase();
  const ampla = [
    "everyone:(f)",
    "everyone:(m)",
    "everyone:(w)",
    "todos:(f)",
    "todos:(m)",
    "todos:(w)",
    "usuários:(f)",
    "usuarios:(f)",
    "builtin\\users:(f)",
    "users:(f)",
  ];
  if (ampla.some((item) => textoSaida.includes(item))) {
    return {
      ok: false,
      mensagem: "A cópia ficou com permissão ampla. A pasta anterior foi mantida.",
    };
  }
  if (!textoSaida.includes("(f)") && !textoSaida.includes("(m)")) {
    return {
      ok: false,
      mensagem: "A cópia não ficou gravável para o Connector. A pasta anterior foi mantida.",
    };
  }
  return { ok: true, pronto: false };
}

function executarComando(comando, args) {
  return new Promise((resolve, reject) => {
    execFile(comando, args, { windowsHide: true }, (erro, stdout, stderr) => {
      if (erro) {
        reject(erro);
        return;
      }
      resolve(`${stdout ?? ""}\n${stderr ?? ""}`);
    });
  });
}

export async function aplicarAclRestrita(arquivo, executar = executarComando, info) {
  const conta = await resolverContaProcesso(executar, info);
  if (!conta) {
    return {
      ok: false,
      pronto: false,
      mensagem: "Não foi possível identificar o processo do TEF. A pasta anterior foi mantida.",
    };
  }
  try {
    await executar("icacls.exe", [
      arquivo,
      "/inheritance:r",
      "/grant:r",
      "*S-1-5-18:(F)",
      "*S-1-5-32-544:(F)",
      `${conta}:(M)`,
    ]);
    return auditarAcl(await executar("icacls.exe", [arquivo]));
  } catch {
    return {
      ok: false,
      pronto: false,
      mensagem: "Não foi possível restringir a permissão da cópia. A pasta anterior foi mantida.",
    };
  }
}

export const SID_SISTEMA = "S-1-5-18";
export const SID_ADMINISTRADORES = "S-1-5-32-544";
export const SID_INTERATIVO = "S-1-5-4";

export function entradasAclDiretorio(conta = "") {
  const entradas = [
    `*${SID_SISTEMA}:(OI)(CI)(F)`,
    `*${SID_ADMINISTRADORES}:(OI)(CI)(F)`,
    `*${SID_INTERATIVO}:(OI)(CI)(M)`,
  ];
  if (conta) {
    entradas.push(`${conta}:(OI)(CI)(M)`);
  }
  return entradas;
}

export function aclContemNegacao(saida) {
  return /\(deny\)|\(n\)/iu.test(String(saida ?? ""));
}

export async function aplicarAclDiretorio(diretorio, executar = executarComando, info) {
  const conta = await resolverContaProcesso(executar, info);
  try {
    await executar("icacls.exe", [
      diretorio,
      "/inheritance:r",
      "/grant:r",
      ...entradasAclDiretorio(conta),
    ]);
    return auditarAcl(await executar("icacls.exe", [diretorio]));
  } catch {
    return {
      ok: false,
      pronto: false,
      mensagem: "Não foi possível restringir a permissão da pasta. Nenhum arquivo existente foi apagado.",
    };
  }
}

export async function concederAcessoProcesso(diretorio, executar = executarComando, info) {
  const conta = await resolverContaProcesso(executar, info);
  try {
    await executar("icacls.exe", [
      diretorio,
      "/grant",
      ...entradasAclDiretorio(conta),
    ]);
    const saida = await executar("icacls.exe", [diretorio]);
    const ampla = auditarAcl(saida);
    if (!ampla.ok && /everyone|todos/u.test(String(saida).toLowerCase())) {
      return {
        ok: false,
        pronto: false,
        mensagem: "A pasta operacional ficou com permissão ampla. Nenhum arquivo existente foi apagado.",
      };
    }
    return { ok: true, pronto: false };
  } catch {
    return {
      ok: false,
      pronto: false,
      mensagem: "Não foi possível conceder acesso ao processo do TEF. Nenhum arquivo existente foi apagado.",
    };
  }
}

export async function avaliarMigracao(origem, destino, fsApi = fs, ambiente = "producao") {
  if (ambiente !== "producao") {
    return {
      ok: true,
      pronto: false,
      copiar: [],
      iguais: [],
      conflitos: [],
      semInstalacao: true,
      homologacaoPreservada: true,
    };
  }
  if (mesmaPasta(origem, destino)) {
    return { ok: true, pronto: false, copiar: [], iguais: [], conflitos: [], semInstalacao: true };
  }
  const arquivos = await listarArquivos(origem, fsApi);
  const operacionais = arquivos.filter((item) => arquivoOperacional(path.win32.relative(origem, item)));
  if (operacionais.length === 0) {
    return { ok: true, pronto: false, copiar: [], iguais: [], conflitos: [], semInstalacao: true };
  }
  const temCertificado = operacionais.some(
    (item) => path.win32.basename(item).toLowerCase() === "certificado.crt"
  );
  const temPos = operacionais.some((item) => item.toLowerCase().endsWith(".pos"));
  if (ambiente === "producao" && temPos && !temCertificado) {
    return recusa(
      "A instalação atual não tem certificado.crt. A troca foi interrompida e o PayGo não foi reinstalado.",
      "migracao"
    );
  }
  const copiar = [];
  const iguais = [];
  const conflitos = [];
  for (const arquivo of operacionais) {
    const relativo = path.win32.relative(origem, arquivo);
    if (!relativo || relativo.startsWith("..") || path.win32.isAbsolute(relativo)) {
      return recusa("A instalação atual tem um caminho que não pode ser copiado. A pasta anterior foi mantida.", "migracao");
    }
    let origemHash;
    try {
      origemHash = await hashArquivo(arquivo, fsApi);
    } catch {
      return recusa(
        "Não foi possível ler os arquivos da instalação atual. A pasta anterior foi mantida.",
        "migracao"
      );
    }
    const alvo = path.join(destino, relativo);
    let destinoExiste = true;
    try {
      await fsApi.access(alvo);
    } catch (erro) {
      if (erro?.code === "ENOENT") {
        destinoExiste = false;
      } else {
        return recusa("Não foi possível verificar a pasta nova. A pasta anterior foi mantida.", "migracao");
      }
    }
    if (!destinoExiste) {
      copiar.push({ arquivo, alvo, relativo });
      continue;
    }
    try {
      const destinoHash = await hashArquivo(alvo, fsApi);
      if (destinoHash !== origemHash) {
        conflitos.push(relativo);
      } else {
        iguais.push(relativo);
      }
    } catch {
      return recusa("Não foi possível ler um arquivo da pasta nova. A pasta anterior foi mantida.", "migracao");
    }
  }
  if (conflitos.length > 0) {
    return {
      ok: false,
      pronto: false,
      codigo: "conflito",
      mensagem: `A pasta nova já tem arquivos diferentes (${conflitos.slice(0, 3).join(", ")}). A troca foi interrompida e nada foi reinstalado.`,
      conflitos,
      copiar: [],
    };
  }
  return { ok: true, pronto: false, copiar, iguais, conflitos, semInstalacao: false };
}

async function desfazerCopias(criados, fsApi) {
  for (const arquivo of [...criados].reverse()) {
    await fsApi.unlink(arquivo).catch(() => {});
  }
}

export async function aplicarMigracao(plano, fsApi = fs, restringir = aplicarAclRestrita) {
  const criados = [];
  for (const item of plano?.copiar ?? []) {
    try {
      await fsApi.mkdir(path.dirname(item.alvo), { recursive: true });
    } catch {
      await desfazerCopias(criados, fsApi);
      return recusa(
        "Não foi possível criar a pasta da cópia. Nenhum arquivo existente foi apagado.",
        "migracao"
      );
    }
    try {
      await fsApi.access(item.alvo);
      await desfazerCopias(criados, fsApi);
      return recusa(
        "A pasta nova foi alterada durante a cópia. Nenhum arquivo existente foi substituído.",
        "conflito"
      );
    } catch (erro) {
      if (erro?.code !== "ENOENT") {
        await desfazerCopias(criados, fsApi);
        return recusa("Não foi possível verificar a pasta nova. A pasta anterior foi mantida.", "migracao");
      }
    }
    try {
      await fsApi.copyFile(item.arquivo, item.alvo, constantesFs.COPYFILE_EXCL);
    } catch (erro) {
      if (erro?.code !== "EEXIST") {
        await fsApi.unlink(item.alvo).catch(() => {});
      }
      await desfazerCopias(criados, fsApi);
      return recusa(
        erro?.code === "EEXIST"
          ? "A pasta nova foi alterada durante a cópia. Nenhum arquivo existente foi substituído."
          : "Não foi possível copiar os arquivos da instalação. Nenhum arquivo existente foi apagado.",
        erro?.code === "EEXIST" ? "conflito" : "migracao"
      );
    }
    criados.push(item.alvo);
    try {
      const origemHash = await hashArquivo(item.arquivo, fsApi);
      const copiaHash = await hashArquivo(item.alvo, fsApi);
      if (origemHash !== copiaHash) {
        await desfazerCopias(criados, fsApi);
        return recusa("A cópia dos arquivos da instalação não conferiu. A pasta anterior foi mantida.", "migracao");
      }
    } catch {
      await desfazerCopias(criados, fsApi);
      return recusa(
        "Não foi possível conferir a cópia. Nenhum arquivo existente foi apagado.",
        "migracao"
      );
    }
    let acl;
    try {
      acl = await restringir(item.alvo);
    } catch {
      acl = { ok: false };
    }
    if (!acl?.ok) {
      await desfazerCopias(criados, fsApi);
      return {
        ok: false,
        pronto: false,
        codigo: "permissao",
        mensagem:
          acl?.mensagem ||
          "Não foi possível restringir a permissão da cópia. A pasta anterior foi mantida.",
      };
    }
  }
  return { ok: true, pronto: false, arquivos: criados.length, criados };
}

function pedidoPreparado(registro, ambiente) {
  const chave = chaveAmbiente(ambiente);
  const preparada = registro?.ativacao?.[chave];
  if (preparada?.estado === "preparada" && texto(preparada.pai)) {
    return preparada;
  }
  const legado = registro?.[chave];
  if (!registro?.ativacao && texto(legado?.pai) && !legado?.confirmadaEm) {
    return legado;
  }
  return null;
}

export async function planejarDiretorioInicial({
  arquivo,
  fsApi = fs,
  ambiente = "homologacao",
  paiPadrao = "",
  bloqueado = false,
  raizExecutavel = "",
  producaoPai = "",
  sandboxPai = "",
  programFiles = [],
  classificarUnidade = classificarUnidadeWindows,
  restringir = aplicarAclRestrita,
  conceder = concederAcessoProcesso,
  restringirDiretorio = aplicarAclDiretorio,
} = {}) {
  const registro = await lerRegistro(arquivo, fsApi).catch(() => ({ versao: 2 }));
  const confirmado = paiConfirmado(registro, ambiente);
  const diretorioConfirmado =
    confirmado && !(paiPadrao && mesmaPasta(confirmado, paiPadrao)) ? confirmado : "";
  const pedido = pedidoPreparado(registro, ambiente);
  const efetivoRegistrado = texto(registro?.[chaveAmbiente(ambiente)]?.efetivo);
  if (!pedido) {
    return {
      ok: true,
      pronto: false,
      diretorioPai: diretorioConfirmado,
      efetivoEsperado: diretorioConfirmado ? efetivoPgWeb(diretorioConfirmado) : "",
      efetivoRegistrado,
      tentativa: false,
    };
  }
  if (bloqueado) {
    return {
      ok: true,
      pronto: false,
      diretorioPai: diretorioConfirmado,
      efetivoEsperado: diretorioConfirmado ? efetivoPgWeb(diretorioConfirmado) : "",
      efetivoRegistrado,
      tentativa: false,
      adiada: true,
    };
  }
  const tipoUnidade = await classificarUnidade(pedido.pai).catch(() => "desconhecida");
  const validado = validarPastaLocal({
    caminho: pedido.pai,
    ambiente,
    raizExecutavel,
    producaoPai,
    sandboxPai,
    programFiles,
    permitirProgramFilesExato: ambiente !== "producao" && mesmaPasta(pedido.pai, sandboxPai),
    tipoUnidade,
  });
  if (!validado.ok) {
    await registrarResultadoAtivacao({
      arquivo,
      fsApi,
      ambiente,
      solicitado: true,
      efetivoEsperado: efetivoPgWeb(pedido.pai),
      sucesso: false,
      diretorioObservado: "",
      diagnostico: validado.mensagem,
    });
    return validado;
  }
  let criados = [];
  if (ambiente === "producao") {
    const origem = efetivoPgWeb(confirmado || paiPadrao);
    const migracao = await avaliarMigracao(origem, validado.efetivo, fsApi, ambiente);
    if (!migracao.ok) {
      await registrarResultadoAtivacao({
        arquivo,
        fsApi,
        ambiente,
        solicitado: true,
        efetivoEsperado: validado.efetivo,
        sucesso: false,
        diretorioObservado: "",
        diagnostico: migracao.mensagem,
      });
      return migracao;
    }
    const aplicada = await aplicarMigracao(migracao, fsApi, restringir);
    if (!aplicada.ok) {
      await registrarResultadoAtivacao({
        arquivo,
        fsApi,
        ambiente,
        solicitado: true,
        efetivoEsperado: validado.efetivo,
        sucesso: false,
        diretorioObservado: "",
        diagnostico: aplicada.mensagem,
      });
      return aplicada;
    }
    criados = aplicada.criados ?? [];
    const preparado = await prepararDiretoriosOperacionais(validado.efetivo, {
      fsApi,
      ambiente,
      conceder,
      restringirDiretorio,
    });
    if (!preparado.ok) {
      await desfazerCopias(criados, fsApi);
      await registrarResultadoAtivacao({
        arquivo,
        fsApi,
        ambiente,
        solicitado: true,
        efetivoEsperado: validado.efetivo,
        sucesso: false,
        diretorioObservado: "",
        diagnostico: preparado.mensagem,
      });
      return preparado;
    }
    const gravacao = await testarGravacaoOperacional(validado.efetivo, fsApi);
    if (!gravacao.ok) {
      await desfazerCopias(criados, fsApi);
      await registrarResultadoAtivacao({
        arquivo,
        fsApi,
        ambiente,
        solicitado: true,
        efetivoEsperado: validado.efetivo,
        sucesso: false,
        diretorioObservado: "",
        diagnostico: gravacao.mensagem,
      });
      return gravacao;
    }
  }
  const personalizado = !(paiPadrao && mesmaPasta(validado.pai, paiPadrao));
  return {
    ok: true,
    pronto: false,
    diretorioPai: personalizado ? validado.pai : "",
    efetivoEsperado: validado.efetivo,
    tentativa: true,
  };
}

export async function registrarResultadoAtivacao({
  arquivo,
  fsApi = fs,
  ambiente = "homologacao",
  solicitado = false,
  efetivoEsperado = "",
  sucesso = false,
  diretorioObservado = "",
  retornoPwInit = null,
  retornoPwInitNome = "",
  diagnostico = "",
} = {}) {
  if (!solicitado) {
    return { promovida: false };
  }
  const registro = await lerRegistro(arquivo, fsApi).catch(() => ({ versao: 2 }));
  const chave = chaveAmbiente(ambiente);
  const pedido = pedidoPreparado(registro, ambiente) || registro?.ativacao?.[chave];
  const confere = sucesso === true && mesmaPasta(diretorioObservado, efetivoEsperado);
  const proximo = {
    versao: 2,
    producao: registro.producao ?? null,
    sandbox: registro.sandbox ?? null,
    ativacao: { ...(registro.ativacao ?? {}) },
  };
  if (proximo[chave] && !proximo[chave].confirmadaEm) {
    proximo[chave] = null;
  }
  if (confere && pedido?.pai) {
    proximo[chave] = {
      pai: pedido.pai,
      efetivo: efetivoEsperado,
      salvoEm: pedido.salvoEm || new Date().toISOString(),
      confirmadaEm: new Date().toISOString(),
    };
    proximo.ativacao[chave] = null;
    await gravarRegistro(arquivo, proximo, fsApi);
    return { promovida: true, mantida: false };
  }
  proximo.ativacao[chave] = {
    estado: "recusada",
    pai: texto(pedido?.pai),
    efetivo: efetivoEsperado,
    retornoPwInit: Number.isFinite(Number(retornoPwInit)) ? Math.round(Number(retornoPwInit)) : null,
    retornoPwInitNome: texto(retornoPwInitNome),
    diretorioPwInit: texto(diretorioObservado),
    diagnostico:
      texto(diagnostico) ||
      "A biblioteca não confirmou a pasta salva. A configuração anterior foi mantida.",
  };
  await gravarRegistro(arquivo, proximo, fsApi);
  return { promovida: false, mantida: true };
}

export async function verificarSeletorInterativo({
  platform = process.platform,
  windowsHide = false,
  consultarSessao,
} = {}) {
  if (platform !== "win32") {
    return { ok: false, mensagem: "O seletor de pastas do Windows só abre neste computador." };
  }
  if (windowsHide !== false) {
    return { ok: false, mensagem: "O seletor precisa aparecer na sessão de quem está no caixa." };
  }
  const sessao = await consultarSessao();
  if (!sessao?.cscript) {
    return { ok: false, mensagem: "O seletor de pastas do Windows não está disponível." };
  }
  if (!sessao.interativa || Number(sessao.sessao) === 0) {
    return { ok: false, mensagem: "O Connector não está em uma sessão interativa do Windows." };
  }
  return { ok: true, mensagem: "O Connector pode abrir o seletor de pastas nesta sessão." };
}

async function hashArquivo(arquivo, fsApi) {
  const dados = await fsApi.readFile(arquivo);
  return createHash("sha256").update(dados).digest("hex");
}

async function listarArquivos(origem, fsApi) {
  let entradas;
  try {
    entradas = await fsApi.readdir(origem, { withFileTypes: true });
  } catch (erro) {
    if (erro?.code === "ENOENT") {
      return [];
    }
    throw erro;
  }
  const arquivos = [];
  for (const entrada of entradas) {
    const caminho = path.join(origem, entrada.name);
    if (entrada.isSymbolicLink?.()) {
      const erro = new Error("atalho");
      erro.code = "ELOOP";
      throw erro;
    }
    if (entrada.isDirectory()) {
      arquivos.push(...(await listarArquivos(caminho, fsApi)));
    } else if (entrada.isFile()) {
      arquivos.push(caminho);
    }
  }
  return arquivos;
}

export async function copiarBackupIntegro(
  origem,
  destino,
  fsApi = fs,
  restringir = aplicarAclRestrita
) {
  const arquivos = await listarArquivos(origem, fsApi);
  if (arquivos.length === 0) {
    return { ok: true, pronto: false, arquivos: 0, semDados: true, destino: "" };
  }
  await fsApi.mkdir(destino, { recursive: true });
  const copiados = [];
  for (const arquivo of arquivos) {
    const relativo = path.win32.relative(origem, arquivo);
    if (!relativo || relativo.startsWith("..") || path.win32.isAbsolute(relativo)) {
      return recusa("A cópia de segurança foi recusada. A pasta atual foi mantida.");
    }
    const alvo = path.join(destino, relativo);
    try {
      await fsApi.access(alvo);
      const pos = relativo.toLowerCase().endsWith(".pos");
      return recusa(
        pos
          ? "Já existe um arquivo .pos no destino da cópia. Nenhum arquivo foi substituído e a pasta atual foi mantida."
          : "A cópia encontraria um arquivo já existente. A pasta atual foi mantida."
      );
    } catch (erro) {
      if (erro?.code !== "ENOENT") {
        return recusa("Não foi possível verificar a cópia. A pasta atual foi mantida.");
      }
    }
    await fsApi.mkdir(path.dirname(alvo), { recursive: true });
    try {
      await fsApi.copyFile(arquivo, alvo, constantesFs.COPYFILE_EXCL);
    } catch (erro) {
      if (erro?.code !== "EEXIST") {
        await fsApi.unlink(alvo).catch(() => {});
      }
      await desfazerCopias(copiados.map((item) => item.alvo), fsApi);
      return recusa(
        erro?.code === "EEXIST"
          ? "A cópia encontraria um arquivo já existente. A pasta atual foi mantida."
          : "Não foi possível copiar a pasta atual. Nenhum arquivo existente foi apagado."
      );
    }
    const acl = await restringir(alvo);
    if (!acl?.ok) {
      await desfazerCopias([...copiados.map((item) => item.alvo), alvo], fsApi);
      return {
        ok: false,
        pronto: false,
        codigo: "permissao",
        mensagem: acl?.mensagem || "Não foi possível restringir a permissão da cópia. A pasta anterior foi mantida.",
      };
    }
    copiados.push({ arquivo, alvo });
  }
  for (const item of copiados) {
    try {
      const origemHash = await hashArquivo(item.arquivo, fsApi);
      const copiaHash = await hashArquivo(item.alvo, fsApi);
      if (origemHash !== copiaHash) {
        await desfazerCopias(copiados.map((copiado) => copiado.alvo), fsApi);
        return recusa("A cópia de segurança não conferiu. A pasta atual foi mantida.");
      }
    } catch {
      await desfazerCopias(copiados.map((copiado) => copiado.alvo), fsApi);
      return recusa("Não foi possível conferir a cópia de segurança. Nenhum arquivo existente foi apagado.");
    }
  }
  return {
    ok: true,
    pronto: false,
    arquivos: copiados.length,
    semDados: false,
    destino,
  };
}

export async function testarGravacaoPasta(pasta, fsApi = fs) {
  const nome = `.ultrapdv-teste-${randomUUID()}.tmp`;
  const arquivo = path.join(pasta, nome);
  const renomeado = path.join(pasta, `${nome}.ok`);
  try {
    let existe = false;
    if (typeof fsApi.access === "function") {
      try {
        await fsApi.access(pasta);
        existe = true;
      } catch (erro) {
        if (erro?.code !== "ENOENT") {
          throw erro;
        }
      }
    }
    if (!existe && typeof fsApi.mkdir === "function") {
      await fsApi.mkdir(pasta);
    }
    await fsApi.writeFile(arquivo, "ultrapdv", "utf8");
    const lido = await fsApi.readFile(arquivo, "utf8");
    if (lido !== "ultrapdv") {
      const erro = new Error("leitura");
      erro.code = "EIO";
      throw erro;
    }
    await fsApi.rename(arquivo, renomeado);
    const depois = await fsApi.readFile(renomeado, "utf8");
    if (depois !== "ultrapdv") {
      const erro = new Error("renome");
      erro.code = "EIO";
      throw erro;
    }
    await fsApi.unlink(renomeado);
    return { ok: true, pronto: false };
  } catch (erro) {
    await fsApi.unlink(arquivo).catch(() => {});
    await fsApi.unlink(renomeado).catch(() => {});
    const falha = classificarFalhaArquivo(erro);
    return { ok: false, pronto: false, ...falha };
  }
}

export function rotuloOperacional(efetivo, pasta) {
  const relativo = path.win32.relative(
    path.win32.normalize(texto(efetivo)),
    path.win32.normalize(texto(pasta))
  );
  if (!relativo || relativo === ".") {
    return "PGWeb";
  }
  return path.win32.join("PGWeb", relativo);
}

function codigoErroFs(erro) {
  const codigo = texto(erro?.code).toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,31}$/u.test(codigo) ? codigo : "DESCONHECIDO";
}

export function diagnosticoPreparacao(efetivo, pasta, operacao, erro, saidaAcl = "") {
  const rotulo = rotuloOperacional(efetivo, pasta);
  const codigoFs = codigoErroFs(erro);
  const caminho = path.win32.normalize(texto(pasta)).replace(/[\u0000\r\n]/g, "");
  const negacao = aclContemNegacao(saidaAcl)
    ? " Há uma permissão de negação que não foi removida."
    : "";
  const intervencao =
    codigoFs === "EACCES" || codigoFs === "EPERM"
      ? " A permissão existente impediu a correção automática. É necessária intervenção administrativa."
      : "";
  return {
    ok: false,
    pronto: false,
    codigo: codigoFs === "EBUSY" || codigoFs === "ELOCKED" ? "bloqueio" : "permissao",
    operacao,
    codigoErro: codigoFs,
    pasta: caminho,
    mensagem: `Não foi possível preparar ${rotulo} (${operacao}, ${codigoFs}). Caminho: ${caminho}.${negacao}${intervencao} Nenhum arquivo existente foi apagado.`,
  };
}

async function leituraAcl(pasta, listarAcl) {
  if (!listarAcl) {
    return "";
  }
  try {
    return String(await listarAcl(pasta) ?? "");
  } catch {
    return "";
  }
}

export async function validarPastaConfirmada({
  pai,
  efetivoEsperado = "",
  efetivoRegistrado = "",
  fsApi = fs,
} = {}) {
  const base = path.win32.normalize(texto(pai));
  const efetivo = efetivoPgWeb(base);
  const registrado = texto(efetivoRegistrado);
  if (
    !base ||
    (efetivoEsperado && !mesmaPasta(efetivo, efetivoEsperado)) ||
    (registrado && !mesmaPasta(efetivo, registrado))
  ) {
    return {
      ok: false,
      pronto: false,
      codigo: "caminho",
      mensagem:
        "A validação do Connector recusou a pasta confirmada: o caminho salvo não corresponde à estrutura PGWeb. A PGWebLib não foi chamada. Nenhum arquivo existente foi apagado.",
    };
  }
  for (const pasta of diretoriosOperacionais(efetivo)) {
    const rotulo = rotuloOperacional(efetivo, pasta);
    try {
      await fsApi.access(pasta);
      if (typeof fsApi.stat === "function") {
        const info = await fsApi.stat(pasta);
        if (typeof info?.isDirectory === "function" && !info.isDirectory()) {
          return {
            ok: false,
            pronto: false,
            codigo: "integridade",
            operacao: "stat",
            pasta,
            mensagem: `A validação do Connector encontrou ${rotulo}, mas esse caminho não é uma pasta. A PGWebLib não foi chamada. Nenhum arquivo existente foi apagado.`,
          };
        }
      }
    } catch (erro) {
      if (erro?.code === "ENOENT") {
        return {
          ok: false,
          pronto: false,
          codigo: "integridade",
          operacao: "access",
          codigoErro: "ENOENT",
          pasta,
          mensagem: `A validação do Connector não encontrou ${rotulo}. A PGWebLib não foi chamada. Nenhum arquivo existente foi apagado.`,
        };
      }
      const codigoFs = codigoErroFs(erro);
      return {
        ok: false,
        pronto: false,
        codigo: codigoFs === "EACCES" || codigoFs === "EPERM" ? "permissao" : "bloqueio",
        operacao: "access",
        codigoErro: codigoFs,
        pasta,
        mensagem: `A validação do Connector não conseguiu ler ${rotulo} (access, ${codigoFs}). A PGWebLib não foi chamada. Nenhum arquivo existente foi apagado.`,
      };
    }
  }
  return { ok: true, pronto: false, preservada: true, diretorioPai: base, efetivo };
}

export async function testarGravacaoOperacional(efetivo, fsApi = fs) {
  for (const pasta of diretoriosOperacionais(efetivo)) {
    let existia = false;
    try {
      existia = await diretorioExiste(pasta, fsApi);
    } catch (erro) {
      const falha = classificarFalhaArquivo(erro);
      return {
        ok: false,
        pronto: false,
        ...falha,
        operacao: "access",
        codigoErro: codigoErroFs(erro),
        pasta,
        mensagem: `${falha.mensagem} A verificação falhou em ${rotuloOperacional(efetivo, pasta)} (access, ${codigoErroFs(erro)}).`,
      };
    }
    if (!existia) {
      try {
        await fsApi.mkdir(pasta);
      } catch (erro) {
        if (erro?.code !== "EEXIST") {
          const falha = classificarFalhaArquivo(erro);
          return {
            ok: false,
            pronto: false,
            ...falha,
            operacao: "mkdir",
            codigoErro: codigoErroFs(erro),
            pasta,
            mensagem: `${falha.mensagem} A verificação falhou em ${rotuloOperacional(efetivo, pasta)} (mkdir, ${codigoErroFs(erro)}).`,
          };
        }
      }
    }
    const resultado = await testarGravacaoPasta(pasta, fsApi);
    if (!resultado.ok) {
      return {
        ...resultado,
        pasta,
        mensagem: `${resultado.mensagem} A verificação falhou em ${rotuloOperacional(efetivo, pasta)}.`,
      };
    }
  }
  return { ok: true, pronto: false };
}

async function diretorioExiste(pasta, fsApi) {
  try {
    await fsApi.access(pasta);
    return true;
  } catch (erro) {
    if (erro?.code === "ENOENT") {
      return false;
    }
    throw erro;
  }
}

export async function prepararDiretoriosOperacionais(
  efetivo,
  {
    fsApi = fs,
    ambiente = "producao",
    conceder = concederAcessoProcesso,
    restringirDiretorio = aplicarAclDiretorio,
    listarAcl = null,
  } = {}
) {
  if (ambiente !== "producao") {
    return { ok: true, pronto: false, preservada: true };
  }
  for (const pasta of diretoriosOperacionais(efetivo)) {
    let existia = false;
    try {
      existia = await diretorioExiste(pasta, fsApi);
    } catch (erro) {
      return diagnosticoPreparacao(
        efetivo,
        pasta,
        "access",
        erro,
        await leituraAcl(pasta, listarAcl)
      );
    }
    if (!existia) {
      try {
        await fsApi.mkdir(pasta);
      } catch (erro) {
        if (erro?.code === "EEXIST") {
          existia = true;
        } else {
          return diagnosticoPreparacao(
            efetivo,
            pasta,
            "mkdir",
            erro,
            await leituraAcl(pasta, listarAcl)
          );
        }
      }
    }
    const acl = existia ? await conceder(pasta) : await restringirDiretorio(pasta);
    if (!acl?.ok) {
      return {
        ok: false,
        pronto: false,
        codigo: "permissao",
        mensagem:
          acl?.mensagem ||
          "Não foi possível preparar o acesso do processo do TEF. Nenhum arquivo existente foi apagado.",
      };
    }
  }
  return { ok: true, pronto: false };
}

export async function instalarPastaPadrao({
  pai,
  fsApi = fs,
  ambiente = "producao",
  conceder = concederAcessoProcesso,
  restringirDiretorio = aplicarAclDiretorio,
  listarAcl = null,
} = {}) {
  if (ambiente !== "producao") {
    return { ok: true, pronto: false, preservada: true, diretorioPai: "" };
  }
  const base = path.win32.normalize(texto(pai));
  const efetivo = efetivoPgWeb(base);
  let paiExiste = false;
  try {
    paiExiste = await diretorioExiste(base, fsApi);
  } catch (erro) {
    return diagnosticoPreparacao(efetivo, base, "access", erro, await leituraAcl(base, listarAcl));
  }
  if (!paiExiste) {
    try {
      await fsApi.mkdir(base, { recursive: true });
    } catch (erro) {
      return diagnosticoPreparacao(efetivo, base, "mkdir", erro, await leituraAcl(base, listarAcl));
    }
  }
  const preparado = await prepararDiretoriosOperacionais(efetivo, {
    fsApi,
    ambiente,
    conceder,
    restringirDiretorio,
    listarAcl,
  });
  if (!preparado.ok) {
    return preparado;
  }
  const gravacao = await testarGravacaoOperacional(efetivo, fsApi);
  if (!gravacao.ok) {
    return gravacao;
  }
  return { ok: true, pronto: false, diretorioPai: base, efetivo };
}

function basesDoAmbiente(deps, ambiente) {
  const producao = texto(deps.producaoPai) || path.win32.dirname(diretorioProducaoPgWeb(deps.env));
  const sandbox =
    texto(deps.sandboxPai) ||
    path.win32.resolve(texto(deps.raizExecutavel), "TEF");
  return {
    producaoPai: producao,
    sandboxPai: sandbox,
    recomendada: ambiente === "producao" ? producao : sandbox,
  };
}

export function criarServicoPastaTef(deps = {}) {
  const fsApi = deps.fsApi ?? fs;
  const arquivo = deps.arquivo ?? arquivoPastaTef(deps.env);
  const selecoes = new Map();
  let dialogoAberto = false;

  async function tipoDaUnidade(caminho) {
    if (deps.classificarUnidade) {
      return deps.classificarUnidade(caminho);
    }
    const letra = caminho.slice(0, 2);
    const saida = await new Promise((resolve, reject) => {
      const filho = spawn("fsutil.exe", ["fsinfo", "drivetype", letra], {
        windowsHide: true,
      });
      let textoSaida = "";
      filho.stdout?.on("data", (parte) => {
        textoSaida += parte.toString("utf8");
      });
      filho.on("error", reject);
      filho.on("close", (code) => {
        if (code === 0) {
          resolve(textoSaida);
        } else {
          reject(new Error("unidade"));
        }
      });
    });
    return classificarUnidadePorTexto(saida);
  }

  async function validar(caminho, ambiente, opcoes = {}) {
    let tipoUnidade = "desconhecida";
    try {
      tipoUnidade = await tipoDaUnidade(caminho);
    } catch {
      tipoUnidade = "desconhecida";
    }
    const bases = basesDoAmbiente(deps, ambiente);
    return validarPastaLocal({
      caminho,
      ambiente,
      raizExecutavel: deps.raizExecutavel,
      producaoPai: bases.producaoPai,
      sandboxPai: bases.sandboxPai,
      programFiles: deps.programFiles ?? [
        process.env.ProgramFiles,
        process.env["ProgramFiles(x86)"],
      ],
      permitirProgramFilesExato: opcoes.recomendada === true && ambiente !== "producao",
      tipoUnidade,
    });
  }

  function guardar(caminho, ambiente) {
    const selecaoId = randomUUID();
    selecoes.set(selecaoId, {
      pai: caminho.pai,
      efetivo: caminho.efetivo,
      ambiente,
      expira: Date.now() + 10 * 60 * 1000,
    });
    return selecaoId;
  }

  function lerSelecao(selecaoId, ambiente) {
    const item = selecoes.get(texto(selecaoId));
    if (!item || item.ambiente !== ambiente || item.expira < Date.now()) {
      return null;
    }
    return item;
  }

  async function consultar(ctx) {
    const registro = await lerRegistro(arquivo, fsApi).catch(() => ({ versao: 1, ilegivel: true }));
    const chave = ctx.ambiente === "producao" ? "producao" : "sandbox";
    const bases = basesDoAmbiente(deps, ctx.ambiente);
    const salva = paiConfirmado(registro, ctx.ambiente);
    const preparada = registro?.ativacao?.[chave]?.estado === "preparada"
      ? registro.ativacao[chave]
      : null;
    const recusada = registro?.ativacao?.[chave]?.estado === "recusada"
      ? registro.ativacao[chave]
      : null;
    const bloqueio = motivoBloqueioPasta(ctx);
    return {
      ok: true,
      pronto: false,
      ambiente: ctx.ambiente,
      atual: salva
        ? { pai: salva, efetivo: efetivoPgWeb(salva) }
        : { pai: bases.recomendada, efetivo: efetivoPgWeb(bases.recomendada), padrao: true },
      recomendada: {
        pai: bases.recomendada,
        efetivo: efetivoPgWeb(bases.recomendada),
      },
      preparada: preparada
        ? { pai: texto(preparada.pai), efetivo: texto(preparada.efetivo) || efetivoPgWeb(preparada.pai) }
        : null,
      falha: recusada
        ? {
            mensagem: texto(recusada.diagnostico),
            retornoPwInit: descreverRetornoPwInit(recusada.retornoPwInit, recusada.retornoPwInitNome),
            diretorioPwInit: texto(recusada.diretorioPwInit),
          }
        : null,
      agente: {
        diretorioTrabalho: texto(ctx.diretorioTrabalho),
        diretorioPwInit: texto(ctx.diretorioPwInit),
        retornoPwInit: descreverRetornoPwInit(ctx.retornoPwInit, ctx.retornoPwInitNome),
      },
      bloqueio: bloqueio
        ? { bloqueado: true, mensagem: bloqueio }
        : { bloqueado: false, mensagem: "" },
      ilegivel: registro.ilegivel === true,
    };
  }

  async function escolher(ctx, corpo) {
    if (!payloadEscolherPermitido(corpo)) {
      return recusa("A pasta precisa ser escolhida neste computador.", "payload");
    }
    const bloqueio = motivoBloqueioPasta(ctx);
    if (bloqueio) {
      return recusa(bloqueio, "bloqueado");
    }
    if (dialogoAberto) {
      return recusa("O seletor de pastas já está aberto.", "dialogo");
    }
    dialogoAberto = true;
    let escolhido;
    try {
      const abrir = deps.abrirSeletor ?? abrirSeletorNativo;
      escolhido = await abrir();
    } catch {
      return recusa("Não foi possível abrir o seletor de pastas do Windows.", "dialogo");
    } finally {
      dialogoAberto = false;
    }
    if (escolhido?.cancelado) {
      return {
        ok: true,
        pronto: false,
        cancelado: true,
        mensagem: "Nenhuma pasta foi escolhida.",
      };
    }
    const validado = await validar(texto(escolhido?.caminho), ctx.ambiente);
    if (!validado.ok) {
      return validado;
    }
    const selecaoId = guardar(validado, ctx.ambiente);
    return {
      ok: true,
      pronto: false,
      cancelado: false,
      selecaoId,
      pai: validado.pai,
      efetivo: validado.efetivo,
      mensagem:
        "Pasta escolhida. A biblioteca usa a subpasta PGWeb dentro dela. Nada foi salvo ainda.",
    };
  }

  async function recomendada(ctx, corpo) {
    if (!payloadEscolherPermitido(corpo)) {
      return recusa("A pasta recomendada é definida neste computador.", "payload");
    }
    const bloqueio = motivoBloqueioPasta(ctx);
    if (bloqueio) {
      return recusa(bloqueio, "bloqueado");
    }
    const bases = basesDoAmbiente(deps, ctx.ambiente);
    const validado = await validar(bases.recomendada, ctx.ambiente, { recomendada: true });
    if (!validado.ok) {
      return validado;
    }
    const selecaoId = guardar(validado, ctx.ambiente);
    return {
      ok: true,
      pronto: false,
      selecaoId,
      pai: validado.pai,
      efetivo: validado.efetivo,
      mensagem: "Pasta recomendada selecionada. Nada foi salvo ainda.",
    };
  }

  async function salvar(ctx, corpo) {
    if (!payloadSalvarPermitido(corpo)) {
      return recusa("Confirme a pasta escolhida neste computador.", "payload");
    }
    const bloqueio = motivoBloqueioPasta(ctx);
    if (bloqueio) {
      return recusa(bloqueio, "bloqueado");
    }
    const bases = basesDoAmbiente(deps, ctx.ambiente);
    const candidata = corpo.usarRecomendada
      ? null
      : lerSelecao(corpo.selecaoId, ctx.ambiente);
    const paiInformado = corpo.usarRecomendada ? bases.recomendada : candidata?.pai;
    if (!paiInformado) {
      return recusa("Escolha a pasta de novo antes de salvar.", "selecao");
    }
    const validado = await validar(paiInformado, ctx.ambiente, {
      recomendada: corpo.usarRecomendada === true,
    });
    if (!validado.ok) {
      return validado;
    }
    if (candidata && !mesmaPasta(validado.pai, candidata.pai)) {
      return recusa("A pasta confirmada não confere com a escolha.", "selecao");
    }
    let registro;
    try {
      registro = await lerRegistro(arquivo, fsApi);
    } catch {
      return recusa(
        "Não foi possível ler a pasta salva. A pasta atual foi mantida.",
        "interno"
      );
    }
    const chave = ctx.ambiente === "producao" ? "producao" : "sandbox";
    const confirmado = paiConfirmado(registro, ctx.ambiente);
    const anterior = confirmado || bases.recomendada;
    let backup = { ok: true, pronto: false, arquivos: 0, semDados: true, destino: "" };
    if (!mesmaPasta(anterior, validado.pai)) {
      const origem = efetivoPgWeb(anterior);
      const carimbo = deps.carimbo ?? new Date().toISOString().replace(/[:.]/g, "-");
      const destino = deps.destinoBackup ?? pastaBackupTef(deps.env, carimbo);
      backup = await copiarBackupIntegro(origem, destino, fsApi, deps.restringir ?? aplicarAclRestrita);
      if (!backup.ok) {
        return { ...backup, mantida: true };
      }
      if (ctx.ambiente === "producao") {
        const migracao = await avaliarMigracao(origem, validado.efetivo, fsApi, ctx.ambiente);
        if (!migracao.ok) {
          return { ...migracao, mantida: true };
        }
      }
    }
    const gravacao =
      ctx.ambiente === "producao"
        ? await (async () => {
            const preparado = await prepararDiretoriosOperacionais(validado.efetivo, {
              fsApi,
              ambiente: "producao",
              conceder: deps.conceder ?? concederAcessoProcesso,
              restringirDiretorio: deps.restringir ?? aplicarAclDiretorio,
            });
            if (!preparado.ok) {
              return preparado;
            }
            return testarGravacaoOperacional(validado.efetivo, fsApi);
          })()
        : await testarGravacaoPasta(validado.efetivo, fsApi);
    if (!gravacao.ok) {
      return { ...gravacao, mantida: true };
    }
    const proximo = {
      versao: 2,
      producao: registro.producao?.confirmadaEm ? registro.producao : null,
      sandbox: registro.sandbox?.confirmadaEm ? registro.sandbox : null,
      ativacao: { ...(registro.ativacao ?? {}) },
    };
    proximo.ativacao[chave] = mesmaPasta(confirmado, validado.pai)
      ? null
      : {
          estado: "preparada",
          pai: validado.pai,
          efetivo: validado.efetivo,
          salvoEm: new Date().toISOString(),
        };
    await gravarRegistro(arquivo, proximo, fsApi);
    if (candidata) {
      selecoes.delete(texto(corpo.selecaoId));
    }
    return {
      ok: true,
      pronto: false,
      pai: validado.pai,
      efetivo: validado.efetivo,
      backup,
      mantida: false,
      mensagem:
        "Pasta salva. Ela será ativada na próxima inicialização, se os arquivos conferirem. O TEF não foi marcado como pronto.",
    };
  }

  return { consultar, escolher, recomendada, salvar };
}

export function abrirSeletorNativo() {
  return new Promise((resolve, reject) => {
    const arquivo = path.join(
      process.env.TEMP || process.env.TMP || ".",
      `ultrapdv-pasta-${randomUUID()}.vbs`
    );
    fs.writeFile(arquivo, SCRIPT_SELETOR_PASTA, "utf8")
      .then(() => {
        const filho = spawn("cscript.exe", ["//nologo", arquivo], {
          windowsHide: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let saida = "";
        filho.stdout.on("data", (parte) => {
          saida += parte.toString("utf8");
        });
        filho.on("error", (erro) => {
          fs.unlink(arquivo).catch(() => {});
          reject(erro);
        });
        filho.on("close", (code) => {
          fs.unlink(arquivo).catch(() => {});
          if (code === 2) {
            resolve({ cancelado: true });
            return;
          }
          if (code === 0 && saida.trim()) {
            resolve({ cancelado: false, caminho: saida.trim() });
            return;
          }
          reject(new Error("Não foi possível abrir o seletor de pastas do Windows."));
        });
      })
      .catch(reject);
  });
}
