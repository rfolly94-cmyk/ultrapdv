/**
 * Catálogo comercial do plano (entitlement da empresa).
 * Documentação: docs/entitlements-map.md
 * Permissões de usuário (camada distinta): docs/permissoes-usuarios-map.md
 * Combinar as camadas: lib/plataforma/entitlements/
 * Rollout atual: ver `RECURSOS_COM_ENFORCEMENT`.
 */
export const CATEGORIAS_RECURSO = [
  "comercial",
  "fiscal",
  "contabilidade",
  "integracoes",
  "suporte",
] as const;

export type CategoriaRecurso = (typeof CATEGORIAS_RECURSO)[number];

export const NIVEIS_SUPORTE = ["normal", "prioritario", "premium"] as const;

export type NivelSuporte = (typeof NIVEIS_SUPORTE)[number];

export const CHAVES_LIMITE = ["usuarios", "filiais"] as const;

export type ChaveLimite = (typeof CHAVES_LIMITE)[number];

export type RecursoCatalogo = {
  chave: string;
  nome: string;
  descricao: string;
  categoria: CategoriaRecurso;
  ordem: number;
};

export const CATALOGO_RECURSOS: RecursoCatalogo[] = [
  {
    chave: "pdv",
    nome: "PDV",
    descricao: "Sistema de frente de caixa.",
    categoria: "comercial",
    ordem: 10,
  },
  {
    chave: "vendas",
    nome: "Vendas",
    descricao: "Histórico e gestão de vendas.",
    categoria: "comercial",
    ordem: 20,
  },
  {
    chave: "produtos",
    nome: "Produtos",
    descricao: "Cadastro e gestão de produtos.",
    categoria: "comercial",
    ordem: 30,
  },
  {
    chave: "clientes",
    nome: "Clientes",
    descricao: "Cadastro de clientes.",
    categoria: "comercial",
    ordem: 40,
  },
  {
    chave: "estoque",
    nome: "Estoque",
    descricao: "Controle de estoque.",
    categoria: "comercial",
    ordem: 50,
  },
  {
    chave: "carteira",
    nome: "Carteira",
    descricao: "Vendas fiado e recebimentos.",
    categoria: "comercial",
    ordem: 60,
  },
  {
    chave: "relatorios",
    nome: "Relatórios",
    descricao: "Relatórios operacionais.",
    categoria: "comercial",
    ordem: 70,
  },
  {
    chave: "catalogo",
    nome: "Catálogo online",
    descricao: "Loja pública, publicação de produtos e pedidos online.",
    categoria: "comercial",
    ordem: 80,
  },
  {
    chave: "nfce",
    nome: "NFC-e",
    descricao: "Emissão de NFC-e.",
    categoria: "fiscal",
    ordem: 10,
  },
  {
    chave: "nfe",
    nome: "NF-e",
    descricao: "Emissão de NF-e.",
    categoria: "fiscal",
    ordem: 20,
  },
  {
    chave: "cce",
    nome: "Carta de Correção Eletrônica",
    descricao: "CC-e para NF-e autorizada.",
    categoria: "fiscal",
    ordem: 30,
  },
  {
    chave: "inutilizacao_fiscal",
    nome: "Inutilização de numeração",
    descricao: "Inutilização fiscal de numeração.",
    categoria: "fiscal",
    ordem: 40,
  },
  {
    chave: "contabilidade",
    nome: "Contabilidade",
    descricao: "Área da contadora.",
    categoria: "contabilidade",
    ordem: 10,
  },
  {
    chave: "importador",
    nome: "Importador de dados",
    descricao: "Importação de cadastros.",
    categoria: "integracoes",
    ordem: 10,
  },
  {
    chave: "pix_integrado",
    nome: "PIX integrado",
    descricao: "Recebimento PIX no PDV.",
    categoria: "integracoes",
    ordem: 20,
  },
  {
    chave: "impressao_automatica",
    nome: "Impressão automática",
    descricao: "UltraPDV Conector e impressão automática.",
    categoria: "integracoes",
    ordem: 30,
  },
  {
    chave: "suporte_prioritario",
    nome: "Suporte prioritário",
    descricao: "Atendimento com prioridade.",
    categoria: "suporte",
    ordem: 10,
  },
];

export const ROTULOS_CATEGORIA_RECURSO: Record<CategoriaRecurso, string> = {
  comercial: "Comercial",
  fiscal: "Fiscal",
  contabilidade: "Contabilidade",
  integracoes: "Integrações",
  suporte: "Suporte",
};

export const ROTULOS_NIVEL_SUPORTE: Record<NivelSuporte, string> = {
  normal: "Suporte normal",
  prioritario: "Suporte prioritário",
  premium: "Suporte premium",
};

export const ROTULOS_LIMITE: Record<ChaveLimite, string> = {
  usuarios: "Usuários",
  filiais: "Filiais",
};

export function recursoDoCatalogo(chave: string) {
  return CATALOGO_RECURSOS.find((item) => item.chave === chave) ?? null;
}

export function recursosDaCategoria(categoria: CategoriaRecurso) {
  return CATALOGO_RECURSOS.filter((item) => item.categoria === categoria).sort(
    (a, b) => a.ordem - b.ordem
  );
}

export function nivelSuporteValido(valor: unknown): valor is NivelSuporte {
  return NIVEIS_SUPORTE.includes(String(valor ?? "") as NivelSuporte);
}

export function chaveLimiteValida(valor: unknown): valor is ChaveLimite {
  return CHAVES_LIMITE.includes(String(valor ?? "") as ChaveLimite);
}
