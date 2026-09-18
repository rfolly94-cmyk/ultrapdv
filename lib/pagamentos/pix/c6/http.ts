import { Buffer } from "node:buffer";
import https from "node:https";
import { URL } from "node:url";

import { ErroPixGeranet } from "../erro";
import {
  MENSAGEM_C6_INDISPONIVEL,
  MENSAGEM_C6_MTLS,
  TIMEOUT_C6_MS,
  mensagemErroHttpC6,
  urlAuthC6,
  urlCobC6,
} from "./regras";

export type C6RespostaHttp = {
  status: number;
  json: Record<string, unknown> | null;
  texto: string;
  timeout?: boolean;
  mtls?: boolean;
  rede?: boolean;
};

export type C6Http = (input: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  cert: string;
  key: string;
}) => Promise<C6RespostaHttp>;

function jsonSeguro(texto: string): Record<string, unknown> | null {
  if (!texto.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(texto) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  return null;
}

function ehErroMtls(error: unknown) {
  const codigo = String(
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : ""
  );
  const mensagem = error instanceof Error ? error.message : String(error ?? "");
  return (
    /UNABLE_TO_|CERT|ERR_OSSL|EPROTO|certificate|mTLS|private key/i.test(
      `${codigo} ${mensagem}`
    )
  );
}

export const httpMtlsC6: C6Http = (input) =>
  new Promise((resolve) => {
    const url = new URL(input.url);
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: input.method,
        headers: input.headers,
        cert: input.cert,
        key: input.key,
      },
      (res) => {
        const partes: Buffer[] = [];
        res.on("data", (chunk) => partes.push(chunk as Buffer));
        res.on("end", () => {
          const texto = Buffer.concat(partes).toString("utf8");
          resolve({
            status: res.statusCode ?? 0,
            texto,
            json: jsonSeguro(texto),
          });
        });
      }
    );

    req.setTimeout(TIMEOUT_C6_MS, () => {
      req.destroy();
      resolve({
        status: 0,
        texto: "",
        json: null,
        timeout: true,
      });
    });

    req.on("error", (error) => {
      if (ehErroMtls(error)) {
        resolve({
          status: 0,
          texto: "",
          json: null,
          mtls: true,
        });
        return;
      }

      resolve({
        status: 0,
        texto: "",
        json: null,
        rede: true,
      });
    });

    if (input.body) {
      req.write(input.body);
    }
    req.end();
  });

export function pemDeHexadecimal(hex: string, rotulo: string) {
  const bruto = String(hex ?? "").trim();
  if (!bruto) {
    throw new ErroPixGeranet(`${rotulo} não configurado.`);
  }

  let texto = bruto;
  if (/^[0-9a-fA-F]+$/.test(bruto) && bruto.length % 2 === 0) {
    texto = Buffer.from(bruto, "hex").toString("utf8");
  }

  if (!texto.includes("-----BEGIN")) {
    throw new ErroPixGeranet(`${rotulo} deve estar em PEM (.crt/.key).`);
  }

  return texto;
}

export function interpretarAuthC6(resposta: C6RespostaHttp) {
  if (resposta.timeout || resposta.rede) {
    throw new ErroPixGeranet(MENSAGEM_C6_INDISPONIVEL, 503);
  }

  if (resposta.mtls) {
    throw new ErroPixGeranet(MENSAGEM_C6_MTLS, 422);
  }

  if (resposta.status === 502 || resposta.status >= 500) {
    throw new ErroPixGeranet(MENSAGEM_C6_INDISPONIVEL, 503);
  }

  if (resposta.status < 200 || resposta.status >= 300) {
    throw new ErroPixGeranet(mensagemErroHttpC6(resposta.status), resposta.status || 422);
  }

  const token = String(resposta.json?.access_token ?? "").trim();
  const expiresIn = Number(resposta.json?.expires_in ?? 0);
  if (!token) {
    throw new ErroPixGeranet(
      "O C6 Bank autenticou sem devolver access_token utilizável.",
      422
    );
  }

  return {
    accessToken: token,
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 600,
    tokenType: String(resposta.json?.token_type ?? "Bearer"),
  };
}

