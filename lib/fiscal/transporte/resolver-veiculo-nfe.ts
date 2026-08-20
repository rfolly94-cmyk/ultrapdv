import type { ModFreteNfe } from "@/lib/fiscal/transporte/dados-transporte-venda";

export type DecisaoVeiculoNfe = {
  coletar: boolean;
  transmitirGeranet: boolean;
  motivo: string;
};

/**
 * O payload Geranet de NF-e 55 não possui grupo de veículo (placa/UF/RNTC).
 * Coletamos no rascunho quando há ocorrência de transporte, mas não enviamos.
 */
export function resolverGrupoVeiculoNfe(params: {
  modFrete?: ModFreteNfe | string | null;
}): DecisaoVeiculoNfe {
  const modFrete = String(params.modFrete ?? "9").trim();
  if (modFrete === "9" || !modFrete) {
    return {
      coletar: false,
      transmitirGeranet: false,
      motivo:
        "Sem ocorrência de transporte: transportadora, placa e RNTC não se aplicam.",
    };
  }

  return {
    coletar: true,
    transmitirGeranet: false,
    motivo:
      "Placa, UF do veículo e RNTC ficam no rascunho. O payload Geranet de NF-e 55 não possui grupo de veículo.",
  };
}
