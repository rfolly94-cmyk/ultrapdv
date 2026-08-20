import type { CodigoRegimeTributario } from "@/lib/fiscal/geranet/resolver-politica-ibscbs";
import { CSOSN, CST_ICMS, existeCodigo } from "@/lib/fiscal/tabelas-fiscais";

export const MENSAGEM_CRT_SIMPLES_EXIGE_CSOSN =
  "Inconsistência fiscal: CRT do Simples Nacional exige CSOSN.";

export const MENSAGEM_CRT_NORMAL_EXIGE_CST =
  "Inconsistência fiscal: CRT do regime normal exige CST ICMS.";

export const MENSAGEM_CRT_EMPRESA_AUSENTE =
  "CRT da empresa da emissão não está configurado.";

/** CSOSN aceitos no contrato Geranet usado pelo UltraPDV. */
export const CSOSN_CONTRATO_GERANET = [
  "101",
  "102",
  "103",
  "201",
  "202",
  "203",
  "300",
  "400",
  "500",
  "900",
] as const;

export type CamposIcmsItemGeranet =
  | { icmsCsosn: string; icmsCst?: never }
  | { icmsCst: string; icmsCsosn?: never };

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function registro(valor: unknown): Record<string, unknown> | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) {
    return null;
  }
  return valor as Record<string, unknown>;
}

function codigoPresente(valor: unknown) {
  return texto(valor) !== "";
}

export function crtUsaCsosnIcms(
  codigoRegimeTributario: CodigoRegimeTributario
) {
  return codigoRegimeTributario === 1 || codigoRegimeTributario === 4;
}

export function lerCodigoRegimeTributario(
  valor: unknown
): CodigoRegimeTributario {
  const crt = Number(valor);
  if (crt === 1 || crt === 2 || crt === 3 || crt === 4) {
    return crt;
  }
  throw new Error(MENSAGEM_CRT_EMPRESA_AUSENTE);
}

export function codigoIcmsDoGrupo(valor: unknown) {
  return texto(valor).replace(/\D/g, "");
}

export function resolverCamposIcmsItemGeranet(params: {
  codigoRegimeTributario: unknown;
  codigoIcms: unknown;
}): CamposIcmsItemGeranet {
  const crt = lerCodigoRegimeTributario(params.codigoRegimeTributario);
  const codigo = codigoIcmsDoGrupo(params.codigoIcms);

  if (crtUsaCsosnIcms(crt)) {
    if (
      !codigo ||
      !existeCodigo(CSOSN, codigo) ||
      !CSOSN_CONTRATO_GERANET.includes(
        codigo as (typeof CSOSN_CONTRATO_GERANET)[number]
      )
    ) {
      throw new Error(MENSAGEM_CRT_SIMPLES_EXIGE_CSOSN);
    }
    return { icmsCsosn: codigo };
  }

  if (
    !codigo ||
    existeCodigo(CSOSN, codigo) ||
    !existeCodigo(CST_ICMS, codigo)
  ) {
    throw new Error(MENSAGEM_CRT_NORMAL_EXIGE_CST);
  }

  return { icmsCst: codigo };
}

function crtDoPayloadGeranet(payload: unknown): CodigoRegimeTributario {
  const raiz = registro(payload) ?? {};
  const nfe = registro(raiz.nfe) ?? raiz;
  const emitente =
    registro(nfe.emitente) ??
    registro(nfe.empresa) ??
    registro(raiz.emitente) ??
    registro(raiz.empresa) ??
    {};

  return lerCodigoRegimeTributario(
    emitente.codigoRegimeTributario ??
      nfe.codigoRegimeTributario ??
      raiz.codigoRegimeTributario
  );
}

function itensDoPayloadGeranet(payload: unknown) {
  const raiz = registro(payload) ?? {};
  const nfe = registro(raiz.nfe) ?? raiz;
  const itens = nfe.itens ?? raiz.itens;
  return Array.isArray(itens) ? itens : [];
}

export function assertIcmsContratoGeranet(payload: unknown) {
  const crt = crtDoPayloadGeranet(payload);
  const itens = itensDoPayloadGeranet(payload);

  if (itens.length === 0) {
    throw new Error(
      crtUsaCsosnIcms(crt)
        ? MENSAGEM_CRT_SIMPLES_EXIGE_CSOSN
        : MENSAGEM_CRT_NORMAL_EXIGE_CST
    );
  }

  for (const bruto of itens) {
    const item = registro(bruto) ?? {};
    const temCst = codigoPresente(item.icmsCst);
    const temCsosn = codigoPresente(item.icmsCsosn);

    if (temCst && temCsosn) {
      throw new Error(
        crtUsaCsosnIcms(crt)
          ? MENSAGEM_CRT_SIMPLES_EXIGE_CSOSN
          : MENSAGEM_CRT_NORMAL_EXIGE_CST
      );
    }

    if (crtUsaCsosnIcms(crt)) {
      if (temCst || !temCsosn) {
        throw new Error(MENSAGEM_CRT_SIMPLES_EXIGE_CSOSN);
      }
      resolverCamposIcmsItemGeranet({
        codigoRegimeTributario: crt,
        codigoIcms: item.icmsCsosn,
      });
      continue;
    }

    if (temCsosn || !temCst) {
      throw new Error(MENSAGEM_CRT_NORMAL_EXIGE_CST);
    }
    resolverCamposIcmsItemGeranet({
      codigoRegimeTributario: crt,
      codigoIcms: item.icmsCst,
    });
  }
}
