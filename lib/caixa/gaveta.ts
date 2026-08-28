import { classificarFormaCaixa } from "./formas";

export const ABRIR_GAVETA_APOS_VENDA_DINHEIRO_PADRAO = false;

export const ORIGENS_ABERTURA_GAVETA = ["caixa", "pdv", "venda"] as const;
export type OrigemAberturaGaveta = (typeof ORIGENS_ABERTURA_GAVETA)[number];

export function origemAberturaGaveta(valor: unknown): OrigemAberturaGaveta | null {
  const bruto = String(valor ?? "").trim();
  if (bruto === "caixa" || bruto === "pdv" || bruto === "venda") {
    return bruto;
  }
  return null;
}

export function abrirGavetaAposVendaDinheiroDoRegistro(valor: unknown): boolean {
  return valor === true;
}

export function vendaTemPagamentoDinheiro(
  pagamentos: Array<{
    tipo?: string | null;
    codigo?: string | null;
    nome?: string | null;
    forma?: {
      tipo?: string | null;
      codigo?: string | null;
      nome?: string | null;
    } | null;
    valorCentavos?: number | null;
  }>
): boolean {
  return (pagamentos ?? []).some((pagamento) => {
    const valor = Number(pagamento.valorCentavos ?? 0);
    if (Number.isFinite(valor) && valor <= 0) {
      return false;
    }
    const forma = pagamento.forma ?? pagamento;
    return classificarFormaCaixa(forma) === "dinheiro";
  });
}

export function deveAbrirGavetaAposVenda(input: {
  configAtiva: boolean;
  pagamentos: Array<{
    tipo?: string | null;
    codigo?: string | null;
    nome?: string | null;
    forma?: {
      tipo?: string | null;
      codigo?: string | null;
      nome?: string | null;
    } | null;
    valorCentavos?: number | null;
  }>;
}): boolean {
  if (input.configAtiva !== true) {
    return false;
  }
  return vendaTemPagamentoDinheiro(input.pagamentos);
}
