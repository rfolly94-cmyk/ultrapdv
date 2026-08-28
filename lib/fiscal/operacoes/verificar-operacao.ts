import { naturezaEstaCompleta } from "@/lib/fiscal/operacoes/resolver-natureza";
import {
  resolverCfopEfetivo,
  tipoDestinoPorUf,
  type RegraCfopNatureza,
  type TipoDestinoCfop,
} from "@/lib/fiscal/operacoes/resolver-cfop";
import type { NaturezaOperacaoFiscal } from "@/lib/fiscal/operacoes/catalogo";
import {
  MENSAGEM_TRANSFERENCIA_DESTINO_CLIENTE,
  MENSAGEM_TRANSFERENCIA_DESTINO_INELEGIVEL,
} from "@/lib/fiscal/operacoes/catalogo";
import { destinoTransferenciaElegivel } from "@/lib/fiscal/operacoes/elegibilidade-transferencia";
import type { AmbienteGeranet, CodigoRegimeTributario } from "@/lib/fiscal/geranet/resolver-politica-ibscbs";
import { pendenciasIpiDocumento, type PerfilIpi } from "@/lib/fiscal/ipi";
import { camposIpiDoGrupo } from "@/lib/fiscal/ipi";
import { alertaNaoContribuinteConsumidorFinal } from "@/lib/fiscal/destinatario/resolver-destinatario-fiscal";

export type PendenciaOperacaoFiscal = {
  codigo: string;
  mensagem: string;
};

export type ItemVerificacaoOperacao = {
  id: string;
  descricao: string;
  produtoId: string;
  produtoEmpresaId?: string | null;
  grupoFiscalId?: string | null;
  grupoFiscalEmpresaId?: string | null;
  grupoFiscalNome?: string | null;
  icmsCstCsosn?: string | null;
  ncm?: string | null;
  cfopInterno?: string | null;
  cfopInterestadual?: string | null;
  quantidade: number;
  valorUnitario: number;
  estoqueDisponivel?: number | null;
};

