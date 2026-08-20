function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

export function montarInformacaoComplementarNfe(params: {
  textosAutomaticos: Array<string | null | undefined>;
  padraoEmpresa?: string | null;
  textoUsuario?: string | null;
}) {
  const partes = [
    ...params.textosAutomaticos.map((item) => texto(item)).filter(Boolean),
    texto(params.padraoEmpresa),
    texto(params.textoUsuario),
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
  return unicos.join(" ");
}

export function montarInformacaoAdicionalFisco(params: {
  textoUsuario?: string | null;
}) {
  return texto(params.textoUsuario);
}
