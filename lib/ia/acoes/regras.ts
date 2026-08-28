import {
  FERRAMENTAS_ESCRITA_IA,
  MENSAGEM_EMPRESA_TROCADA,
  MENSAGEM_PROPOSTA_EXPIRADA,
  MENSAGEM_STALE_ENTIDADE,
  MENSAGEM_STALE_PRODUTO,
  STATUS_PROPOSTA_IA,
  type StatusPropostaIa,
  type TipoAcaoIa,
} from "./tipos";

export function propostaExpirada(expiresAt: string, agora = new Date()) {
  const fim = new Date(expiresAt).getTime();
  if (!Number.isFinite(fim)) {
    return true;
  }
  return agora.getTime() > fim;
}

export function bloquearTrocaEmpresa(propostaEmpresaId: string, empresaAtivaId: string) {
  if (propostaEmpresaId !== empresaAtivaId) {
    return { ok: false as const, erro: MENSAGEM_EMPRESA_TROCADA, codigo: "empresa" };
  }
  return { ok: true as const };
}

export function bloquearUsuario(propostaUsuarioId: string, usuarioAtivoId: string) {
  if (propostaUsuarioId !== usuarioAtivoId) {
    return {
      ok: false as const,
      erro: "Esta proposta pertence a outro usuário.",
      codigo: "usuario",
    };
  }
  return { ok: true as const };
}

export function bloquearStale(params: {
  hashAtual: string;
  hashProposta: string;
  entidadeTipo: string;
}) {
  if (params.hashAtual === params.hashProposta) {
    return { ok: true as const };
  }
  return {
    ok: false as const,
    erro:
      params.entidadeTipo === "produto"
        ? MENSAGEM_STALE_PRODUTO
        : MENSAGEM_STALE_ENTIDADE,
    codigo: "stale",
  };
}

export function podeConfirmarStatus(status: StatusPropostaIa, expiresAt: string, agora = new Date()) {
  if (status === "executada") {
    return { ok: true as const, idempotente: true };
  }
  if (status === "confirmada") {
    return {
      ok: false as const,
      erro: "A confirmação desta proposta já está em andamento.",
      codigo: "em_andamento",
    };
  }
  if (status === "cancelada") {
    return { ok: false as const, erro: "Esta proposta foi cancelada.", codigo: "cancelada" };
  }
  if (status === "falhou") {
    return {
      ok: false as const,
      erro: "Esta proposta falhou. Faça uma nova análise.",
      codigo: "falhou",
    };
  }
  if (status === "expirada" || propostaExpirada(expiresAt, agora)) {
    return { ok: false as const, erro: MENSAGEM_PROPOSTA_EXPIRADA, codigo: "expirada" };
  }
  if (status !== "pendente") {
    return { ok: false as const, erro: "Proposta inválida.", codigo: "status" };
  }
  return { ok: true as const, idempotente: false };
}

export function statusPropostaConhecido(valor: string): valor is StatusPropostaIa {
  return (STATUS_PROPOSTA_IA as readonly string[]).includes(valor);
}

export function ferramentaEscritaAutonoma(nome: string) {
  return (FERRAMENTAS_ESCRITA_IA as readonly string[]).includes(nome);
}

export function tiposDesfaziveis(): TipoAcaoIa[] {
  return [
    "atualizacao_fiscal_produto",
    "atribuicao_grupo_fiscal",
    "atualizacao_basica_produto",
  ];
}

export function podeDesfazerTipo(tipo: TipoAcaoIa) {
  return tiposDesfaziveis().includes(tipo);
}
