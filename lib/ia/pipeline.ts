import { lerConfigProviderIa } from "./provider";

/**
 * Preparado para um roteador barato + reasoner avançado.
 * Nesta fase os dois papéis usam o mesmo modelo configurado.
 * Toda mensagem do Assistente passa pelo provider; não há roteador determinístico no caminho principal.
 */
export type PapelPipelineIa = "router" | "reasoner";

export function modeloParaPapelIa(_papel: PapelPipelineIa) {
  const config = lerConfigProviderIa();
  return config?.model ?? null;
}

export function provedorIaDisponivel() {
  return Boolean(lerConfigProviderIa());
}
