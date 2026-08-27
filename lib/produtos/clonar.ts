export const SUFIXO_COPIA_PRODUTO = " - CÓPIA";

export type ProdutoOrigemClone = {
  nome: string;
  descricao: string | null;
  categoria_id: string | null;
  marca_id: string | null;
  grupo_fiscal_id: string | null;
  ncm?: string | null;
  cest?: string | null;
  origem_produto?: string | null;
  unidade_medida: string;
  preco_custo: number | string | null;
  preco_venda: number | string | null;
  ativo?: boolean;
  catalogo_publicado?: boolean;
  catalogo_descricao?: string | null;
  catalogo_destaque?: boolean;
  catalogo_mostrar_preco?: boolean;
  controlar_validade?: boolean;
};

export type ProdutoCloneValores = {
  codigo: string;
  codigo_barras: null;
  nome: string;
  descricao: string | null;
  categoria_id: string | null;
  marca_id: string | null;
  grupo_fiscal_id: string | null;
  ncm: string | null;
  cest: string | null;
  origem_produto: string | null;
  unidade_medida: string;
  preco_custo: number | string | null;
  preco_venda: number | string | null;
  ativo: boolean;
  catalogo_publicado: boolean;
  catalogo_descricao: string | null;
  catalogo_destaque: boolean;
  catalogo_mostrar_preco: boolean;
  catalogo_imagem_path: null;
  controlar_validade: boolean;
};

export function nomeProdutoCopia(nome: string) {
  const texto = String(nome ?? "").trim();
  if (!texto) {
    return SUFIXO_COPIA_PRODUTO.trim();
  }
  if (texto.endsWith(SUFIXO_COPIA_PRODUTO)) {
    return texto;
  }
  return `${texto}${SUFIXO_COPIA_PRODUTO}`;
}

export function montarDadosCloneProduto(
  origem: ProdutoOrigemClone
): ProdutoCloneValores {
  return {
    codigo: "",
    codigo_barras: null,
    nome: nomeProdutoCopia(origem.nome),
    descricao: origem.descricao,
    categoria_id: origem.categoria_id,
    marca_id: origem.marca_id,
    grupo_fiscal_id: origem.grupo_fiscal_id,
    ncm: origem.ncm ?? null,
    cest: origem.cest ?? null,
    origem_produto: origem.origem_produto ?? "0",
    unidade_medida: origem.unidade_medida,
    preco_custo: origem.preco_custo,
    preco_venda: origem.preco_venda,
    ativo: origem.ativo !== false,
    catalogo_publicado: Boolean(origem.catalogo_publicado),
    catalogo_descricao: origem.catalogo_descricao ?? null,
    catalogo_destaque: Boolean(origem.catalogo_destaque),
    catalogo_mostrar_preco: origem.catalogo_mostrar_preco !== false,
    catalogo_imagem_path: null,
    controlar_validade: Boolean(origem.controlar_validade),
  };
}
