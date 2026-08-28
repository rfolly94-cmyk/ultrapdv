import { ignorarEmpresaIdDoCliente } from "../contexto";
import { PERIODOS_ASSISTENTE, type PeriodoAssistente } from "../tipos";
import { graoDaConsulta, JOINS_PERMITIDOS } from "./dimensoes";
import {
  campoFiltroAnalitico,
  operadorFiltroAnalitico,
  valorFiltroEhSeguro,
} from "./filtros";
import { metricaAnalitica } from "./metricas";
import {
  LIMITE_MAX_ANALITICO,
  LIMITE_PADRAO_ANALITICO,
  NOMES_DIMENSAO_ANALITICA,
  NOMES_METRICA_ANALITICA,
  type ConsultaAnalitica,
  type FiltroAnalitico,
  type NomeDimensaoAnalitica,
  type NomeMetricaAnalitica,
  type OrdenacaoAnalitica,
} from "./tipos";

const CAMPOS_PROIBIDOS = [
  "empresa_id",
  "empresaId",
  "sql",
  "query",
  "table",
  "tabela",
  "from",
  "join",
  "rpc",
  "select",
];

function periodoValido(valor: unknown): PeriodoAssistente {
  const texto = String(valor ?? "mes");
  if ((PERIODOS_ASSISTENTE as readonly string[]).includes(texto)) {
    return texto as PeriodoAssistente;
  }
  return "mes";
}

function listaMetricas(bruto: unknown): { ok: true; metricas: NomeMetricaAnalitica[] } | { ok: false; erro: string } {
  if (!Array.isArray(bruto) || bruto.length === 0) {
    return { ok: false, erro: "Informe ao menos uma métrica conhecida." };
  }
  if (bruto.length > 12) {
    return { ok: false, erro: "Limite de métricas nesta consulta foi atingido." };
  }
  const metricas: NomeMetricaAnalitica[] = [];
  for (const item of bruto) {
    const nome = String(item ?? "");
    if (!(NOMES_METRICA_ANALITICA as readonly string[]).includes(nome)) {
      return { ok: false, erro: `Métrica não suportada: ${nome || "(vazia)"}.` };
    }
    if (!metricas.includes(nome as NomeMetricaAnalitica)) {
      metricas.push(nome as NomeMetricaAnalitica);
    }
  }
  return { ok: true, metricas };
}

function listaDimensoes(bruto: unknown): { ok: true; dimensoes: NomeDimensaoAnalitica[] } | { ok: false; erro: string } {
  if (bruto == null) {
    return { ok: true, dimensoes: [] };
  }
  if (!Array.isArray(bruto)) {
    return { ok: false, erro: "Dimensões devem ser uma lista conhecida." };
  }
  if (bruto.length > 1) {
    return { ok: false, erro: "Use no máximo uma dimensão por consulta." };
  }
  const dimensoes: NomeDimensaoAnalitica[] = [];
  for (const item of bruto) {
    const nome = String(item ?? "");
    if (!(NOMES_DIMENSAO_ANALITICA as readonly string[]).includes(nome)) {
      return { ok: false, erro: `Dimensão não suportada: ${nome}.` };
    }
    dimensoes.push(nome as NomeDimensaoAnalitica);
  }
  return { ok: true, dimensoes };
}

function listaFiltros(bruto: unknown): { ok: true; filtros: FiltroAnalitico[] } | { ok: false; erro: string } {
  if (bruto == null) {
    return { ok: true, filtros: [] };
  }
  if (!Array.isArray(bruto)) {
    return { ok: false, erro: "Filtros devem ser uma lista tipada." };
  }
  if (bruto.length > 12) {
    return { ok: false, erro: "Limite de filtros nesta consulta foi atingido." };
  }
  const filtros: FiltroAnalitico[] = [];
  for (const item of bruto) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, erro: "Filtro inválido." };
    }
    const registro = item as Record<string, unknown>;
    for (const chave of Object.keys(registro)) {
      if (!["campo", "operador", "valor"].includes(chave)) {
        return { ok: false, erro: "Filtro contém propriedade não permitida." };
      }
    }
    const campo = campoFiltroAnalitico(registro.campo);
    const operador = operadorFiltroAnalitico(registro.operador);
    if (!campo || !operador) {
      return { ok: false, erro: "Campo ou operador de filtro não suportado." };
    }
    if (!valorFiltroEhSeguro(registro.valor)) {
      return { ok: false, erro: "Valor de filtro rejeitado." };
    }
    filtros.push({
      campo,
      operador,
      valor: registro.valor as FiltroAnalitico["valor"],
    });
  }
  return { ok: true, filtros };
}

