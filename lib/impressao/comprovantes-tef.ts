export type PapelComprovanteTef = "58mm" | "80mm";

export type PreferenciaComprovantesTef = {
  cadastrada: boolean;
  impressoraNome: string | null;
  papel: PapelComprovanteTef;
  viaCliente: boolean;
  viaEstabelecimento: boolean;
  reciboComercial: boolean;
};

export function preferenciaComprovantesTefAusente(): PreferenciaComprovantesTef {
  return {
    cadastrada: false,
    impressoraNome: null,
    papel: "80mm",
    viaCliente: true,
    viaEstabelecimento: true,
    reciboComercial: true,
  };
}

export function papelComprovanteTef(valor: unknown): PapelComprovanteTef {
  return valor === "58mm" ? "58mm" : "80mm";
}

export function sanitizarPreferenciaComprovantesTef(input: {
  impressoraNome?: unknown;
  papel?: unknown;
  viaCliente?: unknown;
  viaEstabelecimento?: unknown;
  reciboComercial?: unknown;
}): PreferenciaComprovantesTef {
  const impressora = String(input.impressoraNome ?? "").trim().slice(0, 200);
  return {
    cadastrada: true,
    impressoraNome: impressora || null,
    papel: papelComprovanteTef(input.papel),
    viaCliente: input.viaCliente === true,
    viaEstabelecimento: input.viaEstabelecimento === true,
    reciboComercial: input.reciboComercial === true,
  };
}

export function preferenciaComprovantesTefDaLinha(linha: {
  impressora_nome?: string | null;
  papel?: string | null;
  imprimir_via_cliente?: boolean | null;
  imprimir_via_estabelecimento?: boolean | null;
  imprimir_recibo_comercial?: boolean | null;
} | null): PreferenciaComprovantesTef {
  if (!linha) {
    return preferenciaComprovantesTefAusente();
  }
  return {
    cadastrada: true,
    impressoraNome: String(linha.impressora_nome ?? "").trim() || null,
    papel: papelComprovanteTef(linha.papel),
    viaCliente: linha.imprimir_via_cliente !== false,
    viaEstabelecimento: linha.imprimir_via_estabelecimento !== false,
    reciboComercial: linha.imprimir_recibo_comercial !== false,
  };
}

export function permitirReciboComercialNaVendaTef(preferencia: PreferenciaComprovantesTef) {
  if (!preferencia.cadastrada) {
    return true;
  }
  return preferencia.reciboComercial;
}

export function viasAutomaticasTef(preferencia: PreferenciaComprovantesTef) {
  if (!preferencia.cadastrada) {
    return { cliente: true, estabelecimento: true };
  }
  return {
    cliente: preferencia.viaCliente,
    estabelecimento: preferencia.viaEstabelecimento,
  };
}
