import {
  valorTotalNotaGeranet,
  type ItemFiscalParaTotalNota,
} from "@/lib/fiscal/distribuir-desconto-itens";

type DetalhePagamentoDiagnostico = {
  valor?: unknown;
};

type ItemDiagnostico = {
  valorTotal?: unknown;
  desconto?: unknown;
};

type NfeDiagnostico = {
  valorTotal?: unknown;
  itens?: ItemDiagnostico[];
  pagamento?: {
    troco?: unknown;
    detalhamento?: DetalhePagamentoDiagnostico[];
  };
};

export type DiagnosticoTotalNotaGeranet = {
  modelo: "55" | "65";
  valorTotal: string | null;
  itens: Array<{
    valorTotal: unknown;
    desconto: unknown;
  }>;
  pagamento: {
    detalhamento: Array<{
      valor: unknown;
    }>;
    troco: unknown;
  };
};

export function diagnosticoTotalNotaGeranet(input: {
  modelo: "55" | "65";
  nfe: NfeDiagnostico;
}): DiagnosticoTotalNotaGeranet {
  return {
    modelo: input.modelo,
    valorTotal:
      input.nfe.valorTotal == null
        ? null
        : String(input.nfe.valorTotal),
    itens: (input.nfe.itens ?? []).map((item) => ({
      valorTotal: item.valorTotal ?? null,
      desconto: item.desconto ?? null,
    })),
    pagamento: {
      detalhamento: (input.nfe.pagamento?.detalhamento ?? []).map(
        (detalhe) => ({
          valor: detalhe.valor ?? null,
        })
      ),
      troco: input.nfe.pagamento?.troco ?? null,
    },
  };
}

export function aplicarValorTotalNotaGeranet(input: {
  modelo: "55" | "65";
  nfe: object;
  itensFiscais: ItemFiscalParaTotalNota[];
}) {
  const nfe = input.nfe as NfeDiagnostico & {
    valorTotal?: string;
  };

  nfe.valorTotal = valorTotalNotaGeranet(input.itensFiscais);

  const diagnostico = diagnosticoTotalNotaGeranet({
    modelo: input.modelo,
    nfe,
  });

  console.info(
    "[fiscal] total-nota-geranet",
    diagnostico
  );

  return diagnostico;
}
