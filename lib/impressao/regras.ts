import {
  COPIAS_IMPRESSAO_MAX,
  COPIAS_IMPRESSAO_MIN,
  PAPEIS_IMPRESSAO,
  TIPOS_DOCUMENTO_IMPRESSAO,
  type ConfiguracaoImpressao,
  type DestinoImpressaoAutomatica,
  type PapelImpressao,
  type TipoDocumentoImpressao,
} from "./tipos";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function ehUuid(valor: unknown): valor is string {
  return UUID_RE.test(String(valor ?? "").trim());
}

export function ehTipoDocumentoImpressao(
  valor: unknown
): valor is TipoDocumentoImpressao {
  return TIPOS_DOCUMENTO_IMPRESSAO.includes(
    String(valor ?? "") as TipoDocumentoImpressao
  );
}

export function ehPapelImpressao(valor: unknown): valor is PapelImpressao {
  return PAPEIS_IMPRESSAO.includes(String(valor ?? "") as PapelImpressao);
}

export function papelPadraoDoTipo(
  tipo: TipoDocumentoImpressao
): PapelImpressao {
  if (tipo === "danfe_nfe") {
    return "a4";
  }
  return "80mm";
}

export function rotuloTipoDocumentoImpressao(tipo: TipoDocumentoImpressao) {
  if (tipo === "recibo") {
    return "Recibo de venda";
  }
  if (tipo === "danfe_nfce") {
    return "DANFE NFC-e";
  }
  return "DANFE NF-e";
}

export function sanitizarCopiasImpressao(valor: unknown) {
  const n = Math.floor(Number(valor));
  if (!Number.isFinite(n)) {
    return 1;
  }
  return Math.min(COPIAS_IMPRESSAO_MAX, Math.max(COPIAS_IMPRESSAO_MIN, n));
}

export function sanitizarConfiguracaoImpressao(input: {
  tipoDocumento: unknown;
  impressoraNome?: unknown;
  papel?: unknown;
  copias?: unknown;
  impressaoAutomatica?: unknown;
  ativo?: unknown;
  id?: unknown;
}): ConfiguracaoImpressao | null {
  if (!ehTipoDocumentoImpressao(input.tipoDocumento)) {
    return null;
  }

  const papel = ehPapelImpressao(input.papel)
    ? input.papel
    : papelPadraoDoTipo(input.tipoDocumento);

  const nome = String(input.impressoraNome ?? "").trim();

  return {
    id: String(input.id ?? "").trim() || null,
    tipoDocumento: input.tipoDocumento,
    impressoraNome: nome || null,
    papel,
    copias: sanitizarCopiasImpressao(input.copias),
    impressaoAutomatica: input.impressaoAutomatica === true,
    ativo: input.ativo !== false,
  };
}

export function configuracaoPadrao(
  tipo: TipoDocumentoImpressao
): ConfiguracaoImpressao {
  return {
    id: null,
    tipoDocumento: tipo,
    impressoraNome: null,
    papel: papelPadraoDoTipo(tipo),
    copias: 1,
    impressaoAutomatica: false,
    ativo: true,
  };
}

export function completarConfiguracoesImpressao(
  registros: ConfiguracaoImpressao[]
) {
  return TIPOS_DOCUMENTO_IMPRESSAO.map((tipo) => {
    return (
      registros.find((item) => item.tipoDocumento === tipo) ??
      configuracaoPadrao(tipo)
    );
  });
}

export function configDoTipo(
  configs: ConfiguracaoImpressao[],
  tipo: TipoDocumentoImpressao
) {
  return (
    configs.find(
      (item) =>
        item.tipoDocumento === tipo && item.ativo !== false
    ) ?? configuracaoPadrao(tipo)
  );
}

export function podeImprimirAutomaticamente(
  config: ConfiguracaoImpressao | null | undefined
) {
  return Boolean(
    config && config.ativo !== false && config.impressaoAutomatica === true
  );
}

export function danfeNfceAutorizadaImprimivel(fiscal: {
  emitindo?: boolean;
  kind?: string | null;
  status?: string | null;
  emissaoId?: string | null;
  danfeDisponivel?: boolean;
} | null) {
  return Boolean(
    fiscal &&
      !fiscal.emitindo &&
      fiscal.kind === "autorizada" &&
      fiscal.status === "autorizada" &&
      fiscal.emissaoId &&
      fiscal.danfeDisponivel
  );
}

export function decidirDocumentoImpressao(input: {
  vendaId: string;
  fiscal?: {
    emitindo?: boolean;
    kind?: string | null;
    status?: string | null;
    emissaoId?: string | null;
    danfeDisponivel?: boolean;
  } | null;
}): DestinoImpressaoAutomatica {
  const vendaId = String(input.vendaId ?? "").trim();
  if (!vendaId) {
    return { tipo: "nenhum" };
  }

  if (
    danfeNfceAutorizadaImprimivel(input.fiscal ?? null) &&
    input.fiscal?.emissaoId
  ) {
    return {
      tipo: "danfe_nfce",
      emissaoId: input.fiscal.emissaoId,
    };
  }

  return { tipo: "recibo", vendaId };
}

export function decidirDestinoImpressaoAutomatica(input: {
  configs: ConfiguracaoImpressao[];
  vendaId: string;
  fiscal?: {
    emitindo?: boolean;
    kind?: string | null;
    status?: string | null;
    emissaoId?: string | null;
    danfeDisponivel?: boolean;
  } | null;
}): DestinoImpressaoAutomatica {
  const destino = decidirDocumentoImpressao(input);
  if (destino.tipo === "nenhum") {
    return destino;
  }

  const tipo = destino.tipo === "recibo" ? "recibo" : destino.tipo;
  if (!podeImprimirAutomaticamente(configDoTipo(input.configs, tipo))) {
    return { tipo: "nenhum" };
  }

  return destino;
}
