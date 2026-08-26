import { TAMANHO_MAXIMO_LOGO_RECIBO_BYTES } from "./logo-recibo-personalizada";

const TIPOS = new Set(["image/jpeg", "image/png", "image/webp", "image/jpg"]);

export async function prepararArquivoLogoRecibo(arquivo: File) {
  const tipo = String(arquivo.type || "").toLowerCase();
  if (!TIPOS.has(tipo)) {
    throw new Error("Envie uma imagem PNG, JPEG ou WEBP.");
  }
  if (arquivo.size > TAMANHO_MAXIMO_LOGO_RECIBO_BYTES) {
    throw new Error("A logo do recibo deve ter no máximo 2 MB.");
  }

  if (tipo !== "image/webp") {
    return arquivo;
  }

  const bitmap = await createImageBitmap(arquivo);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Não foi possível processar a imagem.");
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (resultado) => {
        if (resultado) {
          resolve(resultado);
          return;
        }
        reject(new Error("Não foi possível converter a imagem WEBP."));
      },
      "image/png"
    );
  });

  return new File([blob], "logo-recibo.png", { type: "image/png" });
}
