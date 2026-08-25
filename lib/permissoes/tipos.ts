export const MODULOS_PERMISSAO = [
  "inicio",
  "vendas",
  "pdv",
  "clientes",
  "produtos",
  "estoque",
  "fiscal",
  "financeiro",
  "contabilidade",
  "configuracoes",
  "usuarios",
  "catalogo",
  "importacao_dados",
  "relatorios",
  "caixa",
] as const;

export type ModuloPermissao = (typeof MODULOS_PERMISSAO)[number];

export const ACOES_POR_MODULO = {
  inicio: ["acessar"],
  vendas: ["acessar", "criar", "editar", "cancelar"],
  pdv: [
    "acessar",
    "finalizar_venda",
    "aplicar_desconto",
    "usar_fiado",
    "cancelar_venda",
  ],
  clientes: [
    "acessar",
    "criar",
    "editar",
    "excluir",
    "acessar_carteira",
    "receber_carteira",
  ],
  produtos: ["acessar", "criar", "editar", "excluir", "importar"],
  estoque: ["acessar", "movimentar", "ajustar", "importar_estoque"],
  fiscal: [
    "acessar",
    "emitir_nfe",
    "emitir_nfce",
    "cancelar_nota",
    "carta_correcao",
    "inutilizar",
    "reconciliar",
    "configurar_fiscal",
  ],
  financeiro: ["acessar", "criar", "editar", "excluir", "configurar_pix"],
  contabilidade: [
    "acessar",
    "baixar_xml",
    "relatorios",
    "fechamento",
    "inventario",
  ],
  configuracoes: ["acessar", "editar_empresa", "configuracoes_gerais"],
  usuarios: ["acessar", "criar", "editar", "desativar", "alterar_permissoes"],
  catalogo: ["acessar", "configurar", "pedidos"],
  importacao_dados: ["acessar", "importar_produtos", "importar_clientes"],
  relatorios: ["acessar", "exportar"],
  caixa: ["acessar", "abrir", "movimentar", "fechar", "reabrir"],
} as const;

export type AcaoDoModulo<M extends ModuloPermissao> =
  (typeof ACOES_POR_MODULO)[M][number];

export type PermissoesModulo<M extends ModuloPermissao> = Record<
  AcaoDoModulo<M>,
  boolean
>;

export type PermissoesEfetivas = {
  [M in ModuloPermissao]: PermissoesModulo<M>;
};

export type LinhaPermissao = {
  modulo: string;
  permissoes: Record<string, boolean>;
};

export type OrigemPermissao = "administrador" | "perfil_padrao" | "personalizada";

export const MODULO_LABEL: Record<ModuloPermissao, string> = {
  inicio: "Início",
  vendas: "Vendas",
  pdv: "PDV",
  clientes: "Clientes",
  produtos: "Produtos",
  estoque: "Estoque",
  fiscal: "Fiscal",
  financeiro: "Financeiro",
  contabilidade: "Contabilidade",
  configuracoes: "Configurações",
  usuarios: "Usuários",
  catalogo: "Catálogo Online",
  importacao_dados: "Importação de dados",
  relatorios: "Relatórios",
  caixa: "Caixa",
};

export const ACAO_LABEL: Record<string, string> = {
  acessar: "Acessar",
  criar: "Criar",
  editar: "Editar",
  excluir: "Excluir",
  cancelar: "Cancelar",
  finalizar_venda: "Finalizar venda",
  aplicar_desconto: "Desconto",
  usar_fiado: "Fiado",
  cancelar_venda: "Cancelar venda",
  acessar_carteira: "Carteira",
  receber_carteira: "Receber carteira",
  importar: "Importar",
  movimentar: "Movimentar",
  ajustar: "Ajustar",
  importar_estoque: "Importar estoque",
  emitir_nfe: "Emitir NF-e",
  emitir_nfce: "Emitir NFC-e",
  cancelar_nota: "Cancelar nota",
  carta_correcao: "Carta de correção",
  inutilizar: "Inutilizar",
  reconciliar: "Reconciliar",
  configurar_fiscal: "Configurar fiscal",
  configurar_pix: "Configurar PIX",
  baixar_xml: "Baixar XML",
  relatorios: "Relatórios",
  fechamento: "Fechamento",
  inventario: "Inventário",
  editar_empresa: "Editar empresa",
  configuracoes_gerais: "Configurações gerais",
  desativar: "Desativar",
  alterar_permissoes: "Alterar permissões",
  configurar: "Configurar",
  pedidos: "Pedidos",
  importar_produtos: "Importar produtos",
  importar_clientes: "Importar clientes",
  exportar: "Exportar",
  abrir: "Abrir caixa",
  fechar: "Fechar caixa",
  reabrir: "Reabrir caixa",
};

export function ehModuloPermissao(valor: string): valor is ModuloPermissao {
  return (MODULOS_PERMISSAO as readonly string[]).includes(valor);
}
