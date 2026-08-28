import { argumentosTentaramEmpresaId } from "../ferramentas/args";
import { PERIODOS_ASSISTENTE, type PeriodoAssistente } from "../tipos";
import {
  campoConsultaIa,
  campoResolvidoConsultaIa,
  fonteConsultaIa,
  relacaoConsultaIa,
} from "./catalogo";
import {
  AGREGACOES_CONSULTA,
  CAMPOS_PROIBIDOS_CONSULTA,
  FONTES_PROIBIDAS_CONSULTA,
  LIMITE_MAX_CONSULTA,
  LIMITE_PADRAO_CONSULTA,
  LIMITE_REJEITAR_CONSULTA,
  MAX_AGREGACOES_CONSULTA,
  MAX_CAMPOS_SELECT_CONSULTA,
  MAX_FILTROS_CONSULTA,
  MAX_ITENS_OR_CONSULTA,
  MAX_JOINS_CONSULTA,
  OPERADORES_FILTRO_CONSULTA,
  type AgregacaoConsulta,
  type ConsultaDados,
  type FiltroConsulta,
  type FiltroSimplesConsulta,
  type OperadorFiltroConsulta,
  type SelectConsulta,
} from "./tipos";

const SQL_PERIGOSO =
  /(\b(select|insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|merge|exec|execute|pg_|dblink|lo_|set_config|current_setting)\b)|[;()]|--|\/\*|\*\//;

export function erroConsulta(
  error: string,
  details: string
): { ok: false; error: string; details: string } {
  return { ok: false, error, details };
}

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function campoProibido(nome: string) {
  const lower = nome.trim().toLowerCase();
  if (lower === "*" || lower.includes("*")) {
    return true;
  }
  return CAMPOS_PROIBIDOS_CONSULTA.some(
    (item) => lower === item || lower.endsWith(`.${item}`)
  );
}

function caminhoSuspeito(nome: string) {
  return SQL_PERIGOSO.test(nome.toLowerCase()) || nome.includes(" ") || nome.includes("\\");
}

function ehFiltroSimples(valor: unknown): valor is FiltroSimplesConsulta {
  return Boolean(valor && typeof valor === "object" && "field" in valor && "op" in valor);
}

function ehFiltroOu(valor: unknown): valor is { or: unknown[] } {
  return Boolean(valor && typeof valor === "object" && "or" in valor);
}

function validarFiltroSimples(
  bruto: FiltroSimplesConsulta,
  fonteNome: string,
  relacoes: string[]
): { ok: true; filtro: FiltroSimplesConsulta } | { ok: false; error: string; details: string } {
  const field = texto(bruto.field);
  const op = texto(bruto.op);
  if (!field || campoProibido(field)) {
    return erroConsulta("campo_nao_permitido", `Campo não permitido: ${field || "(vazio)"}`);
  }
  if (caminhoSuspeito(field)) {
    return erroConsulta("campo_nao_permitido", "Campo contém expressão não permitida.");
  }
  if (!(OPERADORES_FILTRO_CONSULTA as readonly string[]).includes(op)) {
    return erroConsulta("operador_nao_permitido", `Operador não permitido: ${op || "(vazio)"}`);
  }
  const fonte = fonteConsultaIa(fonteNome);
  if (!fonte) {
    return erroConsulta("fonte_nao_permitida", "Fonte desconhecida.");
  }
  const resolvido = campoResolvidoConsultaIa(fonte, field);
  if (!resolvido) {
    const direto = campoConsultaIa(fonte, field);
    if (!direto) {
      return erroConsulta("campo_nao_permitido", `Campo fora do catálogo: ${field}`);
    }
  }
  if (field.includes(".")) {
    const prefixo = field.split(".")[0];
    const relacao = fonte.relacoes.find((item) => item.prefixo === prefixo);
    if (!relacao || !relacoes.includes(relacao.nome)) {
      return erroConsulta(
        "relacao_nao_permitida",
        `Filtro em ${field} exige a relação correspondente.`
      );
    }
  }
  const operador = op as OperadorFiltroConsulta;
  if (operador === "isNull" || operador === "isNotNull") {
    return { ok: true, filtro: { field, op: operador } };
  }
  if (bruto.value === undefined) {
    return erroConsulta("consulta_invalida", `Filtro ${field} exige valor.`);
  }
  if (operador === "in" || operador === "notIn" || operador === "between") {
    if (!Array.isArray(bruto.value)) {
      return erroConsulta("consulta_invalida", `Filtro ${field} exige lista de valores.`);
    }
    if (operador === "between" && bruto.value.length !== 2) {
      return erroConsulta("consulta_invalida", "between exige exatamente dois valores.");
    }
    if ((operador === "in" || operador === "notIn") && bruto.value.length > 50) {
      return erroConsulta("limite_excedido", "Lista IN grande demais.");
    }
  }
  return { ok: true, filtro: { field, op: operador, value: bruto.value } };
}

function contarFiltros(filtros: FiltroConsulta[]): number {
  let n = 0;
  for (const item of filtros) {
    if ("or" in item) {
      n += item.or.length;
    } else {
      n += 1;
    }
  }
  return n;
}

