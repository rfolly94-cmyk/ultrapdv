const HOSTS_REAIS =
  /(^|\.)supabase\.co$|sefaz|c6bank\.info$|(^|\.)tpgweb\.io$|paygo/i;

/**
 * Carga e mutação de teste só podem mirar a própria máquina.
 * Qualquer outro host, inclusive homologação financeira, fica fechado.
 */
export function cargaPodeAtingir(url: string) {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    return false;
  }
  if (HOSTS_REAIS.test(host)) {
    return false;
  }
  return true;
}
