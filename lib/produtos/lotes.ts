export const MENSAGEM_LOTE_CODIGO_OBRIGATORIO =
  "Informe o código do lote.";

export const MENSAGEM_LOTE_VALIDADE_OBRIGATORIA =
  "Informe a data de validade do lote.";

export const MENSAGEM_LOTE_QUANTIDADE_INVALIDA =
  "Informe uma quantidade de lote válida.";

export const MENSAGEM_LOTE_FABRICACAO_POSTERIOR =
  "A data de fabricação não pode ser posterior à validade.";

export const MENSAGEM_CONTROLE_VALIDADE_INATIVO =
  "Ative o controle de validade antes de cadastrar lotes.";

export const MENSAGEM_LOTE_DUPLICADO =
  "Já existe um lote com este código neste produto.";

export type StatusValidadeLote =
  | "vencido"
  | "vence_7"
  | "vence_30"
  | "vence_60"
  | "normal";

export type DadosLoteProduto = {
  codigoLote: string;
  dataFabricacao: string | null;
  dataValidade: string;
  quantidade: number;
  observacao: string | null;
};

export type LoteEstoque = {
  id: string;
  empresa_id: string;
  produto_id: string;
  codigo_lote: string;
  data_fabricacao: string | null;
  data_validade: string;
  quantidade: number;
  observacao: string | null;
  created_at: string;
  updated_at: string;
};

export type LoteFefo = {
  id: string;
  data_validade: string;
  created_at: string;
  quantidade: number;
};

export function dataIso(valor: string | Date | null | undefined) {
  if (!valor) {
    return "";
  }
  if (valor instanceof Date) {
    const ano = valor.getFullYear();
    const mes = String(valor.getMonth() + 1).padStart(2, "0");
    const dia = String(valor.getDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
  }
  return String(valor).trim().slice(0, 10);
}

export function hojeIso(referencia: Date = new Date()) {
  return dataIso(referencia);
}

export function timestampDataIso(valor: string) {
  const texto = dataIso(valor);
  const partes = texto.split("-").map(Number);
  if (partes.length !== 3 || partes.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const [ano, mes, dia] = partes;
  return Date.UTC(ano, mes - 1, dia);
}

export function diasAteValidade(
  dataValidade: string,
  referencia: Date | string = new Date()
) {
  const validade = timestampDataIso(dataValidade);
  const hoje = timestampDataIso(
    typeof referencia === "string" ? referencia : hojeIso(referencia)
  );
  if (validade == null || hoje == null) {
    return null;
  }
  return (validade - hoje) / 86_400_000;
}

export function statusValidadeLote(
  dataValidade: string,
  referencia: Date | string = new Date()
): StatusValidadeLote {
  const dias = diasAteValidade(dataValidade, referencia);
  if (dias == null || dias < 0) {
    return "vencido";
  }
  if (dias <= 7) {
    return "vence_7";
  }
  if (dias <= 30) {
    return "vence_30";
  }
  if (dias <= 60) {
    return "vence_60";
  }
  return "normal";
}

export function rotuloStatusValidade(status: StatusValidadeLote) {
  switch (status) {
    case "vencido":
      return "Vencido";
    case "vence_7":
      return "Vence em até 7 dias";
    case "vence_30":
      return "Vence em até 30 dias";
    case "vence_60":
      return "Vence em até 60 dias";
    default:
      return "Normal";
  }
}

export function formatarDataBr(valor: string | null | undefined) {
  const texto = dataIso(valor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return "—";
  }
  const [ano, mes, dia] = texto.split("-");
  return `${dia}/${mes}/${ano}`;
}

export function ordenarLotesFefo<T extends LoteFefo>(lotes: T[]) {
  return [...lotes].sort((a, b) => {
    const validadeA = timestampDataIso(a.data_validade) ?? Number.MAX_SAFE_INTEGER;
    const validadeB = timestampDataIso(b.data_validade) ?? Number.MAX_SAFE_INTEGER;
    if (validadeA !== validadeB) {
      return validadeA - validadeB;
    }
    return String(a.created_at).localeCompare(String(b.created_at));
  });
}

export function alocarQuantidadeFefo(
  lotes: LoteFefo[],
  quantidade: number,
  opcoes?: {
    referencia?: Date | string;
    ignorarVencidos?: boolean;
  }
) {
  const restanteInicial = Number(quantidade);
  if (!Number.isFinite(restanteInicial) || restanteInicial <= 0) {
    return [] as Array<{ loteId: string; quantidade: number }>;
  }

  const ignorarVencidos = opcoes?.ignorarVencidos !== false;
  const referencia = opcoes?.referencia ?? new Date();
  const candidatos = ordenarLotesFefo(lotes).filter((lote) => {
    if (Number(lote.quantidade) <= 0) {
      return false;
    }
    if (
      ignorarVencidos &&
      statusValidadeLote(lote.data_validade, referencia) === "vencido"
    ) {
      return false;
    }
    return true;
  });

  let restante = restanteInicial;
  const alocacao: Array<{ loteId: string; quantidade: number }> = [];

  for (const lote of candidatos) {
    if (restante <= 0) {
      break;
    }
    const usar = Math.min(Number(lote.quantidade), restante);
    if (usar <= 0) {
      continue;
    }
    alocacao.push({ loteId: lote.id, quantidade: usar });
    restante -= usar;
  }

  return alocacao;
}

export function validarDadosLoteProduto(dados: {
  codigoLote?: string | null;
  dataFabricacao?: string | null;
  dataValidade?: string | null;
  quantidade?: number | null;
}): string | null {
  const codigo = String(dados.codigoLote ?? "").trim();
  if (!codigo || codigo.length > 60) {
    return MENSAGEM_LOTE_CODIGO_OBRIGATORIO;
  }

  const validade = dataIso(dados.dataValidade);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validade)) {
    return MENSAGEM_LOTE_VALIDADE_OBRIGATORIA;
  }

  const fabricacao = dataIso(dados.dataFabricacao);
  if (fabricacao) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fabricacao)) {
      return "Informe uma data de fabricação válida.";
    }
    const tsFab = timestampDataIso(fabricacao);
    const tsVal = timestampDataIso(validade);
    if (tsFab != null && tsVal != null && tsFab > tsVal) {
      return MENSAGEM_LOTE_FABRICACAO_POSTERIOR;
    }
  }

  const quantidade = Number(dados.quantidade);
  if (!Number.isFinite(quantidade) || quantidade < 0) {
    return MENSAGEM_LOTE_QUANTIDADE_INVALIDA;
  }

  return null;
}

