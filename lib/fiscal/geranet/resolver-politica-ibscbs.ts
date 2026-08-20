export type AmbienteGeranet = "1" | "2";

export type CodigoRegimeTributario =
  | 1
  | 2
  | 3
  | 4;

export type PoliticaIbscbs = {
  codigoRegimeTributario:
    CodigoRegimeTributario;

  usaCsosnIcms: boolean;

  incluirIbscbs: boolean;

  modo:
    | "normal"
    | "nao_obrigatorio_simples_2026"
    | "homologacao_forcada";

  motivo: string;
};

/**
 * Data centralizada para a ativação técnica
 * dos grupos IBS/CBS em emitentes CRT 1/2/4
 * conforme o cronograma atual da NF-e/NFC-e.
 *
 * Antes de entrar em produção em 2027,
 * revisar a NT vigente e alterar somente aqui
 * caso o cronograma oficial seja atualizado.
 */
export const INICIO_IBSCBS_SIMPLES_NFE =
  "2027-01-04";

function somenteData(
  valor: Date | string
) {
  if (valor instanceof Date) {
    if (
      Number.isNaN(
        valor.getTime()
      )
    ) {
      throw new Error(
        "Data de emissão inválida."
      );
    }

    return valor
      .toISOString()
      .slice(0, 10);
  }

  const texto = String(
    valor ?? ""
  ).trim();

  if (!texto) {
    throw new Error(
      "Data de emissão não informada."
    );
  }

  // Aceita:
  // 2026-08-11
  // 2026-08-11T23:09:00-03:00
  // 2026-08-12T02:09:00.000Z
  const match = texto.match(
    /^(\d{4}-\d{2}-\d{2})/
  );

  if (match?.[1]) {
    return match[1];
  }

  // Fallback para qualquer string de data
  // que o JavaScript consiga interpretar.
  const convertida = new Date(texto);

  if (
    Number.isNaN(
      convertida.getTime()
    )
  ) {
    throw new Error(
      "Data de emissão inválida."
    );
  }

  return convertida
    .toISOString()
    .slice(0, 10);
}

export function resolverPoliticaIbscbs({
  codigoRegimeTributario,
  dataEmissao,
  ambiente,
  forcarIbscbsHomologacao = false,
}: {
  codigoRegimeTributario:
    CodigoRegimeTributario;

  dataEmissao: Date | string;

  ambiente: AmbienteGeranet;

  forcarIbscbsHomologacao?: boolean;
}): PoliticaIbscbs {
  const data = somenteData(
    dataEmissao
  );

  const simplesOuMei =
    codigoRegimeTributario === 1 ||
    codigoRegimeTributario === 2 ||
    codigoRegimeTributario === 4;

  const usaCsosnIcms =
    codigoRegimeTributario === 1 ||
    codigoRegimeTributario === 4;

  if (
    simplesOuMei &&
    data < INICIO_IBSCBS_SIMPLES_NFE
  ) {
    if (
      ambiente === "2" &&
      forcarIbscbsHomologacao
    ) {
      return {
        codigoRegimeTributario,
        usaCsosnIcms,
        incluirIbscbs: true,
        modo: "homologacao_forcada",
        motivo:
          "IBS/CBS habilitado apenas para teste em homologação.",
      };
    }

    return {
      codigoRegimeTributario,
      usaCsosnIcms,
      incluirIbscbs: false,
      modo:
        "nao_obrigatorio_simples_2026",
      motivo:
        "Emitente CRT 1/2/4 antes do início técnico do IBS/CBS para Simples/MEI; campos omitidos.",
    };
  }

  return {
    codigoRegimeTributario,
    usaCsosnIcms,
    incluirIbscbs: true,
    modo: "normal",
    motivo:
      "IBS/CBS incluído conforme política fiscal vigente configurada no UltraPDV.",
  };
}
