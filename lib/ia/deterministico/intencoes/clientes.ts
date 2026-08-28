import type { DefinicaoIntencao } from "../tipos";

export const INTENCOES_CLIENTES: DefinicaoIntencao[] = [
  {
    nome: "clientes.ranking",
    ferramenta: "consultar_vendas",
    padroes: [
      { re: /\bcliente que mais comprou\b/, pontos: 22 },
      { re: /\bmaiores clientes\b/, pontos: 20 },
      { re: /\btop clientes\b/, pontos: 18 },
      { re: /\bquem mais comprou\b/, pontos: 18 },
      { re: /\bmelhores clientes\b/, pontos: 14 },
    ],
    args: ({ periodo }) => ({ periodo, rankingClientes: true }),
  },
  {
    nome: "clientes.compras",
    ferramenta: "consultar_cliente",
    encadear: ["consultar_vendas"],
    padroes: [
      { re: /\btotal comprado\b/, pontos: 20 },
      { re: /\bultima compra\b/, pontos: 20 },
      { re: /\bquantidade de compras\b/, pontos: 18 },
      { re: /\bquanto (o |a )?cliente .+ comprou/, pontos: 18 },
    ],
    args: ({ busca, clienteId, periodo }) => ({
      ...(clienteId ? { clienteId } : {}),
      ...(busca ? { busca } : {}),
      periodo,
    }),
  },
];
