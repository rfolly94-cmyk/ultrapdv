import { Buffer } from "node:buffer";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  X509Certificate,
  type KeyObject,
} from "node:crypto";
import tls from "node:tls";
import { inflateRawSync } from "node:zlib";

import { ErroPixGeranet } from "../erro";

export const MENSAGEM_PAR_MTLS_C6 =
  "O certificado e a chave privada informados não pertencem ao mesmo par.";

export const MENSAGEM_SOMENTE_CERTIFICADO_PUBLICO_C6 =
  "O arquivo do C6 contém apenas o certificado público. Falta a chave privada correspondente (.key), baixada uma única vez no Web Banking em Integrações via API, no mesmo download do certificado. A chave privada de sandbox não pode ser usada em produção.";

export const MENSAGEM_ENVIAR_CHAVE_CORRESPONDENTE_C6 =
  "Envie também a chave privada (.key) correspondente a este certificado.";

export const MENSAGEM_SANDBOX_EM_PRODUCAO_C6 =
  "A produção do C6 não pode reutilizar o certificado ou a chave privada de sandbox.";

const MENSAGEM_CERTIFICADO_AUSENTE = "Certificado C6 não configurado.";
const MENSAGEM_CHAVE_CRIPTOGRAFADA =
  "A chave privada está protegida por senha. No Web Banking C6 o arquivo .key desse download não usa senha; envie esse .key, sem reutilizar a chave de sandbox.";
const MENSAGEM_PFX_SENHA =
  "O certificado PFX está protegido por senha e nenhuma senha foi informada. Não reutilize a chave privada de sandbox.";
const MENSAGEM_ZIP =
  "Não foi possível ler o arquivo compactado do certificado C6. Envie o .crt e o .key que estão dentro dele.";

const RE_CERT =
  /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
const RE_KEY =
  /-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/g;
const OID_PKCS12 = Buffer.from([
  0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x0c,
]);

export type EntradaMaterialMtlsC6 = {
  certificado: string;
  chavePrivada: string;
  ambiente: string;
  certificadoSandbox?: string;
  chaveSandbox?: string;
  senhaPfx?: string;
};

export type MaterialTlsC6 = {
  cert?: string;
  key?: string;
  pfx?: Buffer;
  passphrase?: string;
};

type Pecas = {
  certificados: string[];
  chaves: string[];
  pfx: Buffer | null;
};

function pecasVazias(): Pecas {
  return { certificados: [], chaves: [], pfx: null };
}

export function bytesDoCofre(valor: string) {
  const bruto = String(valor ?? "").trim();
  if (!bruto) {
    return Buffer.alloc(0);
  }

  if (/^[0-9a-fA-F]+$/.test(bruto) && bruto.length % 2 === 0) {
    return Buffer.from(bruto, "hex");
  }

  return Buffer.from(bruto, "utf8");
}

function nomeSeguro(nome: string) {
  const base = nome.split(/[/\\]/).pop() ?? "";
  if (!base || base === "." || base === "..") {
    return "";
  }
  return base;
}

function lerZip(buffer: Buffer) {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) {
    return null;
  }

  let eocd = -1;
  const minimo = Math.max(0, buffer.length - 22 - 65535);
  for (let i = buffer.length - 22; i >= minimo; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }

  if (eocd < 0) {
    throw new ErroPixGeranet(MENSAGEM_ZIP);
  }

  const total = buffer.readUInt16LE(eocd + 10);
  if (total > 20) {
    throw new ErroPixGeranet(MENSAGEM_ZIP);
  }

  let cursor = buffer.readUInt32LE(eocd + 16);
  const arquivos: { nome: string; conteudo: Buffer }[] = [];

  for (let indice = 0; indice < total; indice += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new ErroPixGeranet(MENSAGEM_ZIP);
    }

    const flags = buffer.readUInt16LE(cursor + 8);
    const metodo = buffer.readUInt16LE(cursor + 10);
    const comprimido = buffer.readUInt32LE(cursor + 20);
    const nomeTamanho = buffer.readUInt16LE(cursor + 28);
    const extraTamanho = buffer.readUInt16LE(cursor + 30);
    const comentarioTamanho = buffer.readUInt16LE(cursor + 32);
    const local = buffer.readUInt32LE(cursor + 42);
    const nome = nomeSeguro(
      buffer.toString("utf8", cursor + 46, cursor + 46 + nomeTamanho)
    );

    if (flags & 0x1 || comprimido === 0xffffffff) {
      throw new ErroPixGeranet(MENSAGEM_ZIP);
    }

    if (nome && local + 30 <= buffer.length) {
      const localNome = buffer.readUInt16LE(local + 26);
      const localExtra = buffer.readUInt16LE(local + 28);
      const inicio = local + 30 + localNome + localExtra;
      const fatia = buffer.subarray(inicio, inicio + comprimido);
      let conteudo: Buffer;
      if (metodo === 0) {
        conteudo = Buffer.from(fatia);
      } else if (metodo === 8) {
        try {
          conteudo = Buffer.from(inflateRawSync(fatia));
        } catch {
          throw new ErroPixGeranet(MENSAGEM_ZIP);
        }
      } else {
        throw new ErroPixGeranet(MENSAGEM_ZIP);
      }

      if (conteudo.length > 2 * 1024 * 1024) {
        throw new ErroPixGeranet(MENSAGEM_ZIP);
      }

      arquivos.push({ nome, conteudo });
    }

    cursor += 46 + nomeTamanho + extraTamanho + comentarioTamanho;
  }

  return arquivos;
}

