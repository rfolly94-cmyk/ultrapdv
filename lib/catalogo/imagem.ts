import { CATALOGO_IMAGEM_MAX_BYTES } from "@/lib/catalogo/regras";

const TIPOS = new Set(["image/jpeg", "image/png", "image/webp"]);
const LADO_MAX = 1200;

export async function otimizarImagemCatalogo(arquivo: File) {
  if (!TIPOS.has(arquivo.type)) {
    throw new Error("Envie uma imagem JPEG, PNG ou WebP.");
  }

  if (arquivo.size > CATALOGO_IMAGEM_MAX_BYTES) {
    throw new Error("A imagem deve ter no máximo 5 MB.");
  }

  const bitmap = await createImageBitmap(arquivo);
  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
  const largura = Math.max(1, Math.round(bitmap.width * escala));
  const altura = Math.max(1, Math.round(bitmap.height * escala));

  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;

  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Não foi possível processar a imagem.");
  }

  ctx.drawImage(bitmap, 0, 0, largura, altura);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (resultado) => {
        if (resultado) {
          resolve(resultado);
          return;
        }

        reject(new Error("Não foi possível gerar a imagem otimizada."));
      },
      "image/webp",
      0.82
    );
  });

  return new File([blob], "principal.webp", {
    type: "image/webp",
  });
}
