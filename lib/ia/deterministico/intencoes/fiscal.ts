import type { DefinicaoIntencao } from "../tipos";

export const INTENCOES_FISCAL: DefinicaoIntencao[] = [
  {
    nome: "fiscal.notas_rejeitadas",
    ferramenta: "consultar_emissao_fiscal",
    padroes: [
      { re: /\bnotas? rejeitadas?\b/, pontos: 22 },
      { re: /\brejeitadas?\b/, pontos: 12 },
    ],
    args: () => ({ status: "rejeitada" }),
  },
  {
    nome: "fiscal.reconciliacao",
    ferramenta: "consultar_emissao_fiscal",
    padroes: [
      { re: /\baguardando reconciliacao\b/, pontos: 22 },
      { re: /\breconciliacao\b/, pontos: 16 },
      { re: /\bnotas? (para |aguardando )?reconciliar\b/, pontos: 16 },
    ],
    args: () => ({ status: "aguardando_reconciliacao" }),
  },
  {
    nome: "fiscal.diagnostico",
    ferramenta: "diagnosticar_nota",
    padroes: [
      { re: /\bqual erro da nota\b/, pontos: 22 },
      { re: /\berro da nota\b/, pontos: 18 },
      { re: /\bnota .+ (esta |ta )?rejeitada\b/, pontos: 16 },
      { re: /\bdiagnostico (da |de )?nota\b/, pontos: 16 },
      { re: /\bpor que (a |essa )?nota\b/, pontos: 14 },
    ],
    args: () => ({}),
  },
  {
    nome: "fiscal.ncm_vigente",
    ferramenta: "consultar_produto",
    encadear: ["validar_ncm"],
    padroes: [
      { re: /\bncm (esta |ta )?vigente\b/, pontos: 22 },
      { re: /\besse ncm (esta |ta )?vigente\b/, pontos: 22 },
      { re: /\bncm vigente\b/, pontos: 18 },
    ],
    args: ({ busca, produtoId }) => ({
      ...(produtoId ? { produtoId } : {}),
      ...(busca ? { busca } : {}),
    }),
  },
  {
    nome: "fiscal.ncm_cadastrado",
    ferramenta: "consultar_produto",
    padroes: [
      { re: /\bncm (esta )?cadastrado\b/, pontos: 20 },
      { re: /\bqual ncm\b/, pontos: 16 },
      { re: /\bncm (do |da |de )/, pontos: 14 },
    ],
    args: ({ busca, produtoId }) => ({
      ...(produtoId ? { produtoId } : {}),
      ...(busca ? { busca } : {}),
    }),
  },
  {
    nome: "fiscal.cest",
    ferramenta: "consultar_produto",
    padroes: [
      { re: /\bqual cest\b/, pontos: 20 },
      { re: /\bcest atual\b/, pontos: 18 },
      { re: /\bcest (do |da |cadastrado)/, pontos: 14 },
    ],
    args: ({ busca, produtoId }) => ({
      ...(produtoId ? { produtoId } : {}),
      ...(busca ? { busca } : {}),
    }),
  },
  {
    nome: "fiscal.ibs_cbs",
    ferramenta: "consultar_produto",
    padroes: [
      { re: /\bcst ibs/, pontos: 20 },
      { re: /\bcst cbs\b/, pontos: 18 },
      { re: /\bcclasstrib\b/, pontos: 20 },
      { re: /\bclassificacao ibs/, pontos: 16 },
    ],
    args: ({ busca, produtoId }) => ({
      ...(produtoId ? { produtoId } : {}),
      ...(busca ? { busca } : {}),
    }),
  },
  {
    nome: "fiscal.grupo",
    ferramenta: "consultar_produto",
    padroes: [
      { re: /\bgrupo fiscal atual\b/, pontos: 20 },
      { re: /\bqual grupo fiscal\b/, pontos: 18 },
      { re: /\bgrupo fiscal (do |da |cadastrado)/, pontos: 14 },
    ],
    args: ({ busca, produtoId }) => ({
      ...(produtoId ? { produtoId } : {}),
      ...(busca ? { busca } : {}),
    }),
  },
];
