import { normalizarTextoDeterministico } from "./normalizar";

const STOPWORDS = new Set([
  "a",
  "o",
  "os",
  "as",
  "um",
  "uma",
  "de",
  "do",
  "da",
  "dos",
  "das",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "por",
  "para",
  "com",
  "sem",
  "qual",
  "quais",
  "quem",
  "quanto",
  "quanta",
  "quantos",
  "quantas",
  "como",
  "esta",
  "este",
  "essa",
  "esse",
  "meu",
  "minha",
  "meus",
  "minhas",
  "seu",
  "sua",
  "ta",
  "estao",
  "estão",
  "mais",
  "hoje",
  "ontem",
  "anteontem",
  "cliente",
  "clientes",
  "produto",
  "produtos",
  "item",
  "venda",
  "vendas",
  "estoque",
  "preco",
  "preço",
  "codigo",
  "ncm",
  "cest",
  "grupo",
  "fiscal",
  "saldo",
  "aberto",
  "vencido",
  "credito",
  "débito",
  "debito",
  "deve",
  "devendo",
  "conta",
  "caixa",
  "nota",
  "notas",
  "atual",
  "cadastrado",
  "vigente",
  "ativo",
  "inativo",
]);

export function extrairBuscaDeterministica(textoNormalizado: string) {
  const padroes = [
    /(?:cliente|devedor)\s+(.+)$/,
    /(?:produto|item)\s+(.+)$/,
    /quanto\s+(?:o|a)?\s*(.+?)\s+(?:deve|ta\s+devendo|esta\s+devendo|comprou)/,
    /preco\s+(?:do|da|de)\s+(.+)$/,
    /estoque\s+(?:do|da|de)\s+(.+)$/,
    /ncm\s+(?:do|da|de)\s+(.+)$/,
    /cest\s+(?:do|da|de)\s+(.+)$/,
    /codigo\s+(?:do|da|de)\s+(.+)$/,
    /grupo\s+fiscal\s+(?:do|da|de)\s+(.+)$/,
  ];
  for (const re of padroes) {
    const match = textoNormalizado.match(re);
    const valor = String(match?.[1] ?? "")
      .replace(
        /\b(hoje|ontem|anteontem|este mes|esse mes|mes passado|esta semana|semana passada|este ano)\b/g,
        " "
      )
      .replace(/\s+/g, " ")
      .trim();
    if (valor.length >= 2 && !STOPWORDS.has(valor)) {
      return valor;
    }
  }
  return null;
}

export function tokensBuscaRestantes(textoNormalizado: string) {
  const tokens = normalizarTextoDeterministico(textoNormalizado)
    .split(" ")
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
  if (tokens.length === 0 || tokens.length > 6) {
    return null;
  }
  return tokens.join(" ");
}
