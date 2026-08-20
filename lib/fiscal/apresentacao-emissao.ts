import {
  resolverEstadoOperacionalFiscal,
  type CasoApresentacaoEmissao,
  type AcaoPrincipalEmissaoFiscal,
} from "@/lib/fiscal/estado-operacional-fiscal";

export {
  classificacaoResumoDaEmissao,
} from "@/lib/fiscal/estado-operacional-fiscal";

export type { CasoApresentacaoEmissao };

export type EvidenciaApresentacaoEmissao = {
  modelo?: string | null;
  status?: string | null;
  classificacao?: string | null;
  resposta_resumo?: unknown;
  cstat?: string | null;
  motivo?: string | null;
  protocolo?: string | null;
  chaveAcesso?: string | null;
  geranetHttpStatus?: number | null;
  geranetSituacao?: string | null;
  erroComunicacao?: string | null;
};

export type ApresentacaoEmissaoFiscal = {
  caso: CasoApresentacaoEmissao;
  titulo: string;
  texto: string;
  acaoPrincipal: AcaoPrincipalEmissaoFiscal;
  consultaGeranetSecundaria: boolean;
  podeRetransmitir: boolean;
  bloqueiaRetransmissao: boolean;
};

export function resolverApresentacaoEmissaoFiscal(
  emissao: EvidenciaApresentacaoEmissao
): ApresentacaoEmissaoFiscal {
  const estado = resolverEstadoOperacionalFiscal({
    modelo: emissao.modelo,
    status: emissao.status,
    classificacao: emissao.classificacao,
    resposta_resumo: emissao.resposta_resumo,
    cstat: emissao.cstat,
    motivo: emissao.motivo,
    protocolo: emissao.protocolo,
    chaveAcesso: emissao.chaveAcesso,
    geranetHttpStatus: emissao.geranetHttpStatus,
    geranetSituacao: emissao.geranetSituacao,
    erroComunicacao: emissao.erroComunicacao,
  });

  return {
    caso: estado.caso,
    titulo: estado.titulo,
    texto: estado.descricao,
    acaoPrincipal: estado.acaoPrincipal,
    consultaGeranetSecundaria: estado.consultaGeranetSecundaria,
    podeRetransmitir: estado.podeRetry,
    bloqueiaRetransmissao: estado.bloqueiaRetransmissao,
  };
}
