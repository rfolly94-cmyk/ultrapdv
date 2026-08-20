const BUCKET = "catalogo";

export function caminhoImagemProduto(
  empresaId: string,
  produtoId: string
) {
  return `${empresaId}/produtos/${produtoId}/principal.webp`;
}

export function caminhoLogoCatalogo(empresaId: string) {
  return `${empresaId}/logo.webp`;
}

export function caminhoBannerCatalogo(empresaId: string) {
  return `${empresaId}/banner.webp`;
}

export function urlPublicaCatalogo(path: string | null | undefined) {
  if (!path) {
    return null;
  }

  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!base) {
    return null;
  }

  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/${path}`;
}

export function bucketCatalogo() {
  return BUCKET;
}
