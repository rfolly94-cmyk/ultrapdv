import { normalizarTextoDeterministico } from "../deterministico/normalizar";
import { extrairPeriodoDeterministico } from "../deterministico/periodo";
import type { ContextoAnaliticoAssistente, ConsultaAnalitica } from "./tipos";
import { validarConsultaAnalitica } from "./validar-consulta";

type Tema = {
  id: string;
  padroes: RegExp[];
  plano: Record<string, unknown>;
};

const TEMAS: Tema[] = [
  {
    id: "margem_vs_venda",
    padroes: [
      /vendendo mais/,
      /ganhando menos/,
      /margem caiu/,
      /faturamento.*margem/,
      /mais venda.*menos/,
    ],
    plano: {
      metricas: ["faturamento", "margem_bruta", "margem_percentual"],
      dimensoes: [],
      comparacao: true,
      periodo: "mes",
    },
  },
  {
    id: "vende_acabando",
    padroes: [
      /vend(e|em|endo).*(acab|baixo|perto)/,
      /acabando/,
      /perto de acabar/,
      /mais vendidos?.*(sem estoque|acab|zerad)/,
      /sem estoque/,
    ],
    plano: {
      metricas: [
        "faturamento",
        "quantidade_vendida",
        "estoque_atual",
        "estoque_minimo",
        "cobertura_estoque_dias",
      ],
      dimensoes: ["produto"],
      filtros: [{ campo: "situacao_estoque", operador: "eq", valor: "baixo" }],
      ordenacao: { metrica: "faturamento", direcao: "desc" },
      limite: 8,
      periodo: "mes",
    },
  },
  {
    id: "dinheiro_parado",
    padroes: [/dinheiro parado/, /imobilizado/, /valor (do |em )?estoque/, /parado em estoque/],
    plano: {
      metricas: ["valor_imobilizado", "valor_estoque_custo", "quantidade_vendida", "giro_estoque"],
      dimensoes: ["produto"],
      ordenacao: { metrica: "valor_imobilizado", direcao: "desc" },
      limite: 8,
      periodo: "mes",
    },
  },
  {
    id: "compra_prioridade",
    padroes: [/comprar mercadoria/, /proxima compra/, /o que merece atencao/, /priorizar/],
    plano: {
      metricas: [
        "faturamento",
        "quantidade_vendida",
        "estoque_atual",
        "estoque_minimo",
        "cobertura_estoque_dias",
      ],
      dimensoes: ["produto"],
      filtros: [{ campo: "situacao_estoque", operador: "eq", valor: "baixo" }],
      ordenacao: { metrica: "faturamento", direcao: "desc" },
      limite: 8,
      periodo: "mes",
    },
  },
  {
    id: "cliente_atrasa",
    padroes: [/compr(am|a|ando).*(atras|vencid)/, /compram muito.*atras/, /atrasando/, /inadimplen/],
    plano: {
      metricas: ["valor_comprado", "quantidade_compras", "saldo_aberto", "saldo_vencido", "inadimplencia_cliente"],
      dimensoes: ["cliente"],
      filtros: [{ campo: "saldo_vencido", operador: "gt", valor: 0 }],
      ordenacao: { metrica: "valor_comprado", direcao: "desc" },
      limite: 8,
      periodo: "mes",
    },
  },
  {
    id: "categoria_cresceu",
    padroes: [/categoria cresceu/, /qual categoria/, /cresceu mais/],
    plano: {
      metricas: ["faturamento", "crescimento_periodo"],
      dimensoes: ["categoria"],
      comparacao: true,
      ordenacao: { metrica: "crescimento_periodo", direcao: "desc" },
      limite: 8,
      periodo: "mes",
    },
  },
  {
    id: "categoria_margem_baixa",
    padroes: [/categoria.*margem/, /vende (muito|bastante).*margem/, /pouca margem/],
    plano: {
      metricas: ["faturamento", "margem_bruta", "margem_percentual"],
      dimensoes: ["categoria"],
      ordenacao: { metrica: "faturamento", direcao: "desc" },
      limite: 8,
      periodo: "mes",
    },
  },
  {
    id: "comparar_mes",
    padroes: [/compare (este )?mes/, /compar(ar|e) .*anterior/, /este mes com o anterior/],
    plano: {
      metricas: ["faturamento", "quantidade_vendas", "ticket_medio", "margem_percentual"],
      dimensoes: [],
      comparacao: true,
      periodo: "mes",
    },
  },
  {
    id: "loja_ruim",
    padroes: [/indo mal/, /o que (esta|ta) (ruim|mal)/, /precisa de atencao/],
    plano: {
      metricas: [
        "faturamento",
        "margem_percentual",
        "produtos_abaixo_minimo",
        "saldo_vencido",
        "notas_rejeitadas",
      ],
      dimensoes: [],
      comparacao: true,
      periodo: "mes",
    },
  },
  {
    id: "top_produtos",
    padroes: [/mais vendidos/, /top produtos/, /produtos mais/],
    plano: {
      metricas: ["faturamento", "quantidade_vendida", "participacao_no_faturamento"],
      dimensoes: ["produto"],
      ordenacao: { metrica: "faturamento", direcao: "desc" },
      limite: 5,
      periodo: "mes",
    },
  },
];

