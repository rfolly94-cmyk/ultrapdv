import { CATALOGO_RECURSOS, recursoDoCatalogo } from "@/lib/plataforma/recursos/catalogo";

/**
 * Organização comercial da tela Master → Planos.
 * Não cria recurso novo. O enforcement continua pelas chaves técnicas.
 */
export type GrupoComercialPlano = {
  id: string;
  rotulo: string;
  chaves: readonly string[];
};

export const GRUPOS_COMERCIAIS_PLANO: readonly GrupoComercialPlano[] = [
  {
    id: "operacao_comercial",
    rotulo: "Operação comercial",
    chaves: ["pdv", "vendas", "produtos", "clientes"],
  },
  {
    id: "catalogo_online",
    rotulo: "Catálogo online",
    chaves: ["catalogo"],
  },
  {
    id: "estoque",
    rotulo: "Estoque",
    chaves: ["estoque"],
  },
  {
    id: "carteira_financeiro",
    rotulo: "Carteira / Financeiro",
    chaves: ["carteira"],
  },
  {
    id: "fiscal_nfce",
    rotulo: "Fiscal NFC-e",
    chaves: ["nfce"],
  },
  {
    id: "fiscal_avancado",
    rotulo: "Fiscal avançado",
    chaves: ["nfe", "cce", "inutilizacao_fiscal"],
  },
  {
    id: "contabilidade",
    rotulo: "Contabilidade",
    chaves: ["contabilidade"],
  },
  {
    id: "integracoes",
    rotulo: "Integrações",
    chaves: ["importador", "pix_integrado", "impressao_automatica"],
  },
  {
    id: "relatorios",
    rotulo: "Relatórios",
    chaves: ["relatorios"],
  },
  {
    id: "suporte",
    rotulo: "Suporte",
    chaves: ["suporte_prioritario"],
  },
];

export function chavesDosGruposComerciais() {
  return GRUPOS_COMERCIAIS_PLANO.flatMap((grupo) => [...grupo.chaves]);
}

export function resumoDoGrupoComercial(
  grupo: GrupoComercialPlano,
  recursos: Record<string, boolean>
) {
  const ligados = grupo.chaves.filter((chave) => Boolean(recursos[chave]));
  return {
    ligados: ligados.length,
    total: grupo.chaves.length,
    todos: ligados.length === grupo.chaves.length,
    nenhum: ligados.length === 0,
  };
}

export function classificarRecursosDoPlano(recursos: Record<string, boolean>) {
  const incluidos: Array<{ chave: string; nome: string }> = [];
  const naoIncluidos: Array<{ chave: string; nome: string }> = [];

  for (const grupo of GRUPOS_COMERCIAIS_PLANO) {
    for (const chave of grupo.chaves) {
      const item = recursoDoCatalogo(chave);
      const nome = item?.nome ?? chave;
      if (recursos[chave]) {
        incluidos.push({ chave, nome });
      } else {
        naoIncluidos.push({ chave, nome });
      }
    }
  }

  return { incluidos, naoIncluidos };
}

export function catalogoCobertoPelosGruposComerciais() {
  const chavesGrupo = new Set(chavesDosGruposComerciais());
  const chavesCatalogo = CATALOGO_RECURSOS.map((item) => item.chave);
  const faltandoNoGrupo = chavesCatalogo.filter((chave) => !chavesGrupo.has(chave));
  const extraNoGrupo = [...chavesGrupo].filter(
    (chave) => !chavesCatalogo.includes(chave)
  );
  return {
    ok: faltandoNoGrupo.length === 0 && extraNoGrupo.length === 0,
    faltandoNoGrupo,
    extraNoGrupo,
  };
}
