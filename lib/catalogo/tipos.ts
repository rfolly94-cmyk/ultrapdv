export type CatalogoDisponibilidade =
  | "disponivel"
  | "ultimas"
  | "esgotado";

export type CatalogoProdutoPublico = {
  id: string;
  codigo: string;
  nome: string;
  descricao_catalogo: string | null;
  imagem: string | null;
  categoria: string | null;
  categoria_id: string | null;
  marca: string | null;
  preco: number | null;
  mostrar_preco: boolean;
  disponibilidade: CatalogoDisponibilidade;
  destaque: boolean;
};

export type CatalogoLojaPublica = {
  nome_exibido: string;
  slug: string;
  descricao: string | null;
  logo: string | null;
  banner: string | null;
  whatsapp_numero: string | null;
  whatsapp_mensagem: string | null;
  permitir_pedido: boolean;
  permitir_whatsapp: boolean;
  produto_sem_estoque: "mostrar_esgotado" | "ocultar";
  permitir_retirada: boolean;
  permitir_entrega: boolean;
  info_entrega: string | null;
};

export type CatalogoPublicoOk = {
  status: "ok";
  loja: CatalogoLojaPublica;
  produtos: CatalogoProdutoPublico[];
  categorias: Array<{ id: string; nome: string }>;
};

export type CatalogoPublicoResposta =
  | CatalogoPublicoOk
  | { status: "inativo"; loja: { nome_exibido: string; slug: string } }
  | { status: "nao_encontrado" };

export type CatalogoCarrinhoItem = {
  produtoId: string;
  codigo: string;
  nome: string;
  quantidade: number;
  preco: number | null;
  mostrarPreco: boolean;
  imagem: string | null;
};

export type CatalogoConfigFormulario = {
  id?: string;
  ativo: boolean;
  nome_exibido: string;
  slug: string;
  descricao: string;
  logo_path: string | null;
  banner_path: string | null;
  whatsapp_numero: string;
  whatsapp_mensagem: string;
  permitir_pedido: boolean;
  permitir_whatsapp: boolean;
  produto_sem_estoque: "mostrar_esgotado" | "ocultar";
  permitir_retirada: boolean;
  permitir_entrega: boolean;
  info_entrega: string;
};

export type CatalogoPedidoStatus =
  | "NOVO"
  | "EM_ATENDIMENTO"
  | "ACEITO"
  | "CONVERTIDO"
  | "CANCELADO";

export type CatalogoPedidoItem = {
  id: string;
  produto_id: string | null;
  codigo_produto: string;
  nome_produto: string;
  quantidade: number;
  preco_unitario: number;
  subtotal: number;
};

export type CatalogoPedido = {
  id: string;
  codigo: number;
  cliente_nome: string;
  cliente_whatsapp: string;
  tipo_entrega: "retirada" | "entrega";
  cep: string | null;
  rua: string | null;
  numero: string | null;
  bairro: string | null;
  complemento: string | null;
  cidade: string | null;
  referencia: string | null;
  observacao: string | null;
  subtotal: number;
  total: number;
  status: CatalogoPedidoStatus;
  venda_id: string | null;
  venda_numero: number | null;
  created_at: string;
  itens: CatalogoPedidoItem[];
};

export type PedidoPdvAviso = {
  produtoId: string;
  nome: string;
  tipo: "preco" | "estoque" | "indisponivel";
  detalhe: string;
};

export type PedidoPdvInicial = {
  pedidoId: string;
  codigo: number;
  clienteNome: string;
  clienteWhatsapp: string;
  tipoEntrega: "retirada" | "entrega";
  endereco: string | null;
  observacao: string | null;
  avisos: PedidoPdvAviso[];
  itens: Array<{
    produtoId: string;
    codigo: string;
    nome: string;
    unidadeMedida: string;
    quantidade: number;
    precoAtual: number;
    precoPedido: number;
  }>;
};
