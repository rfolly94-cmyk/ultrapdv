export type VinculoProdutoConfiguracao = {
  empresaId: string;
  configuracaoId: string;
  produtoId: string;
  enviarBalanca: boolean;
};

export const MENSAGEM_VINCULO_OUTRA_EMPRESA =
  "Não é possível vincular configuração ou produto de outra empresa.";

export const MENSAGEM_VINCULO_DUPLICADO =
  "Este produto já está vinculado a esta balança.";

export function vinculoMesmaEmpresa(params: {
  empresaIdSessao: string;
  empresaIdConfig: string;
  empresaIdProduto: string;
}) {
  const sessao = String(params.empresaIdSessao ?? "").trim();
  return (
    Boolean(sessao) &&
    sessao === String(params.empresaIdConfig ?? "").trim() &&
    sessao === String(params.empresaIdProduto ?? "").trim()
  );
}

export function produtoEstaVinculadoAConfig(
  vinculos: VinculoProdutoConfiguracao[],
  configuracaoId: string,
  produtoId: string
) {
  return vinculos.some(
    (vinculo) =>
      vinculo.configuracaoId === configuracaoId &&
      vinculo.produtoId === produtoId &&
      vinculo.enviarBalanca !== false
  );
}

export function chaveVinculoConfiguracaoProduto(params: {
  configuracaoId: string;
  produtoId: string;
}) {
  return `${params.configuracaoId}:${params.produtoId}`;
}

export function criarVinculoProdutoConfiguracao(params: {
  empresaIdSessao: string;
  empresaIdConfig: string;
  empresaIdProduto: string;
  configuracaoId: string;
  produtoId: string;
  enviarBalanca?: boolean;
}): VinculoProdutoConfiguracao {
  if (
    !vinculoMesmaEmpresa({
      empresaIdSessao: params.empresaIdSessao,
      empresaIdConfig: params.empresaIdConfig,
      empresaIdProduto: params.empresaIdProduto,
    })
  ) {
    throw new Error("empresa_mismatch");
  }

  return {
    empresaId: params.empresaIdSessao,
    configuracaoId: params.configuracaoId,
    produtoId: params.produtoId,
    enviarBalanca: params.enviarBalanca !== false,
  };
}

export function inserirVinculoConfiguracaoProduto(
  existentes: VinculoProdutoConfiguracao[],
  novo: VinculoProdutoConfiguracao
) {
  const chave = chaveVinculoConfiguracaoProduto(novo);
  const duplicado = existentes.some(
    (item) => chaveVinculoConfiguracaoProduto(item) === chave
  );
  if (duplicado) {
    throw new Error("unique_violation");
  }

  existentes.push(novo);
  return novo;
}

export function produtosDaConfiguracao<
  T extends { produtoId: string; empresaId: string },
>(
  produtos: T[],
  vinculos: VinculoProdutoConfiguracao[],
  configuracaoId: string,
  empresaId: string
) {
  return produtos.filter(
    (produto) =>
      produto.empresaId === empresaId &&
      produtoEstaVinculadoAConfig(vinculos, configuracaoId, produto.produtoId)
  );
}
