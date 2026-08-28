export const FABRICANTES_BALANCA = [
  { value: "toledo", label: "Toledo" },
  { value: "urano", label: "Urano" },
  { value: "filizola", label: "Filizola" },
  { value: "outro", label: "Outro" },
] as const;

export type FabricanteBalanca = (typeof FABRICANTES_BALANCA)[number]["value"];

export const TIPOS_INTEGRACAO_BALANCA = [
  { value: "arquivo", label: "Arquivo" },
  { value: "pendrive", label: "Pendrive" },
  { value: "rede", label: "Rede" },
] as const;

export type TipoIntegracaoBalanca =
  (typeof TIPOS_INTEGRACAO_BALANCA)[number]["value"];

export const MODOS_ETIQUETA_BALANCA = [
  { value: "peso", label: "Peso" },
  { value: "preco", label: "Preço" },
] as const;

export type ModoEtiquetaBalanca =
  (typeof MODOS_ETIQUETA_BALANCA)[number]["value"];

export type ConfiguracaoEtiquetaBalanca = {
  prefixo: string;
  plu: boolean;
  modo: ModoEtiquetaBalanca;
  quantidadeDigitos: number;
  casasDecimais: number;
  digitoVerificador: boolean;
};

export type ConfiguracaoBalancaJson = {
  etiqueta: ConfiguracaoEtiquetaBalanca;
  modeloId?: string | null;
  formato?: string | null;
  etiquetaManual?: boolean;
  departamentoPadrao?: string | null;
};

export const STATUS_PRODUTO_BALANCA = [
  "pronto",
  "nao_vinculado",
  "plu_duplicado",
  "plu_ausente",
  "plu_invalido",
  "descricao_invalida",
  "preco_invalido",
  "departamento_invalido",
  "validade_invalida",
  "configuracao_incompleta",
] as const;

export type StatusProdutoBalanca = (typeof STATUS_PRODUTO_BALANCA)[number];

export const ROTULO_STATUS_PRODUTO_BALANCA: Record<
  StatusProdutoBalanca,
  string
> = {
  pronto: "Pronto",
  nao_vinculado: "Não vinculado",
  plu_duplicado: "PLU duplicado",
  plu_ausente: "PLU ausente",
  plu_invalido: "PLU inválido",
  descricao_invalida: "Descrição inválida",
  preco_invalido: "Preço inválido",
  departamento_invalido: "Departamento inválido",
  validade_invalida: "Validade inválida",
  configuracao_incompleta: "Configuração incompleta",
};

export type ProdutoCargaBalanca = {
  plu: string;
  codigoProduto: string;
  descricao: string;
  preco: number;
  unidade: string;
  validadeDias: number | null;
  tara: number | null;
  departamento: string | null;
  mensagem: string | null;
};

export type DadosCadastroBalanca = {
  plu: string | null;
  descricaoBalanca: string | null;
  validadeEtiquetaDias: number | null;
  taraPadrao: number | null;
  departamento: string | null;
  mensagem: string | null;
};

export type ProdutoElegivelBalanca = {
  produtoId: string;
  empresaId: string;
  codigo: string;
  nome: string;
  unidade: string;
  precoVenda: number;
  configuracaoId: string | null;
  enviarBalanca: boolean;
  plu: string | null;
  descricaoBalanca: string | null;
  validadeEtiquetaDias: number | null;
  taraPadrao: number | null;
  departamento: string | null;
  mensagem: string | null;
};

export type ProdutoVinculadoBalanca = ProdutoElegivelBalanca & {
  status: StatusProdutoBalanca;
  problemas: string[];
};

export type ConfiguracaoBalanca = {
  id: string;
  empresaId: string;
  nome: string;
  fabricante: FabricanteBalanca;
  modelo: string | null;
  layout: string | null;
  tipoIntegracao: TipoIntegracaoBalanca;
  configuracao: ConfiguracaoBalancaJson;
  ativo: boolean;
};

export type ProblemaCargaBalanca = {
  produtoId: string;
  codigo: string;
  nome: string;
  plu: string | null;
  status: StatusProdutoBalanca;
  detalhe: string;
};

export type ResumoValidacaoCargaBalanca = {
  encontrados: number;
  validos: number;
  comErro: number;
  problemas: ProblemaCargaBalanca[];
};

export type ResultadoExportacaoBalanca =
  | {
      ok: true;
      nomeArquivo: string;
      conteudo: string;
      mime: string;
    }
  | { ok: false; erro: string };

export const MENSAGEM_LAYOUT_NAO_IMPLEMENTADO =
  "Layout de exportação ainda não implementado.";

export const MENSAGEM_EXPORTACAO_COM_INVALIDOS =
  "Não é possível gerar a carga com registros inválidos. Corrija os problemas ou exporte somente os válidos.";

export const MENSAGEM_SEM_PRODUTOS_VALIDOS =
  "Não há produtos válidos para exportar.";

export const MENSAGEM_PLU_DUPLICADO =
  "Já existe um produto com este PLU nesta empresa.";

export const ETIQUETA_BALANCA_PADRAO: ConfiguracaoEtiquetaBalanca = {
  prefixo: "",
  plu: true,
  modo: "peso",
  quantidadeDigitos: 6,
  casasDecimais: 3,
  digitoVerificador: false,
};
