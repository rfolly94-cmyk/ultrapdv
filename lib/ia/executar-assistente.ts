import { dadosComoBlocoNaoInstrucao } from "./contexto";
import { DEFINICOES_FERRAMENTAS_IA, executarFerramentaIa } from "./ferramentas/registro";
import { ferramentaDoCatalogo } from "./ferramentas/catalogo";
import type { ContextoFerramentaIa } from "./ferramentas/contexto";
import { ferramentaEscritaAutonoma } from "./acoes/regras";
import { registrarTelemetriaIa } from "./deterministico/telemetria";
import { chatComFerramentasIa, type MensagemProviderIa } from "./provider";
import { promptSistemaAssistente } from "./prompts/sistema";
import { sanitizarAcoesFrontendAssistente } from "./acoes-frontend";
import { MAX_CONSULTAR_DADOS_POR_MENSAGEM } from "./consulta/tipos";
import {
  MENSAGEM_IA_FALHA_CONSULTA,
  MENSAGEM_IA_NAO_CONFIGURADO,
  MENSAGEM_IA_PROVEDOR_SEM_CREDITO,
  NOMES_FERRAMENTAS_IA,
  type AcaoAssistente,
  type ContextoDeterministicoAssistente,
  type MensagemAssistente,
  type ModoRespostaAssistente,
  type NomeFerramentaIa,
  type PropostaFiscalProduto,
} from "./tipos";
import type { ContextoAnaliticoAssistente } from "./analitico/tipos";

const MAX_RODADAS = 4;
const MAX_CHAMADAS_POR_MENSAGEM = 8;
const MAX_HISTORICO = 8;
const MAX_CHARS_HISTORICO = 1500;

function parseArgs(bruto: string) {
  try {
    const json = JSON.parse(bruto) as unknown;
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return {};
    }
    return json as Record<string, unknown>;
  } catch {
    return {};
  }
}

