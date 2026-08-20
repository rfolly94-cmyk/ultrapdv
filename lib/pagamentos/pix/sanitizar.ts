const CHAVES_SECRETAS =
  /certificado|senha|api.?key|token|authorization|csc|csrt|password|secret|clienteSegredo|clienteId|chaveUsuario|chavePrivada|chaveConsumidor|segredoConsumidor|chaveAplicacao|autenticacaoApi|chaveAutenticacao/i;

export function sanitizarRespostaPix(valor: unknown): unknown {
  if (valor === null || valor === undefined) {
    return valor;
  }

  if (Array.isArray(valor)) {
    return valor.map(sanitizarRespostaPix);
  }

  if (typeof valor !== "object") {
    if (typeof valor === "string" && valor.length > 400) {
      return "[omitido]";
    }

    return valor;
  }

  const saida: Record<string, unknown> = {};

  for (const [chave, conteudo] of Object.entries(
    valor as Record<string, unknown>
  )) {
    if (CHAVES_SECRETAS.test(chave)) {
      saida[chave] = "[oculto]";
      continue;
    }

    if (
      typeof conteudo === "string" &&
      conteudo.length > 80 &&
      /^[0-9a-fA-F]+$/.test(conteudo)
    ) {
      saida[chave] = "[hex-oculto]";
      continue;
    }

    saida[chave] = sanitizarRespostaPix(conteudo);
  }

  return saida;
}

export function payloadSemCredenciais(payload: Record<string, unknown>) {
  const { credenciais: _credenciais, ...resto } = payload;
  return sanitizarRespostaPix({
    ...resto,
    credenciais: "[oculto]",
  });
}
