import type { EstadoOperacionalFiscal } from "@/lib/fiscal/estado-operacional-fiscal";

/**
 * Aparência do card fiscal. Não classifica documento:
 * apenas escolhe cor/ícone a partir do estado operacional já resolvido.
 */
export type TomVisualDocumentoFiscal =
  | "autorizada"
  | "cancelada"
  | "ambigua"
  | "processando"
  | "rejeitada"
  | "alerta"
  | "neutro";

export function tomVisualDocumentoFiscal(
  estado: EstadoOperacionalFiscal
): TomVisualDocumentoFiscal {
  if (estado === "autorizada") {
    return "autorizada";
  }
  if (estado === "cancelada") {
    return "cancelada";
  }
  if (estado === "ambigua") {
    return "ambigua";
  }
  if (estado === "em_transmissao") {
    return "processando";
  }
  if (estado === "rejeitada_sefaz") {
    return "rejeitada";
  }
  if (estado === "erro_envio" || estado === "nao_classificada") {
    return "alerta";
  }
  return "neutro";
}

export function tituloVisualDocumentoFiscal(titulo: string) {
  const conectores = new Set(["de", "da", "do", "das", "dos", "e", "pela", "pelo"]);
  return titulo
    .split(/\s+/)
    .map((palavra, indice) => {
      if (palavra === "NF-e" || palavra === "NFC-e") {
        return palavra;
      }
      const minuscula = palavra.toLowerCase();
      if (indice > 0 && conectores.has(minuscula)) {
        return minuscula;
      }
      return minuscula.charAt(0).toUpperCase() + minuscula.slice(1);
    })
    .join(" ");
}