export function verificarOperacaoFiscal(params: {
  empresaIdAtiva: string;
  tipoOperacaoInterno: "venda" | "bonificacao" | "transferencia";
  natureza: NaturezaOperacaoFiscal | null;
  ufEmpresa?: string | null;
  ufDestinatario?: string | null;
  destinatarioTipo: string;
  destinatarioId?: string | null;
  destinoEmpresaId?: string | null;
  vinculosTransferencia?: Array<{
    id: string;
    empresa_origem_id: string;
    empresa_destino_id: string;
    ativo?: boolean | null;
  }>;
  itens: ItemVerificacaoOperacao[];
  regrasCfop: RegraCfopNatureza[];
  codigoRegimeTributario: CodigoRegimeTributario;
  ambiente: AmbienteGeranet;
  perfilIpi: PerfilIpi | null;
  gruposIpi?: Array<{
    nome?: string | null;
    ipi_aplicavel?: boolean | null;
    ipi_cst?: string | null;
    ipi_aliquota?: number | string | null;
    ipi_enquadramento?: string | null;
  }>;
  modeloDocumento?: string | null;
  indicadorIeDestinatario?: string | null;
  consumidorFinal?: boolean | string | null;
}): {
  ok: boolean;
  pendencias: PendenciaOperacaoFiscal[];
  alertas: string[];
  tipoDestino: TipoDestinoCfop | null;
  itens: Array<ItemVerificacaoOperacao & { cfop: string | null }>;
} {
  const pendencias: PendenciaOperacaoFiscal[] = [];
  const alertas: string[] = [];

  if (
    !params.natureza ||
    !naturezaEstaCompleta(params.natureza, params.empresaIdAtiva)
  ) {
    pendencias.push({
      codigo: "natureza",
      mensagem:
        params.tipoOperacaoInterno === "venda"
          ? "Cadastre ou selecione uma natureza de venda da empresa ativa."
          : params.tipoOperacaoInterno === "bonificacao"
            ? "Cadastre ou selecione uma natureza de bonificação da empresa ativa."
            : "Cadastre ou selecione uma natureza de transferência da empresa ativa.",
    });
  } else if (
    params.natureza.tipo_operacao_interno !== params.tipoOperacaoInterno
  ) {
    pendencias.push({
      codigo: "natureza_tipo",
      mensagem: "A natureza selecionada não pertence a esta operação.",
    });
  }

  if (params.tipoOperacaoInterno === "bonificacao" || params.tipoOperacaoInterno === "venda") {
    if (params.destinatarioTipo !== "cliente" || !params.destinatarioId) {
      pendencias.push({
        codigo: "destinatario",
        mensagem: "Selecione um destinatário da empresa ativa.",
      });
    } else {
      const alertaDestinatario = alertaNaoContribuinteConsumidorFinal({
        modelo: params.modeloDocumento ?? "55",
        tipoOperacaoInterno: params.tipoOperacaoInterno,
        indicadorIEdestinatario: params.indicadorIeDestinatario,
        consumidorFinal: params.consumidorFinal,
        ufDestinatario: params.ufDestinatario,
      });
      if (alertaDestinatario) {
        alertas.push(alertaDestinatario.mensagem);
      }
    }
  } else {
    if (params.destinatarioTipo === "cliente") {
      pendencias.push({
        codigo: "destino_cliente",
        mensagem: MENSAGEM_TRANSFERENCIA_DESTINO_CLIENTE,
      });
    } else if (
      !params.destinoEmpresaId ||
      !destinoTransferenciaElegivel({
        empresaOrigemId: params.empresaIdAtiva,
        destinoEmpresaId: params.destinoEmpresaId,
        vinculos: params.vinculosTransferencia ?? [],
      })
    ) {
      pendencias.push({
        codigo: "destino",
        mensagem: MENSAGEM_TRANSFERENCIA_DESTINO_INELEGIVEL,
      });
    }
  }

  const tipoDestino = tipoDestinoPorUf(params.ufEmpresa, params.ufDestinatario);
  if (!tipoDestino) {
    pendencias.push({
      codigo: "uf",
      mensagem:
        "UF da empresa ou do destinatário incompleta. Não é possível resolver o destino do CFOP.",
    });
  }

  if (params.itens.length === 0) {
    pendencias.push({
      codigo: "itens",
      mensagem: "Inclua ao menos um produto da empresa ativa.",
    });
  }

  const itens = params.itens.map((item) => {
    if (String(item.produtoEmpresaId ?? "") !== params.empresaIdAtiva) {
      pendencias.push({
        codigo: "produto_empresa",
        mensagem: `Produto ${item.descricao} não pertence à empresa ativa.`,
      });
    }
    if (
      item.grupoFiscalId &&
      String(item.grupoFiscalEmpresaId ?? "") !== params.empresaIdAtiva
    ) {
      pendencias.push({
        codigo: "grupo_empresa",
        mensagem: `Grupo fiscal de ${item.descricao} não pertence à empresa ativa.`,
      });
    }
    if (item.quantidade <= 0) {
      pendencias.push({
        codigo: "quantidade",
        mensagem: `Quantidade inválida em ${item.descricao}.`,
      });
    }
    if (item.valorUnitario < 0) {
      pendencias.push({
        codigo: "valor",
        mensagem: `Valor unitário inválido em ${item.descricao}.`,
      });
    }
    if (item.valorUnitario === 0) {
      alertas.push(
        `${item.descricao}: valor unitário zero. Confirme se este é o valor fiscal desejado.`
      );
    }
    if (!/^\d{8}$/.test(String(item.ncm ?? "").replace(/\D/g, ""))) {
      pendencias.push({
        codigo: "ncm",
        mensagem: `NCM de ${item.descricao} incompleto.`,
      });
    }
    if (!String(item.icmsCstCsosn ?? "").trim()) {
      pendencias.push({
        codigo: "icms",
        mensagem: `Grupo fiscal de ${item.descricao} sem CST/CSOSN configurado.`,
      });
    }

    let cfop: string | null = null;
    if (params.natureza && tipoDestino && item.grupoFiscalId) {
      const resolvido = resolverCfopEfetivo({
        tipoOperacaoInterno: params.tipoOperacaoInterno,
        tipoDestino,
        naturezaId: params.natureza.id,
        grupoFiscalId: item.grupoFiscalId,
        empresaIdAtiva: params.empresaIdAtiva,
        naturezaPadrao: params.natureza.padrao,
        naturezaDescricao: params.natureza.descricao,
        grupoFiscal: {
          nome: item.grupoFiscalNome,
          cfopInterno: item.cfopInterno,
          cfopInterestadual: item.cfopInterestadual,
        },
        regras: params.regrasCfop,
      });
      if (resolvido.ok) {
        cfop = resolvido.cfop;
      } else {
        pendencias.push({ codigo: "cfop", mensagem: resolvido.mensagem });
      }
    }
    return { ...item, cfop };
  });

  const pendenciasIpi = pendenciasIpiDocumento({
    modelo: "55",
    perfilIpi: params.perfilIpi,
    grupos: (params.gruposIpi ?? []).map((grupo) => ({
      nome: grupo.nome,
      ...camposIpiDoGrupo(grupo),
    })),
  });
  for (const mensagem of pendenciasIpi) {
    pendencias.push({ codigo: "ipi", mensagem });
  }

  void params.codigoRegimeTributario;
  void params.ambiente;

  return {
    ok: pendencias.length === 0,
    pendencias,
    alertas,
    tipoDestino,
    itens,
  };
}