export function normalizarDadosLoteProduto(dados: {
  codigoLote?: string | null;
  dataFabricacao?: string | null;
  dataValidade?: string | null;
  quantidade?: number | null;
  observacao?: string | null;
}): DadosLoteProduto {
  const fabricacao = dataIso(dados.dataFabricacao);
  return {
    codigoLote: String(dados.codigoLote ?? "").trim(),
    dataFabricacao: /^\d{4}-\d{2}-\d{2}$/.test(fabricacao) ? fabricacao : null,
    dataValidade: dataIso(dados.dataValidade),
    quantidade: Number(dados.quantidade ?? 0),
    observacao: String(dados.observacao ?? "").trim() || null,
  };
}

export type LoteQuantidade = {
  id?: string;
  empresa_id?: string;
  produto_id?: string;
  quantidade: number;
};

export function arredondarQuantidadeLote(valor: number) {
  if (!Number.isFinite(valor)) {
    return 0;
  }
  return Math.round(valor * 10_000) / 10_000;
}

export function formatarQuantidadeLote(valor: number) {
  return arredondarQuantidadeLote(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export function mensagemLotesUltrapassamEstoque(disponivel: number) {
  return (
    "A quantidade dos lotes não pode ultrapassar o estoque atual. " +
    `Estoque disponível para vincular a lotes: ${formatarQuantidadeLote(disponivel)}.`
  );
}

export function lotesDaEmpresaProduto<T extends LoteQuantidade>(
  lotes: T[],
  empresaId: string,
  produtoId: string
) {
  return lotes.filter(
    (lote) =>
      lote.empresa_id === empresaId && lote.produto_id === produtoId
  );
}

export function somarQuantidadesLotes(
  lotes: LoteQuantidade[],
  ignorarLoteId?: string | null
) {
  let soma = 0;
  for (const lote of lotes) {
    if (ignorarLoteId && lote.id === ignorarLoteId) {
      continue;
    }
    soma += Number(lote.quantidade) || 0;
  }
  return arredondarQuantidadeLote(soma);
}

export function resumoDistribuicaoLotes(input: {
  estoqueAtual: number;
  lotes: LoteQuantidade[];
  ignorarLoteId?: string | null;
}) {
  const estoqueAtual = arredondarQuantidadeLote(
    Math.max(0, Number(input.estoqueAtual) || 0)
  );
  const vinculado = somarQuantidadesLotes(input.lotes);
  const vinculadoExceto = somarQuantidadesLotes(
    input.lotes,
    input.ignorarLoteId
  );
  const saldoSemLote = arredondarQuantidadeLote(
    Math.max(0, estoqueAtual - vinculado)
  );
  const disponivel = arredondarQuantidadeLote(
    Math.max(0, estoqueAtual - vinculadoExceto)
  );

  return {
    estoqueAtual,
    vinculado,
    saldoSemLote,
    disponivel,
  };
}

export function validarQuantidadeContraEstoque(input: {
  estoqueAtual: number;
  lotes: LoteQuantidade[];
  quantidadeNova: number;
  loteId?: string | null;
}): string | null {
  const resumo = resumoDistribuicaoLotes({
    estoqueAtual: input.estoqueAtual,
    lotes: input.lotes,
    ignorarLoteId: input.loteId,
  });
  const nova = arredondarQuantidadeLote(Number(input.quantidadeNova) || 0);
  if (nova > resumo.disponivel) {
    return mensagemLotesUltrapassamEstoque(resumo.disponivel);
  }
  return null;
}
