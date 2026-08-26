import { deflateSync, inflateSync } from "node:zlib";

import { detectarTipoLogo, type TipoLogoEmpresa } from "@/lib/empresa/logo";
import type { PapelImpressao } from "./tipos";
import type { AlinhamentoRecibo } from "./recibo-layout";

const LARGURA_MAX_LOGO = 1024;
const ALTURA_MAX_LOGO = 1024;

export type ImagemPdfPreparada = {
  objeto: Buffer;
  larguraPx: number;
  alturaPx: number;
};

export function dimensoesJpeg(bytes: Buffer) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let i = 2;
  while (i + 8 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }

    const marcador = bytes[i + 1];
    if (marcador === 0xd8 || marcador === 0x00 || marcador === 0xff) {
      i += 1;
      continue;
    }
    if (marcador === 0xd9 || marcador === 0xda) {
      break;
    }

    const tamanho = (bytes[i + 2] << 8) | bytes[i + 3];
    if (tamanho < 2 || i + 2 + tamanho > bytes.length) {
      return null;
    }

    const sof =
      marcador >= 0xc0 &&
      marcador <= 0xcf &&
      marcador !== 0xc4 &&
      marcador !== 0xc8 &&
      marcador !== 0xcc;
    if (sof) {
      if (tamanho < 7) {
        return null;
      }
      const altura = (bytes[i + 5] << 8) | bytes[i + 6];
      const largura = (bytes[i + 7] << 8) | bytes[i + 8];
      const componentes = bytes[i + 9];
      if (largura < 1 || altura < 1 || (componentes !== 1 && componentes !== 3)) {
        return null;
      }
      return {
        width: largura,
        height: altura,
        colorSpace: componentes === 1 ? "/DeviceGray" : "/DeviceRGB",
      };
    }

    i += 2 + tamanho;
  }

  return null;
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  if (pb <= pc) {
    return b;
  }
  return c;
}

function aplicarFiltroPng(
  filtro: number,
  atual: Buffer,
  anterior: Buffer,
  bpp: number
) {
  for (let i = 0; i < atual.length; i += 1) {
    const esquerda = i >= bpp ? atual[i - bpp] : 0;
    const acima = anterior[i];
    const diagonal = i >= bpp ? anterior[i - bpp] : 0;
    let valor = atual[i];
    if (filtro === 1) {
      valor = (valor + esquerda) & 255;
    } else if (filtro === 2) {
      valor = (valor + acima) & 255;
    } else if (filtro === 3) {
      valor = (valor + ((esquerda + acima) >> 1)) & 255;
    } else if (filtro === 4) {
      valor = (valor + paeth(esquerda, acima, diagonal)) & 255;
    } else if (filtro !== 0) {
      return false;
    }
    atual[i] = valor;
  }
  return true;
}

