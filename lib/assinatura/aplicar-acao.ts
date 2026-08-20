import type { AcaoAssinatura, AssinaturaEmpresa, EventoMaster } from "./tipos";

const DIAS_LIBERACAO = [1, 3, 7, 15, 30] as const;

export function diasLiberacaoTemporaria() {
  return [...DIAS_LIBERACAO];
}

export function somarDias(base: Date, dias: number) {
  return new Date(base.getTime() + dias * 24 * 60 * 60 * 1000);
}

export function aplicarAcaoAssinatura(
  atual: AssinaturaEmpresa,
  acao: AcaoAssinatura,
  params: {
    planoId?: string | null;
    planoNome?: string | null;
    vencimentoEm?: string | null;
    carenciaAte?: string | null;
    liberadoAte?: string | null;
    diasLiberacao?: number;
    motivo?: string | null;
  } = {},
  agora = new Date()
): { proxima: AssinaturaEmpresa; evento: EventoMaster } {
  const motivo = String(params.motivo ?? "").trim();
  const base: AssinaturaEmpresa = {
    ...atual,
    observacao: motivo || atual.observacao,
  };

  if (acao === "ativar") {
    return {
      proxima: {
        ...base,
        status: "ativa",
        suspenso_em: null,
        cancelado_em: null,
      },
      evento: "empresa_ativada",
    };
  }

  if (acao === "suspender") {
    return {
      proxima: {
        ...base,
        status: "suspensa",
        suspenso_em: agora.toISOString(),
        liberado_ate: null,
      },
      evento: "empresa_suspensa",
    };
  }

  if (acao === "carencia") {
    return {
      proxima: {
        ...base,
        status: "carencia",
        carencia_ate: params.carenciaAte ?? null,
        suspenso_em: null,
      },
      evento: "empresa_carencia",
    };
  }

  if (acao === "liberar") {
    const ate =
      params.liberadoAte ||
      somarDias(
        agora,
        DIAS_LIBERACAO.includes(params.diasLiberacao as (typeof DIAS_LIBERACAO)[number])
          ? Number(params.diasLiberacao)
          : 7
      ).toISOString();
    return {
      proxima: {
        ...base,
        liberado_ate: ate,
      },
      evento: "empresa_liberada_temporariamente",
    };
  }

  if (acao === "cancelar") {
    return {
      proxima: {
        ...base,
        status: "cancelada",
        cancelado_em: agora.toISOString(),
        liberado_ate: null,
      },
      evento: "assinatura_cancelada",
    };
  }

  if (acao === "alterar_plano") {
    return {
      proxima: {
        ...base,
      plano_id: params.planoId ?? atual.plano_id,
      plano_nome: params.planoNome ?? atual.plano_nome,
      vencimento_em: params.vencimentoEm ?? atual.vencimento_em,
      },
      evento: "plano_alterado",
    };
  }

  return {
    proxima: {
      ...base,
      vencimento_em: params.vencimentoEm ?? atual.vencimento_em,
    },
    evento: "vencimento_alterado",
  };
}
