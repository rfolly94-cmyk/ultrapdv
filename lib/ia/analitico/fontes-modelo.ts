import type { ItemVendaRelatorio, PagamentoRelatorio } from "@/lib/relatorios/calculo";

import type { DominioAnalitico } from "./tipos";

export type VendaFonte = {
  id: string;
  empresa_id: string;
  cliente_id: string | null;
  usuario_id: string | null;
  status: string;
  valor_total: number;
  desconto: number;
  finalizada_at: string | null;
  created_at: string;
};

export type ProdutoFonte = {
  id: string;
  empresa_id: string;
  nome: string;
  categoria_id: string | null;
  marca_id: string | null;
  preco_custo: number;
  preco_venda: number;
  ativo: boolean;
};

export type EstoqueFonte = {
  produto_id: string;
  quantidade: number;
  minimo: number;
};

export type ClienteFonte = {
  id: string;
  nome: string;
  ativo: boolean;
  limite_credito: number;
  bloqueado: boolean;
};

export type CarteiraFonte = {
  debitoAberto: number;
  vencido: number;
  creditoAberto: number;
};

export type RecebimentoFonte = {
  cliente_id: string;
  valor: number;
  created_at: string;
};

export type FontesAnaliticas = {
  empresaId: string;
  janela: { inicio: Date; fim: Date; rotulo: string; dias: number };
  janelaAnterior: { inicio: Date; fim: Date; rotulo: string; dias: number } | null;
  vendas: VendaFonte[];
  itens: ItemVendaRelatorio[];
  pagamentos: PagamentoRelatorio[];
  vendasAnterior: VendaFonte[];
  itensAnterior: ItemVendaRelatorio[];
  pagamentosAnterior: PagamentoRelatorio[];
  produtos: ProdutoFonte[];
  categorias: Map<string, string>;
  marcas: Map<string, string>;
  estoque: Map<string, EstoqueFonte>;
  clientes: Map<string, ClienteFonte>;
  vendedores: Map<string, string>;
  carteira: Map<string, CarteiraFonte>;
  recebimentos: RecebimentoFonte[];
  recebimentosAnterior: RecebimentoFonte[];
  caixa: {
    aberto: boolean;
    entradas: number;
    saidas: number;
    saldoAtual: number | null;
  } | null;
  fiscal: {
    revisao: number;
    gruposIncompativeis: number;
    notasRejeitadas: number;
  } | null;
  avisos: string[];
  dadosIncompletos: string[];
  dominiosNegados: DominioAnalitico[];
};

export function fontesAnaliticasVazias(empresaId: string): FontesAnaliticas {
  const agora = new Date();
  return {
    empresaId,
    janela: { inicio: agora, fim: agora, rotulo: "hoje", dias: 1 },
    janelaAnterior: null,
    vendas: [],
    itens: [],
    pagamentos: [],
    vendasAnterior: [],
    itensAnterior: [],
    pagamentosAnterior: [],
    produtos: [],
    categorias: new Map(),
    marcas: new Map(),
    estoque: new Map(),
    clientes: new Map(),
    vendedores: new Map(),
    carteira: new Map(),
    recebimentos: [],
    recebimentosAnterior: [],
    caixa: null,
    fiscal: null,
    avisos: [],
    dadosIncompletos: [],
    dominiosNegados: [],
  };
}
