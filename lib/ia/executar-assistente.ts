import { dadosComoBlocoNaoInstrucao, ignorarEmpresaIdDoCliente } from "./contexto";
import { DEFINICOES_FERRAMENTAS_IA, executarFerramentaIa } from "./ferramentas/registro";
import type { ContextoFerramentaIa } from "./ferramentas/contexto";
import { ferramentaEscritaAutonoma } from "./acoes/regras";
import { responderDeterministico } from "./deterministico/responder";
import { registrarTelemetriaIa } from "./deterministico/telemetria";
import { chatComFerramentasIa, type MensagemProviderIa } from "./provider";
import { promptSistemaAssistente } from "./prompts/sistema";
import type { CardPropostaAcao } from "./acoes/tipos";
import {
  MENSAGEM_IA_FALHA_CONSULTA,
  MENSAGEM_IA_PRECISA_MODO,
  NOMES_FERRAMENTAS_IA,
  type AcaoAssistente,
  type ContextoDeterministicoAssistente,
  type MensagemAssistente,
  type ModoRespostaAssistente,
  type NomeFerramentaIa,
  type PropostaFiscalProduto,
  type ResultadoFerramentaIa,
} from "./tipos";
import type { ContextoAnaliticoAssistente } from "./analitico/tipos";
import { MAX_CONSULTAS_ANALITICAS_POR_MENSAGEM } from "./analitico/tipos";

const MAX_RODADAS = 4;
const MAX_CHAMADAS_POR_MENSAGEM = 8;

function parseArgs(bruto: string) {
  try {
    const json = JSON.parse(bruto) as unknown;
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return {};
    }
    return ignorarEmpresaIdDoCliente(json as Record<string, unknown>);
  } catch {
    return {};
  }
}

function ferramentaConhecida(nome: string): nome is NomeFerramentaIa {
  return (NOMES_FERRAMENTAS_IA as readonly string[]).includes(nome);
}

function ultimoContextoDeterministico(
  historico: MensagemAssistente[],
  empresaId: string
): ContextoDeterministicoAssistente | null {
  for (let i = historico.length - 1; i >= 0; i -= 1) {
    const item = historico[i];
    if (item.papel !== "assistente" || !item.contextoDeterministico) {
      continue;
    }
    if (item.contextoDeterministico.empresaId !== empresaId) {
      return null;
    }
    return item.contextoDeterministico;
  }
  return null;
}

function ultimoContextoAnalitico(
  historico: MensagemAssistente[],
  empresaId: string
): ContextoAnaliticoAssistente | null {
  for (let i = historico.length - 1; i >= 0; i -= 1) {
    const item = historico[i];
    if (item.papel !== "assistente" || !item.contextoAnalitico) {
      continue;
    }
    if (item.contextoAnalitico.empresaId !== empresaId) {
      return null;
    }
    return item.contextoAnalitico;
  }
  return null;
}

