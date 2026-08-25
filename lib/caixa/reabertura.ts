import {
  MENSAGEM_MOTIVO_REABERTURA,
  MENSAGEM_REABRIR_COM_ABERTO,
  MENSAGEM_REABRIR_NAO_FECHADO,
  MENSAGEM_REABRIR_ULTIMO_FECHADO,
} from "./mensagens";
import type {
  CaixaAvisoReaberto,
  CaixaCicloFechamento,
  CaixaReabertura,
  StatusCaixa,
} from "./tipos";

export const MOTIVO_REABERTURA_MIN = 8;

export type SessaoReaberturaRef = {
  id: string;
  status: StatusCaixa | string;
  aberto_em: string;
  numero: number;
  filial_id: string | null;
};

export type ResultadoElegibilidadeReabertura =
  | { ok: true }
  | { ok: false; erro: string };

export function validarMotivoReabertura(motivo: unknown): {
  ok: true;
  motivo: string;
} | {
  ok: false;
  erro: string;
} {
  const texto = String(motivo ?? "").trim();
  if (!texto || !/[A-Za-zÀ-ÿ0-9]/.test(texto) || texto.length < MOTIVO_REABERTURA_MIN) {
    return { ok: false, erro: MENSAGEM_MOTIVO_REABERTURA };
  }
  if (texto.length > 500) {
    return {
      ok: false,
      erro: "O motivo da reabertura deve ter no máximo 500 caracteres.",
    };
  }
  return { ok: true, motivo: texto };
}

function mesmaFilial(
  a: string | null | undefined,
  b: string | null | undefined
) {
  const esquerda = a ?? null;
  const direita = b ?? null;
  return esquerda === direita;
}

function sessaoEhPosterior(alvo: SessaoReaberturaRef, outra: SessaoReaberturaRef) {
  if (outra.id === alvo.id) {
    return false;
  }
  if (!mesmaFilial(alvo.filial_id, outra.filial_id)) {
    return false;
  }
  if (outra.aberto_em > alvo.aberto_em) {
    return true;
  }
  return outra.aberto_em === alvo.aberto_em && outra.numero > alvo.numero;
}

export function sessaoPodeSerReaberta(input: {
  alvo: SessaoReaberturaRef;
  sessoesEmpresa: SessaoReaberturaRef[];
}): ResultadoElegibilidadeReabertura {
  if (String(input.alvo.status) !== "fechado") {
    return { ok: false, erro: MENSAGEM_REABRIR_NAO_FECHADO };
  }

  const aberta = input.sessoesEmpresa.find(
    (sessao) =>
      sessao.id !== input.alvo.id &&
      String(sessao.status) === "aberto" &&
      mesmaFilial(sessao.filial_id, input.alvo.filial_id)
  );
  if (aberta) {
    return { ok: false, erro: MENSAGEM_REABRIR_COM_ABERTO };
  }

  const posterior = input.sessoesEmpresa.some((sessao) =>
    sessaoEhPosterior(input.alvo, sessao)
  );
  if (posterior) {
    return { ok: false, erro: MENSAGEM_REABRIR_ULTIMO_FECHADO };
  }

  return { ok: true };
}

export function idCaixaReabrirElegivel(sessoes: SessaoReaberturaRef[]): string | null {
  const aberta = sessoes.find((sessao) => String(sessao.status) === "aberto");
  if (aberta) {
    return null;
  }

  const fechados = sessoes.filter((sessao) => String(sessao.status) === "fechado");
  let candidato: SessaoReaberturaRef | null = null;
  for (const sessao of fechados) {
    if (!candidato) {
      candidato = sessao;
      continue;
    }
    if (
      sessao.aberto_em > candidato.aberto_em ||
      (sessao.aberto_em === candidato.aberto_em && sessao.numero > candidato.numero)
    ) {
      candidato = sessao;
    }
  }
  if (!candidato) {
    return null;
  }
  const resultado = sessaoPodeSerReaberta({
    alvo: candidato,
    sessoesEmpresa: sessoes,
  });
  return resultado.ok ? candidato.id : null;
}

export function avisoCaixaReabertoAtual(input: {
  status?: string | null;
  reaberto?: boolean | null;
  reaberturas?: CaixaReabertura[] | null;
} | null): CaixaAvisoReaberto | null {
  if (!input || String(input.status) !== "aberto" || input.reaberto !== true) {
    return null;
  }
  const lista = input.reaberturas ?? [];
  const ultima = lista[lista.length - 1];
  if (!ultima) {
    return null;
  }
  return {
    reaberto_em: ultima.reaberto_em,
    reaberto_por_nome: ultima.reaberto_por_nome,
    motivo: ultima.motivo,
  };
}

export type EventoHistoricoCaixa =
  | {
      tipo: "fechamento";
      em: string;
      porNome: string | null;
      diferenca: number;
      versao: number;
      dinheiro_contado: number;
      dinheiro_fisico_esperado: number;
    }
  | {
      tipo: "reabertura";
      em: string;
      porNome: string | null;
      motivo: string;
    };

export function montarHistoricoCiclos(input: {
  ciclos: CaixaCicloFechamento[];
  reaberturas: CaixaReabertura[];
}): EventoHistoricoCaixa[] {
  const eventos: Array<EventoHistoricoCaixa & { ordem: number }> = [];

  for (const ciclo of input.ciclos) {
    eventos.push({
      tipo: "fechamento",
      em: ciclo.fechado_em,
      porNome: ciclo.fechado_por_nome,
      diferenca: ciclo.diferenca,
      versao: ciclo.versao,
      dinheiro_contado: ciclo.dinheiro_contado,
      dinheiro_fisico_esperado: ciclo.dinheiro_fisico_esperado,
      ordem: Date.parse(ciclo.fechado_em) || 0,
    });
  }

  for (const reabertura of input.reaberturas) {
    eventos.push({
      tipo: "reabertura",
      em: reabertura.reaberto_em,
      porNome: reabertura.reaberto_por_nome,
      motivo: reabertura.motivo,
      ordem: Date.parse(reabertura.reaberto_em) || 0,
    });
  }

  return eventos
    .sort((a, b) => a.ordem - b.ordem || (a.tipo === "fechamento" ? -1 : 1))
    .map(({ ordem: _ordem, ...evento }) => evento);
}

export function sanitizarCiclosFechamentoCego(
  ciclos: CaixaCicloFechamento[]
): CaixaCicloFechamento[] {
  return ciclos.map((ciclo) => ({
    ...ciclo,
    dinheiro_fisico_esperado: 0,
    diferenca: 0,
    meios: ciclo.meios.map((meio) => ({
      ...meio,
      valor_esperado: 0,
      diferenca: 0,
    })),
  }));
}
