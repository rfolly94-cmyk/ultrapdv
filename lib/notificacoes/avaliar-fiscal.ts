import {
  hrefOrigemEmissaoFiscal,
  rotuloModeloFiscal,
} from "@/lib/fiscal/acoes-emissao";
import { diasAteValidade } from "@/lib/produtos/lotes";

import {
  chaveNotificacao,
  hrefFiscalConfigNotificacao,
  hrefFiscalFallbackNotificacao,
} from "./rotas";
import type { CandidatoNotificacao, ConfiguracaoNotificacoes } from "./tipos";

export type EmissaoFiscalNotificacao = {
  id: string;
  modelo: string | null;
  numero: number | string | null;
  status: string;
  origemTipo: string | null;
  origemId: string | null;
};

export type CertificadoFiscalNotificacao = {
  empresaId: string;
  validade: string | null;
};

export type ImpactoBaseFiscalNotificacao = {
  versaoId: string;
  quantidade: number;
};

export function avaliarFiscalNotificacoes(params: {
  emissoes: EmissaoFiscalNotificacao[];
  certificado: CertificadoFiscalNotificacao | null;
  impactosBase?: ImpactoBaseFiscalNotificacao[];
  config: ConfiguracaoNotificacoes;
  referencia?: Date | string;
}): CandidatoNotificacao[] {
  const candidatos: CandidatoNotificacao[] = [];

  for (const emissao of params.emissoes) {
    const status = String(emissao.status ?? "").trim();
    const modelo = rotuloModeloFiscal(emissao.modelo);
    const numero = String(emissao.numero ?? "").trim();
    const rotulo = numero ? `${modelo} ${numero}` : modelo;
    const destino =
      hrefOrigemEmissaoFiscal(emissao.origemTipo, emissao.origemId) ??
      hrefFiscalFallbackNotificacao();

    if (status === "rejeitada" && params.config.fiscalRejeitada) {
      candidatos.push({
        tipo: "fiscal_rejeitada",
        categoria: "fiscal",
        nivel: "importante",
        titulo: "Nota rejeitada",
        mensagem: `${rotulo} foi rejeitada e precisa de conferência.`,
        entidadeTipo: "fiscal_emissao",
        entidadeId: emissao.id,
        actionUrl: destino,
        chaveDeduplicacao: chaveNotificacao("fiscal_rejeitada", emissao.id),
        metadata: { status, modelo: emissao.modelo },
      });
    }

    if (
      status === "aguardando_reconciliacao" &&
      params.config.fiscalAguardandoReconciliacao
    ) {
      candidatos.push({
        tipo: "fiscal_aguardando_reconciliacao",
        categoria: "fiscal",
        nivel: "atencao",
        titulo: "Aguardando reconciliação",
        mensagem: `${rotulo} está aguardando reconciliação.`,
        entidadeTipo: "fiscal_emissao",
        entidadeId: emissao.id,
        actionUrl: destino,
        chaveDeduplicacao: chaveNotificacao(
          "fiscal_aguardando_reconciliacao",
          emissao.id
        ),
        metadata: { status, modelo: emissao.modelo },
      });
    }
  }

  if (params.config.fiscalCertificadoVencendo && params.certificado?.validade) {
    const dias = diasAteValidade(
      params.certificado.validade,
      params.referencia ?? new Date()
    );
    if (
      dias != null &&
      dias <= params.config.antecedenciaCertificadoDias
    ) {
      const vencido = dias < 0;
      candidatos.push({
        tipo: "fiscal_certificado_vencendo",
        categoria: "fiscal",
        nivel: vencido ? "critico" : "importante",
        titulo: vencido
          ? "Certificado digital vencido"
          : "Certificado próximo do vencimento",
        mensagem: vencido
          ? "O certificado digital da empresa está vencido."
          : `O certificado digital vence em ${dias} dia(s).`,
        entidadeTipo: "empresa",
        entidadeId: params.certificado.empresaId,
        actionUrl: hrefFiscalConfigNotificacao(),
        chaveDeduplicacao: chaveNotificacao(
          "fiscal_certificado_vencendo",
          params.certificado.empresaId
        ),
        metadata: { dias, validade: params.certificado.validade },
      });
    }
  }

  if (params.config.fiscalRevisaoBase) {
    for (const impacto of params.impactosBase ?? []) {
      if (impacto.quantidade <= 0) {
        continue;
      }
      candidatos.push({
        tipo: "fiscal_revisao_base",
        categoria: "fiscal",
        nivel: "atencao",
        titulo: "Revisão fiscal",
        mensagem: `${impacto.quantidade} produto(s) podem precisar de revisão fiscal.`,
        entidadeTipo: "fiscal_base",
        entidadeId: impacto.versaoId,
        actionUrl: "/produtos",
        chaveDeduplicacao: chaveNotificacao(
          "fiscal_revisao_base",
          impacto.versaoId
        ),
        metadata: { quantidade: impacto.quantidade },
      });
    }
  }

  return candidatos;
}
