import type { DefinicaoFerramentaIa, NomeFerramentaIa } from "./tipos";

export type MensagemProviderIa = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: Array<{
    id: string;
    name: NomeFerramentaIa;
    arguments: string;
  }>;
};

export type RespostaProviderIa =
  | {
      ok: true;
      texto: string | null;
      toolCalls: Array<{
        id: string;
        name: NomeFerramentaIa;
        arguments: string;
      }>;
    }
    | { ok: false; erro: string; codigo: "nao_configurado" | "falha" | "sem_credito" };

export type ConfigProviderIa = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export function lerConfigProviderIa(): ConfigProviderIa | null {
  const apiKey = String(process.env.ULTRAPDV_IA_API_KEY ?? "").trim();
  if (!apiKey) {
    return null;
  }
  return {
    apiKey,
    baseUrl: String(
      process.env.ULTRAPDV_IA_BASE_URL ?? "https://api.openai.com/v1"
    ).replace(/\/+$/, ""),
    model: String(process.env.ULTRAPDV_IA_MODEL ?? "gpt-4o-mini").trim(),
  };
}

function ferramentasOpenAi(ferramentas: DefinicaoFerramentaIa[]) {
  return ferramentas.map((item) => ({
    type: "function",
    function: {
      name: item.nome,
      description: item.descricao,
      parameters: item.parametros,
    },
  }));
}

export async function chatComFerramentasIa(params: {
  mensagens: MensagemProviderIa[];
  ferramentas: DefinicaoFerramentaIa[];
  config?: ConfigProviderIa | null;
}): Promise<RespostaProviderIa> {
  const config = params.config ?? lerConfigProviderIa();
  if (!config) {
    return {
      ok: false,
      erro: "Provedor de IA não configurado.",
      codigo: "nao_configurado",
    };
  }

  const mensagens = params.mensagens.map((item) => {
    if (item.role === "tool") {
      return {
        role: "tool",
        tool_call_id: item.toolCallId,
        content: item.content,
      };
    }
    if (item.role === "assistant" && item.toolCalls?.length) {
      return {
        role: "assistant",
        content: item.content || null,
        tool_calls: item.toolCalls.map((chamada) => ({
          id: chamada.id,
          type: "function",
          function: {
            name: chamada.name,
            arguments: chamada.arguments,
          },
        })),
      };
    }
    return {
      role: item.role,
      content: item.content,
    };
  });

  try {
    const resposta = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        messages: mensagens,
        tools: ferramentasOpenAi(params.ferramentas),
        tool_choice: "auto",
      }),
    });

    const bruto = await resposta.text();
    if (!resposta.ok) {
      const lower = bruto.toLowerCase();
      const semCredito =
        resposta.status === 402 ||
        resposta.status === 429 ||
        /insufficient_quota|quota_exceeded|billing_hard_limit|credit|saldo insuficiente/.test(
          lower
        );
      return {
        ok: false,
        erro: semCredito
          ? "Provedor de IA sem crédito ou cota."
          : `Falha do provedor de IA (${resposta.status}).`,
        codigo: semCredito ? "sem_credito" : "falha",
      };
    }

    const json = JSON.parse(bruto || "{}") as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };
    const mensagem = json.choices?.[0]?.message;
    const toolCalls = (mensagem?.tool_calls ?? [])
      .map((item) => ({
        id: String(item.id ?? ""),
        name: String(item.function?.name ?? "") as NomeFerramentaIa,
        arguments: String(item.function?.arguments ?? "{}"),
      }))
      .filter((item) => item.id && item.name);

    return {
      ok: true,
      texto: mensagem?.content ? String(mensagem.content) : null,
      toolCalls,
    };
  } catch {
    return {
      ok: false,
      erro: "Não foi possível falar com o provedor de IA.",
      codigo: "falha",
    };
  }
}
