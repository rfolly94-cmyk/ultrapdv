import { MENSAGEM_IA_FALHA_CONSULTA, MENSAGEM_IA_SEM_PERMISSAO, type ResultadoFerramentaIa } from "../tipos";
import type { ContextoFerramentaIa } from "../ferramentas/contexto";
import { ignorarEmpresaIdDoCliente } from "../contexto";
import { hrefClienteAssistente, hrefProdutoAssistente } from "../rotas";
import { executarConsultaAnalitica } from "./executar-consulta";
import { validarConsultaAnalitica } from "./validar-consulta";

export async function consultarAnaliticoIa(
  ctx: ContextoFerramentaIa,
  args: Record<string, unknown>
): Promise<ResultadoFerramentaIa> {
  const limpo = ignorarEmpresaIdDoCliente(args);
  const validada = validarConsultaAnalitica(limpo);
  if (!validada.ok) {
    return {
      ok: false,
      ferramenta: "consultar_analitico",
      erro: validada.erro,
      codigo: "falha",
    };
  }
  try {
    const resultado = await executarConsultaAnalitica({
      ctx,
      consulta: validada.consulta,
      contextoAnterior: ctx.contextoAnalitico ?? null,
    });
    if (
      resultado.avisos.some((item) => item.includes("Nenhuma métrica")) &&
      resultado.linhas.length === 0 &&
      Object.keys(resultado.resumo).length === 0
    ) {
      return {
        ok: false,
        ferramenta: "consultar_analitico",
        erro: MENSAGEM_IA_SEM_PERMISSAO,
        codigo: "sem_permissao",
      };
    }
    const acoes = resultado.linhas.slice(0, 3).flatMap((linha) => {
      if (resultado.contexto.entidadeTipo === "produto") {
        return [{ label: `Abrir ${linha.nome}`, href: hrefProdutoAssistente(linha.id) }];
      }
      if (resultado.contexto.entidadeTipo === "cliente") {
        return [{ label: `Abrir ${linha.nome}`, href: hrefClienteAssistente(linha.id) }];
      }
      return [];
    });
    return {
      ok: true,
      ferramenta: "consultar_analitico",
      dados: {
        resumo: resultado.resumo,
        linhas: resultado.linhas,
        comparacao: resultado.comparacao,
        avisos: resultado.avisos,
        dadosIncompletos: resultado.dadosIncompletos,
        periodo: resultado.periodo,
        contextoAnalitico: resultado.contexto,
      },
      acoes,
    };
  } catch {
    return {
      ok: false,
      ferramenta: "consultar_analitico",
      erro: MENSAGEM_IA_FALHA_CONSULTA,
      codigo: "falha",
    };
  }
}
