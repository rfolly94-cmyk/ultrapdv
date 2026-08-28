import { ferramentaEscritaAutonoma } from "../acoes/regras";
import type { DefinicaoFerramentaIa, NomeFerramentaIa, ResultadoFerramentaIa } from "../tipos";
import {
  argumentosTentaramEmpresaId,
  chavesPermitidasDoSchema,
  sanitizarArgumentosFerramentaIa,
} from "./args";
import {
  CATALOGO_FERRAMENTAS_IA,
  definicoesFerramentasParaModelo,
  ferramentaDoCatalogo,
} from "./catalogo";
import type { ContextoFerramentaIa } from "./contexto";
import { MAX_RETRY_CONSULTA_IA } from "./definicao";

export const DEFINICOES_FERRAMENTAS_IA: DefinicaoFerramentaIa[] =
  definicoesFerramentasParaModelo();

export { CATALOGO_FERRAMENTAS_IA };

function recusaInexistente(nome: string): ResultadoFerramentaIa {
  return {
    ok: false,
    ferramenta: "consultar_dados",
    erro: "Ferramenta não disponível.",
    codigo: "ferramenta_inexistente",
  };
}

export async function executarFerramentaIa(
  nome: string,
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  if (ferramentaEscritaAutonoma(nome)) {
    return recusaInexistente(nome);
  }
  const tool = ferramentaDoCatalogo(nome);
  if (!tool) {
    return recusaInexistente(nome);
  }
  if (tool.mode !== "read" && tool.mode !== "navigate") {
    return recusaInexistente(nome);
  }
  if (tool.name === "consultar_dados" && argumentosTentaramEmpresaId(args)) {
    return {
      ok: false,
      ferramenta: "consultar_dados",
      erro: "A empresa ativa vem da sessão. Não envie empresa_id.",
      codigo: "argumentos_invalidos",
      dados: {
        ok: false,
        error: "empresa_id_nao_permitido",
        details: "A empresa ativa vem da sessão autenticada. Não envie empresa_id.",
      },
    };
  }
  const permitidos = chavesPermitidasDoSchema(tool.schema);
  const limpos = sanitizarArgumentosFerramentaIa(args, permitidos);
  let ultimo: ResultadoFerramentaIa | null = null;
  for (let tentativa = 0; tentativa <= MAX_RETRY_CONSULTA_IA; tentativa += 1) {
    try {
      ultimo = await tool.handler(ctx, tool.name === "consultar_dados" ? args : limpos);
      if (ultimo.ok || ultimo.codigo !== "falha") {
        return ultimo;
      }
    } catch {
      ultimo = {
        ok: false,
        ferramenta: tool.name,
        erro: "Não consegui consultar essa informação agora.",
        codigo: "falha",
      };
    }
  }
  return ultimo ?? recusaInexistente(nome);
}

export function ferramentaRegistradaEhSomenteLeitura(nome: NomeFerramentaIa) {
  const tool = ferramentaDoCatalogo(nome);
  return tool?.mode === "read" || tool?.mode === "navigate";
}