export function decodificarPngParaRgb(png: Buffer) {
  try {
    if (png.length < 24 || png[0] !== 0x89 || png[1] !== 0x50) {
      return null;
    }

    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    let palette: Buffer | null = null;
    const idats: Buffer[] = [];

    while (offset + 12 <= png.length) {
      const len = png.readUInt32BE(offset);
      if (len < 0 || offset + 12 + len > png.length) {
        return null;
      }
      const tipo = png.subarray(offset + 4, offset + 8).toString("ascii");
      const data = png.subarray(offset + 8, offset + 8 + len);
      if (tipo === "IHDR" && data.length >= 13) {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        bitDepth = data[8];
        colorType = data[9];
        interlace = data[12];
      } else if (tipo === "PLTE") {
        palette = data;
      } else if (tipo === "IDAT") {
        idats.push(data);
      } else if (tipo === "IEND") {
        break;
      }
      offset += 12 + len;
    }

    if (
      width < 1 ||
      height < 1 ||
      width > LARGURA_MAX_LOGO ||
      height > ALTURA_MAX_LOGO ||
      bitDepth !== 8 ||
      interlace !== 0 ||
      ![0, 2, 3, 4, 6].includes(colorType)
    ) {
      return null;
    }

    const bpp =
      colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 4;
    if (colorType === 3 && (!palette || palette.length < 3 || palette.length % 3 !== 0)) {
      return null;
    }

    const inflado = inflateSync(Buffer.concat(idats));
    const stride = width * bpp;
    const esperado = height * (1 + stride);
    if (inflado.length < esperado) {
      return null;
    }

    const rgb = Buffer.alloc(width * height * 3);
    const anterior = Buffer.alloc(stride);
    const atual = Buffer.alloc(stride);
    let src = 0;

    for (let y = 0; y < height; y += 1) {
      const filtro = inflado[src];
      src += 1;
      inflado.copy(atual, 0, src, src + stride);
      src += stride;
      if (!aplicarFiltroPng(filtro, atual, anterior, bpp)) {
        return null;
      }

      for (let x = 0; x < width; x += 1) {
        const dst = (y * width + x) * 3;
        if (colorType === 0) {
          const g = atual[x];
          rgb[dst] = g;
          rgb[dst + 1] = g;
          rgb[dst + 2] = g;
        } else if (colorType === 2) {
          rgb[dst] = atual[x * 3];
          rgb[dst + 1] = atual[x * 3 + 1];
          rgb[dst + 2] = atual[x * 3 + 2];
        } else if (colorType === 3) {
          const idx = atual[x] * 3;
          if (!palette || idx + 2 >= palette.length) {
            return null;
          }
          rgb[dst] = palette[idx];
          rgb[dst + 1] = palette[idx + 1];
          rgb[dst + 2] = palette[idx + 2];
        } else if (colorType === 4) {
          const g = atual[x * 2];
          const a = atual[x * 2 + 1] / 255;
          const mistura = Math.round(g * a + 255 * (1 - a));
          rgb[dst] = mistura;
          rgb[dst + 1] = mistura;
          rgb[dst + 2] = mistura;
        } else {
          const a = atual[x * 4 + 3] / 255;
          rgb[dst] = Math.round(atual[x * 4] * a + 255 * (1 - a));
          rgb[dst + 1] = Math.round(atual[x * 4 + 1] * a + 255 * (1 - a));
          rgb[dst + 2] = Math.round(atual[x * 4 + 2] * a + 255 * (1 - a));
        }
      }
      atual.copy(anterior);
    }

    return { width, height, rgb };
  } catch {
    return null;
  }
}

function objetoImagemPdf(input: {
  width: number;
  height: number;
  colorSpace: string;
  filter: string;
  stream: Buffer;
}) {
  const cabecalho = Buffer.from(
    `<< /Type /XObject /Subtype /Image /Width ${input.width} /Height ${input.height} /ColorSpace ${input.colorSpace} /BitsPerComponent 8 /Filter /${input.filter} /Length ${input.stream.length} >>\nstream\n`,
    "latin1"
  );
  const rodape = Buffer.from("\nendstream", "latin1");
  return Buffer.concat([cabecalho, input.stream, rodape]);
}

export function prepararImagemPdf(bytes: Buffer, mime?: TipoLogoEmpresa | null) {
  const tipo = mime ?? detectarTipoLogo(bytes);
  if (!tipo) {
    return null;
  }

  if (tipo === "image/jpeg") {
    const dim = dimensoesJpeg(bytes);
    if (
      !dim ||
      dim.width > LARGURA_MAX_LOGO ||
      dim.height > ALTURA_MAX_LOGO
    ) {
      return null;
    }
    return {
      objeto: objetoImagemPdf({
        width: dim.width,
        height: dim.height,
        colorSpace: dim.colorSpace,
        filter: "DCTDecode",
        stream: bytes,
      }),
      larguraPx: dim.width,
      alturaPx: dim.height,
    } satisfies ImagemPdfPreparada;
  }

  const png = decodificarPngParaRgb(bytes);
  if (!png) {
    return null;
  }

  return {
    objeto: objetoImagemPdf({
      width: png.width,
      height: png.height,
      colorSpace: "/DeviceRGB",
      filter: "FlateDecode",
      stream: deflateSync(png.rgb),
    }),
    larguraPx: png.width,
    alturaPx: png.height,
  } satisfies ImagemPdfPreparada;
}

export function caixaLogoTermica(input: {
  papel: PapelImpressao;
  larguraPx: number;
  alturaPx: number;
  larguraPagina: number;
  margem: number;
  alinhamento?: AlinhamentoRecibo;
}) {
  const area = input.larguraPagina - input.margem * 2;
  const maxW =
    input.papel === "a4" ? Math.min(160, area) : Math.max(24, area * 0.7);
  const maxH = input.papel === "58mm" ? 36 : input.papel === "80mm" ? 48 : 64;
  const escala = Math.min(
    maxW / Math.max(input.larguraPx, 1),
    maxH / Math.max(input.alturaPx, 1),
    1
  );
  const w = input.larguraPx * escala;
  const h = input.alturaPx * escala;
  const x =
    input.alinhamento === "esquerda"
      ? input.margem
      : (input.larguraPagina - w) / 2;
  return { w, h, x };
}