function certificadosPem(texto: string) {
  return [...texto.matchAll(RE_CERT)].map((item) => item[0]);
}

function chavesPem(texto: string) {
  return [...texto.matchAll(RE_KEY)].map((item) => item[0]);
}

function certificadoDer(buffer: Buffer) {
  try {
    return new X509Certificate(buffer).toString();
  } catch {
    return null;
  }
}

function pecasDe(buffer: Buffer, profundidade = 0): Pecas {
  if (buffer.length === 0 || profundidade > 2) {
    return pecasVazias();
  }

  if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) {
    const entradas = lerZip(buffer) ?? [];
    const acumulado = pecasVazias();
    for (const entrada of entradas) {
      const pecas = pecasDe(entrada.conteudo, profundidade + 1);
      acumulado.certificados.push(...pecas.certificados);
      acumulado.chaves.push(...pecas.chaves);
      if (pecas.pfx && !acumulado.pfx) {
        acumulado.pfx = pecas.pfx;
      }
    }
    return acumulado;
  }

  if (buffer.includes(Buffer.from("-----BEGIN"))) {
    const texto = buffer.toString("utf8");
    return {
      certificados: certificadosPem(texto),
      chaves: chavesPem(texto),
      pfx: texto.includes("-----BEGIN PKCS12-----") ? buffer : null,
    };
  }

  if (buffer.includes(OID_PKCS12)) {
    return { certificados: [], chaves: [], pfx: buffer };
  }

  const der = certificadoDer(buffer);
  if (der) {
    return { certificados: [der], chaves: [], pfx: null };
  }

  return pecasVazias();
}

function spki(chave: KeyObject) {
  const exportado = chave.export({ type: "spki", format: "der" });
  const der = Buffer.isBuffer(exportado) ? exportado : Buffer.from(exportado);
  return createHash("sha256").update(der).digest("hex");
}

function spkiCertificado(pem: string) {
  return spki(new X509Certificate(pem).publicKey);
}

function spkiChave(pem: string) {
  return spki(createPublicKey(createPrivateKey(pem)));
}

export function fingerprintChavePem(pem: string) {
  const exportado = createPrivateKey(pem).export({
    type: "pkcs8",
    format: "der",
  });
  const der = Buffer.isBuffer(exportado) ? exportado : Buffer.from(exportado);
  return createHash("sha256").update(der).digest("hex");
}

function chaveCriptografada(pem: string) {
  return pem.includes("BEGIN ENCRYPTED PRIVATE KEY");
}

function parCompativel(certificado: string, chave: string) {
  try {
    if (chaveCriptografada(chave)) {
      return false;
    }
    return spkiCertificado(certificado) === spkiChave(chave);
  } catch {
    return false;
  }
}

function fingerprintsSandbox(params: EntradaMaterialMtlsC6) {
  if (params.ambiente !== "1") {
    return new Set<string>();
  }

  const fingerprints = new Set<string>();
  for (const bruto of [params.certificadoSandbox, params.chaveSandbox]) {
    const pecas = pecasDe(bytesDoCofre(String(bruto ?? "")));
    for (const chave of pecas.chaves) {
      if (chaveCriptografada(chave)) {
        continue;
      }
      try {
        fingerprints.add(fingerprintChavePem(chave));
      } catch {
        continue;
      }
    }
  }

  return fingerprints;
}