export function validarConsultaAnalitica(
  bruto: Record<string, unknown>
): { ok: true; consulta: ConsultaAnalitica } | { ok: false; erro: string } {
  const entrada = ignorarEmpresaIdDoCliente(bruto);
  for (const chave of Object.keys(entrada)) {
    const lower = chave.toLowerCase();
    if (CAMPOS_PROIBIDOS.includes(chave) || CAMPOS_PROIBIDOS.includes(lower)) {
      return { ok: false, erro: "A consulta contém campos não permitidos." };
    }
  }
  if ("sql" in entrada || "query" in entrada || "tabela" in entrada) {
    return { ok: false, erro: "SQL e tabelas arbitrárias não são permitidos." };
  }

  const metricas = listaMetricas(entrada.metricas);
  if (!metricas.ok) {
    return metricas;
  }
  const dimensoes = listaDimensoes(entrada.dimensoes);
  if (!dimensoes.ok) {
    return dimensoes;
  }
  const filtros = listaFiltros(entrada.filtros);
  if (!filtros.ok) {
    return filtros;
  }

  const grao = graoDaConsulta(dimensoes.dimensoes);
  const permitidos = new Set(JOINS_PERMITIDOS[grao]);
  for (const nome of metricas.metricas) {
    const def = metricaAnalitica(nome);
    if (!def) {
      return { ok: false, erro: `Métrica não suportada: ${nome}.` };
    }
    if (!def.graos.includes(grao)) {
      return {
        ok: false,
        erro: `A métrica ${nome} não combina com a dimensão escolhida.`,
      };
    }
    if (!permitidos.has(def.dominio) && !(def.dominio === "clientes" && permitidos.has("carteira"))) {
      return {
        ok: false,
        erro: `Join não autorizado: ${def.dominio} com dimensão ${grao}.`,
      };
    }
  }

  if (metricas.metricas.includes("crescimento_periodo") && entrada.comparacao !== true) {
    return { ok: false, erro: "crescimento_periodo exige comparacao." };
  }

  let ordenacao: OrdenacaoAnalitica | null = null;
  if (entrada.ordenacao && typeof entrada.ordenacao === "object" && !Array.isArray(entrada.ordenacao)) {
    const metrica = String((entrada.ordenacao as Record<string, unknown>).metrica ?? "");
    const direcao = String((entrada.ordenacao as Record<string, unknown>).direcao ?? "desc");
    if (!(NOMES_METRICA_ANALITICA as readonly string[]).includes(metrica)) {
      return { ok: false, erro: "Ordenação usa métrica inexistente." };
    }
    if (direcao !== "asc" && direcao !== "desc") {
      return { ok: false, erro: "Direção de ordenação inválida." };
    }
    ordenacao = { metrica: metrica as NomeMetricaAnalitica, direcao };
  }

  const limiteBruto = Number(entrada.limite ?? LIMITE_PADRAO_ANALITICO);
  const limite = Math.min(
    LIMITE_MAX_ANALITICO,
    Math.max(1, Number.isFinite(limiteBruto) ? Math.floor(limiteBruto) : LIMITE_PADRAO_ANALITICO)
  );

  return {
    ok: true,
    consulta: {
      metricas: metricas.metricas,
      dimensoes: dimensoes.dimensoes,
      filtros: filtros.filtros,
      periodo: periodoValido(entrada.periodo),
      de: typeof entrada.de === "string" ? entrada.de : null,
      ate: typeof entrada.ate === "string" ? entrada.ate : null,
      comparacao: entrada.comparacao === true,
      ordenacao,
      limite,
      reutilizarContexto: entrada.reutilizarContexto === true,
    },
  };
}
