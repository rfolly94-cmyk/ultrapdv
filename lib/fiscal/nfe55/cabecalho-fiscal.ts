import {
  ehFinNfeSuportada,
  ehTpNf,
  type FinNfeSuportada,
  type TpNf,
} from "@/lib/fiscal/operacoes/catalogo";

export const INDICADORES_PRESENCA_NFE = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "9",
] as const;

export type IndicadorPresencaNfe = (typeof INDICADORES_PRESENCA_NFE)[number];

export const ROTULOS_INDICADOR_PRESENCA_NFE: Record<IndicadorPresencaNfe, string> = {
  "0": "0 - Não se aplica",
  "1": "1 - Operação presencial",
  "2": "2 - Internet",
  "3": "3 - Teleatendimento",
  "4": "4 - Entrega a domicílio",
  "5": "5 - Fora do estabelecimento",
  "9": "9 - Operação não presencial, outros",
};

export const INDICADORES_INTERMEDIADOR_NFE = ["0", "1"] as const;

export type IndicadorIntermediadorNfe =
  (typeof INDICADORES_INTERMEDIADOR_NFE)[number];

export const ROTULOS_INDICADOR_INTERMEDIADOR_NFE: Record<
  IndicadorIntermediadorNfe,
  string
> = {
  "0": "0 - Sem intermediador",
  "1": "1 - Com intermediador",
};

export type AuditoriaCabecalhoFiscal = {
  usuario_id: string;
  empresa_id: string;
  em: string;
  antes: Record<string, unknown>;
  depois: Record<string, unknown>;
};

export type NumeracaoNfeEmpresa = {
  modelo?: string | number | null;
  ambiente?: string | number | null;
  serie?: string | number | null;
  proximo_numero?: string | number | null;
  ativo?: boolean | null;
};

export type CabecalhoFiscalSnapshot = {
  tpNf: TpNf | null;
  serie: number | null;
  numero: number | null;
  numeracaoAutomatica: boolean;
  indicadorPresenca: IndicadorPresencaNfe | null;
  indicativoIntermediador: IndicadorIntermediadorNfe | null;
  finNfe: FinNfeSuportada | null;
  dataEmissao: string | null;
  horaEmissao: string | null;
  dataSaida: string | null;
  horaSaida: string | null;
};

export const MENSAGEM_SERIE_NFE_INVALIDA =
  "A série não pertence à empresa ativa, não está ativa para o modelo 55 no ambiente atual ou é inválida.";

export const MENSAGEM_NUMERO_NFE_DUPLICADO =
  "Já existe documento fiscal com esta empresa, ambiente, modelo, série e número.";

export const MENSAGEM_NUMERO_NFE_INVALIDO =
  "Informe um número de NF-e inteiro maior que zero.";

export const MENSAGEM_NUMERACAO_JA_RESERVADA =
  "A numeração desta NF-e já foi reservada ou a transmissão já começou. Série e número não podem mais ser alterados.";

const LIMITE_AUDITORIA_CABECALHO = 40;

export function ehIndicadorPresencaNfe(
  valor: unknown
): valor is IndicadorPresencaNfe {
  return INDICADORES_PRESENCA_NFE.includes(String(valor ?? "") as IndicadorPresencaNfe);
}

export function ehIndicadorIntermediadorNfe(
  valor: unknown
): valor is IndicadorIntermediadorNfe {
  return valor === "0" || valor === "1";
}

export function validarDataFiscal(valor: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(valor.trim());
}

export function validarHoraFiscal(valor: string) {
  return /^\d{2}:\d{2}(:\d{2})?$/.test(valor.trim());
}

export const validarDataSaidaFiscal = validarDataFiscal;
export const validarHoraSaidaFiscal = validarHoraFiscal;

function textoOuNulo(valor: unknown) {
  const texto = String(valor ?? "").trim();
  return texto || null;
}

function inteiroPositivo(valor: unknown) {
  const texto = String(valor ?? "").trim();
  if (!/^\d+$/.test(texto)) {
    return null;
  }
  const numero = Number(texto);
  if (!Number.isInteger(numero) || numero <= 0) {
    return null;
  }
  return numero;
}

export function serieNfeFaixaValida(serie: number) {
  return (serie >= 1 && serie <= 889) || (serie >= 920 && serie <= 969);
}