function validarPfx(pfx: Buffer, senha?: string) {
  const passphrase = String(senha ?? "").trim();
  try {
    tls.createSecureContext(
      passphrase ? { pfx, passphrase } : { pfx }
    );
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : "";
    if (/mac verify|invalid password|bad decrypt/i.test(mensagem)) {
      throw new ErroPixGeranet(MENSAGEM_PFX_SENHA);
    }
    throw new ErroPixGeranet(MENSAGEM_PAR_MTLS_C6);
  }

  return {
    pfx,
    ...(passphrase ? { passphrase } : {}),
  } satisfies MaterialTlsC6;
}

export type PlanoSubstituicaoMtlsC6 =
  | { substituir: false }
  | {
      substituir: true;
      certificadoPemHexadecimal: string;
      chavePrivadaPemHexadecimal: string;
    };

function hexDeTexto(valor: string) {
  return Buffer.from(valor, "utf8").toString("hex");
}

function materialTemChavePrivada(pecas: Pecas) {
  return pecas.chaves.length > 0 || Boolean(pecas.pfx);
}

export function chaveSeparadaDoCofre(certificado: string, chavePrivada: string) {
  const pecas = pecasDe(bytesDoCofre(certificado));
  if (materialTemChavePrivada(pecas)) {
    return "";
  }
  return chavePrivada;
}

export function planejarSubstituicaoMtlsC6(params: {
  certificadoNovo?: string;
  chaveNova?: string;
  certificadoAtual?: string;
  chaveAtual?: string;
  ambiente: string;
  certificadoSandbox?: string;
  chaveSandbox?: string;
  senhaPfx?: string;
}): PlanoSubstituicaoMtlsC6 {
  const certificadoNovo = String(params.certificadoNovo ?? "").trim();
  const chaveNova = String(params.chaveNova ?? "").trim();
  const certificadoAtual = String(params.certificadoAtual ?? "").trim();
  void params.chaveAtual;

  if (!certificadoNovo && !chaveNova) {
    return { substituir: false };
  }

  const certificado = certificadoNovo || certificadoAtual;
  const chaveInformada = chaveNova;

  if (certificadoNovo) {
    const pecasCert = pecasDe(bytesDoCofre(certificadoNovo));
    const pecasChave = chaveNova
      ? pecasDe(bytesDoCofre(chaveNova))
      : pecasVazias();
    if (
      !materialTemChavePrivada(pecasCert) &&
      !materialTemChavePrivada(pecasChave)
    ) {
      throw new ErroPixGeranet(MENSAGEM_ENVIAR_CHAVE_CORRESPONDENTE_C6);
    }
  }

  const material = resolverMaterialMtlsC6({
    certificado,
    chavePrivada: chaveInformada,
    ambiente: params.ambiente,
    certificadoSandbox: params.certificadoSandbox,
    chaveSandbox: params.chaveSandbox,
    senhaPfx: params.senhaPfx,
  });

  if (material.pfx && material.pfx.byteLength > 0) {
    const pfxHex = material.pfx.toString("hex");
    return {
      substituir: true,
      certificadoPemHexadecimal: pfxHex,
      chavePrivadaPemHexadecimal: pfxHex,
    };
  }

  return {
    substituir: true,
    certificadoPemHexadecimal: hexDeTexto(String(material.cert ?? "")),
    chavePrivadaPemHexadecimal: hexDeTexto(String(material.key ?? "")),
  };
}

export function cofreC6IncluiChavePrivada(
  certificado: unknown,
  chavePrivada: unknown
) {
  const doCertificado = pecasDe(bytesDoCofre(String(certificado ?? "")));
  const daChave = pecasDe(bytesDoCofre(String(chavePrivada ?? "")));
  return (
    doCertificado.chaves.length > 0 ||
    daChave.chaves.length > 0 ||
    Boolean(doCertificado.pfx || daChave.pfx)
  );
}

