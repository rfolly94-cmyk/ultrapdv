import {
  registroPertenceAEmpresaAtiva,
} from "@/lib/empresa/assert-registro-empresa-ativa";
import {
  ehFinNfeSuportada,
  ehTpNf,
  MENSAGEM_IDENTIDADE_FISCAL_AUSENTE,
  MENSAGEM_NATUREZA_BONIFICACAO_AUSENTE,
  MENSAGEM_NATUREZA_BONIFICACAO_INVALIDA,
  MENSAGEM_NATUREZA_DEVOLUCAO_FORNECEDOR_AUSENTE,
  MENSAGEM_NATUREZA_DEVOLUCAO_FORNECEDOR_INVALIDA,
  MENSAGEM_NATUREZA_TRANSFERENCIA_AUSENTE,
  MENSAGEM_NATUREZA_TRANSFERENCIA_INVALIDA,
  MENSAGEM_NATUREZA_VENDA_AUSENTE,
  MENSAGEM_NATUREZA_VENDA_INVALIDA,
  type FinNfeSuportada,
  type NaturezaOperacaoFiscal,
  type TpNf,
} from "./catalogo";

export function escolherNaturezaPadrao(
  naturezas: NaturezaOperacaoFiscal[],
  tipoOperacaoInterno: string,
  empresaIdAtiva: string
) {
  return (
    naturezas.find(
      (natureza) =>
        registroPertenceAEmpresaAtiva(natureza, empresaIdAtiva) &&
        natureza.tipo_operacao_interno === tipoOperacaoInterno &&
        natureza.padrao &&
        natureza.ativo
    ) ?? null
  );
}

export function naturezaEstaCompleta(
  natureza: NaturezaOperacaoFiscal | null | undefined,
  empresaIdAtiva?: string
) {
  if (!natureza) {
    return false;
  }

  if (
    empresaIdAtiva !== undefined &&
    !registroPertenceAEmpresaAtiva(natureza, empresaIdAtiva)
  ) {
    return false;
  }

  return (
    natureza.ativo &&
    Boolean(natureza.id) &&
    Boolean(natureza.descricao.trim()) &&
    ehTpNf(natureza.tp_nf) &&
    ehFinNfeSuportada(natureza.fin_nfe)
  );
}

export function mensagemNaturezaIncompleta(
  tipoOperacaoInterno: string
) {
  if (tipoOperacaoInterno === "venda") {
    return MENSAGEM_NATUREZA_VENDA_AUSENTE;
  }

  return MENSAGEM_IDENTIDADE_FISCAL_AUSENTE;
}

export function assertIdentidadeFiscalNfe(params: {
  naturezaId?: string | null;
  descricao?: string | null;
  tpNf?: string | null;
  finNfe?: string | null;
}) {
  const naturezaId = String(params.naturezaId ?? "").trim();
  const descricao = String(params.descricao ?? "").trim();
  const tpNf = String(params.tpNf ?? "").trim();
  const finNfe = String(params.finNfe ?? "").trim();

  if (
    !naturezaId ||
    !descricao ||
    !ehTpNf(tpNf) ||
    !ehFinNfeSuportada(finNfe)
  ) {
    throw new Error(MENSAGEM_IDENTIDADE_FISCAL_AUSENTE);
  }

  return {
    naturezaId,
    descricao,
    tpNf: tpNf as TpNf,
    finNfe: finNfe as FinNfeSuportada,
  };
}

export function escolherNaturezaParaVenda(params: {
  empresaIdAtiva: string;
  naturezaIdVenda?: string | null;
  naturezas: NaturezaOperacaoFiscal[];
}) {
  const escolhidaId = String(params.naturezaIdVenda ?? "").trim();
  const daEmpresa = params.naturezas.filter(
    (natureza) =>
      registroPertenceAEmpresaAtiva(natureza, params.empresaIdAtiva) &&
      natureza.tipo_operacao_interno === "venda"
  );

  if (escolhidaId) {
    const escolhida = daEmpresa.find((natureza) => natureza.id === escolhidaId);

    if (
      !escolhida ||
      !naturezaEstaCompleta(escolhida, params.empresaIdAtiva)
    ) {
      return {
        ok: false as const,
        mensagem: MENSAGEM_NATUREZA_VENDA_INVALIDA,
      };
    }

    return {
      ok: true as const,
      natureza: escolhida,
      origem: "venda" as const,
    };
  }

  const padrao = escolherNaturezaPadrao(
    daEmpresa,
    "venda",
    params.empresaIdAtiva
  );

  if (!padrao || !naturezaEstaCompleta(padrao, params.empresaIdAtiva)) {
    return {
      ok: false as const,
      mensagem: MENSAGEM_NATUREZA_VENDA_AUSENTE,
    };
  }

  return {
    ok: true as const,
    natureza: padrao,
    origem: "padrao" as const,
  };
}