export function lancarSeRespostaC6Falhou(
  resposta: C6RespostaHttp,
  operacao: "auth" | "cob" | "consulta" | "cancelar" | "webhook"
) {
  if (resposta.timeout || resposta.rede) {
    throw new ErroPixGeranet(MENSAGEM_C6_INDISPONIVEL, 503);
  }

  if (resposta.mtls) {
    throw new ErroPixGeranet(MENSAGEM_C6_MTLS, 422);
  }

  if (resposta.status === 502 || resposta.status >= 500) {
    throw new ErroPixGeranet(MENSAGEM_C6_INDISPONIVEL, 503);
  }

  if (resposta.status < 200 || resposta.status >= 300) {
    const detalhe = String(
      resposta.json?.detail ??
        resposta.json?.title ??
        resposta.json?.mensagem ??
        ""
    ).trim();
    const base = mensagemErroHttpC6(resposta.status);
    throw new ErroPixGeranet(
      operacao === "auth" || !detalhe || detalhe.length > 180
        ? base
        : `${base} ${detalhe}`.trim(),
      resposta.status || 422
    );
  }
}

type CacheTokenC6 = {
  token: string;
  expiraEm: number;
};

const cacheTokenC6 = new Map<string, CacheTokenC6>();

export function chaveCacheTokenC6(params: {
  empresaId: string;
  ambiente: string;
  clientId: string;
}) {
  return `${params.empresaId}:${params.ambiente}:${params.clientId}`;
}

export function tokenCacheadoC6(chave: string) {
  const atual = cacheTokenC6.get(chave);
  if (!atual || atual.expiraEm <= Date.now()) {
    return null;
  }
  return atual.token;
}

export function gravarTokenCacheC6(
  chave: string,
  token: string,
  expiresIn: number,
  margemSegundos: number
) {
  cacheTokenC6.set(chave, {
    token,
    expiraEm: Date.now() + Math.max(expiresIn - margemSegundos, 15) * 1000,
  });
}

export function limparCacheTokenC6() {
  cacheTokenC6.clear();
}

export async function autenticarC6(params: {
  empresaId: string;
  ambiente: string;
  clientId: string;
  clientSecret: string;
  cert: string;
  key: string;
  http?: C6Http;
}) {
  const chave = chaveCacheTokenC6({
    empresaId: params.empresaId,
    ambiente: params.ambiente,
    clientId: params.clientId,
  });
  const cacheado = tokenCacheadoC6(chave);
  if (cacheado) {
    return cacheado;
  }

  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    grant_type: "client_credentials",
  }).toString();

  const http = params.http ?? httpMtlsC6;
  const resposta = await http({
    url: urlAuthC6(params.ambiente),
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": String(Buffer.byteLength(body)),
    },
    body,
    cert: params.cert,
    key: params.key,
  });

  const auth = interpretarAuthC6(resposta);
  gravarTokenCacheC6(chave, auth.accessToken, auth.expiresIn, 30);
  return auth.accessToken;
}

export async function requisicaoC6Autenticada(params: {
  empresaId: string;
  ambiente: string;
  clientId: string;
  clientSecret: string;
  cert: string;
  key: string;
  method: "GET" | "PUT" | "PATCH" | "DELETE";
  txid?: string;
  url?: string;
  json?: Record<string, unknown>;
  http?: C6Http;
}) {
  const token = await autenticarC6(params);
  const body = params.json ? JSON.stringify(params.json) : undefined;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (body) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(body));
  }

  const url =
    params.url ??
    urlCobC6(params.ambiente, String(params.txid ?? "").trim());
  const http = params.http ?? httpMtlsC6;
  return http({
    url,
    method: params.method,
    headers,
    body,
    cert: params.cert,
    key: params.key,
  });
}
