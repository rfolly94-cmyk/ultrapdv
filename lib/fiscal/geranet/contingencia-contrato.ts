export type ModoContingenciaGeranet = "nao" | "sim";

type EmpresaGeranet = {
  contingencia?: unknown;
  [chave: string]: unknown;
};

export type NfeComContingenciaGeranet = {
  contingencia?: string;
  justificativaContingencia?: string;
  empresa?: EmpresaGeranet | null;
  [chave: string]: unknown;
};

/**
 * Contrato OpenAPI atual: nfe.contingencia (nao|sim).
 * Não envia a chave dentro de nfe.empresa.
 * "sim" + justificativa só na NFC-e offline.
 */
export function aplicarContingenciaContratoGeranet(
  nfe: NfeComContingenciaGeranet,
  modo: ModoContingenciaGeranet,
  justificativa?: string
) {
  if (nfe.empresa && "contingencia" in nfe.empresa) {
    delete nfe.empresa.contingencia;
  }

  nfe.contingencia = modo;

  if (modo === "sim") {
    nfe.justificativaContingencia = String(
      justificativa ?? ""
    ).trim();
    return nfe;
  }

  if ("justificativaContingencia" in nfe) {
    delete nfe.justificativaContingencia;
  }

  return nfe;
}
