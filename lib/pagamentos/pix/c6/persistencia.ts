export const MENSAGEM_C6_CERTIFICADO_NAO_SALVO =
  "C6 Bank: certificado não foi salvo. Selecione novamente o arquivo .crt/.pem.";

export const MENSAGEM_C6_CHAVE_NAO_SALVA =
  "C6 Bank: chave privada não foi salva. Selecione novamente o arquivo .key.";

export const MENSAGEM_C6_CREDENCIAIS_SALVAS =
  "Credenciais salvas com segurança.";

export type FlagsExistenciaCofreC6 = {
  clienteId: boolean;
  clienteSegredo: boolean;
  certificadoPemHexadecimal: boolean;
  chavePrivadaPemHexadecimal: boolean;
  chavePix: boolean;
};

export type DiagnosticoSeguroArquivoC6 = {
  recebido: boolean;
  size: number | null;
  temArrayBuffer: boolean;
  incluidoEmNovos: boolean;
  rpcExecutada: boolean;
  readBackEncontrou: boolean;
  motivoNaoIncluido?: string | null;
};

export type DiagnosticoSeguroC6 = {
  certificado: DiagnosticoSeguroArquivoC6;
  chave: DiagnosticoSeguroArquivoC6;
};

function presente(valor: unknown) {
  return Boolean(String(valor ?? "").trim());
}

export function flagsExistenciaCofreC6(
  cofre: Record<string, unknown> | null | undefined
): FlagsExistenciaCofreC6 {
  const dados = cofre && typeof cofre === "object" ? cofre : {};
  return {
    clienteId: presente(dados.clienteId),
    clienteSegredo: presente(dados.clienteSegredo),
    certificadoPemHexadecimal: presente(dados.certificadoPemHexadecimal),
    chavePrivadaPemHexadecimal: presente(dados.chavePrivadaPemHexadecimal),
    chavePix: presente(dados.chavePix),
  };
}

export function erroReadBackC6(flags: FlagsExistenciaCofreC6) {
  if (!flags.certificadoPemHexadecimal) {
    return MENSAGEM_C6_CERTIFICADO_NAO_SALVO;
  }
  if (!flags.chavePrivadaPemHexadecimal) {
    return MENSAGEM_C6_CHAVE_NAO_SALVA;
  }
  if (!flags.clienteId || !flags.clienteSegredo) {
    return "C6 Bank: credenciais incompletas no cofre.";
  }
  if (!flags.chavePix) {
    return "C6 Bank: informe a Chave PIX.";
  }
  return null;
}

export function salvarC6Confirmado(flags: FlagsExistenciaCofreC6) {
  return erroReadBackC6(flags) === null;
}

export function chavePixC6ParaVault(chaveDigitada: unknown) {
  const digitada = String(chaveDigitada ?? "").trim();
  return digitada || null;
}

export function diagnosticoSeguroArquivoC6(params: {
  recebido?: boolean;
  size?: number | null;
  temArrayBuffer?: boolean;
  incluidoEmNovos?: boolean;
  rpcExecutada?: boolean;
  readBackEncontrou?: boolean;
  motivoNaoIncluido?: string | null;
}): DiagnosticoSeguroArquivoC6 {
  return {
    recebido: Boolean(params.recebido),
    size: typeof params.size === "number" ? params.size : null,
    temArrayBuffer: Boolean(params.temArrayBuffer),
    incluidoEmNovos: Boolean(params.incluidoEmNovos),
    rpcExecutada: Boolean(params.rpcExecutada),
    readBackEncontrou: Boolean(params.readBackEncontrou),
    motivoNaoIncluido: params.incluidoEmNovos
      ? null
      : params.motivoNaoIncluido ?? null,
  };
}

export function respostaPublicaSalvarPixC6(params: {
  ok: boolean;
  erro?: string;
  certificadoConfigurado: boolean;
  chavePrivadaConfigurada: boolean;
  diagnostico: DiagnosticoSeguroC6;
}) {
  const diagnostico = {
    certificado: diagnosticoSeguroArquivoC6(params.diagnostico.certificado),
    chave: diagnosticoSeguroArquivoC6(params.diagnostico.chave),
  };
  const flags = {
    certificadoConfigurado: params.certificadoConfigurado,
    chavePrivadaConfigurada: params.chavePrivadaConfigurada,
    diagnostico,
  };

  if (params.ok) {
    return {
      ok: true as const,
      mensagem: MENSAGEM_C6_CREDENCIAIS_SALVAS,
      ...flags,
    };
  }

  return {
    ok: false as const,
    erro: params.erro ?? "Não foi possível salvar o PIX C6 Bank.",
    ...flags,
  };
}
