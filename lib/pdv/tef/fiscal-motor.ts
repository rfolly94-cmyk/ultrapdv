import { cnpjCredenciadoraPayGo } from "@/lib/fiscal/tef/credenciadoras-paygo";

export type DadosFiscaisMotor = {
  autorizacao: string | null;
  bandeiraNome: string | null;
  rede: string | null;
  instituicao: string | null;
  cnpjCredenciadora: string | null;
  cnpjRecebedor: string | null;
};

function texto(valor: unknown, limite: number) {
  const limpo = String(valor ?? "").replace(/[\r\n]/g, "").trim();
  if (!limpo || limpo.length > limite || /^\d{13,19}$/.test(limpo)) {
    return null;
  }
  return limpo;
}

function cnpj(valor: unknown) {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  return digitos.length === 14 ? digitos : null;
}

function mesmo(esquerda: string | null, direita: string | null) {
  return Boolean(esquerda && direita && esquerda.localeCompare(direita, undefined, { sensitivity: "accent" }) === 0);
}

/**
 * Aceita só o que a biblioteca devolveu na sessão da venda.
 * O nome da rede não vira bandeira. Referência de confirmação não vira cAut.
 * O comprovante não entra neste objeto.
 */
export function dadosFiscaisDoMotor(bruto: unknown): DadosFiscaisMotor | null {
  const fiscal = bruto && typeof bruto === "object" ? bruto as Record<string, unknown> : null;
  if (!fiscal) {
    return null;
  }
  const rede = texto(fiscal.rede, 40);
  let bandeiraNome = texto(fiscal.bandeiraNome, 40);
  if (mesmo(bandeiraNome, rede)) {
    bandeiraNome = null;
  }
  const autorizacao = texto(fiscal.autorizacao, 20);
  const instituicao = texto(fiscal.instituicao, 40);
  const cnpjInformado = cnpj(fiscal.cnpjCredenciadora);
  const cnpjCredenciadora = cnpjInformado ?? cnpjCredenciadoraPayGo(rede);
  const cnpjRecebedor = cnpj(fiscal.cnpjRecebedor);
  if (!autorizacao && !bandeiraNome && !rede && !instituicao && !cnpjCredenciadora && !cnpjRecebedor) {
    return null;
  }
  return {
    autorizacao,
    bandeiraNome,
    rede,
    instituicao,
    cnpjCredenciadora,
    cnpjRecebedor,
  };
}

export function recebedorFiscal(fiscal: DadosFiscaisMotor, cnpjEmpresa: string | null) {
  return fiscal.cnpjRecebedor ?? cnpj(cnpjEmpresa);
}
