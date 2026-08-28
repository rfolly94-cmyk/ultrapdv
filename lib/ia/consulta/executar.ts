import { filtrarRegistrosDaEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { arredondarMoeda } from "../periodo";
import {
  campoResolvidoConsultaIa,
  fonteConsultaIa,
  relacaoConsultaIa,
} from "./catalogo";
import {
  ehPeriodoRelativoConsulta,
  linhaNoPeriodo,
  resolverJanelaRelativaConsulta,
  type JanelaConsulta,
} from "./datas";
import { janelaPeriodoAssistente } from "../periodo";
import type { FonteCatalogoConsulta, LinhaConsulta, ResultadoConsultaDados } from "./tipos";
import {
  LIMITE_MAX_CONSULTA,
  MAX_FETCH_CONSULTA,
  TIMEOUT_CONSULTA_MS,
  type ConsultaDados,
  type FiltroConsulta,
  type FiltroSimplesConsulta,
} from "./tipos";

export type CarregarFonteConsulta = (params: {
  fonte: FonteCatalogoConsulta;
  empresaId: string;
  ids?: { coluna: string; valores: string[] };
}) => Promise<LinhaConsulta[]>;

function ler(linha: LinhaConsulta, campo: string) {
  return linha[campo];
}

function numeroOpcional(valor: unknown): number | null {
  if (valor == null || valor === "") {
    return null;
  }
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

function texto(valor: unknown) {
  return String(valor ?? "");
}

function instante(valor: unknown): number | null {
  if (valor == null || valor === "") {
    return null;
  }
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor.getTime();
  }
  const n = new Date(String(valor)).getTime();
  return Number.isNaN(n) ? null : n;
}

function comparar(
  op: FiltroSimplesConsulta["op"],
  atual: unknown,
  esperado: unknown,
  tipo: string | undefined
): boolean {
  if (op === "isNull") {
    return atual == null || atual === "";
  }
  if (op === "isNotNull") {
    return atual != null && atual !== "";
  }
  if (atual == null) {
    return false;
  }
  if (op === "contains") {
    return texto(atual).toLowerCase().includes(texto(esperado).toLowerCase());
  }
  if (op === "startsWith") {
    return texto(atual).toLowerCase().startsWith(texto(esperado).toLowerCase());
  }
  if (op === "endsWith") {
    return texto(atual).toLowerCase().endsWith(texto(esperado).toLowerCase());
  }
  if (op === "in") {
    return Array.isArray(esperado) && esperado.some((item) => String(item) === String(atual));
  }
  if (op === "notIn") {
    return Array.isArray(esperado) && esperado.every((item) => String(item) !== String(atual));
  }

  const usarData = tipo === "date" || instante(atual) != null && instante(esperado) != null && tipo === "date";
  if (op === "between" && Array.isArray(esperado) && esperado.length === 2) {
    if (tipo === "date" || tipo === undefined && instante(atual) != null) {
      const t = instante(atual);
      const a = instante(esperado[0]);
      const b = instante(esperado[1]);
      if (t == null || a == null || b == null) {
        return false;
      }
      return t >= Math.min(a, b) && t <= Math.max(a, b);
    }
    const n = numeroOpcional(atual);
    const a = numeroOpcional(esperado[0]);
    const b = numeroOpcional(esperado[1]);
    if (n == null || a == null || b == null) {
      return false;
    }
    return n >= Math.min(a, b) && n <= Math.max(a, b);
  }

  if (tipo === "date" || usarData) {
    const t = instante(atual);
    const e = instante(esperado);
    if (t == null || e == null) {
      return op === "neq";
    }
    if (op === "eq") return t === e;
    if (op === "neq") return t !== e;
    if (op === "gt") return t > e;
    if (op === "gte") return t >= e;
    if (op === "lt") return t < e;
    if (op === "lte") return t <= e;
  }

  if (tipo === "number" || tipo === "moeda" || tipo === "boolean") {
    const n = tipo === "boolean" ? (atual === true || atual === "true" ? 1 : 0) : numeroOpcional(atual);
    const e =
      tipo === "boolean"
        ? esperado === true || esperado === "true"
          ? 1
          : 0
        : numeroOpcional(esperado);
    if (n == null || e == null) {
      return op === "neq";
    }
    if (op === "eq") return n === e;
    if (op === "neq") return n !== e;
    if (op === "gt") return n > e;
    if (op === "gte") return n >= e;
    if (op === "lt") return n < e;
    if (op === "lte") return n <= e;
  }

  const a = texto(atual);
  const b = texto(esperado);
  if (op === "eq") return a === b;
  if (op === "neq") return a !== b;
  if (op === "gt") return a > b;
  if (op === "gte") return a >= b;
  if (op === "lt") return a < b;
  if (op === "lte") return a <= b;
  return false;
}

function janelaDoValor(valor: unknown, agora: Date): JanelaConsulta | null {
  if (typeof valor !== "string" || !ehPeriodoRelativoConsulta(valor)) {
    return null;
  }
  return resolverJanelaRelativaConsulta(valor, agora);
}

function passaFiltroSimples(
  linha: LinhaConsulta,
  filtro: FiltroSimplesConsulta,
  fonte: FonteCatalogoConsulta,
  agora: Date
): boolean {
  const resolvido = campoResolvidoConsultaIa(fonte, filtro.field);
  const atual = ler(linha, filtro.field);
  const tipo = resolvido?.campo.tipo;
  if (
    (tipo === "date" || fonte.campoData === filtro.field) &&
    typeof filtro.value === "string" &&
    ehPeriodoRelativoConsulta(filtro.value) &&
    (filtro.op === "eq" || filtro.op === "between")
  ) {
    const janela = janelaDoValor(filtro.value, agora);
    if (!janela) {
      return false;
    }
    const t = instante(atual);
    if (t == null) {
      return false;
    }
    return t >= janela.inicio.getTime() && t < janela.fim.getTime();
  }
  return comparar(filtro.op, atual, filtro.value, tipo);
}

function passaFiltros(
  linha: LinhaConsulta,
  filtros: FiltroConsulta[],
  fonte: FonteCatalogoConsulta,
  agora: Date
): boolean {
  for (const filtro of filtros) {
    if ("or" in filtro) {
      if (!filtro.or.some((item) => passaFiltroSimples(linha, item, fonte, agora))) {
        return false;
      }
      continue;
    }
    if (!passaFiltroSimples(linha, filtro, fonte, agora)) {
      return false;
    }
  }
  return true;
}

function achatar(
  base: LinhaConsulta,
  prefixo: string,
  relacionado: LinhaConsulta | null,
  camposAlvo: readonly { nome: string }[]
): LinhaConsulta {
  const saida: LinhaConsulta = { ...base };
  for (const campo of camposAlvo) {
    const chave = `${prefixo}.${campo.nome}`;
    saida[chave] = relacionado ? relacionado[campo.nome] : null;
  }
  return saida;
}

function chaveIndice(valor: unknown) {
  if (valor == null || valor === "") {
    return null;
  }
  return String(valor);
}

function agregarValores(
  valores: unknown[],
  aggregate: string,
  tipo: string | undefined
): unknown {
  if (aggregate === "count") {
    return valores.length;
  }
  const presentes = valores.filter((item) => item != null && item !== "");
  if (aggregate === "countDistinct") {
    return new Set(presentes.map((item) => String(item))).size;
  }
  if (!presentes.length) {
    return null;
  }
  if (aggregate === "min" || aggregate === "max") {
    if (tipo === "date") {
      const tempos = presentes.map((item) => instante(item)).filter((item): item is number => item != null);
      if (!tempos.length) {
        return null;
      }
      const escolhido = aggregate === "min" ? Math.min(...tempos) : Math.max(...tempos);
      return new Date(escolhido).toISOString();
    }
    if (tipo === "number" || tipo === "moeda") {
      const nums = presentes
        .map((item) => numeroOpcional(item))
        .filter((item): item is number => item != null);
      if (!nums.length) {
        return null;
      }
      const n = aggregate === "min" ? Math.min(...nums) : Math.max(...nums);
      return tipo === "moeda" ? arredondarMoeda(n) : n;
    }
    const textos = presentes.map((item) => texto(item)).sort();
    return aggregate === "min" ? textos[0] : textos[textos.length - 1];
  }
  const nums = presentes
    .map((item) => numeroOpcional(item))
    .filter((item): item is number => item != null);
  if (!nums.length) {
    return null;
  }
  if (tipo === "moeda") {
    const centavos = nums.reduce((total, item) => total + Math.round(item * 100), 0);
    if (aggregate === "sum") {
      return arredondarMoeda(centavos / 100);
    }
    if (aggregate === "avg") {
      return arredondarMoeda(centavos / nums.length / 100);
    }
  }
  const soma = nums.reduce((total, item) => total + item, 0);
  if (aggregate === "sum") {
    return soma;
  }
  if (aggregate === "avg") {
    return soma / nums.length;
  }
  return null;
}

function projetarLinha(linha: LinhaConsulta, consulta: ConsultaDados) {
  const saida: LinhaConsulta = {};
  for (const item of consulta.select) {
    if (item.aggregate) {
      continue;
    }
    const chave = item.as || item.field;
    saida[chave] = linha[item.field];
  }
  return saida;
}

function aplicarDistinct(linhas: LinhaConsulta[]) {
  const vistos = new Set<string>();
  const saida: LinhaConsulta[] = [];
  for (const linha of linhas) {
    const chave = JSON.stringify(linha);
    if (vistos.has(chave)) {
      continue;
    }
    vistos.add(chave);
    saida.push(linha);
  }
  return saida;
}

function ordenar(linhas: LinhaConsulta[], consulta: ConsultaDados) {
  if (!consulta.orderBy.length) {
    return linhas;
  }
  const copia = [...linhas];
  copia.sort((a, b) => {
    for (const ordem of consulta.orderBy) {
      const va = a[ordem.field];
      const vb = b[ordem.field];
      if (va == null && vb == null) {
        continue;
      }
      if (va == null) {
        return 1;
      }
      if (vb == null) {
        return -1;
      }
      const na = numeroOpcional(va);
      const nb = numeroOpcional(vb);
      let cmp = 0;
      if (na != null && nb != null) {
        cmp = na - nb;
      } else {
        cmp = texto(va).localeCompare(texto(vb), "pt-BR");
      }
      if (cmp !== 0) {
        return ordem.direction === "desc" ? -cmp : cmp;
      }
    }
    return 0;
  });
  return copia;
}

function resumir(consulta: ConsultaDados, rowCount: number, truncated: boolean) {
  const agregacoes = consulta.select
    .filter((item) => item.aggregate)
    .map((item) => `${item.aggregate}(${item.field})`)
    .join(", ");
  const campos = consulta.select
    .filter((item) => !item.aggregate)
    .map((item) => item.field)
    .join(", ");
  const partes = [`fonte ${consulta.source}`];
  if (campos) {
    partes.push(`campos ${campos}`);
  }
  if (agregacoes) {
    partes.push(agregacoes);
  }
  if (consulta.relations.length) {
    partes.push(`relações ${consulta.relations.join(", ")}`);
  }
  if (consulta.periodo) {
    partes.push(`período ${consulta.periodo}`);
  }
  partes.push(`${rowCount} linha(s)`);
  if (truncated) {
    partes.push("resultado limitado");
  }
  return partes.join("; ");
}

function semEmpresa(linha: LinhaConsulta) {
  const saida: LinhaConsulta = {};
  for (const [chave, valor] of Object.entries(linha)) {
    if (chave === "empresa_id" || chave.endsWith(".empresa_id")) {
      continue;
    }
    saida[chave] = valor;
  }
  return saida;
}

async function comTimeout<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promessa,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function executarConsultaDados(params: {
  consulta: ConsultaDados;
  empresaId: string;
  agora?: Date;
  timeoutMs?: number;
  carregar: CarregarFonteConsulta;
}): Promise<ResultadoConsultaDados> {
  const inicio = Date.now();
  const agora = params.agora ?? new Date();
  const timeoutMs = params.timeoutMs ?? TIMEOUT_CONSULTA_MS;
  const fonte = fonteConsultaIa(params.consulta.source);
  if (!fonte) {
    return { ok: false, error: "fonte_nao_permitida", details: "Fonte desconhecida." };
  }

  try {
    return await comTimeout(
      (async () => {
        const avisos: string[] = [];
        const fontesUsadas = new Set<string>([fonte.nome]);
        let linhas = filtrarRegistrosDaEmpresaAtiva(
          (await params.carregar({ fonte, empresaId: params.empresaId })) as Array<
            LinhaConsulta & { empresa_id?: string | null }
          >,
          params.empresaId
        );
        if (linhas.length >= MAX_FETCH_CONSULTA) {
          avisos.push("A amostra interna foi limitada. Prefira agregar ou filtrar o período.");
        }

        if (params.consulta.periodo && fonte.campoData) {
          const janela = janelaPeriodoAssistente(params.consulta.periodo, agora);
          linhas = linhas.filter((linha) =>
            linhaNoPeriodo(linha, fonte, {
              inicio: janela.inicio,
              fim: janela.fim,
              rotulo: janela.rotulo,
            })
          );
        }

        for (const nomeRelacao of params.consulta.relations) {
          const relacao = relacaoConsultaIa(fonte, nomeRelacao);
          if (!relacao) {
            return {
              ok: false as const,
              error: "relacao_nao_permitida",
              details: `Relação desconhecida: ${nomeRelacao}`,
            };
          }
          const alvo = fonteConsultaIa(relacao.fonteAlvo);
          if (!alvo) {
            return {
              ok: false as const,
              error: "relacao_nao_permitida",
              details: `Fonte da relação ausente: ${nomeRelacao}`,
            };
          }
          fontesUsadas.add(alvo.nome);
          const ids = [
            ...new Set(
              linhas
                .map((linha) => chaveIndice(ler(linha, relacao.local)))
                .filter((item): item is string => Boolean(item))
            ),
          ];
          if (!ids.length) {
            linhas = linhas.map((linha) =>
              achatar(linha, relacao.prefixo, null, alvo.campos)
            );
            continue;
          }
          const relacionados = filtrarRegistrosDaEmpresaAtiva(
            (await params.carregar({
              fonte: alvo,
              empresaId: params.empresaId,
              ids: ids.length ? { coluna: relacao.remoto, valores: ids } : undefined,
            })) as Array<LinhaConsulta & { empresa_id?: string | null }>,
            params.empresaId
          );
          const indice = new Map<string, LinhaConsulta[]>();
          for (const item of relacionados) {
            const chave = chaveIndice(item[relacao.remoto]);
            if (!chave) {
              continue;
            }
            const lista = indice.get(chave) ?? [];
            lista.push(item);
            indice.set(chave, lista);
          }
          const juntos: LinhaConsulta[] = [];
          for (const linha of linhas) {
            const chave = chaveIndice(ler(linha, relacao.local));
            const matches = chave ? indice.get(chave) : undefined;
            if (!matches?.length) {
              juntos.push(achatar(linha, relacao.prefixo, null, alvo.campos));
              continue;
            }
            for (const match of matches) {
              juntos.push(achatar(linha, relacao.prefixo, match, alvo.campos));
            }
          }
          linhas = juntos;
          if (linhas.length > MAX_FETCH_CONSULTA * 2) {
            linhas = linhas.slice(0, MAX_FETCH_CONSULTA * 2);
            avisos.push("Cruzamento limitado para evitar produto cartesiano.");
          }
        }

        linhas = linhas.filter((linha) =>
          passaFiltros(linha, params.consulta.filters, fonte, agora)
        );

        const temAgregacao = params.consulta.select.some((item) => item.aggregate);
        let resultado: LinhaConsulta[] = [];
        if (temAgregacao) {
          const grupos = new Map<string, LinhaConsulta[]>();
          for (const linha of linhas) {
            const chave = JSON.stringify(
              params.consulta.groupBy.map((campo) => linha[campo] ?? null)
            );
            const lista = grupos.get(chave) ?? [];
            lista.push(linha);
            grupos.set(chave, lista);
          }
          for (const grupo of grupos.values()) {
            const linha: LinhaConsulta = {};
            for (const campo of params.consulta.groupBy) {
              linha[campo] = grupo[0]?.[campo] ?? null;
            }
            for (const item of params.consulta.select) {
              if (!item.aggregate) {
                const chave = item.as || item.field;
                linha[chave] = grupo[0]?.[item.field] ?? null;
                continue;
              }
              const resolvido = campoResolvidoConsultaIa(fonte, item.field);
              const valores =
                item.aggregate === "count"
                  ? grupo.map(() => 1)
                  : grupo.map((row) => row[item.field]);
              linha[item.as] = agregarValores(
                valores,
                item.aggregate,
                resolvido?.campo.tipo
              );
            }
            resultado.push(linha);
          }
        } else {
          resultado = linhas.map((linha) => projetarLinha(linha, params.consulta));
          if (params.consulta.distinct) {
            resultado = aplicarDistinct(resultado);
          }
        }

        resultado = ordenar(resultado, params.consulta);
        const total = resultado.length;
        const fatia = resultado.slice(
          params.consulta.offset,
          params.consulta.offset + params.consulta.limit
        );
        const truncated = total > fatia.length || avisos.length > 0;
        const rows = fatia.map(semEmpresa);
        if (rows.length > LIMITE_MAX_CONSULTA) {
          return {
            ok: false as const,
            error: "limite_excedido",
            details: "Resultado excedeu o limite seguro.",
          };
        }
        const columns = [
          ...new Set(
            params.consulta.select.map((item) =>
              item.aggregate ? item.as : item.as || item.field
            )
          ),
        ];
        return {
          ok: true as const,
          columns,
          rows,
          rowCount: rows.length,
          truncated: truncated && total > rows.length,
          querySummary: resumir(params.consulta, rows.length, total > rows.length),
          avisos,
          fontes: [...fontesUsadas],
          duracaoMs: Date.now() - inicio,
        };
      })(),
      timeoutMs
    );
  } catch (erro) {
    if (erro instanceof Error && erro.message === "timeout") {
      return {
        ok: false,
        error: "timeout",
        details: "A consulta excedeu o tempo máximo e foi interrompida.",
      };
    }
    return {
      ok: false,
      error: "falha",
      details: "Não foi possível executar a consulta.",
    };
  }
}
