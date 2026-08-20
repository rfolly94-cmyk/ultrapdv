import {
  POSICAO_ASSISTENTE_PADRAO,
  type LadoAssistente,
  type PosicaoAssistente,
} from "./tipos";

const MARGEM = 16;
const TAMANHO_BOTAO = 56;

export function sanitizarPosicaoAssistente(
  entrada: Partial<PosicaoAssistente> | null | undefined
): PosicaoAssistente {
  const lado: LadoAssistente =
    entrada?.lado === "left" ? "left" : "right";
  const offset = Number(entrada?.offsetY);
  const offsetY = Number.isFinite(offset)
    ? Math.min(100, Math.max(0, offset))
    : POSICAO_ASSISTENTE_PADRAO.offsetY;
  return { lado, offsetY };
}

export function snapLadoAssistente(x: number, larguraViewport: number): LadoAssistente {
  return x + TAMANHO_BOTAO / 2 < larguraViewport / 2 ? "left" : "right";
}

export function pixelsDaPosicaoAssistente(
  posicao: PosicaoAssistente,
  viewport: { width: number; height: number }
) {
  const maxX = Math.max(MARGEM, viewport.width - TAMANHO_BOTAO - MARGEM);
  const maxY = Math.max(MARGEM, viewport.height - TAMANHO_BOTAO - MARGEM);
  const y = MARGEM + ((maxY - MARGEM) * posicao.offsetY) / 100;
  return {
    x: posicao.lado === "left" ? MARGEM : maxX,
    y: Math.min(maxY, Math.max(MARGEM, y)),
  };
}

export function posicaoAssistenteDePixels(
  x: number,
  y: number,
  viewport: { width: number; height: number }
): PosicaoAssistente {
  const maxY = Math.max(MARGEM, viewport.height - TAMANHO_BOTAO - MARGEM);
  const faixa = Math.max(1, maxY - MARGEM);
  const yLimitado = Math.min(maxY, Math.max(MARGEM, y));
  return sanitizarPosicaoAssistente({
    lado: snapLadoAssistente(x, viewport.width),
    offsetY: ((yLimitado - MARGEM) / faixa) * 100,
  });
}

export const MEDIDAS_ASSISTENTE = {
  margem: MARGEM,
  tamanhoBotao: TAMANHO_BOTAO,
};
