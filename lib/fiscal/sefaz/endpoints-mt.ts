export const UF_SEFAZ_MT = "51";

export const SOAP_ACTION_NFE_CONSULTA_PROTOCOLO =
  "http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4/nfeConsultaNF";

const CONSULTA_PROTOCOLO_MT = {
  "55": {
    "1": "https://nfe.sefaz.mt.gov.br/nfews/v4/services/NfeConsulta4",
    "2": "https://homologacao.sefaz.mt.gov.br/nfews/v4/services/NfeConsulta4",
  },
  "65": {
    "1": "https://nfce.sefaz.mt.gov.br/nfcews/services/NfeConsulta4",
    "2": "https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeConsulta4",
  },
} as const;

export type ModeloConsultaSefaz = keyof typeof CONSULTA_PROTOCOLO_MT;
export type AmbienteConsultaSefaz = "1" | "2";

export function endpointConsultaProtocoloMt(params: {
  modelo: string;
  ambiente: string;
}) {
  const modelo = params.modelo === "65" ? "65" : params.modelo === "55" ? "55" : null;
  const ambiente =
    params.ambiente === "1" || params.ambiente === "2" ? params.ambiente : null;

  if (!modelo || !ambiente) {
    return null;
  }

  return CONSULTA_PROTOCOLO_MT[modelo][ambiente];
}
