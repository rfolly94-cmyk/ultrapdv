import type { DefinicaoDimensaoAnalitica, GraoJoinAnalitico, NomeDimensaoAnalitica } from "./tipos";

export const REGISTRO_DIMENSOES_ANALITICAS: Record<
  NomeDimensaoAnalitica,
  DefinicaoDimensaoAnalitica
> = {
  produto: {
    nome: "produto",
    grao: "produto",
    fonte: "produtos.id / vendas_itens.produto_id",
  },
  categoria: {
    nome: "categoria",
    grao: "categoria",
    fonte: "produtos.categoria_id + categorias.nome",
  },
  marca: {
    nome: "marca",
    grao: "marca",
    fonte: "produtos.marca_id + marcas.nome",
  },
  cliente: {
    nome: "cliente",
    grao: "cliente",
    fonte: "vendas.cliente_id / carteira.cliente_id",
  },
  vendedor: {
    nome: "vendedor",
    grao: "vendedor",
    fonte: "vendas.usuario_id",
  },
  forma_pagamento: {
    nome: "forma_pagamento",
    grao: "forma_pagamento",
    fonte: "vendas_pagamentos.forma_pagamento_nome",
  },
  dia: { nome: "dia", grao: "tempo", fonte: "chaveDiaSaoPaulo da venda" },
  semana: { nome: "semana", grao: "tempo", fonte: "semana ISO America/Sao_Paulo" },
  mes: { nome: "mes", grao: "tempo", fonte: "YYYY-MM America/Sao_Paulo" },
  ano: { nome: "ano", grao: "tempo", fonte: "YYYY America/Sao_Paulo" },
};

export const JOINS_PERMITIDOS: Record<GraoJoinAnalitico, readonly string[]> = {
  empresa: ["vendas", "estoque", "carteira", "clientes", "caixa", "fiscal"],
  produto: ["vendas", "estoque"],
  categoria: ["vendas", "estoque"],
  marca: ["vendas", "estoque"],
  cliente: ["vendas", "carteira", "clientes"],
  vendedor: ["vendas"],
  forma_pagamento: ["vendas"],
  tempo: ["vendas", "carteira"],
};

export function dimensaoAnalitica(nome: string): DefinicaoDimensaoAnalitica | null {
  return Object.prototype.hasOwnProperty.call(REGISTRO_DIMENSOES_ANALITICAS, nome)
    ? REGISTRO_DIMENSOES_ANALITICAS[nome as NomeDimensaoAnalitica]
    : null;
}

export function graoDaConsulta(dimensoes: NomeDimensaoAnalitica[]): GraoJoinAnalitico {
  if (dimensoes.length === 0) {
    return "empresa";
  }
  return REGISTRO_DIMENSOES_ANALITICAS[dimensoes[0]].grao;
}
