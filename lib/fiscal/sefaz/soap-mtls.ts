import { Buffer } from "node:buffer";
import https from "node:https";

const TIMEOUT_SOAP_SEFAZ_MS = 30_000;

export function postSoapMtlsSefaz(params: {
  endpoint: string;
  soap: string;
  certificadoHex: string;
  senha: string;
  soapAction: string;
}) {
  return new Promise<{ httpStatus: number; body: string }>((resolve, reject) => {
    const pfx = Buffer.from(params.certificadoHex, "hex");
    const req = https.request(
      params.endpoint,
      {
        method: "POST",
        pfx,
        passphrase: params.senha,
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
        headers: {
          Accept: "application/soap+xml, text/xml",
          "Content-Type": `application/soap+xml; charset=utf-8; action="${params.soapAction}"`,
          "Content-Length": Buffer.byteLength(params.soap),
        },
      },
      (res) => {
        const partes: Buffer[] = [];
        res.on("data", (chunk) => partes.push(Buffer.from(chunk)));
        res.on("end", () => {
          resolve({
            httpStatus: res.statusCode ?? 0,
            body: Buffer.concat(partes).toString("utf8"),
          });
        });
      }
    );

    req.setTimeout(TIMEOUT_SOAP_SEFAZ_MS, () => {
      req.destroy(new Error("Timeout ao consultar a SEFAZ."));
    });
    req.on("error", reject);
    req.write(params.soap);
    req.end();
  });
}
