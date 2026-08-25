import { ehFormaPix } from "@/lib/pagamentos/pix/local-regras";

export type ClasseFormaCaixa =
  | "dinheiro"
  | "pix"
  | "credito"
  | "debito"
  | "outros";

function texto(valor: unknown) {
  return String(valor ?? "").trim().toUpperCase();
}

/**
 * Classificação dos totais por meio a partir do snapshot tipo/codigo/nome.
 * Troco usa permite_troco_snapshot. Gaveta usa afeta_caixa_fisico_snapshot.
 */
export function classificarFormaCaixa(forma: {
  tipo?: string | null;
  codigo?: string | null;
  nome?: string | null;
}): ClasseFormaCaixa {
  const tipo = texto(forma.tipo);
  const codigo = texto(forma.codigo);

  if (tipo === "DINHEIRO" || codigo === "DINHEIRO" || codigo === "01") {
    return "dinheiro";
  }
  if (ehFormaPix(forma)) {
    return "pix";
  }
  if (
    tipo === "CARTAO_CREDITO" ||
    tipo === "CREDITO" ||
    codigo === "CARTAO_CREDITO" ||
    codigo === "03"
  ) {
    return "credito";
  }
  if (
    tipo === "CARTAO_DEBITO" ||
    tipo === "DEBITO" ||
    codigo === "CARTAO_DEBITO" ||
    codigo === "04"
  ) {
    return "debito";
  }
  return "outros";
}

export function formaAfetaSaldoFisico(forma: {
  afeta_caixa_fisico?: boolean | null;
  afeta_caixa_fisico_snapshot?: boolean | null;
}) {
  return (
    forma.afeta_caixa_fisico === true ||
    forma.afeta_caixa_fisico_snapshot === true
  );
}

export function movimentoAfetaSaldoFisico(movimento: {
  tipo?: string | null;
  afeta_caixa_fisico_snapshot?: boolean | null;
}) {
  const tipo = String(movimento.tipo ?? "");
  if (tipo === "abertura" || tipo === "suprimento" || tipo === "sangria") {
    return true;
  }
  return formaAfetaSaldoFisico({
    afeta_caixa_fisico_snapshot: movimento.afeta_caixa_fisico_snapshot,
  });
}

export function efeitoFisicoMovimento(movimento: {
  tipo?: string | null;
  entrada?: number | string | null;
  saida?: number | string | null;
  afeta_caixa_fisico_snapshot?: boolean | null;
}) {
  if (!movimentoAfetaSaldoFisico(movimento)) {
    return 0;
  }
  const entrada = Number(movimento.entrada ?? 0);
  const saida = Number(movimento.saida ?? 0);
  return Math.round((entrada - saida) * 100) / 100;
}

export function valorLiquidoMovimento(movimento: {
  entrada?: number | string | null;
  saida?: number | string | null;
}) {
  const entrada = Number(movimento.entrada ?? 0);
  const saida = Number(movimento.saida ?? 0);
  return Math.round((entrada - saida) * 100) / 100;
}
