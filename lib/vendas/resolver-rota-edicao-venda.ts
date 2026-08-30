import { hrefEdicaoOperacaoFiscal } from "@/lib/fiscal/acoes-emissao";
import { resolverEstadoOperacionalFiscal } from "@/lib/fiscal/estado-operacional-fiscal";

export type OrigemVendaComercial = "pdv" | "nfe_manual";

export type ModoEdicaoVenda = "pdv" | "nfe_formulario" | "venda_detalhe";

export type RotaEdicaoVenda = {
  href: string;
  label: string;
  modo: ModoEdicaoVenda;
};

function prioridadeStatusFiscal(status: string) {
  if (status === "autorizada") return 100;
  if (
    status === "enviando" ||
    status === "aguardando_reconciliacao" ||
    status === "erro_comunicacao"
  ) {
    return 80;
  }
  if (status === "cancelada") return 70;
  if (status === "rejeitada") return 50;
  return 10;
}

function estadoFiscalDaVenda(input: {
  statusFiscal?: string | null;
  classificacaoFiscal?: string | null;
}) {
  return resolverEstadoOperacionalFiscal({
    status: input.statusFiscal,
    classificacao: input.classificacaoFiscal,
  });
}

export function resolverOrigemVendaComercial(
  operacaoFiscalVendaId?: string | null
): OrigemVendaComercial {
  return String(operacaoFiscalVendaId ?? "").trim() ? "nfe_manual" : "pdv";
}

export function rotuloOrigemVendaComercial(origem: OrigemVendaComercial) {
  return origem === "nfe_manual" ? "NF-e" : "PDV";
}

export function escolherStatusFiscalVenda(
  emissoes: Array<{ status?: string | null }>
) {
  let escolhida: string | null = null;
  let prioridade = -1;
  for (const emissao of emissoes) {
    const status = String(emissao.status ?? "").trim();
    if (!status) continue;
    const atual = prioridadeStatusFiscal(status);
    if (atual > prioridade) {
      escolhida = status;
      prioridade = atual;
    }
  }
  return escolhida;
}

export function escolherEmissaoFiscalVenda<T extends { status?: string | null }>(
  emissoes: T[]
): T | null {
  if (emissoes.length === 0) {
    return null;
  }
  const status = escolherStatusFiscalVenda(emissoes);
  if (!status) {
    return emissoes[0] ?? null;
  }
  return emissoes.find((emissao) => String(emissao.status ?? "") === status) ?? emissoes[0] ?? null;
}

export function resolverRotaEdicaoVenda(input: {
  vendaId: string;
  origem: OrigemVendaComercial;
  operacaoFiscalId?: string | null;
  statusFiscal?: string | null;
  classificacaoFiscal?: string | null;
}): RotaEdicaoVenda {
  const vendaId = String(input.vendaId ?? "").trim();
  const operacaoId = String(input.operacaoFiscalId ?? "").trim();
  const estado = estadoFiscalDaVenda(input);

  if (input.origem !== "nfe_manual") {
    return {
      href: `/pdv/editar/${vendaId}`,
      label: "Editar no PDV",
      modo: "pdv",
    };
  }

  if (estado.estado === "cancelada") {
    return {
      href: operacaoId ? hrefEdicaoOperacaoFiscal(operacaoId) : `/vendas/${vendaId}`,
      label: "Abrir documento",
      modo: operacaoId ? "nfe_formulario" : "venda_detalhe",
    };
  }

  if (estado.documentoFiscalSensivel || estado.estado === "reservada") {
    return {
      href: `/vendas/${vendaId}`,
      label: estado.podeReconciliar
        ? "Reconciliar agora"
        : estado.requerDiagnostico
          ? "Consultar diagnóstico"
          : "Abrir documento",
      modo: "venda_detalhe",
    };
  }

  if (operacaoId) {
    return {
      href: hrefEdicaoOperacaoFiscal(operacaoId),
      label:
        estado.podeRetry || estado.estado === "rejeitada_sefaz"
          ? "Corrigir NF-e"
          : "Editar NF-e",
      modo: "nfe_formulario",
    };
  }

  return {
    href: `/vendas/${vendaId}`,
    label: "Abrir venda",
    modo: "venda_detalhe",
  };
}

export function resolverRotaEmissaoListaVenda(input: {
  vendaId: string;
  origem: OrigemVendaComercial;
  operacaoFiscalId?: string | null;
  statusFiscal?: string | null;
  classificacaoFiscal?: string | null;
  modelo: "55" | "65";
}): { href: string; label: string; ocultar: boolean } {
  const operacaoId = String(input.operacaoFiscalId ?? "").trim();
  const label = input.modelo === "65" ? "Emitir NFC-e" : "Emitir NF-e";
  const estado = estadoFiscalDaVenda(input);

  if (input.origem === "pdv" && input.modelo === "55") {
    return {
      href: `/vendas/${input.vendaId}/nfe`,
      label,
      ocultar: true,
    };
  }

  if (input.origem === "nfe_manual") {
    if (estado.documentoFiscalSensivel || estado.estado === "reservada") {
      return { href: `/vendas/${input.vendaId}`, label, ocultar: true };
    }
    if (operacaoId) {
      return {
        href: hrefEdicaoOperacaoFiscal(operacaoId),
        label: estado.podeRetry ? "Reenviar NF-e" : label,
        ocultar: false,
      };
    }
  }

  return {
    href:
      input.modelo === "65"
        ? `/vendas/${input.vendaId}/nfce`
        : `/vendas/${input.vendaId}/nfe`,
    label,
    ocultar: false,
  };
}

