import { autorizarFerramentaIa, recusaFerramentaIa } from "../permissoes";
import { argumentosTentaramEmpresaId } from "../ferramentas/args";
import type { ContextoFerramentaIa } from "../ferramentas/contexto";
import {
  MENSAGEM_IA_FALHA_CONSULTA,
  type ResultadoFerramentaIa,
} from "../tipos";
import { fonteConsultaIa } from "./catalogo";
import { criarCarregadorConsulta } from "./carregar";
import { executarConsultaDados } from "./executar";
import { registrarObservabilidadeConsulta } from "./observabilidade";
import { validarConsultaDados } from "./validar";

export async function consultarDadosIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  if (argumentosTentaramEmpresaId(args)) {
    registrarObservabilidadeConsulta({
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      ok: false,
      error: "empresa_id_nao_permitido",
      fontes: [],
      duracaoMs: 0,
      rowCount: 0,
    });
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

  const validada = validarConsultaDados(args);
  if (!validada.ok) {
    registrarObservabilidadeConsulta({
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      ok: false,
      error: validada.error,
      fontes: [],
      duracaoMs: 0,
      rowCount: 0,
    });
    return {
      ok: false,
      ferramenta: "consultar_dados",
      erro: validada.details,
      codigo: "argumentos_invalidos",
      dados: validada,
    };
  }

  const fontes = new Set<string>([validada.consulta.source, ...validada.consulta.relations.map((nome) => {
    const fonte = fonteConsultaIa(validada.consulta.source);
    const relacao = fonte?.relacoes.find((item) => item.nome === nome);
    return relacao?.fonteAlvo ?? "";
  }).filter(Boolean)]);

  for (const nome of fontes) {
    const def = fonteConsultaIa(nome);
    if (!def?.recurso) {
      continue;
    }
    const auth = await autorizarFerramentaIa({
      empresaId: ctx.empresaId,
      permissoes: ctx.permissoes,
      recurso: def.recurso,
      acao: def.acao,
    });
    if (!auth.ok) {
      return recusaFerramentaIa("consultar_dados", auth);
    }
  }

  const inicio = Date.now();
  try {
    const resultado = await executarConsultaDados({
      consulta: validada.consulta,
      empresaId: ctx.empresaId,
      carregar: criarCarregadorConsulta(ctx.supabase),
    });
    registrarObservabilidadeConsulta({
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      ok: resultado.ok,
      error: resultado.ok ? null : resultado.error,
      fontes: resultado.ok ? resultado.fontes : [...fontes],
      duracaoMs: resultado.ok ? resultado.duracaoMs : Date.now() - inicio,
      rowCount: resultado.ok ? resultado.rowCount : 0,
      querySummary: resultado.ok ? resultado.querySummary : undefined,
    });
    if (!resultado.ok) {
      return {
        ok: false,
        ferramenta: "consultar_dados",
        erro: resultado.details,
        codigo: resultado.error === "timeout" ? "falha" : "argumentos_invalidos",
        dados: resultado,
      };
    }
    return {
      ok: true,
      ferramenta: "consultar_dados",
      dados: resultado,
    };
  } catch {
    registrarObservabilidadeConsulta({
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      ok: false,
      error: "falha",
      fontes: [...fontes],
      duracaoMs: Date.now() - inicio,
      rowCount: 0,
    });
    return {
      ok: false,
      ferramenta: "consultar_dados",
      erro: MENSAGEM_IA_FALHA_CONSULTA,
      codigo: "falha",
    };
  }
}
