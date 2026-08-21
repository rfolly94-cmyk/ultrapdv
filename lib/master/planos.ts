import "server-only";

import { exigirMaster } from "@/lib/master/exigir-master";
import {
  CATALOGO_RECURSOS,
  CHAVES_LIMITE,
  nivelSuporteValido,
  type NivelSuporte,
} from "@/lib/plataforma/recursos/catalogo";
import {
  recursosHabilitados,
  type RecursoDoPlano,
} from "@/lib/plataforma/recursos/resolver";

export type PlanoMasterResumo = {
  id: string;
  nome: string;
  descricao: string;
  valorMensal: number | null;
  valorAnual: number | null;
  ordem: number;
  ativo: boolean;
  destaque: boolean;
  textoDestaque: string;
  diasTeste: number;
  nivelSuporte: NivelSuporte;
  empresas: number;
  limites: Record<string, number | null>;
  recursosHabilitados: number;
  recursos: Record<string, boolean>;
};

export type MetricasPlanosMaster = {
  planosAtivos: number;
  empresasAssinantes: number;
  mrrEstimado: number;
  planoMaisUtilizado: string | null;
};

const STATUS_ASSINANTE = new Set(["ativa", "trial", "carencia"]);

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function numeroOuNulo(valor: unknown) {
  if (valor == null || valor === "") {
    return null;
  }
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

export async function carregarPainelPlanosMaster() {
  const { admin } = await exigirMaster();

  const [
    { data: planos, error: planosError },
    { data: limites, error: limitesError },
    { data: recursos, error: recursosError },
    { data: assinaturas, error: assinaturasError },
  ] = await Promise.all([
    admin
      .from("planos")
      .select(
        "id, nome, descricao, valor_mensal, valor_anual, ordem, ativo, destaque, texto_destaque, dias_teste, nivel_suporte"
      )
      .order("ordem"),
    admin.from("planos_limites").select("plano_id, chave, valor"),
    admin
      .from("planos_recursos")
      .select("plano_id, habilitado, recursos_plataforma ( chave, ativo )"),
    admin
      .from("assinaturas_empresas")
      .select("plano_id, status, valor_mensal_contratado"),
  ]);

  if (planosError) {
    throw new Error(planosError.message);
  }
  if (limitesError) {
    throw new Error(limitesError.message);
  }
  if (recursosError) {
    throw new Error(recursosError.message);
  }
  if (assinaturasError) {
    throw new Error(assinaturasError.message);
  }

  const limitesPorPlano = new Map<string, Record<string, number | null>>();
  for (const item of limites ?? []) {
    const planoId = texto(item.plano_id);
    const atual = limitesPorPlano.get(planoId) ?? {};
    atual[texto(item.chave)] = item.valor == null ? null : Number(item.valor);
    limitesPorPlano.set(planoId, atual);
  }

  const recursosPorPlano = new Map<string, RecursoDoPlano[]>();
  for (const item of recursos ?? []) {
    const planoId = texto(item.plano_id);
    const recurso = Array.isArray(item.recursos_plataforma)
      ? item.recursos_plataforma[0]
      : item.recursos_plataforma;
    const lista = recursosPorPlano.get(planoId) ?? [];
    lista.push({
      chave: texto((recurso as { chave?: string } | null)?.chave),
      habilitado: Boolean(item.habilitado),
      ativo: Boolean((recurso as { ativo?: boolean } | null)?.ativo),
    });
    recursosPorPlano.set(planoId, lista);
  }

  const empresasPorPlano = new Map<string, number>();
  let empresasAssinantes = 0;
  let mrrEstimado = 0;

  for (const item of assinaturas ?? []) {
    const planoId = texto(item.plano_id);
    const status = texto(item.status);
    if (STATUS_ASSINANTE.has(status) || status === "suspensa") {
      empresasPorPlano.set(planoId, (empresasPorPlano.get(planoId) ?? 0) + 1);
    }
    if (STATUS_ASSINANTE.has(status)) {
      empresasAssinantes += 1;
    }
    if (status === "ativa") {
      const plano = (planos ?? []).find((linha) => String(linha.id) === planoId);
      const valor =
        numeroOuNulo(item.valor_mensal_contratado) ??
        numeroOuNulo(plano?.valor_mensal) ??
        0;
      mrrEstimado += valor;
    }
  }

  const resumo: PlanoMasterResumo[] = (planos ?? []).map((plano) => {
    const id = String(plano.id);
    const listaRecursos = recursosPorPlano.get(id) ?? [];
    const mapaRecursos: Record<string, boolean> = {};
    for (const recurso of CATALOGO_RECURSOS) {
      const encontrado = listaRecursos.find((item) => item.chave === recurso.chave);
      mapaRecursos[recurso.chave] = encontrado ? encontrado.habilitado : true;
    }
    const mapaLimites: Record<string, number | null> = {};
    const salvos = limitesPorPlano.get(id) ?? {};
    for (const chave of CHAVES_LIMITE) {
      mapaLimites[chave] = chave in salvos ? salvos[chave] : null;
    }

    return {
      id,
      nome: String(plano.nome),
      descricao: plano.descricao ? String(plano.descricao) : "",
      valorMensal: numeroOuNulo(plano.valor_mensal),
      valorAnual: numeroOuNulo(plano.valor_anual),
      ordem: Number(plano.ordem ?? 0),
      ativo: Boolean(plano.ativo),
      destaque: Boolean(plano.destaque),
      textoDestaque: plano.texto_destaque ? String(plano.texto_destaque) : "",
      diasTeste: Number(plano.dias_teste ?? 0),
      nivelSuporte: nivelSuporteValido(plano.nivel_suporte)
        ? plano.nivel_suporte
        : "normal",
      empresas: empresasPorPlano.get(id) ?? 0,
      limites: mapaLimites,
      recursosHabilitados: recursosHabilitados(listaRecursos),
      recursos: mapaRecursos,
    };
  });

  let planoMaisUtilizado: string | null = null;
  let maior = -1;
  for (const plano of resumo) {
    if (plano.empresas > maior) {
      maior = plano.empresas;
      planoMaisUtilizado = plano.nome;
    }
  }

  const metricas: MetricasPlanosMaster = {
    planosAtivos: resumo.filter((item) => item.ativo).length,
    empresasAssinantes,
    mrrEstimado,
    planoMaisUtilizado: maior > 0 ? planoMaisUtilizado : null,
  };

  return { planos: resumo, metricas };
}

export function limitesPadraoPlano(): Record<string, number | null> {
  return Object.fromEntries(CHAVES_LIMITE.map((chave) => [chave, null]));
}

export function recursosPadraoPlano(): Record<string, boolean> {
  return Object.fromEntries(
    CATALOGO_RECURSOS.map((item) => [item.chave, true])
  );
}

export function planoNovoTemplate(ordem: number): PlanoMasterResumo {
  return {
    id: "",
    nome: "",
    descricao: "",
    valorMensal: 0,
    valorAnual: null,
    ordem,
    ativo: true,
    destaque: false,
    textoDestaque: "",
    diasTeste: 0,
    nivelSuporte: "normal",
    empresas: 0,
    limites: limitesPadraoPlano(),
    recursosHabilitados: CATALOGO_RECURSOS.length,
    recursos: recursosPadraoPlano(),
  };
}
