/**
 * Como adicionar uma nova capacidade ao Assistente (READ-ONLY).
 *
 * 1. Crie UM handler tipado (ex.: consultarFornecedoresIa) que só faz SELECT
 *    no cliente autenticado (`ctx.supabase`) filtrado por `ctx.empresaId`.
 * 2. Defina o schema JSON (additionalProperties: false). Nunca inclua
 *    `empresa_id` — a empresa ativa vem do contexto autenticado.
 * 3. Registre a tool em `catalogo.ts` com:
 *    - mode: "read" (consulta) ou "navigate" (rota interna segura)
 *    - requiredPermission: módulo/ação existentes (não invente matriz nova)
 * 4. Adicione o nome em `NOMES_FERRAMENTAS_IA` (`lib/ia/tipos.ts`).
 * 5. Teste: ambiguidade, empresa ativa, args extras ignorados, e o teste
 *    de modo read-only em `read-only.test.ts`.
 *
 * Consultas empresariais novas devem usar `consultar_dados` (DSL), não uma
 * tool específica. Tools específicas só para NCM/CEST/motor fiscal ou navegação.
 *
 * NÃO registre tool com mode "write". O Assistente é permanentemente
 * somente leitura: sem INSERT/UPDATE/DELETE/RPC de escrita/emissão fiscal.
 */
import type { RecursoFerramentaIa } from "../permissoes";
import type { NomeFerramentaIa, ResultadoFerramentaIa } from "../tipos";
import type { ContextoFerramentaIa } from "./contexto";

export const MODOS_FERRAMENTA_IA = ["read", "navigate"] as const;
export type ModoFerramentaIa = (typeof MODOS_FERRAMENTA_IA)[number];

export type PapelModeloIa = "router" | "reasoner";

export type PermissaoFerramentaIa = {
  recurso: RecursoFerramentaIa;
  acao: string;
};

export type SchemaFerramentaIa = {
  type: "object";
  additionalProperties: false;
  properties: Record<string, unknown>;
  required?: string[];
};

export type FerramentaRegistradaIa = {
  name: NomeFerramentaIa;
  description: string;
  schema: SchemaFerramentaIa;
  category: string;
  mode: ModoFerramentaIa;
  availableOnFree: boolean;
  requiredPermission: PermissaoFerramentaIa | null;
  handler: (
    ctx: ContextoFerramentaIa,
    args: Record<string, unknown>
  ) => Promise<ResultadoFerramentaIa>;
  exporAoModelo?: boolean;
};

export function objetoSchema(
  properties: Record<string, unknown>,
  required: string[] = []
): SchemaFerramentaIa {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

export const SCHEMA_PERIODO_IA = {
  type: "string",
  description:
    "hoje, ontem, anteontem, 7d, 30d, mes, mes_anterior, semana, semana_anterior, ano. O backend converte no fuso America/Sao_Paulo.",
};

export const MAX_ITENS_FERRAMENTA_IA = 8;
export const MAX_RETRY_CONSULTA_IA = 1;
