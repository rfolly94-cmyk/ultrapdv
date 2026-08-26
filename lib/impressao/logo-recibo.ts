import {
  pathLogoDaEmpresa,
  urlPublicaLogoEmpresa,
  type TipoLogoEmpresa,
} from "@/lib/empresa/logo";
import { logoUrlUtilizavel } from "@/lib/empresa/logo-url";
import type { AlinhamentoRecibo } from "./recibo-layout";

export type LogoReciboResolvida = {
  path: string | null;
  url: string | null;
  bytes: Buffer | null;
  mime: TipoLogoEmpresa | null;
};

export type LogoPdfRecibo = {
  bytes: Buffer;
  mime: TipoLogoEmpresa;
  alinhamento?: AlinhamentoRecibo;
};

/** Mesma regra da sidebar/cabeçalho: `empresas.logo_path` da empresa ativa. */
export function urlLogoReciboEmpresa(
  empresaId: string,
  logoPath: string | null | undefined
) {
  return logoUrlUtilizavel(
    urlPublicaLogoEmpresa(pathLogoDaEmpresa(empresaId, logoPath))
  );
}

export function logoReciboVazia(): LogoReciboResolvida {
  return { path: null, url: null, bytes: null, mime: null };
}
