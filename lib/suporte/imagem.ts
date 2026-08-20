import {
  LIMITE_IMAGEM_SUPORTE_BYTES,
  MIME_IMAGEM_SUPORTE,
} from "./tipos";

const EXTENSAO_POR_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function validarImagemSuporte(arquivo: {
  type?: string | null;
  size?: number | null;
  name?: string | null;
}) {
  const mime = String(arquivo.type ?? "").toLowerCase();
  const nome = String(arquivo.name ?? "").toLowerCase();
  const tamanho = Number(arquivo.size ?? 0);

  if (!MIME_IMAGEM_SUPORTE.includes(mime as (typeof MIME_IMAGEM_SUPORTE)[number])) {
    return { ok: false as const, erro: "Envie uma imagem JPG, PNG ou WEBP." };
  }

  if (!Number.isFinite(tamanho) || tamanho <= 0) {
    return { ok: false as const, erro: "Arquivo de imagem inválido." };
  }

  if (tamanho > LIMITE_IMAGEM_SUPORTE_BYTES) {
    return { ok: false as const, erro: "A imagem deve ter no máximo 5 MB." };
  }

  const extensaoNome = nome.split(".").pop() ?? "";
  const extensaoEsperada = EXTENSAO_POR_MIME[mime];
  const aliases = mime === "image/jpeg" ? ["jpg", "jpeg"] : [extensaoEsperada];

  if (extensaoNome && !aliases.includes(extensaoNome)) {
    return { ok: false as const, erro: "A extensão do arquivo não corresponde ao tipo da imagem." };
  }

  return { ok: true as const, mime, extensao: extensaoEsperada };
}

export function caminhoArquivoSuporte(
  empresaId: string,
  conversaId: string,
  extensao: string,
  idArquivo: string
) {
  const ext = String(extensao || "jpg").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return `${empresaId}/${conversaId}/${idArquivo}.${ext}`;
}
