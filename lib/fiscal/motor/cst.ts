import {
  CSOSN,
  CST_ICMS,
  CST_PIS_COFINS,
  existeCodigo,
} from "@/lib/fiscal/tabelas-fiscais";
import { crtUsaCsosnIcms } from "@/lib/fiscal/geranet/resolver-icms-geranet";
import type { CodigoRegimeTributario } from "@/lib/fiscal/geranet/resolver-politica-ibscbs";

const CSOSN_ST = new Set(["201", "202", "203", "500"]);
const CST_ST = new Set(["10", "30", "60", "70"]);

export function validarCstCsosn(params: {
  crt: CodigoRegimeTributario | null;
  codigo: string | null | undefined;
}): { ok: boolean; tipo: "csosn" | "cst" | null; motivo: string } {
  const codigo = String(params.codigo ?? "").replace(/\D/g, "");
  if (!params.crt) {
    return {
      ok: false,
      tipo: null,
      motivo: "CRT da empresa não está configurado. Não é possível validar CST/CSOSN.",
    };
  }
  if (!codigo) {
    return { ok: false, tipo: null, motivo: "CST/CSOSN não informado." };
  }
  if (crtUsaCsosnIcms(params.crt)) {
    if (existeCodigo(CSOSN, codigo)) {
      return { ok: true, tipo: "csosn", motivo: `CSOSN ${codigo} compatível com CRT ${params.crt}.` };
    }
    if (existeCodigo(CST_ICMS, codigo)) {
      return {
        ok: false,
        tipo: "cst",
        motivo: `CRT ${params.crt} (Simples/MEI) exige CSOSN, não CST ${codigo}.`,
      };
    }
    return { ok: false, tipo: null, motivo: `CSOSN ${codigo} inexistente.` };
  }
  if (existeCodigo(CST_ICMS, codigo)) {
    return { ok: true, tipo: "cst", motivo: `CST ${codigo} compatível com CRT ${params.crt}.` };
  }
  if (existeCodigo(CSOSN, codigo)) {
    return {
      ok: false,
      tipo: "csosn",
      motivo: `CRT ${params.crt} (regime normal) exige CST ICMS, não CSOSN ${codigo}.`,
    };
  }
  return { ok: false, tipo: null, motivo: `CST ${codigo} inexistente.` };
}

export function validarCstPisCofins(codigo: string | null | undefined) {
  const valor = String(codigo ?? "").replace(/\D/g, "").padStart(2, "0");
  if (!codigo) {
    return { ok: false, motivo: "CST PIS/COFINS não informado." };
  }
  if (!existeCodigo(CST_PIS_COFINS, valor)) {
    return { ok: false, motivo: `CST PIS/COFINS ${valor} inexistente.` };
  }
  return { ok: true, motivo: `CST PIS/COFINS ${valor} existe na tabela oficial do código.` };
}

export function cestNaoImplicaSt(cest: string | null | undefined) {
  return Boolean(cest && String(cest).replace(/\D/g, "").length === 7);
}

export function operacaoSujeitaStPorCodigo(codigoIcms: string | null | undefined) {
  const codigo = String(codigoIcms ?? "").replace(/\D/g, "");
  return CSOSN_ST.has(codigo) || CST_ST.has(codigo);
}
