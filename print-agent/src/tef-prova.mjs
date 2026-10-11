import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { pastaConfigMaquina } from "./config-local.mjs";

export function arquivoChaveTef(env = process.env) {
  return path.join(pastaConfigMaquina(env), "tef-chave.json");
}

function campo(valor) {
  return String(valor ?? "").trim().replace(/[\r\n]/g, "");
}

function digitos(valor) {
  return campo(valor).replace(/\D/g, "");
}

export function dadosFiscaisProvaTef(resultado) {
  const nomePadrao = campo(resultado?.nomeBandeiraPadrao);
  const nomeCartao = campo(resultado?.nomeCartao);
  const rede = campo(resultado?.rede);
  const bandeiraAcbr = campo(resultado?.bandeira);
  let bandeira = nomePadrao || nomeCartao;
  if (!bandeira && bandeiraAcbr && bandeiraAcbr.toUpperCase() !== rede.toUpperCase()) {
    bandeira = bandeiraAcbr;
  }
  return {
    bandeira,
    cnpjCredenciadora: digitos(resultado?.cnpjCredenciadora),
    cnpjRecebedor: digitos(resultado?.cnpjRecebedor),
    instituicao: campo(resultado?.instituicao),
  };
}

export function mensagemProvaTef(campos) {
  const linhas = [
    "ultrapdv-tef-v1",
    campo(campos.acao),
    campo(campos.desafio),
    campo(campos.identificador),
    String(Math.round(Number(campos.valorCentavos) || 0)),
    campo(campos.nsu),
    campo(campos.autorizacao),
    campo(campos.rede),
    campo(campos.finalizacao),
    campos.sucesso ? "1" : "0",
    campo(campos.codigo),
  ];
  if (campos.acao === "pagamento") {
    linhas.push(
      campo(campos.bandeira),
      digitos(campos.cnpjCredenciadora),
      digitos(campos.cnpjRecebedor),
      campo(campos.instituicao)
    );
  }
  return linhas.join("\n");
}