export function lerCabecalhoFiscalDoSnapshot(
  snapshot: unknown
): CabecalhoFiscalSnapshot {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {
      tpNf: null,
      serie: null,
      numero: null,
      numeracaoAutomatica: true,
      indicadorPresenca: null,
      indicativoIntermediador: null,
      finNfe: null,
      dataEmissao: null,
      horaEmissao: null,
      dataSaida: null,
      horaSaida: null,
    };
  }
  const bruto = snapshot as Record<string, unknown>;
  const tpNf = textoOuNulo(bruto.tp_nf);
  const indicador = textoOuNulo(bruto.indicador_presenca);
  const intermediador = textoOuNulo(bruto.indicativo_intermediador);
  const finNfe = textoOuNulo(bruto.fin_nfe);
  const dataEmissao = textoOuNulo(bruto.data_emissao);
  const horaEmissao = textoOuNulo(bruto.hora_emissao);
  const dataSaida = textoOuNulo(bruto.data_saida);
  const horaSaida = textoOuNulo(bruto.hora_saida);
  const automaticaBruto = bruto.numeracao_automatica;
  const numero = inteiroPositivo(bruto.numero);
  return {
    tpNf: ehTpNf(tpNf) ? tpNf : null,
    serie: inteiroPositivo(bruto.serie),
    numero,
    numeracaoAutomatica:
      automaticaBruto === false || automaticaBruto === "false"
        ? false
        : automaticaBruto === true || automaticaBruto === "true"
          ? true
          : numero == null,
    indicadorPresenca: ehIndicadorPresencaNfe(indicador) ? indicador : null,
    indicativoIntermediador: ehIndicadorIntermediadorNfe(intermediador)
      ? intermediador
      : null,
    finNfe: ehFinNfeSuportada(finNfe) ? finNfe : null,
    dataEmissao:
      dataEmissao && validarDataFiscal(dataEmissao) ? dataEmissao : null,
    horaEmissao:
      horaEmissao && validarHoraFiscal(horaEmissao) ? horaEmissao : null,
    dataSaida: dataSaida && validarDataFiscal(dataSaida) ? dataSaida : null,
    horaSaida: horaSaida && validarHoraFiscal(horaSaida) ? horaSaida : null,
  };
}

export function montarDataHoraSaidaGeranet(dataSaida: string, horaSaida: string) {
  const data = dataSaida.trim();
  const hora = horaSaida.trim();
  if (!validarDataFiscal(data) || !validarHoraFiscal(hora)) {
    return null;
  }
  const horaComSegundos = hora.length === 5 ? `${hora}:00` : hora;
  return `${data} ${horaComSegundos}`;
}

export function escolherNumeracaoNfe55(params: {
  numeracoes: NumeracaoNfeEmpresa[];
  ambiente: string | number;
  serieEscolhida?: number | null;
}): { ok: true; numeracao: NumeracaoNfeEmpresa } | { ok: false; mensagem: string } {
  const ambiente = String(params.ambiente);
  const daEmpresa = params.numeracoes.filter(
    (item) =>
      String(item.modelo ?? "") === "55" &&
      String(item.ambiente ?? "") === ambiente &&
      item.ativo !== false
  );
  if (params.serieEscolhida != null) {
    if (!serieNfeFaixaValida(params.serieEscolhida)) {
      return { ok: false, mensagem: MENSAGEM_SERIE_NFE_INVALIDA };
    }
    const encontrada = daEmpresa.find(
      (item) => Number(item.serie) === params.serieEscolhida
    );
    if (!encontrada) {
      return { ok: false, mensagem: MENSAGEM_SERIE_NFE_INVALIDA };
    }
    return { ok: true, numeracao: encontrada };
  }
  if (daEmpresa.length === 1 && daEmpresa[0]) {
    return { ok: true, numeracao: daEmpresa[0] };
  }
  if (daEmpresa.length === 0) {
    return { ok: false, mensagem: MENSAGEM_SERIE_NFE_INVALIDA };
  }
  return {
    ok: false,
    mensagem: "Há mais de uma série NF-e 55 ativa. Selecione a série no cabeçalho.",
  };
}

