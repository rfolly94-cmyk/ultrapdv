import type { DefinicaoIntencao } from "../tipos";

export const INTENCOES_NOTIFICACOES: DefinicaoIntencao[] = [
  {
    nome: "notificacoes.resumo",
    ferramenta: "consultar_notificacoes",
    padroes: [
      { re: /\bo que precisa da minha atencao\b/, pontos: 24 },
      { re: /\btenho alertas?\b/, pontos: 22 },
      { re: /\bavisos?\b/, pontos: 12 },
      { re: /\bnotificacoes?\b/, pontos: 16 },
      { re: /\bcaixa antigo aberto\b/, pontos: 18 },
      { re: /\blotes? vencendo\b/, pontos: 16 },
      { re: /\bnotas? rejeitadas?\b/, pontos: 8 },
    ],
    args: () => ({}),
  },
];
