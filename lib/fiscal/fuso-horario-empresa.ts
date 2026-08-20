import {
  idEmpresaAtiva,
  registroPertenceAEmpresaAtiva,
} from "@/lib/empresa/assert-registro-empresa-ativa";

export const MENSAGEM_FUSO_NAO_CONFIGURADO =
  "Fuso horário fiscal da empresa não está configurado.";

export const MENSAGEM_FUSO_OUTRA_EMPRESA =
  "Não é permitido alterar o fuso horário de outra empresa.";

export const MENSAGEM_FUSO_INVALIDO =
  "Fuso horário fiscal inválido.";

export const MENSAGEM_FISCAL_OUTRA_EMPRESA_EMISSAO =
  "Configuração fiscal não pertence à empresa da emissão.";

export const MENSAGEM_EMPRESA_ATIVA_AUSENTE =
  "Empresa ativa não resolvida.";

export type OpcaoFusoHorarioFiscal = {
  valor: string;
  rotulo: string;
};

export const FUSOS_HORARIOS_FISCAIS_BR: readonly OpcaoFusoHorarioFiscal[] = [
  { valor: "America/Noronha", rotulo: "America/Noronha — Fernando de Noronha" },
  { valor: "America/Belem", rotulo: "America/Belem — Pará e Amapá" },
  { valor: "America/Fortaleza", rotulo: "America/Fortaleza — Ceará, Maranhão, Piauí, RN, PB" },
  { valor: "America/Recife", rotulo: "America/Recife — Pernambuco" },
  { valor: "America/Maceio", rotulo: "America/Maceio — Alagoas e Sergipe" },
  { valor: "America/Bahia", rotulo: "America/Bahia — Bahia" },
  { valor: "America/Sao_Paulo", rotulo: "America/Sao_Paulo — Brasília e a maioria das UFs" },
  { valor: "America/Araguaina", rotulo: "America/Araguaina — Tocantins" },
  { valor: "America/Campo_Grande", rotulo: "America/Campo_Grande — Mato Grosso do Sul" },
  { valor: "America/Cuiaba", rotulo: "America/Cuiaba — Mato Grosso" },
  { valor: "America/Porto_Velho", rotulo: "America/Porto_Velho — Rondônia" },
  { valor: "America/Boa_Vista", rotulo: "America/Boa_Vista — Roraima" },
  { valor: "America/Manaus", rotulo: "America/Manaus — Amazonas" },
  { valor: "America/Rio_Branco", rotulo: "America/Rio_Branco — Acre" },
];

const FUSOS_PERMITIDOS = new Set(
  FUSOS_HORARIOS_FISCAIS_BR.map((item) => item.valor)
);

