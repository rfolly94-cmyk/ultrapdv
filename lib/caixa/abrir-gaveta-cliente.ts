"use client";

import {
  autorizarAberturaGaveta,
  registrarAberturaGaveta,
} from "@/app/caixa/gaveta-actions";
import { abrirGavetaAgente } from "@/lib/impressao/gaveta";
import type { OrigemAberturaGaveta } from "@/lib/caixa/gaveta";
import { MENSAGEM_GAVETA_ABERTA } from "@/lib/caixa/mensagens";

export async function executarAberturaGaveta(input: {
  origem: OrigemAberturaGaveta;
  vendaId?: string | null;
  exigirCaixaAberto?: boolean;
}): Promise<{ ok: true; mensagem: string } | { ok: false; erro: string }> {
  const exigirCaixa = input.exigirCaixaAberto !== false;

  if (exigirCaixa || input.origem !== "venda") {
    const auth = await autorizarAberturaGaveta();
    if (!auth.ok) {
      return auth;
    }
  }

  const fisico = await abrirGavetaAgente();
  if (!fisico.ok) {
    return fisico;
  }

  const registro = await registrarAberturaGaveta({
    origem: input.origem,
    vendaId: input.vendaId ?? null,
  });
  if (!registro.ok && input.origem !== "venda") {
    return { ok: true, mensagem: MENSAGEM_GAVETA_ABERTA };
  }

  return { ok: true, mensagem: MENSAGEM_GAVETA_ABERTA };
}
