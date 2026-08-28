import type { DefinicaoIntencao } from "../tipos";

export const INTENCOES_ESTOQUE: DefinicaoIntencao[] = [
  {
    nome: "estoque.zerados",
    ferramenta: "consultar_estoque",
    padroes: [
      { re: /\bprodutos? zerados?\b/, pontos: 22 },
      { re: /\bzerados?\b/, pontos: 16 },
      { re: /\bsem estoque\b/, pontos: 18 },
      { re: /\bestoque zero\b/, pontos: 16 },
      { re: /\bprodutos? (acabaram|esgotad)/, pontos: 14 },
    ],
    args: () => ({ filtro: "zerados" }),
  },
  {
    nome: "estoque.negativos",
    ferramenta: "consultar_estoque",
    padroes: [
      { re: /\bestoque negativo/, pontos: 22 },
      { re: /\bprodutos? negativos?\b/, pontos: 18 },
      { re: /\bnegativos?\b/, pontos: 10 },
    ],
    args: () => ({ filtro: "negativos" }),
  },
  {
    nome: "estoque.baixo",
    ferramenta: "consultar_estoque",
    padroes: [
      { re: /\bestoque baixo\b/, pontos: 22 },
      { re: /\bproduto(s)? acabando\b/, pontos: 20 },
      { re: /\babixo do minimo\b/, pontos: 20 },
      { re: /\bproximos? de acabar\b/, pontos: 18 },
      { re: /\bacabando\b/, pontos: 12 },
      { re: /\bquantos produtos (estao |ta )?abaixo/, pontos: 16 },
    ],
    args: () => ({ filtro: "acabando" }),
  },
];
