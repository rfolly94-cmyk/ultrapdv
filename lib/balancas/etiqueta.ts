import { departamentoNumericoBalanca } from "./departamento";
import {
  ETIQUETA_BALANCA_PADRAO,
  type ConfiguracaoBalancaJson,
  type ConfiguracaoEtiquetaBalanca,
  type ModoEtiquetaBalanca,
} from "./tipos";

function texto(valor: unknown, max = 20) {
  const limpo = String(valor ?? "").trim();
  return limpo.slice(0, max);
}

function inteiro(valor: unknown, minimo: number, maximo: number, padrao: number) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) {
    return padrao;
  }
  return numero;
}

function modoEtiqueta(valor: unknown): ModoEtiquetaBalanca {
  return valor === "preco" ? "preco" : "peso";
}

export function normalizarEtiquetaBalanca(
  valor: unknown
): ConfiguracaoEtiquetaBalanca {
  const bruto =
    valor && typeof valor === "object"
      ? (valor as Record<string, unknown>)
      : {};

  return {
    prefixo: texto(bruto.prefixo, 8),
    plu: bruto.plu !== false,
    modo: modoEtiqueta(bruto.modo),
    quantidadeDigitos: inteiro(
      bruto.quantidadeDigitos,
      1,
      13,
      ETIQUETA_BALANCA_PADRAO.quantidadeDigitos
    ),
    casasDecimais: inteiro(
      bruto.casasDecimais,
      0,
      4,
      ETIQUETA_BALANCA_PADRAO.casasDecimais
    ),
    digitoVerificador: bruto.digitoVerificador === true,
  };
}

export function normalizarConfiguracaoBalancaJson(
  valor: unknown
): ConfiguracaoBalancaJson {
  const bruto =
    valor && typeof valor === "object"
      ? (valor as Record<string, unknown>)
      : {};

  return {
    etiqueta: normalizarEtiquetaBalanca(bruto.etiqueta),
    modeloId: texto(bruto.modeloId, 80) || null,
    formato: texto(bruto.formato, 40) || null,
    etiquetaManual: bruto.etiquetaManual === true,
    departamentoPadrao:
      "departamentoPadrao" in bruto
        ? departamentoNumericoBalanca(bruto.departamentoPadrao)
        : undefined,
  };
}

export function lerEtiquetaDoFormulario(
  formData: FormData
): ConfiguracaoEtiquetaBalanca {
  return normalizarEtiquetaBalanca({
    prefixo: formData.get("etiqueta_prefixo"),
    plu: formData.get("etiqueta_plu") === "1",
    modo: formData.get("etiqueta_modo"),
    quantidadeDigitos: Number(formData.get("etiqueta_quantidade_digitos")),
    casasDecimais: Number(formData.get("etiqueta_casas_decimais")),
    digitoVerificador: formData.get("etiqueta_digito_verificador") === "1",
  });
}
