import { MENSAGEM_CONECTOR_AUSENTE } from "./mensagens";
import { fetchConector } from "./descobrir";
import { normalizarErroImpressaoConector } from "./mensagens";

const TIMEOUT_GAVETA_MS = 8000;

export async function abrirGavetaAgente(): Promise<
  { ok: true } | { ok: false; erro: string }
> {
  try {
    const resposta = await fetchConector(
      "/drawer/open",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
      TIMEOUT_GAVETA_MS
    );

    const data = (await resposta.json().catch(() => ({}))) as {
      ok?: boolean;
      erro?: string;
    };

    if (!resposta.ok || data.ok !== true) {
      return {
        ok: false,
        erro: normalizarErroImpressaoConector(
          data.erro || "Não foi possível abrir a gaveta neste computador."
        ),
      };
    }

    return { ok: true };
  } catch {
    return {
      ok: false,
      erro: MENSAGEM_CONECTOR_AUSENTE,
    };
  }
}
