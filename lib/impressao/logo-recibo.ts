import {
  pathLogoDaEmpresa,
  urlPublicaLogoEmpresa,
  type TipoLogoEmpresa,
} from "@/lib/empresa/logo";
import { logoUrlUtilizavel } from "@/lib/empresa/logo-url";
import type { AlinhamentoLogoRecibo, TamanhoLogoRecibo, TipoLogoRecibo } from "./logo-recibo-personalizada";

export type LogoReciboResolvida = {
  origem: "empresa" | "personalizada" | null;
  path: string | null;
  url: string | null;
  bytes: Buffer | null;
  mime: TipoLogoRecibo | TipoLogoEmpresa | null;
};

export type LogoPdfRecibo = {
  bytes: Buffer;
  mime: TipoLogoRecibo | TipoLogoEmpresa;
  alinhamento?: AlinhamentoLogoRecibo;
  tamanho?: TamanhoLogoRecibo;
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
  return { origem: null, path: null, url: null, bytes: null, mime: null };
}