export function numeroNfeEmConflito(params: {
  empresaId: string;
  ambiente: string | number;
  modelo?: string;
  serie: number;
  numero: number;
  operacaoIdAtual?: string | null;
  emissoes: Array<{
    empresa_id?: string | null;
    modelo?: string | number | null;
    ambiente?: string | number | null;
    serie?: string | number | null;
    numero?: string | number | null;
    status?: string | null;
  }>;
  rascunhos?: Array<{
    id?: string | null;
    empresa_id?: string | null;
    snapshot_fiscal?: unknown;
  }>;
}) {
  const modelo = params.modelo ?? "55";
  const ambiente = String(params.ambiente);
  const conflitoEmissao = params.emissoes.some(
    (emissao) =>
      String(emissao.empresa_id ?? "") === params.empresaId &&
      String(emissao.modelo ?? "") === modelo &&
      String(emissao.ambiente ?? "") === ambiente &&
      Number(emissao.serie) === params.serie &&
      Number(emissao.numero) === params.numero
  );
  if (conflitoEmissao) {
    return MENSAGEM_NUMERO_NFE_DUPLICADO;
  }
  const conflitoRascunho = (params.rascunhos ?? []).some((operacao) => {
    if (
      params.operacaoIdAtual &&
      String(operacao.id ?? "") === String(params.operacaoIdAtual)
    ) {
      return false;
    }
    if (String(operacao.empresa_id ?? "") !== params.empresaId) {
      return false;
    }
    const cabecalho = lerCabecalhoFiscalDoSnapshot(operacao.snapshot_fiscal);
    return (
      !cabecalho.numeracaoAutomatica &&
      cabecalho.serie === params.serie &&
      cabecalho.numero === params.numero
    );
  });
  return conflitoRascunho ? MENSAGEM_NUMERO_NFE_DUPLICADO : null;
}

export function resolverPayloadCabecalhoNfe(params: {
  snapshot: unknown;
  finNfeOperacao?: string | null;
  finNfeNatureza?: string | null;
  tpNfOperacao?: string | null;
  indicadorPresencaPadraoEmpresa?: string | null;
  indicativoIntermediadorPadraoEmpresa?: string | null;
  dataHoraEmissao: string;
}): {
  tpNf: TpNf | null;
  indicadorPresenca: string;
  indicativoIntermediador: string;
  finNfe: FinNfeSuportada | null;
  dataEmissao: string;
  dataSaida: string;
  serie: number | null;
  numero: number | null;
  numeracaoAutomatica: boolean;
} {
  const cabecalho = lerCabecalhoFiscalDoSnapshot(params.snapshot);
  const finNfe =
    cabecalho.finNfe ??
    (ehFinNfeSuportada(params.finNfeOperacao) ? params.finNfeOperacao : null) ??
    (ehFinNfeSuportada(params.finNfeNatureza) ? params.finNfeNatureza : null);
  const tpNf =
    cabecalho.tpNf ?? (ehTpNf(params.tpNfOperacao) ? params.tpNfOperacao : null);
  const indicador =
    cabecalho.indicadorPresenca ??
    (ehIndicadorPresencaNfe(params.indicadorPresencaPadraoEmpresa)
      ? params.indicadorPresencaPadraoEmpresa
      : "9");
  const intermediador =
    cabecalho.indicativoIntermediador ??
    (ehIndicadorIntermediadorNfe(params.indicativoIntermediadorPadraoEmpresa)
      ? params.indicativoIntermediadorPadraoEmpresa
      : "0");
  const dataEmissaoManual =
    cabecalho.dataEmissao && cabecalho.horaEmissao
      ? montarDataHoraSaidaGeranet(cabecalho.dataEmissao, cabecalho.horaEmissao)
      : null;
  const dataSaida =
    cabecalho.dataSaida && cabecalho.horaSaida
      ? montarDataHoraSaidaGeranet(cabecalho.dataSaida, cabecalho.horaSaida)
      : null;
  const dataEmissao = dataEmissaoManual ?? params.dataHoraEmissao;
  return {
    tpNf,
    indicadorPresenca: indicador,
    indicativoIntermediador: intermediador,
    finNfe,
    dataEmissao,
    dataSaida: dataSaida ?? dataEmissao,
    serie: cabecalho.serie,
    numero: cabecalho.numeracaoAutomatica ? null : cabecalho.numero,
    numeracaoAutomatica: cabecalho.numeracaoAutomatica,
  };
}

