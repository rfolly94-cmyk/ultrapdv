import { objetoSchema, SCHEMA_PERIODO_IA } from "../ferramentas/definicao";
import { AGREGACOES_CONSULTA, NOMES_FONTE_CONSULTA, OPERADORES_FILTRO_CONSULTA } from "./tipos";

const filtroSimples = objetoSchema(
  {
    field: { type: "string", description: "Campo do catálogo. Nunca empresa_id, * ou SQL." },
    op: { type: "string", enum: [...OPERADORES_FILTRO_CONSULTA] },
    value: {
      description:
        "Valor do filtro. Datas relativas: hoje, ontem, anteontem, esta semana, semana passada, últimos 7 dias, últimos 30 dias, este mês, mês passado, este ano, ano passado.",
    },
  },
  ["field", "op"]
);

export const SCHEMA_CONSULTAR_DADOS_IA = objetoSchema(
  {
    source: {
      type: "string",
      enum: [...NOMES_FONTE_CONSULTA],
      description: "Fonte semântica do catálogo. Nunca envie tabela PostgreSQL, SQL ou empresa_id.",
    },
    select: {
      type: "array",
      description: "Campos ou agregações. Proibido SELECT *.",
      items: objetoSchema({
        field: { type: "string" },
        aggregate: { type: "string", enum: [...AGREGACOES_CONSULTA] },
        as: { type: "string", description: "Alias obrigatório em agregações." },
      }),
    },
    filters: {
      type: "array",
      items: {
        type: "object",
        description: "Filtro simples {field,op,value} ou grupo {or:[...]}. AND implícito entre itens.",
      },
    },
    relations: {
      type: "array",
      items: { type: "string" },
      description: "Relações allowlist da fonte. Sem CROSS JOIN.",
    },
    groupBy: { type: "array", items: { type: "string" } },
    orderBy: {
      type: "array",
      items: objetoSchema(
        {
          field: { type: "string" },
          direction: { type: "string", enum: ["asc", "desc"] },
        },
        ["field"]
      ),
    },
    distinct: { type: "boolean" },
    limit: { type: "number", description: "Máximo 100. Padrão 20." },
    offset: { type: "number" },
    periodo: SCHEMA_PERIODO_IA,
  },
  ["source", "select"]
);
