/** Limite SEFAZ de infAdic.infCpl. */
export const LIMITE_INF_CPL_NFE = 5000;
/** Limite SEFAZ de infAdic.infAdFisco. */
export const LIMITE_INF_ADFISCO_NFE = 2000;

function codePointXml10Valido(cp: number) {
  return (
    cp === 0x9 ||
    cp === 0xa ||
    cp === 0xd ||
    (cp >= 0x20 && cp <= 0xd7ff) ||
    (cp >= 0xe000 && cp <= 0xfffd) ||
    (cp >= 0x10000 && cp <= 0x10ffff)
  );
}

/**
 * Remove só caracteres ilegais em XML 1.0. Não apaga acentos, pontuação
 * nem `<>&` — a Geranet escapa no XML. Corta no limite da NF-e.
 */
export function sanitizarTextoInfAdicNfe(valor: unknown, limite: number): string {
  const bruto = String(valor ?? "");
  const teto = Number.isFinite(limite) && limite > 0 ? Math.floor(limite) : 0;
  if (teto <= 0) {
    return "";
  }
  let saida = "";
  for (const ch of bruto) {
    const cp = ch.codePointAt(0) ?? 0;
    if (!codePointXml10Valido(cp)) {
      continue;
    }
    if (saida.length + ch.length > teto) {
      break;
    }
    saida += ch;
  }
  return saida;
}

export function persistirTextoInfAdicNfe(
  valor: unknown,
  limite: number
): string | null {
  const limpo = sanitizarTextoInfAdicNfe(valor, limite).trim();
  return limpo || null;
}

function lerChaveSnapshot(snapshot: unknown, chave: string): unknown {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return undefined;
  }
  return (snapshot as Record<string, unknown>)[chave];
}

export function textoUsuarioInfCplNfe(params: {
  snapshot?: unknown;
  coluna?: string | null;
}): string | null {
  const doSnapshot = persistirTextoInfAdicNfe(
    lerChaveSnapshot(params.snapshot, "informacao_complementar_usuario"),
    LIMITE_INF_CPL_NFE
  );
  if (doSnapshot) {
    return doSnapshot;
  }
  return persistirTextoInfAdicNfe(params.coluna, LIMITE_INF_CPL_NFE);
}

export function textoUsuarioInfAdFiscoNfe(params: {
  snapshot?: unknown;
  coluna?: string | null;
}): string | null {
  const doSnapshot = persistirTextoInfAdicNfe(
    lerChaveSnapshot(params.snapshot, "informacao_adicional_fisco"),
    LIMITE_INF_ADFISCO_NFE
  );
  if (doSnapshot) {
    return doSnapshot;
  }
  return persistirTextoInfAdicNfe(params.coluna, LIMITE_INF_ADFISCO_NFE);
}

export function montarInformacaoComplementarNfe(params: {
  textosAutomaticos: Array<string | null | undefined>;
  padraoEmpresa?: string | null;
  textoUsuario?: string | null;
}) {
  const partes = [
    ...params.textosAutomaticos.map((item) =>
      sanitizarTextoInfAdicNfe(item, LIMITE_INF_CPL_NFE).trim()
    ),
    sanitizarTextoInfAdicNfe(params.padraoEmpresa, LIMITE_INF_CPL_NFE).trim(),
    sanitizarTextoInfAdicNfe(params.textoUsuario, LIMITE_INF_CPL_NFE).trim(),
  ].filter(Boolean);

  const vistos = new Set<string>();
  const unicos: string[] = [];
  for (const parte of partes) {
    if (vistos.has(parte)) {
      continue;
    }
    vistos.add(parte);
    unicos.push(parte);
  }
  return sanitizarTextoInfAdicNfe(unicos.join(" "), LIMITE_INF_CPL_NFE);
}

export function montarInformacaoAdicionalFisco(params: {
  textoUsuario?: string | null;
}) {
  return sanitizarTextoInfAdicNfe(
    params.textoUsuario,
    LIMITE_INF_ADFISCO_NFE
  ).trim();
}
