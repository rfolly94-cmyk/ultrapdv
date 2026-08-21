export const CSTAT_DUPLICIDADE_CHAVE = "539";

const DUPLICIDADE_CHAVE_MENSAGEM =
  /duplicidade de nf-?e com diferen[cç]a na chave de acesso/i;

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

export function cstatNormalizado(
  cstat?: unknown,
  mensagem?: unknown
) {
  const direto = texto(cstat);
  if (/^\d{3}$/.test(direto)) {
    return direto;
  }

  const textoMensagem = texto(mensagem);
  const naMensagem =
    textoMensagem.match(/rejei[cç][aã]o\s+(\d{3})/i)?.[1] ??
    textoMensagem.match(/\bcstat\s*[:=]?\s*(\d{3})\b/i)?.[1] ??
    null;
  if (naMensagem) {
    return naMensagem;
  }

  if (DUPLICIDADE_CHAVE_MENSAGEM.test(textoMensagem)) {
    return CSTAT_DUPLICIDADE_CHAVE;
  }

  return "";
}

export function ehDuplicidadeChaveAcesso(evidencia: {
  cstat?: unknown;
  mensagem?: unknown;
  motivo?: unknown;
}) {
  const mensagem = `${texto(evidencia.mensagem)} ${texto(evidencia.motivo)}`;
  const codigo = cstatNormalizado(evidencia.cstat, mensagem);
  return (
    codigo === CSTAT_DUPLICIDADE_CHAVE ||
    DUPLICIDADE_CHAVE_MENSAGEM.test(mensagem)
  );
}

export function rotuloDuplicidadeChaveAcesso(modelo?: string | number | null) {
  const nome = texto(modelo) === "55" ? "NF-e" : "NFC-e";
  return `Duplicidade de ${nome} com diferença na Chave de Acesso.`;
}

export function descricaoRejeicao539(modelo?: string | number | null) {
  return [
    `Rejeição ${CSTAT_DUPLICIDADE_CHAVE}`,
    rotuloDuplicidadeChaveAcesso(modelo),
    "",
    "Já existe um documento fiscal utilizando esta série e número.",
    "Consulte a situação fiscal antes de realizar uma nova emissão.",
  ].join("\n");
}

export function consolidarEvidencia539(input: {
  cstat?: unknown;
  motivo?: unknown;
  tentativaCstat?: unknown;
  tentativaMotivo?: unknown;
}) {
  const mensagem = `${texto(input.motivo)} ${texto(input.tentativaMotivo)}`;
  const cstat =
    cstatNormalizado(input.tentativaCstat ?? input.cstat, mensagem) ||
    texto(input.tentativaCstat) ||
    texto(input.cstat) ||
    null;
  const duplicidade = ehDuplicidadeChaveAcesso({
    cstat,
    mensagem,
  });
  const motivoTentativa = texto(input.tentativaMotivo);
  const motivoEmissao = texto(input.motivo);
  const motivoProcessando =
    /ainda está sendo processado|em processamento|aguardando processamento/i;
  let motivo = motivoEmissao || motivoTentativa || null;
  if (duplicidade) {
    if (motivoTentativa && ehDuplicidadeChaveAcesso({ mensagem: motivoTentativa })) {
      motivo = motivoTentativa;
    } else if (motivoEmissao && !motivoProcessando.test(motivoEmissao)) {
      motivo = motivoEmissao;
    } else {
      motivo = motivoTentativa || rotuloDuplicidadeChaveAcesso();
    }
  }

  return {
    cstat,
    motivo,
    duplicidade,
  };
}
