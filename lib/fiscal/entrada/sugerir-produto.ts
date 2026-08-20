export type ProdutoCandidatoEntrada = {
  id: string;
  empresa_id: string;
  codigo: string | null;
  codigo_barras: string | null;
  nome: string;
  ncm?: string | null;
  unidade_medida?: string | null;
};

function normalizar(valor: unknown) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function digitos(valor: unknown) {
  return String(valor ?? "").replace(/\D/g, "");
}

export type SugestaoProdutoEntrada = {
  produto: ProdutoCandidatoEntrada;
  confianca: "alta" | "media" | "baixa";
  motivo: string;
} | null;

/**
 * Sugere produto da mesma empresa. Não vincula sozinho.
 * Ordem: EAN/GTIN → código → descrição igual.
 */
export function sugerirProdutoEntrada(
  item: {
    ean?: string | null;
    codigoFornecedor?: string | null;
    descricao?: string | null;
  },
  produtos: ProdutoCandidatoEntrada[],
  empresaIdAtiva: string
): SugestaoProdutoEntrada {
  const daEmpresa = produtos.filter(
    (produto) => produto.empresa_id === empresaIdAtiva
  );

  const ean = digitos(item.ean);
  if (ean.length >= 8) {
    const porEan = daEmpresa.filter(
      (produto) => digitos(produto.codigo_barras) === ean
    );
    if (porEan.length === 1) {
      return {
        produto: porEan[0],
        confianca: "alta",
        motivo: "EAN/GTIN",
      };
    }
  }

  const codigo = normalizar(item.codigoFornecedor);
  if (codigo) {
    const porCodigo = daEmpresa.find(
      (produto) => normalizar(produto.codigo) === codigo
    );
    if (porCodigo) {
      return {
        produto: porCodigo,
        confianca: "media",
        motivo: "código",
      };
    }
  }

  const descricao = normalizar(item.descricao);
  if (descricao.length >= 3) {
    const porNome = daEmpresa.find(
      (produto) => normalizar(produto.nome) === descricao
    );
    if (porNome) {
      return {
        produto: porNome,
        confianca: "baixa",
        motivo: "descrição",
      };
    }
  }

  return null;
}
