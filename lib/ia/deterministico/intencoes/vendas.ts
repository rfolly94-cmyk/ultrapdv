import type { DefinicaoIntencao } from "../tipos";

export const INTENCOES_VENDAS: DefinicaoIntencao[] = [
  {
    nome: "vendas.comparativo",
    ferramenta: "resumir_vendas_periodo",
    padroes: [
      { re: /\bcompar(ar|acao|ativo|ando)\b/, pontos: 16 },
      { re: /\b(versus|vs|em relacao|evolucao|cresceu|caiu)\b/, pontos: 12 },
      { re: /\bvendas\b.+\b(anterior|passad)/, pontos: 10 },
    ],
    args: ({ periodo }) => ({ periodo, compararAnterior: true }),
  },
  {
    nome: "vendas.ranking_produtos",
    ferramenta: "ranking_produtos",
    padroes: [
      { re: /\bproduto(s)? mais vendid/, pontos: 20 },
      { re: /\bqual produto vendeu mais/, pontos: 20 },
      { re: /\bo que mais vendeu/, pontos: 16 },
      { re: /\branking (de )?produtos/, pontos: 16 },
      { re: /\bmais vendidos?\b/, pontos: 12 },
    ],
    args: ({ periodo }) => ({ periodo }),
  },
  {
    nome: "vendas.formas",
    ferramenta: "consultar_vendas",
    padroes: [
      { re: /\bformas? de pagamento/, pontos: 20 },
      { re: /\bpagamento(s)? mais (usad|comum)/, pontos: 16 },
      { re: /\bcomo (pagaram|foi pago|receberam)/, pontos: 12 },
    ],
    args: ({ periodo }) => ({ periodo }),
  },
  {
    nome: "vendas.maior",
    ferramenta: "consultar_vendas",
    padroes: [
      { re: /\bmaior venda\b/, pontos: 20 },
      { re: /\bvenda mais (alta|cara|grande)/, pontos: 16 },
      { re: /\bmaior ticket\b/, pontos: 14 },
    ],
    args: ({ periodo }) => ({ periodo }),
  },
  {
    nome: "vendas.ticket",
    ferramenta: "consultar_vendas",
    padroes: [
      { re: /\bticket medio\b/, pontos: 20 },
      { re: /\bmedia de venda/, pontos: 16 },
      { re: /\bvalor medio\b/, pontos: 12 },
    ],
    args: ({ periodo }) => ({ periodo }),
  },
  {
    nome: "vendas.resumo",
    ferramenta: "consultar_vendas",
    padroes: [
      { re: /\bquanto vend(i|emos|eu)\b/, pontos: 18 },
      { re: /\bquanto fatur(ei|amos|ou|amos)\b/, pontos: 18 },
      { re: /\bfaturamento\b/, pontos: 14 },
      { re: /\bvendas (de |do |da )/, pontos: 12 },
      { re: /\bminha venda\b/, pontos: 12 },
      { re: /\bquantidade de vendas\b/, pontos: 14 },
      { re: /\bquantas vendas\b/, pontos: 14 },
    ],
    args: ({ periodo }) => ({ periodo }),
  },
];
