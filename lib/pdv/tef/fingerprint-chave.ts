import { createHash, createPublicKey } from "node:crypto";

export function fingerprintChavePublicaEd25519(pem: string) {
  const texto = String(pem ?? "").trim();
  if (!texto || /private/i.test(texto)) {
    return null;
  }
  try {
    const chave = createPublicKey(texto);
    if (chave.asymmetricKeyType !== "ed25519") {
      return null;
    }
    const der = chave.export({ type: "spki", format: "der" });
    return createHash("sha256").update(der).digest("hex");
  } catch {
    return null;
  }
}