export function camposCabecalhoParaSnapshot(input: {
  tpNf?: string | null;
  serie?: number | string | null;
  numero?: number | string | null;
  numeracaoAutomatica?: boolean | null;
  indicadorPresenca?: string | null;
  indicativoIntermediador?: string | null;
  finNfe?: string | null;
  dataEmissao?: string | null;
  horaEmissao?: string | null;
  dataSaida?: string | null;
  horaSaida?: string | null;
}): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  if (input.tpNf !== undefined) {
    extra.tp_nf = ehTpNf(input.tpNf) ? input.tpNf : null;
  }
  if (input.serie !== undefined) {
    extra.serie = inteiroPositivo(input.serie);
  }
  if (input.numeracaoAutomatica !== undefined) {
    extra.numeracao_automatica = input.numeracaoAutomatica !== false;
  }
  if (input.numero !== undefined) {
    extra.numero =
      input.numeracaoAutomatica === false ? inteiroPositivo(input.numero) : null;
  }
  if (input.indicadorPresenca !== undefined) {
    extra.indicador_presenca = ehIndicadorPresencaNfe(input.indicadorPresenca)
      ? input.indicadorPresenca
      : null;
  }
  if (input.indicativoIntermediador !== undefined) {
    extra.indicativo_intermediador = ehIndicadorIntermediadorNfe(
      input.indicativoIntermediador
    )
      ? input.indicativoIntermediador
      : null;
  }
  if (input.finNfe !== undefined) {
    extra.fin_nfe = ehFinNfeSuportada(input.finNfe) ? input.finNfe : null;
  }
  if (input.dataEmissao !== undefined) {
    const data = String(input.dataEmissao ?? "").trim();
    extra.data_emissao = data && validarDataFiscal(data) ? data : null;
  }
  if (input.horaEmissao !== undefined) {
    const hora = String(input.horaEmissao ?? "").trim();
    extra.hora_emissao = hora && validarHoraFiscal(hora) ? hora : null;
  }
  if (input.dataSaida !== undefined) {
    const data = String(input.dataSaida ?? "").trim();
    extra.data_saida = data && validarDataFiscal(data) ? data : null;
  }
  if (input.horaSaida !== undefined) {
    const hora = String(input.horaSaida ?? "").trim();
    extra.hora_saida = hora && validarHoraFiscal(hora) ? hora : null;
  }
  return extra;
}

export function anexarAuditoriaCabecalhoFiscal(
  snapshot: unknown,
  entrada: AuditoriaCabecalhoFiscal
): AuditoriaCabecalhoFiscal[] {
  const base =
    snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? (snapshot as { auditoria_cabecalho?: unknown }).auditoria_cabecalho
      : null;
  const atual = Array.isArray(base)
    ? base.filter(
        (item): item is AuditoriaCabecalhoFiscal =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
    : [];
  return [...atual, entrada].slice(-LIMITE_AUDITORIA_CABECALHO);
}

export function argsNumeroManualReservaNfe(cabecalho: CabecalhoFiscalSnapshot) {
  if (!cabecalho.numeracaoAutomatica && cabecalho.numero != null) {
    return { p_numero: cabecalho.numero };
  }
  return {};
}

export function recorteAuditoriaCabecalho(campos: {
  naturezaId?: string | null;
  tpNf?: string | null;
  serie?: number | null;
  numero?: number | null;
  numeracaoAutomatica?: boolean | null;
  finNfe?: string | null;
  indicadorPresenca?: string | null;
  indicativoIntermediador?: string | null;
  dataEmissao?: string | null;
  horaEmissao?: string | null;
  dataSaida?: string | null;
  horaSaida?: string | null;
  informacaoComplementarUsuario?: string | null;
  informacaoAdicionalFisco?: string | null;
}) {
  return {
    natureza_id: campos.naturezaId ?? null,
    tp_nf: campos.tpNf ?? null,
    serie: campos.serie ?? null,
    numero: campos.numero ?? null,
    numeracao_automatica: campos.numeracaoAutomatica ?? true,
    fin_nfe: campos.finNfe ?? null,
    indicador_presenca: campos.indicadorPresenca ?? null,
    indicativo_intermediador: campos.indicativoIntermediador ?? null,
    data_emissao: campos.dataEmissao ?? null,
    hora_emissao: campos.horaEmissao ?? null,
    data_saida: campos.dataSaida ?? null,
    hora_saida: campos.horaSaida ?? null,
    informacao_complementar_usuario: campos.informacaoComplementarUsuario ?? null,
    informacao_adicional_fisco: campos.informacaoAdicionalFisco ?? null,
  };
}
