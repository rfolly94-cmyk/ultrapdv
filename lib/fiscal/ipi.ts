import {
  cenqExisteNoAnexoXiv,
  faixaCenqPermitidaParaCst,
} from "@/lib/fiscal/anexo-xiv-cenq";

export const PERFIS_IPI = [
  "NAO_CONTRIBUINTE",
  "INDUSTRIAL",
  "EQUIPARADO_INDUSTRIAL",
] as const;

export type PerfilIpi = (typeof PERFIS_IPI)[number];

export const CST_IPI_SAIDA_OPERACAO = [
  "50",
  "51",
  "52",
  "53",
  "54",
  "55",
  "99",
] as const;

export type CstIpiSaida =
  (typeof CST_IPI_SAIDA_OPERACAO)[number];

export const CST_IPI_TRIBUTADO = ["50", "99"] as const;

export const CST_IPI_NAO_TRIBUTADO = [
  "51",
  "52",
  "53",
  "54",
  "55",
] as const;

export type ModeloDocumentoFiscal = "55" | "65";

export const CENQ_FORMATO = /^[0-9]{1,3}$/;

export type ConfiguracaoIpiGrupo = {
  ipiAplicavel?: boolean | null;
  ipiCst?: string | null;
  ipiAliquota?: number | string | null;
  ipiEnquadramento?: string | null;
};

export function parsePerfilIpi(
  valor: unknown
): PerfilIpi | null {
  const texto = String(valor ?? "")
    .trim()
    .toUpperCase();

  if (
    texto === "NAO_CONTRIBUINTE" ||
    texto === "INDUSTRIAL" ||
    texto === "EQUIPARADO_INDUSTRIAL"
  ) {
    return texto;
  }

  return null;
}

export function cstIpiSaidaValido(
  cst: string | null | undefined
): cst is CstIpiSaida {
  return CST_IPI_SAIDA_OPERACAO.includes(
    String(cst ?? "") as CstIpiSaida
  );
}

export function cstIpiTributado(
  cst: string | null | undefined
) {
  return CST_IPI_TRIBUTADO.includes(
    String(cst ?? "") as (typeof CST_IPI_TRIBUTADO)[number]
  );
}

export function somenteDigitosIpi(
  valor: string | null | undefined
) {
  return String(valor ?? "").replace(/\D/g, "");
}

export function normalizarCenqInformado(
  valor: string | null | undefined
) {
  return String(valor ?? "").trim();
}

export function cenqFormatoValido(
  valor: string | null | undefined
) {
  return CENQ_FORMATO.test(normalizarCenqInformado(valor));
}

export function validarCenqIpi(
  valor: string | null | undefined,
  cst?: string | null
): string | null {
  const cenq = normalizarCenqInformado(valor);

  if (!cenq) {
    return "Informe o código de enquadramento legal do IPI (cEnq).";
  }

  if (!cenqFormatoValido(cenq)) {
    return "O cEnq deve ter de 1 a 3 dígitos, conforme o leiaute da NF-e.";
  }

  if (!cenqExisteNoAnexoXiv(cenq)) {
    return `O cEnq ${cenq} não consta no Anexo XIV. Informe o código oficial, sem completar zeros ou usar 999 automaticamente.`;
  }

  if (cst) {
    const faixas = faixaCenqPermitidaParaCst(cst);

    if (faixas.length > 0) {
      const numero = Number(cenq);
      const compativel = faixas.some(
        (faixa) =>
          numero >= faixa.minimo && numero <= faixa.maximo
      );

      if (!compativel) {
        return `O cEnq ${cenq} não é compatível com o CST IPI ${cst}, conforme o Anexo XIV.`;
      }
    }
  }

  return null;
}

export function numeroIpi(
  valor: number | string | null | undefined
) {
  if (valor === null || valor === undefined || valor === "") {
    return null;
  }

  let texto = String(valor).trim();

  if (texto.includes(".") && texto.includes(",")) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  } else if (texto.includes(",")) {
    texto = texto.replace(",", ".");
  }

  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : null;
}

export function validarConfiguracaoIpiGrupo(
  grupo: ConfiguracaoIpiGrupo
): string | null {
  if (!grupo.ipiAplicavel) {
    return null;
  }

  const cst = String(grupo.ipiCst ?? "").trim();

  if (!cstIpiSaidaValido(cst)) {
    return "Informe um CST IPI de saída válido (50, 51, 52, 53, 54, 55 ou 99).";
  }

  const erroCenq = validarCenqIpi(
    grupo.ipiEnquadramento,
    cst
  );

  if (erroCenq) {
    return erroCenq;
  }

  if (cstIpiTributado(cst)) {
    const aliquota = numeroIpi(grupo.ipiAliquota);

    if (aliquota === null || aliquota < 0 || aliquota > 100) {
      return "Informe a alíquota de IPI (0 a 100) para CST tributado.";
    }

    if (cst === "50" && aliquota <= 0) {
      return "CST 50 exige alíquota de IPI maior que zero.";
    }
  }

  return null;
}

export function pendenciasIpiDocumento(input: {
  modelo: ModeloDocumentoFiscal;
  perfilIpi: PerfilIpi | null;
  grupos: Array<
    ConfiguracaoIpiGrupo & {
      nome?: string | null;
    }
  >;
}): string[] {
  if (input.modelo === "65") {
    return [];
  }

  if (!input.perfilIpi) {
    return [
      "Configure o perfil perante o IPI em Configurações fiscais. Esta informação não é deduzida do CRT.",
    ];
  }

  if (input.perfilIpi === "NAO_CONTRIBUINTE") {
    return [];
  }

  const pendencias: string[] = [];

  for (const grupo of input.grupos) {
    if (!grupo.ipiAplicavel) {
      continue;
    }

    const erro = validarConfiguracaoIpiGrupo(grupo);

    if (erro) {
      pendencias.push(
        grupo.nome
          ? `Grupo fiscal ${grupo.nome}: ${erro}`
          : erro
      );
    }
  }

  return pendencias;
}

export function camposIpiDoGrupo(grupo: {
  ipi_aplicavel?: boolean | null;
  ipi_cst?: string | null;
  ipi_aliquota?: number | string | null;
  ipi_enquadramento?: string | null;
}): ConfiguracaoIpiGrupo {
  return {
    ipiAplicavel: Boolean(grupo.ipi_aplicavel),
    ipiCst: grupo.ipi_cst ?? null,
    ipiAliquota: grupo.ipi_aliquota ?? null,
    ipiEnquadramento: grupo.ipi_enquadramento ?? null,
  };
}
