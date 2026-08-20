export const CAMPOS_PRODUTO = [
  "codigo",
  "ean",
  "nome",
  "preco_custo",
  "preco_venda",
  "ncm",
  "categoria",
  "unidade",
  "marca",
  "estoque_atual",
] as const;

export type CampoProduto = (typeof CAMPOS_PRODUTO)[number];

export const ROTULOS_CAMPO_PRODUTO: Record<CampoProduto, string> = {
  codigo: "Código",
  ean: "EAN",
  nome: "Descrição/Nome",
  preco_custo: "Preço de custo",
  preco_venda: "Preço de venda",
  ncm: "NCM",
  categoria: "Categoria",
  unidade: "UN",
  marca: "Marca",
  estoque_atual: "Estoque atual",
};

export const CAMPOS_CLIENTE = [
  "nome",
  "nome_fantasia",
  "tipo_pessoa",
  "cpf_cnpj",
  "inscricao_estadual",
  "indicador_ie_destinatario",
  "consumidor_final",
  "telefone",
  "email",
  "cep",
  "logradouro",
  "numero",
  "complemento",
  "bairro",
  "municipio",
  "codigo_municipio_ibge",
  "uf",
  "limite_credito",
  "bloqueado",
  "dia_vencimento",
  "observacao",
  "ativo",
] as const;

export type CampoCliente = (typeof CAMPOS_CLIENTE)[number];

export const ROTULOS_CAMPO_CLIENTE: Record<CampoCliente, string> = {
  nome: "Nome",
  nome_fantasia: "Nome fantasia",
  tipo_pessoa: "Tipo de pessoa",
  cpf_cnpj: "CPF/CNPJ",
  inscricao_estadual: "Inscrição estadual",
  indicador_ie_destinatario: "Indicador IE",
  consumidor_final: "Consumidor final",
  telefone: "Telefone",
  email: "E-mail",
  cep: "CEP",
  logradouro: "Logradouro",
  numero: "Número",
  complemento: "Complemento",
  bairro: "Bairro",
  municipio: "Município",
  codigo_municipio_ibge: "Código IBGE",
  uf: "UF",
  limite_credito: "Limite de crédito",
  bloqueado: "Bloqueado",
  dia_vencimento: "Dia de vencimento",
  observacao: "Observação",
  ativo: "Ativo",
};

export type TipoImportacao = "produtos" | "clientes";

export type SituacaoLinhaImportacao =
  | "criar"
  | "atualizar"
  | "ignorado"
  | "erro"
  | "aviso";

export type ModoAusente = "criar" | "sem" | "erro";
export type ModoExistente = "atualizar" | "ignorar" | "erro";
export type ModoQuantidadeInvalida = "zero" | "ignorar_estoque" | "erro";
export type IdentificadorProduto = "codigo" | "ean";
export type IdentificadorCliente = "cpf_cnpj" | "email" | "telefone";

export type RegrasImportacaoProdutos = {
  identificador: IdentificadorProduto;
  existente: ModoExistente;
  categoriaAusente: ModoAusente;
  marcaAusente: ModoAusente;
  gerarCodigoAutomatico: boolean;
  importarEstoque: boolean;
  colunaQuantidade: string | null;
  quantidadeInvalida: ModoQuantidadeInvalida;
};

export type RegrasImportacaoClientes = {
  identificador: IdentificadorCliente;
  existente: ModoExistente;
};

export const LIMITES_IMPORTACAO = {
  maxLinhas: 5000,
  preview: 8,
  maxBytes: 8 * 1024 * 1024,
};

export type ConfiguracaoImportacao = {
  tipo: TipoImportacao;
  nomeArquivo: string;
  aba: string;
  linhaCabecalho: number;
  colunas: string[];
  camposProduto: CampoProduto[];
  camposCliente: CampoCliente[];
  mapeamento: Record<string, string | null>;
  regrasProdutos: RegrasImportacaoProdutos;
  regrasClientes: RegrasImportacaoClientes;
};

/** Estrutura pronta para um futuro “Salvar este mapeamento”. */
export type ModeloMapeamentoImportacao = {
  nome: string;
  tipo: TipoImportacao;
  camposProduto: CampoProduto[];
  camposCliente: CampoCliente[];
  mapeamento: Record<string, string | null>;
  regrasProdutos: RegrasImportacaoProdutos;
  regrasClientes: RegrasImportacaoClientes;
};

export type LinhaPlanilha = {
  numero: number;
  valores: Record<string, string>;
};

export type LinhaRevisaoImportacao = {
  numero: number;
  situacao: SituacaoLinhaImportacao;
  codigo: string;
  descricao: string;
  venda: string;
  observacao: string;
  payload: Record<string, string | number | boolean | null>;
  quantidadeEstoque: number | null;
  ignorarEstoque: boolean;
  existenteId: string | null;
  estoqueAtualSistema?: number | null;
  estoquePlanilha?: number | null;
  ajusteEstoque?: number | null;
  estoqueAposImportacao?: number | null;
};

export type ResumoImportacao = {
  total: number;
  criar: number;
  atualizar: number;
  ignorados: number;
  erros: number;
  avisos: number;
};

export type ResultadoPreviaImportacao = {
  resumo: ResumoImportacao;
  linhas: LinhaRevisaoImportacao[];
};

export type HistoricoImportacao = {
  id: string;
  tipo: TipoImportacao;
  nome_arquivo: string;
  status: string;
  total_linhas: number;
  total_criados: number;
  total_atualizados: number;
  total_ignorados: number;
  total_erros: number;
  created_at: string;
  finalizado_em: string | null;
};

export type ErroHistoricoImportacao = {
  id: string;
  numero_linha: number;
  erro: string;
  dados: Record<string, unknown>;
};
