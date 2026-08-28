import type { DefinicaoIntencao } from "../tipos";

export const INTENCOES_CARTEIRA: DefinicaoIntencao[] = [
  {
    nome: "carteira.maior_devedor",
    ferramenta: "consultar_carteira",
    padroes: [
      { re: /\bquem deve mais\b/, pontos: 22 },
      { re: /\bquem (esta |ta )?devendo mais\b/, pontos: 22 },
      { re: /\bqual cliente (esta |ta )?devendo mais/, pontos: 22 },
      { re: /\bmaior devedor\b/, pontos: 22 },
      { re: /\bcliente com maior (debito|divida|conta)/, pontos: 18 },
      { re: /\bconta mais alta\b/, pontos: 16 },
      { re: /\bmaior saldo em aberto\b/, pontos: 18 },
      { re: /\bme devendo mais\b/, pontos: 18 },
      { re: /\bdevendo mais\b/, pontos: 14 },
    ],
    args: () => ({ somenteVencidos: false, ordenar: "aberto" }),
  },
  {
    nome: "carteira.vencidos",
    ferramenta: "consultar_carteira",
    padroes: [
      { re: /\bclientes? (com contas? )?vencid/, pontos: 20 },
      { re: /\bcontas? vencidas?\b/, pontos: 18 },
      { re: /\binadimplen/, pontos: 16 },
      { re: /\btotal vencido\b/, pontos: 14 },
      { re: /\bquanto (esta |ta )?vencido\b/, pontos: 12 },
      { re: /\bquem (esta |ta )?vencido/, pontos: 14 },
    ],
    args: () => ({ somenteVencidos: true }),
  },
  {
    nome: "carteira.totais",
    ferramenta: "consultar_carteira",
    padroes: [
      { re: /\btotal em aberto\b/, pontos: 20 },
      { re: /\bquantos clientes (estao |ta )?devendo/, pontos: 20 },
      { re: /\bclientes? (estao |ta )?devendo\b/, pontos: 14 },
      { re: /\bsaldo em aberto (total|geral|da empresa)/, pontos: 14 },
    ],
    args: () => ({ somenteVencidos: false, ordenar: "aberto" }),
  },
  {
    nome: "carteira.cliente",
    ferramenta: "consultar_cliente",
    padroes: [
      { re: /\bquanto (o |a )?cliente .+ (deve|ta devendo|esta devendo)/, pontos: 22 },
      { re: /\bquanto .+ deve\b/, pontos: 14 },
      { re: /\bcredito disponivel\b/, pontos: 16 },
      { re: /\bsaldo (em aberto|vencido) (do|da|de)/, pontos: 14 },
      { re: /\blimite (de credito|disponivel)\b/, pontos: 12 },
    ],
    args: ({ busca, clienteId }) => ({
      ...(clienteId ? { clienteId } : {}),
      ...(busca ? { busca } : {}),
    }),
  },
];