function ferramentaConhecida(nome: string): nome is NomeFerramentaIa {
  return (
    (NOMES_FERRAMENTAS_IA as readonly string[]).includes(nome) &&
    Boolean(ferramentaDoCatalogo(nome))
  );
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

function str(valor: unknown) {
  const saida = String(valor ?? "").trim();
  return saida || null;
}

function contextoDeDadosTool(
  empresaId: string,
  ferramenta: string,
  dados: Record<string, unknown> | undefined
): ContextoDeterministicoAssistente | null {
  if (!dados) {
    return { empresaId, intencao: ferramenta };
  }
  const rows = Array.isArray(dados.rows) ? dados.rows : [];
  const primeiro =
    rows[0] && typeof rows[0] === "object"
      ? (rows[0] as Record<string, unknown>)
      : dados;
  return {
    empresaId,
    intencao: ferramenta,
    clienteId: str(primeiro.cliente_id ?? primeiro.id),
    clienteNome: str(primeiro.cliente_nome ?? primeiro.nome ?? primeiro["cliente.nome"]),
    produtoId: str(primeiro.produto_id),
    produtoNome: str(primeiro.produto_nome ?? primeiro["produto.nome"]),
  };
}

function mensagemErroProvider(codigo: "nao_configurado" | "falha" | "sem_credito") {
  if (codigo === "nao_configurado") {
    return MENSAGEM_IA_NAO_CONFIGURADO;
  }
  if (codigo === "sem_credito") {
    return MENSAGEM_IA_PROVEDOR_SEM_CREDITO;
  }
  return MENSAGEM_IA_FALHA_CONSULTA;
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
  propostaAcao: null;
  modo: ModoRespostaAssistente;
  contextoDeterministico: ContextoDeterministicoAssistente | null;
  contextoAnalitico: ContextoAnaliticoAssistente | null;
}> {
  const contextoAnaliticoAnterior = ultimoContextoAnalitico(
    params.historico,
    params.ctx.empresaId
  );
  const contextoAnterior = ultimoContextoDeterministico(
    params.historico,
    params.ctx.empresaId
  );
  const ctx = { ...params.ctx, contextoAnalitico: contextoAnaliticoAnterior };

  const mensagens: MensagemProviderIa[] = [
    {
      role: "system",
      content: promptSistemaAssistente({
        empresaNome: params.empresaNome,
        contextoTela: ctx.tela.rotulo,
        contextoAnalitico: contextoAnaliticoAnterior,
        contextoEntidade: contextoAnterior,
      }),
    },
    ...params.historico.slice(-MAX_HISTORICO).map((item) => ({
      role: (item.papel === "usuario" ? "user" : "assistant") as "user" | "assistant",
      content: item.conteudo.slice(0, MAX_CHARS_HISTORICO),
    })),
    {
      role: "user",
      content: dadosComoBlocoNaoInstrucao("pergunta_do_usuario", params.pergunta),
    },
  ];

  const acoes: AcaoAssistente[] = [];
  let chamadas = 0;
  let consultasDados = 0;
  let contextoAnalitico: ContextoAnaliticoAssistente | null = contextoAnaliticoAnterior;
  let contextoDeterministico: ContextoDeterministicoAssistente | null = contextoAnterior;

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
        texto: mensagemErroProvider(resposta.codigo),
        acoes: sanitizarAcoesFrontendAssistente(acoes),
        propostaFiscal: null,
        propostaAcao: null,
        modo: "ia",
        contextoDeterministico,
        contextoAnalitico,
      };
    }
    if (process.env.NODE_ENV === "development") {
      console.info(
        JSON.stringify({
          origem: "ia-assistente",
          provider: true,
          toolCalls: resposta.toolCalls.map((item) => item.name),
          rodada,
        })
      );
    }
    if (!resposta.toolCalls.length) {
      registrarTelemetriaIa("ia");
      return {
        texto: resposta.texto?.trim() || MENSAGEM_IA_FALHA_CONSULTA,
        acoes: sanitizarAcoesFrontendAssistente(acoes),
        propostaFiscal: null,
        propostaAcao: null,
        modo: "ia",
        contextoDeterministico,
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
            codigo: "ferramenta_inexistente",
          }),
        });
        continue;
      }
      chamadas += 1;
      if (chamada.name === "consultar_dados") {
        consultasDados += 1;
      }
      if (
        chamadas > MAX_CHAMADAS_POR_MENSAGEM ||
        consultasDados > MAX_CONSULTAR_DADOS_POR_MENSAGEM
      ) {
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
      const inicioTool = Date.now();
      const resultado = await executarFerramentaIa(
        chamada.name,
        ctx,
        parseArgs(chamada.arguments)
      );
      if (process.env.NODE_ENV === "development") {
        console.info(
          JSON.stringify({
            origem: "ia-assistente",
            ferramenta: chamada.name,
            ok: resultado.ok,
            duracaoMs: Date.now() - inicioTool,
            rowCount:
              resultado.ok && resultado.dados && typeof resultado.dados.rowCount === "number"
                ? resultado.dados.rowCount
                : null,
          })
        );
      }
      if (resultado.acoes?.length) {
        acoes.push(...resultado.acoes);
      }
      const contextoNovo = resultado.dados?.contextoAnalitico;
      if (contextoNovo && typeof contextoNovo === "object") {
        const bruto = contextoNovo as ContextoAnaliticoAssistente;
        if (bruto.empresaId === ctx.empresaId) {
          contextoAnalitico = bruto;
        }
      }
      const extraido = contextoDeDadosTool(ctx.empresaId, chamada.name, resultado.dados);
      if (extraido) {
        contextoDeterministico = extraido;
      }
      mensagens.push({
        role: "tool",
        toolCallId: chamada.id,
        content: dadosComoBlocoNaoInstrucao(
          chamada.name,
          resultado.ok
            ? { ok: true, dados: resultado.dados }
            : {
                ok: false,
                erro: resultado.erro,
                codigo: resultado.codigo,
                dados: resultado.dados ?? null,
              }
        ),
      });
    }
  }

  registrarTelemetriaIa("ia");
  return {
    texto: "Consultei os dados da empresa. Veja o resumo nas ações abaixo.",
    acoes: sanitizarAcoesFrontendAssistente(acoes),
    propostaFiscal: null,
    propostaAcao: null,
    modo: "ia",
    contextoDeterministico,
    contextoAnalitico,
  };
}