export async function executarAssistenteIa(params: {
  ctx: ContextoFerramentaIa;
  historico: MensagemAssistente[];
  pergunta: string;
  empresaNome: string;
}): Promise<{
  texto: string;
  acoes: AcaoAssistente[];
  propostaFiscal: PropostaFiscalProduto | null;
  propostaAcao: CardPropostaAcao | null;
  modo: ModoRespostaAssistente;
  contextoDeterministico: ContextoDeterministicoAssistente | null;
  contextoAnalitico: ContextoAnaliticoAssistente | null;
}> {
  const contextoAnaliticoAnterior = ultimoContextoAnalitico(
    params.historico,
    params.ctx.empresaId
  );
  const ctx = { ...params.ctx, contextoAnalitico: contextoAnaliticoAnterior };
  const direto = await responderDeterministico({
    ctx,
    pergunta: params.pergunta,
    interpretacao: {
      empresaId: params.ctx.empresaId,
      produtoIdTela: params.ctx.tela.produtoId,
      clienteIdTela: params.ctx.tela.clienteId,
      emissaoIdTela: params.ctx.tela.emissaoId,
      vendaIdTela: params.ctx.tela.vendaId,
      anterior: ultimoContextoDeterministico(params.historico, params.ctx.empresaId),
    },
  });
  if (direto) {
    registrarTelemetriaIa("deterministico");
    return {
      texto: direto.texto,
      acoes: direto.acoes,
      propostaFiscal: null,
      propostaAcao: null,
      modo: "direto",
      contextoDeterministico: direto.contextoDeterministico,
      contextoAnalitico: null,
    };
  }

  const mensagens: MensagemProviderIa[] = [
    {
      role: "system",
      content: promptSistemaAssistente({
        empresaNome: params.empresaNome,
        contextoTela: ctx.tela.rotulo,
        contextoAnalitico: contextoAnaliticoAnterior,
      }),
    },
    ...params.historico.slice(-12).map((item) => ({
      role: (item.papel === "usuario" ? "user" : "assistant") as "user" | "assistant",
      content: item.conteudo.slice(0, 2000),
    })),
    {
      role: "user",
      content: dadosComoBlocoNaoInstrucao("pergunta_do_usuario", params.pergunta),
    },
  ];

  const acoes: AcaoAssistente[] = [];
  let propostaFiscal: PropostaFiscalProduto | null = null;
  let propostaAcao: CardPropostaAcao | null = null;
  let chamadas = 0;
  let analiticas = 0;
  let contextoAnalitico: ContextoAnaliticoAssistente | null = contextoAnaliticoAnterior;

  for (let rodada = 0; rodada < MAX_RODADAS; rodada += 1) {
    const resposta = await chatComFerramentasIa({
      mensagens,
      ferramentas: DEFINICOES_FERRAMENTAS_IA,
    });
    if (!resposta.ok) {
      registrarTelemetriaIa(
        resposta.codigo === "nao_configurado" || resposta.codigo === "sem_credito"
          ? "fallbackProvider"
          : "erroProvider"
      );
      return {
        texto: MENSAGEM_IA_PRECISA_MODO,
        acoes,
        propostaFiscal,
        propostaAcao,
        modo: "ia",
        contextoDeterministico: null,
        contextoAnalitico,
      };
    }
    if (!resposta.toolCalls.length) {
      registrarTelemetriaIa("ia");
      return {
        texto: resposta.texto?.trim() || MENSAGEM_IA_FALHA_CONSULTA,
        acoes,
        propostaFiscal,
        propostaAcao,
        modo: "ia",
        contextoDeterministico: null,
        contextoAnalitico,
      };
    }

    mensagens.push({
      role: "assistant",
      content: resposta.texto ?? "",
      toolCalls: resposta.toolCalls.filter((item) => ferramentaConhecida(item.name)),
    });

    for (const chamada of resposta.toolCalls) {
      if (ferramentaEscritaAutonoma(chamada.name) || !ferramentaConhecida(chamada.name)) {
        mensagens.push({
          role: "tool",
          toolCallId: chamada.id,
          content: JSON.stringify({
            ok: false,
            erro: "Ferramenta não permitida.",
          }),
        });
        continue;
      }
      chamadas += 1;
      if (chamada.name === "consultar_analitico") {
        analiticas += 1;
      }
      if (chamadas > MAX_CHAMADAS_POR_MENSAGEM || analiticas > MAX_CONSULTAS_ANALITICAS_POR_MENSAGEM) {
        mensagens.push({
          role: "tool",
          toolCallId: chamada.id,
          content: JSON.stringify({
            ok: false,
            erro: "Limite de ferramentas desta mensagem foi atingido.",
          }),
        });
        continue;
      }
      const resultado: ResultadoFerramentaIa = await executarFerramentaIa(
        chamada.name,
        ctx,
        parseArgs(chamada.arguments)
      );
      if (resultado.acoes?.length) {
        acoes.push(...resultado.acoes);
      }
      if (resultado.propostaFiscal) {
        propostaFiscal = resultado.propostaFiscal;
      }
      if (resultado.propostaAcao) {
        propostaAcao = resultado.propostaAcao;
      }
      const contextoNovo = resultado.dados?.contextoAnalitico;
      if (contextoNovo && typeof contextoNovo === "object") {
        const bruto = contextoNovo as ContextoAnaliticoAssistente;
        if (bruto.empresaId === ctx.empresaId) {
          contextoAnalitico = bruto;
        }
      }
      mensagens.push({
        role: "tool",
        toolCallId: chamada.id,
        content: dadosComoBlocoNaoInstrucao(
          chamada.name,
          resultado.ok
            ? { ok: true, dados: resultado.dados }
            : { ok: false, erro: resultado.erro, codigo: resultado.codigo }
        ),
      });
    }
  }

  registrarTelemetriaIa("ia");
  return {
    texto: "Consultei os dados da empresa. Veja o resumo nas ações abaixo.",
    acoes,
    propostaFiscal,
    propostaAcao,
    modo: "ia",
    contextoDeterministico: null,
    contextoAnalitico,
  };
}