export function validarConsultaDados(
  bruto: Record<string, unknown>
): { ok: true; consulta: ConsultaDados } | { ok: false; error: string; details: string } {
  if (argumentosTentaramEmpresaId(bruto)) {
    return erroConsulta(
      "empresa_id_nao_permitido",
      "A empresa ativa vem da sessão autenticada. Não envie empresa_id."
    );
  }
  for (const chave of Object.keys(bruto)) {
    if (campoProibido(chave) || chave.toLowerCase().includes("empresa")) {
      return erroConsulta(
        "empresa_id_nao_permitido",
        `Argumento não permitido: ${chave}`
      );
    }
  }

  const source = texto(bruto.source);
  if (!source) {
    return erroConsulta("consulta_invalida", "Informe a fonte (source).");
  }
  if ((FONTES_PROIBIDAS_CONSULTA as readonly string[]).includes(source.toLowerCase())) {
    return erroConsulta("fonte_nao_permitida", `Fonte proibida: ${source}`);
  }
  if (source.includes(".") || caminhoSuspeito(source)) {
    return erroConsulta("fonte_nao_permitida", `Fonte não permitida: ${source}`);
  }
  const fonte = fonteConsultaIa(source);
  if (!fonte) {
    return erroConsulta("fonte_nao_permitida", `Fonte desconhecida: ${source}`);
  }

  if (!Array.isArray(bruto.select) || bruto.select.length === 0) {
    return erroConsulta("consulta_invalida", "Informe ao menos um campo em select.");
  }
  if (bruto.select.length > MAX_CAMPOS_SELECT_CONSULTA) {
    return erroConsulta("limite_excedido", `select aceita no máximo ${MAX_CAMPOS_SELECT_CONSULTA} campos.`);
  }

  const relationsBruto = Array.isArray(bruto.relations) ? bruto.relations : [];
  if (relationsBruto.length > MAX_JOINS_CONSULTA) {
    return erroConsulta("limite_excedido", `No máximo ${MAX_JOINS_CONSULTA} relações.`);
  }
  const relations: string[] = [];
  for (const item of relationsBruto) {
    const nome = texto(item);
    if (!nome) {
      continue;
    }
    const relacao = relacaoConsultaIa(fonte, nome);
    if (!relacao) {
      return erroConsulta("relacao_nao_permitida", `Relação desconhecida: ${nome}`);
    }
    if (relacao.requer) {
      for (const dep of relacao.requer) {
        if (!relationsBruto.map((r) => texto(r)).includes(dep)) {
          return erroConsulta(
            "relacao_nao_permitida",
            `A relação ${nome} exige ${dep}.`
          );
        }
      }
    }
    relations.push(nome);
  }

  const select: SelectConsulta[] = [];
  let agregacoes = 0;
  for (const item of bruto.select) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return erroConsulta("consulta_invalida", "Item de select inválido.");
    }
    const linha = item as Record<string, unknown>;
    const field = texto(linha.field);
    if (!field || field === "*" || campoProibido(field) || caminhoSuspeito(field)) {
      return erroConsulta("campo_nao_permitido", `Campo de select não permitido: ${field || "*"}`);
    }
    const resolvido = campoResolvidoConsultaIa(fonte, field);
    if (!resolvido) {
      return erroConsulta("campo_nao_permitido", `Campo fora do catálogo: ${field}`);
    }
    if (field.includes(".")) {
      const prefixo = field.split(".")[0];
      const relacao = fonte.relacoes.find((itemRel) => itemRel.prefixo === prefixo);
      if (!relacao || !relations.includes(relacao.nome)) {
        return erroConsulta(
          "relacao_nao_permitida",
          `Campo ${field} exige a relação ${relacao?.nome ?? prefixo}.`
        );
      }
    }
    const aggregate = texto(linha.aggregate);
    const as = texto(linha.as);
    if (aggregate) {
      if (!(AGREGACOES_CONSULTA as readonly string[]).includes(aggregate)) {
        return erroConsulta("consulta_invalida", `Agregação não permitida: ${aggregate}`);
      }
      if (!resolvido.campo.agregavel && aggregate !== "count" && aggregate !== "countDistinct") {
        return erroConsulta(
          "consulta_invalida",
          `Campo ${field} não é agregável com ${aggregate}.`
        );
      }
      if (!as) {
        return erroConsulta("consulta_invalida", `Agregação de ${field} exige alias (as).`);
      }
      if (campoProibido(as) || caminhoSuspeito(as)) {
        return erroConsulta("campo_nao_permitido", `Alias não permitido: ${as}`);
      }
      agregacoes += 1;
      select.push({ field, aggregate: aggregate as AgregacaoConsulta, as });
    } else {
      select.push({ field, as: as || undefined });
    }
  }
  if (agregacoes > MAX_AGREGACOES_CONSULTA) {
    return erroConsulta("limite_excedido", `No máximo ${MAX_AGREGACOES_CONSULTA} agregações.`);
  }

  const groupBy = Array.isArray(bruto.groupBy)
    ? bruto.groupBy.map((item) => texto(item)).filter(Boolean)
    : [];
  for (const campo of groupBy) {
    if (campoProibido(campo) || caminhoSuspeito(campo)) {
      return erroConsulta("campo_nao_permitido", `groupBy não permitido: ${campo}`);
    }
    if (!campoResolvidoConsultaIa(fonte, campo)) {
      return erroConsulta("campo_nao_permitido", `groupBy fora do catálogo: ${campo}`);
    }
  }

  const temAgregacao = select.some((item) => item.aggregate);
  const camposSoltos = select.filter((item) => !item.aggregate).map((item) => item.field);
  if (temAgregacao) {
    for (const campo of camposSoltos) {
      if (!groupBy.includes(campo)) {
        groupBy.push(campo);
      }
    }
  } else if (groupBy.length) {
    return erroConsulta("consulta_invalida", "groupBy exige ao menos uma agregação.");
  }

  const filtrosBrutos = Array.isArray(bruto.filters) ? bruto.filters : [];
  const filters: FiltroConsulta[] = [];
  for (const item of filtrosBrutos) {
    if (ehFiltroOu(item)) {
      if (!Array.isArray(item.or) || item.or.length === 0) {
        return erroConsulta("consulta_invalida", "Grupo OR vazio.");
      }
      if (item.or.length > MAX_ITENS_OR_CONSULTA) {
        return erroConsulta("limite_excedido", "Grupo OR grande demais.");
      }
      const grupo: FiltroSimplesConsulta[] = [];
      for (const parte of item.or) {
        if (!ehFiltroSimples(parte)) {
          return erroConsulta("consulta_invalida", "Filtro OR inválido.");
        }
        const ok = validarFiltroSimples(parte, fonte.nome, relations);
        if (!ok.ok) {
          return ok;
        }
        grupo.push(ok.filtro);
      }
      filters.push({ or: grupo });
    } else if (ehFiltroSimples(item)) {
      const ok = validarFiltroSimples(item, fonte.nome, relations);
      if (!ok.ok) {
        return ok;
      }
      filters.push(ok.filtro);
    } else {
      return erroConsulta("consulta_invalida", "Filtro inválido.");
    }
  }
  if (contarFiltros(filters) > MAX_FILTROS_CONSULTA) {
    return erroConsulta("limite_excedido", `No máximo ${MAX_FILTROS_CONSULTA} filtros.`);
  }

  const orderByBruto = Array.isArray(bruto.orderBy) ? bruto.orderBy : [];
  const aliases = new Set(
    select.map((item) => item.as || ("aggregate" in item ? "" : item.field)).filter(Boolean)
  );
  const orderBy: ConsultaDados["orderBy"] = [];
  for (const item of orderByBruto) {
    if (!item || typeof item !== "object") {
      return erroConsulta("consulta_invalida", "orderBy inválido.");
    }
    const field = texto((item as { field?: unknown }).field);
    const direction = texto((item as { direction?: unknown }).direction) || "asc";
    if (!field || campoProibido(field) || caminhoSuspeito(field)) {
      return erroConsulta("campo_nao_permitido", `orderBy não permitido: ${field}`);
    }
    if (direction !== "asc" && direction !== "desc") {
      return erroConsulta("consulta_invalida", "Direção de ordenação inválida.");
    }
    if (!aliases.has(field) && !campoResolvidoConsultaIa(fonte, field)) {
      return erroConsulta("campo_nao_permitido", `orderBy fora do catálogo: ${field}`);
    }
    orderBy.push({ field, direction });
  }

  const limiteBruto = bruto.limit == null ? LIMITE_PADRAO_CONSULTA : Number(bruto.limit);
  if (!Number.isFinite(limiteBruto) || limiteBruto < 1) {
    return erroConsulta("consulta_invalida", "limit inválido.");
  }
  if (limiteBruto > LIMITE_REJEITAR_CONSULTA) {
    return erroConsulta("limite_excedido", `limit máximo é ${LIMITE_MAX_CONSULTA}.`);
  }
  const limit = Math.min(Math.floor(limiteBruto), LIMITE_MAX_CONSULTA);
  const offsetBruto = bruto.offset == null ? 0 : Number(bruto.offset);
  const offset = Number.isFinite(offsetBruto) && offsetBruto > 0 ? Math.floor(offsetBruto) : 0;
  if (offset > 1000) {
    return erroConsulta("limite_excedido", "offset máximo é 1000.");
  }

  let periodo: PeriodoAssistente | null = null;
  if (bruto.periodo != null && texto(bruto.periodo)) {
    const nome = texto(bruto.periodo);
    if (!(PERIODOS_ASSISTENTE as readonly string[]).includes(nome)) {
      return erroConsulta("consulta_invalida", `Período desconhecido: ${nome}`);
    }
    periodo = nome as PeriodoAssistente;
  }

  return {
    ok: true,
    consulta: {
      source: fonte.nome,
      select,
      filters,
      relations,
      groupBy,
      orderBy,
      distinct: bruto.distinct === true,
      limit,
      offset,
      periodo,
    },
  };
}
