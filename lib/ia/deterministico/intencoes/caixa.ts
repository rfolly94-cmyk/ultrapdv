import type { DefinicaoIntencao } from "../tipos";

export const INTENCOES_CAIXA: DefinicaoIntencao[] = [
  {
    nome: "caixa.status",
    ferramenta: "consultar_caixa",
    padroes: [
      { re: /\bcaixa (esta |ta )?aberto\b/, pontos: 20 },
      { re: /\bcomo (esta |ta )?(o )?meu caixa\b/, pontos: 22 },
      { re: /\bsaldo (esperado )?(do )?caixa\b/, pontos: 16 },
      { re: /\b(sangrias?|suprimentos?)\b/, pontos: 14 },
      { re: /\b(entradas|saidas) (do |de )?caixa\b/, pontos: 14 },
      { re: /\bmovimentos? (de hoje|do caixa)\b/, pontos: 14 },
      { re: /\bmeu caixa\b/, pontos: 12 },
    ],
    args: () => ({}),
  },
];
