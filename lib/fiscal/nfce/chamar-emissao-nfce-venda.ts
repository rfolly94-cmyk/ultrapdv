import { interpretarRespostaEmissaoVenda } from "@/lib/vendas/resolver-rota-edicao-venda";

export type ResultadoEmissaoNfceVenda = {
  ok: boolean;
  autorizada: boolean;
  status: string | null;
  mensagem: string;
  emissaoId: string | null;
  serie: string | number | null;
  numero: string | null;
  kind: ReturnType<typeof interpretarRespostaEmissaoVenda>["kind"];
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

export async function chamarEmissaoNfceVenda(input: {
  vendaId: string;
  ambiente: 1 | 2;
}): Promise<ResultadoEmissaoNfceVenda> {
  const vendaId = texto(input.vendaId);
  const ambiente = input.ambiente === 1 ? 1 : 2;

  try {
    const response = await fetch("/api/fiscal/geranet/nfce-emitir-venda", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": vendaId,
      },
      body: JSON.stringify({
        confirmar:
          ambiente === 1
            ? "EMITIR_NFCE_VENDA_PRODUCAO"
            : "EMITIR_NFCE_VENDA_HOMOLOGACAO",
        venda_id: vendaId,
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;
    const interpretado = interpretarRespostaEmissaoVenda({
      ok: data.ok,
      autorizada: data.autorizada,
      status: data.status,
      classificacao: data.classificacao,
      geranet: data.geranet,
      requer_reconciliacao: data.requer_reconciliacao,
      podeRetransmitir: data.podeRetransmitir,
      mensagem: data.mensagem,
      erro: data.erro,
    });

    return {
      ok: response.ok && data.ok === true,
      autorizada: data.autorizada === true || interpretado.kind === "autorizada",
      status: interpretado.status,
      mensagem:
        texto(data.mensagem) ||
        texto(data.erro) ||
        interpretado.mensagem ||
        "Situação fiscal registrada.",
      emissaoId: texto(data.emissao_id) || null,
      serie: (data.serie as string | number | null) ?? null,
      numero: data.numero == null ? null : String(data.numero),
      kind: interpretado.kind,
    };
  } catch (error) {
    return {
      ok: false,
      autorizada: false,
      status: "erro_comunicacao",
      mensagem:
        error instanceof Error
          ? error.message
          : "Não foi possível emitir a NFC-e.",
      emissaoId: null,
      serie: null,
      numero: null,
      kind: "erro",
    };
  }
}
