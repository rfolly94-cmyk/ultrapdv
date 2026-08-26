export const MENSAGEM_ESTOQUE_INSUFICIENTE =
  "Estoque insuficiente para este produto.";

export const PERMITIR_VENDA_SEM_ESTOQUE_PADRAO = false;

export function formatarQuantidadeEstoquePdv(valor: number) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) {
    return "0";
  }
  return numero.toLocaleString("pt-BR", {
    maximumFractionDigits: 4,
  });
}

export function mensagemEstoqueInsuficientePdv(disponivel: number) {
  return `${MENSAGEM_ESTOQUE_INSUFICIENTE}\nDisponível: ${formatarQuantidadeEstoquePdv(disponivel)}.`;
}

export function permitirVendaSemEstoqueDoRegistro(valor: unknown) {
  return valor === true;
}

export function estoqueDisponivelDoRegistro(valor: unknown) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : 0;
}

export function avaliarQuantidadeEstoquePdv(input: {
  permitirVendaSemEstoque: boolean;
  disponivel: number;
  quantidade: number;
}): { ok: true } | { ok: false; erro: string; disponivel: number } {
  if (input.permitirVendaSemEstoque === true) {
    return { ok: true };
  }

  const disponivel = estoqueDisponivelDoRegistro(input.disponivel);
  const quantidade = Number(input.quantidade);

  if (!Number.isFinite(quantidade) || quantidade <= 0) {
    return {
      ok: false,
      erro: mensagemEstoqueInsuficientePdv(disponivel),
      disponivel,
    };
  }

  if (disponivel <= 0 || quantidade > disponivel) {
    return {
      ok: false,
      erro: mensagemEstoqueInsuficientePdv(disponivel),
      disponivel,
    };
  }

  return { ok: true };
}

export function validarItensEstoquePdv(input: {
  permitirVendaSemEstoque: boolean;
  itens: Array<{ produtoId: string; quantidade: number }>;
  estoquePorProduto: Map<string, number>;
}): { ok: true } | { ok: false; erro: string } {
  if (input.permitirVendaSemEstoque === true) {
    return { ok: true };
  }

  const agregado = new Map<string, number>();
  for (const item of input.itens) {
    const atual = agregado.get(item.produtoId) ?? 0;
    agregado.set(item.produtoId, atual + Number(item.quantidade));
  }

  for (const [produtoId, quantidade] of agregado) {
    const resultado = avaliarQuantidadeEstoquePdv({
      permitirVendaSemEstoque: false,
      disponivel: input.estoquePorProduto.get(produtoId) ?? 0,
      quantidade,
    });
    if (!resultado.ok) {
      return resultado;
    }
  }

  return { ok: true };
}