export function gerarChaveTef() {
  const par = generateKeyPairSync("ed25519");
  return {
    id: randomUUID(),
    publica: par.publicKey.export({ type: "spki", format: "pem" }).toString(),
    privada: par.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

export function hashCodigoPareamento(codigo) {
  return createHash("sha256").update(String(codigo ?? "").trim().toUpperCase()).digest("hex");
}

export function assinarPareamentoTef(chavePrivadaPem, codigoHash, dispositivoId) {
  return assinarProvaTef(chavePrivadaPem, {
    acao: "pareamento",
    desafio: codigoHash,
    identificador: dispositivoId,
    valorCentavos: 0,
    nsu: "",
    autorizacao: "",
    rede: "",
    finalizacao: "",
    sucesso: true,
    codigo: "",
  });
}

export function assinarProvaTef(chavePrivadaPem, campos) {
  return sign(
    null,
    Buffer.from(mensagemProvaTef(campos)),
    createPrivateKey(chavePrivadaPem)
  ).toString("base64");
}

export function assinarIdentidadeTef(chavePrivadaPem, dispositivoId) {
  return assinarProvaTef(chavePrivadaPem, {
    acao: "identidade",
    desafio: "",
    identificador: dispositivoId,
    valorCentavos: 0,
    nsu: "",
    autorizacao: "",
    rede: "",
    finalizacao: "",
    sucesso: true,
    codigo: "",
  });
}

export async function lerOuCriarChaveTef(arquivo, fsApi = fs) {
  try {
    const bruto = await fsApi.readFile(arquivo, "utf8");
    const json = JSON.parse(bruto);
    if (!json?.publica || !json?.privada) {
      throw new Error("Chave TEF ilegível.");
    }
    createPublicKey(json.publica);
    createPrivateKey(json.privada);
    const id = json.id || randomUUID();
    if (!json.id) {
      await fsApi.writeFile(
        arquivo,
        JSON.stringify({ id, publica: json.publica, privada: json.privada }),
        { encoding: "utf8", mode: 0o600 }
      );
    }
    return { id, publica: json.publica, privada: json.privada };
  } catch (erro) {
    if (erro?.code !== "ENOENT") {
      throw erro;
    }
  }
  const gerada = gerarChaveTef();
  await fsApi.mkdir(path.dirname(arquivo), { recursive: true });
  const temporario = `${arquivo}.${process.pid}.tmp`;
  await fsApi.writeFile(temporario, JSON.stringify(gerada), { encoding: "utf8", mode: 0o600 });
  try {
    await fsApi.rename(temporario, arquivo);
  } catch {
    await fsApi.writeFile(arquivo, JSON.stringify(gerada), { encoding: "utf8", mode: 0o600 });
    await fsApi.unlink(temporario).catch(() => {});
  }
  return gerada;
}

const ID_EVIDENCIA =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PONTO_EVIDENCIA = /^[A-Za-z0-9._-]{1,40}$/;

function identificadorEvidencia(valor) {
  const texto = campo(valor).toLowerCase();
  return ID_EVIDENCIA.test(texto) ? texto : "";
}

/**
 * Mensagem exclusiva da instalação controlada.
 * Manter o texto idêntico a lib/pdv/tef/evidencia-instalacao.ts.
 * Não chama PW_iSetEnvironment, PWOPER_INSTALL nem PW_iInit.
 */
export function mensagemEvidenciaInstalacao(campos) {
  return [
    "ultrapdv-tef-instalacao-v1",
    campo(campos.empresaId).toLowerCase(),
    campo(campos.dispositivoId).toLowerCase(),
    campo(campos.terminalId).toLowerCase(),
    campo(campos.pontoCaptura),
    campo(campos.estabelecimento),
    campo(campos.ambiente),
    campo(campos.instalacaoId).toLowerCase(),
    "1",
    "0",
    "1",
    "1",
  ].join("\n");
}

export function avaliarEmissaoEvidencia(observacao) {
  const empresaId = identificadorEvidencia(observacao?.empresaId);
  const dispositivoId = identificadorEvidencia(observacao?.dispositivoId);
  const terminalId = identificadorEvidencia(observacao?.terminalId);
  const instalacaoId = identificadorEvidencia(observacao?.instalacaoId);
  const pontoCaptura = campo(observacao?.pontoCaptura);
  const pontoInstalado = campo(observacao?.pontoInstalado);
  const estabelecimento = campo(observacao?.estabelecimento);
  const ambienteSolicitado =
    observacao?.ambienteSolicitado === "homologacao" || observacao?.ambienteSolicitado === "producao"
      ? observacao.ambienteSolicitado
      : "";
  if (!empresaId || !dispositivoId || !terminalId || !instalacaoId) {
    return { ok: false, motivo: "Os identificadores da instalação estão incompletos." };
  }
  if (!PONTO_EVIDENCIA.test(pontoCaptura)) {
    return { ok: false, motivo: "O ponto de captura da instalação é inválido." };
  }
  if (estabelecimento.length < 1 || estabelecimento.length > 40) {
    return { ok: false, motivo: "O estabelecimento da instalação é inválido." };
  }
  if (!ambienteSolicitado) {
    return { ok: false, motivo: "O ambiente solicitado da instalação é inválido." };
  }
  if (observacao?.vinculoAutorizado !== true) {
    return { ok: false, motivo: "Empresa, dispositivo e terminal ainda não estavam autorizados." };
  }
  if (observacao?.pontoNaoExistia !== true) {
    return { ok: false, motivo: "O ponto de captura já existia antes desta instalação." };
  }
  if (observacao?.retornoSetEnvironment !== 0) {
    return { ok: false, motivo: "PW_iSetEnvironment não retornou sucesso para o ambiente solicitado." };
  }
  if (observacao?.instalacaoConcluida !== true) {
    return { ok: false, motivo: "PWOPER_INSTALL não concluiu para este ponto." };
  }
  if (pontoInstalado !== pontoCaptura) {
    return { ok: false, motivo: "O ponto instalado diverge do ponto solicitado." };
  }
  return {
    ok: true,
    campos: {
      empresaId,
      dispositivoId,
      terminalId,
      pontoCaptura,
      estabelecimento,
      ambiente: ambienteSolicitado,
      instalacaoId,
    },
  };
}

export function assinarEvidenciaInstalacao(chavePrivadaPem, observacao) {
  const emissao = avaliarEmissaoEvidencia(observacao);
  if (!emissao.ok) {
    return null;
  }
  return {
    campos: emissao.campos,
    assinatura: sign(
      null,
      Buffer.from(mensagemEvidenciaInstalacao(emissao.campos)),
      createPrivateKey(chavePrivadaPem)
    ).toString("base64"),
  };
}

export function camposProvaDoResultado({ acao, desafio, identificador, valorReais, resultado, codigo }) {
  const valor = Number(resultado?.valor);
  const centavos = Number.isFinite(valor)
    ? Math.round(valor * 100)
    : Math.round(Number(valorReais) * 100);
  return {
    acao,
    desafio: campo(desafio),
    identificador: campo(identificador),
    valorCentavos: centavos,
    nsu: campo(resultado?.nsu),
    autorizacao: campo(resultado?.codigoAutorizacao || resultado?.autorizacao),
    rede: campo(resultado?.rede),
    finalizacao: campo(resultado?.codigoFinalizacao || resultado?.finalizacao),
    sucesso: resultado?.sucessoTransacao === true || resultado?.confirmada === true || resultado?.desfeita === true,
    codigo: campo(codigo),
  };
}