export type FiscalFusoHorario = {
  empresa_id?: string | null;
  fuso_horario?: string | null;
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

export function fusoHorarioIanaValido(valor: unknown) {
  const fuso = texto(valor);

  if (!fuso || !FUSOS_PERMITIDOS.has(fuso)) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: fuso }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizarFusoHorarioFiscal(valor: unknown) {
  const fuso = texto(valor);

  if (!fuso) {
    return null;
  }

  if (
    /^[+-]\d{2}:\d{2}$/.test(fuso) ||
    /^-0[34]:00$/.test(fuso)
  ) {
    return null;
  }

  return fusoHorarioIanaValido(fuso) ? fuso : null;
}

export function opcoesFusoHorarioFiscal(valorAtual?: string | null) {
  const atual = texto(valorAtual);
  if (
    atual &&
    fusoHorarioIanaValido(atual) &&
    !FUSOS_PERMITIDOS.has(atual)
  ) {
    return [{ valor: atual, rotulo: atual }, ...FUSOS_HORARIOS_FISCAIS_BR];
  }

  return [...FUSOS_HORARIOS_FISCAIS_BR];
}

export function resolverEmpresaParaGravarFuso(args: {
  empresaIdAtiva: unknown;
  empresaIdSolicitada?: unknown;
}) {
  const empresaIdAtiva = idEmpresaAtiva(args.empresaIdAtiva);

  if (!empresaIdAtiva) {
    throw new Error(MENSAGEM_EMPRESA_ATIVA_AUSENTE);
  }

  const solicitada = idEmpresaAtiva(args.empresaIdSolicitada);

  if (solicitada && solicitada !== empresaIdAtiva) {
    throw new Error(MENSAGEM_FUSO_OUTRA_EMPRESA);
  }

  return empresaIdAtiva;
}

export function fusoHorarioParaGravacao(valor: unknown) {
  const bruto = texto(valor);

  if (!bruto) {
    return null;
  }

  const fuso = normalizarFusoHorarioFiscal(bruto);

  if (!fuso) {
    throw new Error(MENSAGEM_FUSO_INVALIDO);
  }

  return fuso;
}

export function carregarFusoHorarioFiscal(
  fiscal: FiscalFusoHorario | null | undefined,
  empresaIdAtiva: unknown
) {
  if (!registroPertenceAEmpresaAtiva(fiscal, empresaIdAtiva)) {
    return null;
  }

  return normalizarFusoHorarioFiscal(fiscal?.fuso_horario);
}

export function exigirFusoHorarioFiscalDaEmissao(args: {
  empresaIdDaEmissao: unknown;
  fiscal: FiscalFusoHorario | null | undefined;
}) {
  if (
    !registroPertenceAEmpresaAtiva(
      args.fiscal,
      args.empresaIdDaEmissao
    )
  ) {
    throw new Error(MENSAGEM_FISCAL_OUTRA_EMPRESA_EMISSAO);
  }

  const fuso = normalizarFusoHorarioFiscal(args.fiscal?.fuso_horario);

  if (!fuso) {
    throw new Error(MENSAGEM_FUSO_NAO_CONFIGURADO);
  }

  return fuso;
}

export function checkFusoHorarioProntidao(
  fiscal: FiscalFusoHorario | null | undefined,
  empresaIdAtiva: unknown
) {
  const fuso = carregarFusoHorarioFiscal(fiscal, empresaIdAtiva);

  return {
    codigo: "fuso" as const,
    titulo: "Fuso horário fiscal",
    ok: Boolean(fuso),
    detalhe: fuso
      ? `Fuso: ${fuso}`
      : MENSAGEM_FUSO_NAO_CONFIGURADO,
    obrigatorio: true,
  };
}

export function checkNaturezaProntidao(
  naturezaVenda: {
    empresa_id?: string | null;
    descricao?: string | null;
    tp_nf?: string | null;
    fin_nfe?: string | null;
  } | null | undefined,
  empresaIdAtiva: unknown
) {
  const daEmpresa = registroPertenceAEmpresaAtiva(
    naturezaVenda,
    empresaIdAtiva
  )
    ? naturezaVenda
    : null;

  const descricao = texto(daEmpresa?.descricao);

  return {
    codigo: "natureza" as const,
    titulo: "Natureza padrão de venda",
    ok: Boolean(descricao),
    detalhe: descricao
      ? `Natureza: ${descricao} · tpNF ${texto(daEmpresa?.tp_nf) || "—"} · finNFe ${texto(daEmpresa?.fin_nfe) || "—"}.`
      : "Natureza padrão de venda não está configurada.",
    obrigatorio: true,
  };
}

export function montarUpdateFusoHorarioDaEmpresaAtiva(args: {
  empresaIdAtiva: unknown;
  empresaIdSolicitada?: unknown;
  fusoHorario: unknown;
}) {
  const empresaId = resolverEmpresaParaGravarFuso({
    empresaIdAtiva: args.empresaIdAtiva,
    empresaIdSolicitada: args.empresaIdSolicitada,
  });

  return {
    empresaId,
    fuso_horario: fusoHorarioParaGravacao(args.fusoHorario),
  };
}