export function resolverMaterialMtlsC6(
  params: EntradaMaterialMtlsC6
): MaterialTlsC6 {
  const certificado = bytesDoCofre(params.certificado);
  const chaveInformada = bytesDoCofre(params.chavePrivada);
  const doCertificado = pecasDe(certificado);
  const daChave = pecasDe(chaveInformada);
  const sandbox = fingerprintsSandbox(params);

  const pfx =
    doCertificado.pfx && doCertificado.chaves.length === 0
      ? doCertificado.pfx
      : doCertificado.certificados.length === 0 &&
          doCertificado.chaves.length === 0 &&
          daChave.pfx
        ? daChave.pfx
        : null;

  if (pfx) {
    if (params.ambiente === "1") {
      const fingerprint = createHash("sha256").update(pfx).digest("hex");
      for (const bruto of [params.certificadoSandbox, params.chaveSandbox]) {
        const bytes = bytesDoCofre(String(bruto ?? ""));
        if (
          bytes.length > 0 &&
          createHash("sha256").update(bytes).digest("hex") === fingerprint
        ) {
          throw new ErroPixGeranet(MENSAGEM_SANDBOX_EM_PRODUCAO_C6);
        }
      }
    }
    return validarPfx(pfx, params.senhaPfx);
  }

  const chaves =
    doCertificado.chaves.length > 0 ? doCertificado.chaves : daChave.chaves;
  const certificados = [
    ...doCertificado.certificados,
    ...(doCertificado.chaves.length > 0 ? [] : daChave.certificados),
  ];

  if (certificados.length === 0 && chaves.length === 0) {
    throw new ErroPixGeranet(MENSAGEM_CERTIFICADO_AUSENTE);
  }

  if (chaves.length === 0) {
    throw new ErroPixGeranet(MENSAGEM_SOMENTE_CERTIFICADO_PUBLICO_C6);
  }

  if (chaves.every(chaveCriptografada)) {
    throw new ErroPixGeranet(MENSAGEM_CHAVE_CRIPTOGRAFADA);
  }

  if (certificados.length === 0) {
    throw new ErroPixGeranet(MENSAGEM_CERTIFICADO_AUSENTE);
  }

  let escolhido: { certificado: string; chave: string } | null = null;
  for (const chave of chaves) {
    if (chaveCriptografada(chave)) {
      continue;
    }
    for (const item of certificados) {
      if (parCompativel(item, chave)) {
        escolhido = { certificado: item, chave };
        break;
      }
    }
    if (escolhido) {
      break;
    }
  }

  if (!escolhido) {
    throw new ErroPixGeranet(MENSAGEM_PAR_MTLS_C6);
  }

  let fingerprint = "";
  try {
    fingerprint = fingerprintChavePem(escolhido.chave);
  } catch {
    throw new ErroPixGeranet(MENSAGEM_PAR_MTLS_C6);
  }

  if (sandbox.has(fingerprint)) {
    throw new ErroPixGeranet(MENSAGEM_SANDBOX_EM_PRODUCAO_C6);
  }

  const cadeia = [
    escolhido.certificado,
    ...certificados.filter((item) => item !== escolhido?.certificado),
  ].join("\n");

  try {
    tls.createSecureContext({ cert: cadeia, key: escolhido.chave });
  } catch {
    throw new ErroPixGeranet(MENSAGEM_PAR_MTLS_C6);
  }

  return { cert: cadeia, key: escolhido.chave };
}

export function validarMaterialTlsC6(material: MaterialTlsC6) {
  if (material.pfx && material.pfx.byteLength > 0) {
    validarPfx(material.pfx, material.passphrase);
    return;
  }

  const cert = String(material.cert ?? "");
  const key = String(material.key ?? "");
  if (!cert || !key || !parCompativel(certificadosPem(cert)[0] ?? cert, key)) {
    throw new ErroPixGeranet(MENSAGEM_PAR_MTLS_C6);
  }

  try {
    tls.createSecureContext({ cert, key });
  } catch {
    throw new ErroPixGeranet(MENSAGEM_PAR_MTLS_C6);
  }
}

export function traduzirErroMtlsC6(error: unknown) {
  if (error instanceof ErroPixGeranet) {
    return error;
  }

  const mensagem = error instanceof Error ? error.message : String(error ?? "");
  if (/key values mismatch|05800074/i.test(mensagem)) {
    return new ErroPixGeranet(MENSAGEM_PAR_MTLS_C6);
  }

  return error instanceof Error ? error : new ErroPixGeranet(MENSAGEM_PAR_MTLS_C6);
}

export async function usarMtlsC6<T>(
  entrada: EntradaMaterialMtlsC6,
  http: (tls: MaterialTlsC6) => Promise<T>
) {
  const tls = resolverMaterialMtlsC6(entrada);
  return http(tls);
}
