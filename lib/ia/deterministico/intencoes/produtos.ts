import type { DefinicaoIntencao } from "../tipos";

export const INTENCOES_PRODUTO: DefinicaoIntencao[] = [
  {
    nome: "produto.consulta",
    ferramenta: "consultar_produto",
    padroes: [
      { re: /\bpreco (do |da |de )/, pontos: 18 },
      { re: /\bestoque (do |da |de )produto/, pontos: 18 },
      { re: /\bcodigo (do |da |de )produto/, pontos: 16 },
      { re: /\bproduto (esta |ta )?(ativo|inativo)/, pontos: 16 },
      { re: /\bsaldo (do |da |de )produto/, pontos: 16 },
    ],
    args: ({ busca, produtoId }) => ({
      ...(produtoId ? { produtoId } : {}),
      ...(busca ? { busca } : {}),
    }),
  },
];