export function escolherNaturezaParaDevolucaoFornecedor(params: {
  empresaIdAtiva: string;
  naturezaId?: string | null;
  naturezas: NaturezaOperacaoFiscal[];
}) {
  const escolhidaId = String(params.naturezaId ?? "").trim();
  const daEmpresa = params.naturezas.filter(
    (natureza) =>
      registroPertenceAEmpresaAtiva(natureza, params.empresaIdAtiva) &&
      natureza.tipo_operacao_interno === "devolucao_fornecedor"
  );

  if (escolhidaId) {
    const escolhida = daEmpresa.find((natureza) => natureza.id === escolhidaId);

    if (
      !escolhida ||
      !naturezaEstaCompleta(escolhida, params.empresaIdAtiva)
    ) {
      return {
        ok: false as const,
        mensagem: MENSAGEM_NATUREZA_DEVOLUCAO_FORNECEDOR_INVALIDA,
      };
    }

    return {
      ok: true as const,
      natureza: escolhida,
      origem: "selecionada" as const,
    };
  }

  const padrao = escolherNaturezaPadrao(
    daEmpresa,
    "devolucao_fornecedor",
    params.empresaIdAtiva
  );

  if (padrao && naturezaEstaCompleta(padrao, params.empresaIdAtiva)) {
    return {
      ok: true as const,
      natureza: padrao,
      origem: "padrao" as const,
    };
  }

  const unica = daEmpresa.find((natureza) =>
    naturezaEstaCompleta(natureza, params.empresaIdAtiva)
  );

  if (unica && daEmpresa.filter((n) => n.ativo).length === 1) {
    return {
      ok: true as const,
      natureza: unica,
      origem: "unica" as const,
    };
  }

  if (daEmpresa.length === 0) {
    return {
      ok: false as const,
      mensagem: MENSAGEM_NATUREZA_DEVOLUCAO_FORNECEDOR_AUSENTE,
    };
  }

  return {
    ok: false as const,
    mensagem: MENSAGEM_NATUREZA_DEVOLUCAO_FORNECEDOR_INVALIDA,
  };
}

export function escolherNaturezaParaTipoOperacao(params: {
  empresaIdAtiva: string;
  tipoOperacaoInterno: "venda" | "bonificacao" | "transferencia";
  naturezaId?: string | null;
  naturezas: NaturezaOperacaoFiscal[];
}) {
  const ausente =
    params.tipoOperacaoInterno === "venda"
      ? MENSAGEM_NATUREZA_VENDA_AUSENTE
      : params.tipoOperacaoInterno === "bonificacao"
        ? MENSAGEM_NATUREZA_BONIFICACAO_AUSENTE
        : MENSAGEM_NATUREZA_TRANSFERENCIA_AUSENTE;
  const invalida =
    params.tipoOperacaoInterno === "venda"
      ? MENSAGEM_NATUREZA_VENDA_INVALIDA
      : params.tipoOperacaoInterno === "bonificacao"
        ? MENSAGEM_NATUREZA_BONIFICACAO_INVALIDA
        : MENSAGEM_NATUREZA_TRANSFERENCIA_INVALIDA;
  const escolhidaId = String(params.naturezaId ?? "").trim();
  const daEmpresa = params.naturezas.filter(
    (natureza) =>
      registroPertenceAEmpresaAtiva(natureza, params.empresaIdAtiva) &&
      natureza.tipo_operacao_interno === params.tipoOperacaoInterno
  );

  if (escolhidaId) {
    const escolhida = daEmpresa.find((natureza) => natureza.id === escolhidaId);
    if (!escolhida || !naturezaEstaCompleta(escolhida, params.empresaIdAtiva)) {
      return { ok: false as const, mensagem: invalida };
    }
    return {
      ok: true as const,
      natureza: escolhida,
      origem: "selecionada" as const,
    };
  }

  const padrao = escolherNaturezaPadrao(
    daEmpresa,
    params.tipoOperacaoInterno,
    params.empresaIdAtiva
  );
  if (padrao && naturezaEstaCompleta(padrao, params.empresaIdAtiva)) {
    return { ok: true as const, natureza: padrao, origem: "padrao" as const };
  }

  const ativas = daEmpresa.filter((natureza) => natureza.ativo);
  if (ativas.length === 1 && naturezaEstaCompleta(ativas[0], params.empresaIdAtiva)) {
    return { ok: true as const, natureza: ativas[0], origem: "unica" as const };
  }

  if (daEmpresa.length === 0) {
    return { ok: false as const, mensagem: ausente };
  }

  return { ok: false as const, mensagem: invalida };
}