export function planejarConsultaAnalitica(
  pergunta: string,
  contexto?: ContextoAnaliticoAssistente | null
): { ok: true; consulta: ConsultaAnalitica; tema: string } | { ok: false; erro: string } {
  const texto = normalizarTextoDeterministico(pergunta);
  const { periodo } = extrairPeriodoDeterministico(texto);
  const followup =
    contexto &&
    contexto.entidadeIds.length > 0 &&
    /\b(desses|destes|e desses|deles|e os)\b/.test(texto);

  let melhor: { tema: Tema; pontos: number } | null = null;
  for (const tema of TEMAS) {
    let pontos = 0;
    for (const re of tema.padroes) {
      if (re.test(texto)) {
        pontos += 1;
      }
    }
    if (pontos > 0 && (!melhor || pontos > melhor.pontos)) {
      melhor = { tema, pontos };
    }
  }

  if (followup && contexto) {
    const base = melhor?.tema.plano ?? {
      metricas: ["estoque_atual", "estoque_minimo", "faturamento"],
      dimensoes: contexto.dimensoes.length ? contexto.dimensoes : ["produto"],
    };
    const filtros = /sem estoque|zerad/.test(texto)
      ? [{ campo: "situacao_estoque", operador: "eq", valor: "sem" }]
      : /acab|baixo|perto/.test(texto)
        ? [{ campo: "situacao_estoque", operador: "eq", valor: "baixo" }]
        : [];
    const validada = validarConsultaAnalitica({
      ...base,
      periodo: contexto.periodo,
      filtros,
      reutilizarContexto: true,
      limite: contexto.entidadeIds.length || 8,
    });
    if (!validada.ok) {
      return validada;
    }
    return { ok: true, consulta: validada.consulta, tema: melhor?.tema.id ?? "followup" };
  }

  if (!melhor) {
    return { ok: false, erro: "Pergunta analítica não reconhecida pelo planejador de testes." };
  }

  const plano: Record<string, unknown> = {
    ...melhor.tema.plano,
    periodo: melhor.tema.plano.periodo ?? periodo,
  };
  if (texto.includes("hoje")) {
    plano.periodo = "hoje";
  }
  if (melhor.tema.id === "vende_acabando" && /sem estoque|zerad/.test(texto)) {
    plano.filtros = [{ campo: "situacao_estoque", operador: "eq", valor: "sem" }];
  }
  const validada = validarConsultaAnalitica(plano);
  if (!validada.ok) {
    return validada;
  }
  return { ok: true, consulta: validada.consulta, tema: melhor.tema.id };
}
