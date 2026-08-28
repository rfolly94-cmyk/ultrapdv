import type { DefinicaoIntencao } from "../tipos";

export const INTENCOES_NAVEGACAO: DefinicaoIntencao[] = [
  {
    nome: "navegacao.pdv",
    ferramenta: "abrir_pdv",
    padroes: [
      { re: /\b(abre|abrir|abrir o|ir para o|vai para o)\b.{0,12}\bpdv\b/, pontos: 22 },
      { re: /\bfrente de caixa\b/, pontos: 16 },
    ],
    args: () => ({}),
  },
  {
    nome: "navegacao.novo_produto",
    ferramenta: "novo_produto",
    padroes: [
      { re: /\b(novo|cadastrar|cadastra)\b.{0,16}\bproduto\b/, pontos: 22 },
    ],
    args: () => ({}),
  },
  {
    nome: "navegacao.produtos",
    ferramenta: "abrir_produtos",
    padroes: [
      { re: /\b(abre|abrir)\b.{0,12}\bprodutos\b/, pontos: 18 },
    ],
    args: () => ({}),
  },
  {
    nome: "navegacao.novo_cliente",
    ferramenta: "novo_cliente",
    padroes: [
      { re: /\b(novo|cadastrar|cadastra)\b.{0,16}\bcliente\b/, pontos: 22 },
    ],
    args: () => ({}),
  },
  {
    nome: "navegacao.clientes",
    ferramenta: "abrir_clientes",
    padroes: [
      { re: /\b(abre|abrir)\b.{0,12}\bclientes\b/, pontos: 18 },
    ],
    args: () => ({}),
  },
  {
    nome: "navegacao.vendas",
    ferramenta: "abrir_vendas",
    padroes: [
      { re: /\b(abre|abrir)\b.{0,12}\bvendas\b/, pontos: 18 },
    ],
    args: () => ({}),
  },
  {
    nome: "vendas.abrir",
    ferramenta: "consultar_venda",
    padroes: [
      { re: /\b(abre|abrir|mostra|ver)\b.{0,8}\bvenda\s+\d+/, pontos: 24 },
    ],
    args: ({ busca }) => {
      const numero = String(busca ?? "").match(/\d+/)?.[0] ?? "";
      return numero ? { numero } : {};
    },
  },
  {
    nome: "navegacao.caixa",
    ferramenta: "abrir_caixa",
    padroes: [
      { re: /\b(abre|abrir|fecha|fechar)\b.{0,16}\bcaixa\b/, pontos: 18 },
      { re: /\bfecha(r)? meu caixa\b/, pontos: 22 },
      { re: /\bsangria/, pontos: 20 },
      { re: /\bsuprimento/, pontos: 20 },
    ],
    args: () => ({}),
  },
  {
    nome: "navegacao.carteira",
    ferramenta: "abrir_carteira",
    padroes: [
      { re: /\b(abre|abrir)\b.{0,12}\bcarteira\b/, pontos: 20 },
      { re: /\brecebe(r)?\b.{0,24}\b(cliente|do |da )/, pontos: 16 },
    ],
    args: ({ clienteId }) => (clienteId ? { clienteId } : {}),
  },
  {
    nome: "navegacao.nfe",
    ferramenta: "iniciar_nfe",
    padroes: [
      { re: /\bemitir nfe\b/, pontos: 24 },
      { re: /\bemitir nf e\b/, pontos: 24 },
      { re: /\bnf e\b/, pontos: 18 },
      { re: /\bnfe\b/, pontos: 16 },
    ],
    args: () => ({}),
  },
  {
    nome: "navegacao.nfce",
    ferramenta: "iniciar_nfce",
    padroes: [
      { re: /\bemitir nfce\b/, pontos: 24 },
      { re: /\bemitir nfc e\b/, pontos: 24 },
      { re: /\bnfc e\b/, pontos: 18 },
      { re: /\bnfce\b/, pontos: 16 },
    ],
    args: () => ({}),
  },
  {
    nome: "navegacao.fiscal",
    ferramenta: "abrir_fiscal",
    padroes: [
      { re: /\b(abre|abrir)\b.{0,12}\bfiscal\b/, pontos: 18 },
    ],
    args: () => ({}),
  },
];