function classificacaoDaResposta(dados: {
  classificacao?: unknown;
  geranet?: unknown;
}) {
  const direta = String(dados.classificacao ?? "").trim();
  if (direta) {
    return direta;
  }
  if (dados.geranet && typeof dados.geranet === "object") {
    return String(
      (dados.geranet as Record<string, unknown>).classificacao ?? ""
    ).trim();
  }
  return "";
}

export function interpretarRespostaEmissaoVenda(dados: {
  ok?: unknown;
  autorizada?: unknown;
  status?: unknown;
  classificacao?: unknown;
  geranet?: unknown;
  erro?: unknown;
  mensagem?: unknown;
  requer_reconciliacao?: unknown;
  podeRetransmitir?: unknown;
}) {
  const status = String(dados.status ?? "").trim();
  const classificacao = classificacaoDaResposta(dados);
  const mensagem = String(
    dados.erro ?? dados.mensagem ?? "Falha ao emitir o documento fiscal."
  );
  const estado = resolverEstadoOperacionalFiscal({ status, classificacao });

  if (dados.autorizada === true || (dados.ok === true && dados.autorizada !== false)) {
    return {
      kind: "autorizada" as const,
      mensagem: String(dados.mensagem ?? "Documento fiscal autorizado."),
      status: "autorizada",
    };
  }

  if (
    dados.requer_reconciliacao === true ||
    status === "aguardando_reconciliacao" ||
    estado.documentoFiscalAmbiguo ||
    estado.estado === "em_transmissao"
  ) {
    return {
      kind: "aguardando_reconciliacao" as const,
      mensagem,
      status: "aguardando_reconciliacao",
    };
  }

  if (estado.estado === "erro_envio" && dados.podeRetransmitir !== false) {
    return {
      kind: "nao_transmitida" as const,
      mensagem,
      status: "nao_transmitida",
    };
  }

  if (estado.estado === "nao_classificada") {
    return {
      kind: "nao_classificada" as const,
      mensagem,
      status: "nao_classificada",
    };
  }

  if (status === "rejeitada" || estado.estado === "rejeitada_sefaz") {
    return { kind: "rejeitada" as const, mensagem, status: status || "rejeitada" };
  }

  return { kind: "erro" as const, mensagem, status: status || null };
}

export function resolverDestinoAposEmissaoVenda(input: {
  vendaId: string;
  ok?: unknown;
  autorizada?: unknown;
  status?: unknown;
  classificacao?: unknown;
  geranet?: unknown;
  requer_reconciliacao?: unknown;
  podeRetransmitir?: unknown;
}) {
  const vendaId = String(input.vendaId ?? "").trim();
  if (!vendaId) return null;
  const resultado = interpretarRespostaEmissaoVenda(input);
  if (
    resultado.kind === "autorizada" ||
    resultado.kind === "aguardando_reconciliacao" ||
    resultado.kind === "nao_transmitida" ||
    resultado.kind === "nao_classificada"
  ) {
    return {
      href: `/vendas/${vendaId}?emissao=${encodeURIComponent(resultado.status)}`,
      status: resultado.status,
    };
  }
  return null;
}

export function mensagemFeedbackEmissaoVenda(emissao?: string | null) {
  const status = String(emissao ?? "").trim();
  if (status === "autorizada") {
    return {
      type: "sucesso" as const,
      texto: "Documento fiscal autorizado. A venda comercial já está nesta tela.",
    };
  }
  if (status === "nao_transmitida") {
    return {
      type: "aviso" as const,
      texto:
        "NF-e não transmitida. A Geranet recusou ou não aceitou a solicitação antes de uma confirmação de envio à SEFAZ.",
    };
  }
  if (status === "nao_classificada") {
    return {
      type: "aviso" as const,
      texto: "Situação fiscal ainda não classificada. Consulte o diagnóstico antes de retransmitir.",
    };
  }
  if (status === "aguardando_reconciliacao") {
    return {
      type: "aviso" as const,
      texto:
        "Não foi possível confirmar o estado fiscal desta NF-e. O documento será mantido para reconciliação. Não retransmita enquanto a situação não for confirmada.",
    };
  }
  if (status === "enviando" || status === "erro_comunicacao") {
    return {
      type: "aviso" as const,
      texto:
        "Situação fiscal ainda não classificada. Consulte o diagnóstico antes de retransmitir.",
    };
  }
  return null;
}
