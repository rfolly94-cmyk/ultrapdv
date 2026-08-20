export const MENSAGEM_FIADO_EXIGE_CLIENTE =
  "Selecione um cliente para utilizar Fiado.";

export type ContextoClientePdv = "manual" | "fiado";

export type PagamentoDigitadoPdv = {
  formaPagamentoId: string;
  valorTexto: string;
};

export function aoMarcarFiado(input: {
  marcado: boolean;
  clienteId: string | null;
}): "ativar" | "desativar" | "pedir_cliente" {
  if (!input.marcado) {
    return "desativar";
  }

  if (!input.clienteId) {
    return "pedir_cliente";
  }

  return "ativar";
}

export function deveResetarPagamentosAposCliente(input: {
  contexto: ContextoClientePdv | null;
  clienteSelecionado: boolean;
}) {
  return input.contexto === "fiado" && input.clienteSelecionado;
}

export function resetarPagamentosAposClienteFiado(): PagamentoDigitadoPdv[] {
  return [];
}

export function restanteParaAtivarFiado(input: {
  totalCentavos: number;
  outrosCentavos?: number;
}) {
  return Math.max(0, input.totalCentavos - (input.outrosCentavos ?? 0));
}

export function fiadoSincronizadoComPagamentos(input: {
  usarFiado: boolean;
  formaFiadoId: string | null;
  pagamentos: PagamentoDigitadoPdv[];
}) {
  if (!input.usarFiado) {
    return true;
  }

  if (!input.formaFiadoId) {
    return false;
  }

  return input.pagamentos.some(
    (pagamento) => pagamento.formaPagamentoId === input.formaFiadoId
  );
}

export function aoCancelarClienteDoFiado(input: {
  contexto: ContextoClientePdv | null;
}) {
  if (input.contexto !== "fiado") {
    return {
      usarFiado: undefined as boolean | undefined,
      mensagem: null as string | null,
      reabrirPagamento: false,
    };
  }

  return {
    usarFiado: false,
    mensagem: MENSAGEM_FIADO_EXIGE_CLIENTE,
    reabrirPagamento: true,
  };
}

export function podeConcluirFiado(input: {
  usarFiado: boolean;
  clienteId: string | null;
}) {
  if (!input.usarFiado) {
    return true;
  }

  return Boolean(input.clienteId);
}
