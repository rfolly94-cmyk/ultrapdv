import {
  classificarFormaCaixa,
  movimentoAfetaSaldoFisico,
  valorLiquidoMovimento,
} from "./formas";
import { totaisDoLivro } from "./saldo";
import type {
  CaixaMovimento,
  CaixaTotais,
  ConferenciaCaixa,
  MeioConferenciaCaixa,
  StatusDiferencaCaixa,
} from "./tipos";
import type { PermissoesEfetivas } from "@/lib/permissoes/tipos";
import { temPermissao } from "@/lib/permissoes/tem-permissao";

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function round2(valor: number) {
  return Math.round(valor * 100) / 100;
}

export function diferencaFechamentoCaixa(
  valorInformado: number,
  valorEsperado: number
) {
  return round2(valorInformado - valorEsperado);
}

export function statusDiferencaCaixa(diferenca: number): StatusDiferencaCaixa {
  if (diferenca === 0) {
    return "conferido";
  }
  return diferenca < 0 ? "falta" : "sobra";
}

export function rotuloStatusDiferencaCaixa(status: StatusDiferencaCaixa) {
  if (status === "falta") {
    return "Falta";
  }
  if (status === "sobra") {
    return "Sobra";
  }
  return "Conferido";
}

export function chaveMeioConferencia(meio: {
  forma_pagamento_id?: string | null;
  forma_nome?: string | null;
  forma_tipo?: string | null;
  forma_codigo?: string | null;
  afeta_caixa_fisico?: boolean | null;
}) {
  const formaId = texto(meio.forma_pagamento_id);
  if (formaId) {
    return formaId;
  }
  return [
    "",
    texto(meio.forma_nome),
    texto(meio.forma_tipo),
    texto(meio.forma_codigo),
    meio.afeta_caixa_fisico === true ? "1" : "0",
  ].join("|");
}

function afetaFisicoMovimento(movimento: {
  tipo?: string | null;
  afeta_caixa_fisico_snapshot?: boolean | null;
}) {
  const tipo = String(movimento.tipo ?? "");
  if (tipo === "abertura" || tipo === "suprimento" || tipo === "sangria") {
    return true;
  }
  return movimento.afeta_caixa_fisico_snapshot === true;
}

function ordemClasse(meio: MeioConferenciaCaixa) {
  if (meio.afeta_caixa_fisico) {
    return 0;
  }
  const classe = classificarFormaCaixa({
    tipo: meio.forma_tipo,
    codigo: meio.forma_codigo,
    nome: meio.forma_nome,
  });
  if (classe === "pix") {
    return 1;
  }
  if (classe === "debito") {
    return 2;
  }
  if (classe === "credito") {
    return 3;
  }
  return 4;
}

export function meiosEsperadosDoLivro(
  movimentos: Array<{
    tipo?: string | null;
    forma_pagamento_id?: string | null;
    forma_nome?: string | null;
    forma_tipo?: string | null;
    forma_codigo?: string | null;
    afeta_caixa_fisico_snapshot?: boolean | null;
    entrada?: number | string | null;
    saida?: number | string | null;
  }>
): MeioConferenciaCaixa[] {
  const grupos = new Map<
    string,
    {
      forma_pagamento_id: string | null;
      forma_nome: string;
      forma_tipo: string | null;
      forma_codigo: string | null;
      afeta_caixa_fisico: boolean;
      valor_esperado: number;
    }
  >();

  for (const movimento of movimentos) {
    const afeta = afetaFisicoMovimento(movimento);
    const formaId = texto(movimento.forma_pagamento_id) || null;
    const chave = chaveMeioConferencia({
      forma_pagamento_id: formaId,
      forma_nome: movimento.forma_nome,
      forma_tipo: movimento.forma_tipo,
      forma_codigo: movimento.forma_codigo,
      afeta_caixa_fisico: afeta,
    });
    const atual = grupos.get(chave);
    const nome = texto(movimento.forma_nome);
    const liquido = valorLiquidoMovimento(movimento);
    if (!atual) {
      grupos.set(chave, {
        forma_pagamento_id: formaId,
        forma_nome: nome || (afeta ? "Dinheiro" : "Sem forma"),
        forma_tipo: texto(movimento.forma_tipo) || null,
        forma_codigo: texto(movimento.forma_codigo) || null,
        afeta_caixa_fisico: afeta,
        valor_esperado: liquido,
      });
      continue;
    }
    atual.valor_esperado = round2(atual.valor_esperado + liquido);
    atual.afeta_caixa_fisico = atual.afeta_caixa_fisico || afeta;
    if (!atual.forma_nome && nome) {
      atual.forma_nome = nome;
    }
    if (!atual.forma_tipo && movimento.forma_tipo) {
      atual.forma_tipo = texto(movimento.forma_tipo);
    }
    if (!atual.forma_codigo && movimento.forma_codigo) {
      atual.forma_codigo = texto(movimento.forma_codigo);
    }
  }

  return [...grupos.entries()]
    .map(([chave, grupo]) => ({
      chave,
      forma_pagamento_id: grupo.forma_pagamento_id,
      forma_nome: grupo.forma_nome || "Sem forma",
      forma_tipo: grupo.forma_tipo,
      forma_codigo: grupo.forma_codigo,
      afeta_caixa_fisico: grupo.afeta_caixa_fisico,
      valor_esperado: round2(grupo.valor_esperado),
    }))
    .sort((a, b) => {
      const ordem = ordemClasse(a) - ordemClasse(b);
      if (ordem !== 0) {
        return ordem;
      }
      return a.forma_nome.localeCompare(b.forma_nome, "pt-BR");
    });
}

export function conferirMeios(input: {
  esperados: MeioConferenciaCaixa[];
  informados: Array<{ chave: string; valor_informado: number }>;
}) {
  const mapa = new Map(
    input.informados.map((item) => [item.chave, round2(item.valor_informado)])
  );
  return input.esperados.map((meio) => {
    const informado = mapa.get(meio.chave);
    const valorInformado = informado == null ? 0 : informado;
    const esperado = round2(Number(meio.valor_esperado ?? 0));
    const diferenca = diferencaFechamentoCaixa(valorInformado, esperado);
    return {
      ...meio,
      valor_esperado: esperado,
      valor_informado: valorInformado,
      diferenca,
      status: statusDiferencaCaixa(diferenca),
    };
  });
}

export function dinheiroFisicoDaConferencia(
  meios: Array<{
    afeta_caixa_fisico?: boolean | null;
    valor_esperado?: number | null;
    valor_informado?: number | null;
  }>
) {
  let esperado = 0;
  let informado = 0;
  for (const meio of meios) {
    if (meio.afeta_caixa_fisico !== true) {
      continue;
    }
    esperado += Number(meio.valor_esperado ?? 0);
    informado += Number(meio.valor_informado ?? 0);
  }
  return {
    esperado: round2(esperado),
    informado: round2(informado),
    diferenca: diferencaFechamentoCaixa(informado, esperado),
  };
}

export function podeRevelarEsperadoCaixaCego(
  permissoes: PermissoesEfetivas | null | undefined
) {
  return temPermissao(permissoes, "configuracoes", "editar_empresa");
}

export function deveOcultarEsperadoCaixaAberto(input: {
  fechamentoCego: boolean;
  caixaAberto: boolean;
  podeRevelarEsperado: boolean;
}) {
  return (
    input.fechamentoCego &&
    input.caixaAberto &&
    !input.podeRevelarEsperado
  );
}

export function sanitizarTotaisCaixaAbertoCego(totais: CaixaTotais): CaixaTotais {
  return {
    ...totais,
    saldoAtual: null,
    vendasDinheiro: null,
  };
}

export function sanitizarMovimentosCaixaAbertoCego(
  movimentos: CaixaMovimento[]
): CaixaMovimento[] {
  return movimentos.map((movimento) => {
    if (!movimentoAfetaSaldoFisico(movimento)) {
      return movimento;
    }
    return {
      ...movimento,
      entrada: 0,
      saida: 0,
      valor_liquido: 0,
      valores_ocultos: true,
    };
  });
}

export function sanitizarSessaoCaixaAbertoCego<
  T extends CaixaTotais & { movimentos: CaixaMovimento[]; status?: string },
>(sessao: T): T {
  return {
    ...sessao,
    ...sanitizarTotaisCaixaAbertoCego(sessao),
    movimentos: sanitizarMovimentosCaixaAbertoCego(sessao.movimentos),
  };
}

export function sanitizarConferenciaCega<T extends {
  fechamento_cego?: boolean;
  dinheiro_fisico_esperado?: number;
  meios: MeioConferenciaCaixa[];
}>(conferencia: T): T {
  if (!conferencia.fechamento_cego) {
    return conferencia;
  }

  const resto = { ...conferencia };
  delete resto.dinheiro_fisico_esperado;

  return {
    ...resto,
    fechamento_cego: true,
    meios: conferencia.meios.map((meio) => ({
      chave: meio.chave,
      forma_pagamento_id: meio.forma_pagamento_id,
      forma_nome: meio.forma_nome,
      forma_tipo: meio.forma_tipo,
      forma_codigo: meio.forma_codigo,
      afeta_caixa_fisico: meio.afeta_caixa_fisico,
    })),
  } as T;
}

function numeroJson(valor: unknown) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function textoJson(valor: unknown) {
  const saida = String(valor ?? "").trim();
  return saida || null;
}

export function mapearMeioConferenciaRpc(
  bruto: Record<string, unknown>
): MeioConferenciaCaixa {
  const meio: MeioConferenciaCaixa = {
    chave: String(bruto.chave ?? ""),
    forma_pagamento_id: textoJson(bruto.forma_pagamento_id),
    forma_nome: textoJson(bruto.forma_nome ?? bruto.forma_nome_snapshot) || "Sem forma",
    forma_tipo: textoJson(bruto.forma_tipo ?? bruto.forma_tipo_snapshot),
    forma_codigo: textoJson(bruto.forma_codigo ?? bruto.forma_codigo_snapshot),
    afeta_caixa_fisico:
      bruto.afeta_caixa_fisico === true ||
      bruto.afeta_caixa_fisico_snapshot === true,
  };
  if (bruto.valor_esperado != null) {
    meio.valor_esperado = numeroJson(bruto.valor_esperado);
  }
  if (bruto.valor_informado != null) {
    meio.valor_informado = numeroJson(bruto.valor_informado);
  }
  if (bruto.diferenca != null) {
    meio.diferenca = numeroJson(bruto.diferenca);
  }
  return meio;
}

export function mapearConferenciaCaixa(data: unknown): ConferenciaCaixa | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const bruto = data as Record<string, unknown>;
  const caixaId = String(bruto.caixa_id ?? "");
  const versao = String(bruto.versao_livro ?? "");
  if (!caixaId || !versao) {
    return null;
  }
  const meiosBrutos = Array.isArray(bruto.meios) ? bruto.meios : [];
  const conferencia: ConferenciaCaixa = {
    caixa_id: caixaId,
    numero: Number(bruto.numero) || 0,
    aberto_em: String(bruto.aberto_em ?? ""),
    usuario_abertura_id: String(bruto.usuario_abertura_id ?? ""),
    versao_livro: versao,
    movimentos_qtd: Number(bruto.movimentos_qtd) || 0,
    fechamento_cego: bruto.fechamento_cego === true,
    saldo_inicial: numeroJson(bruto.saldo_inicial),
    vendas_liquidas: numeroJson(bruto.vendas_liquidas),
    recebimentos_carteira: numeroJson(bruto.recebimentos_carteira),
    suprimentos: numeroJson(bruto.suprimentos),
    sangrias: numeroJson(bruto.sangrias),
    estornos: numeroJson(bruto.estornos),
    meios: meiosBrutos
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map(mapearMeioConferenciaRpc),
  };
  if (bruto.dinheiro_fisico_esperado != null) {
    conferencia.dinheiro_fisico_esperado = numeroJson(
      bruto.dinheiro_fisico_esperado
    );
  }
  return conferencia;
}

/**
 * Resposta da action de iniciar fechamento. Com cego, o esperado não segue
 * para o cliente — inclusive se a RPC vazar o campo ou omitir a flag.
 */
export function conferenciaAbertaParaCliente(input: {
  conferencia: ConferenciaCaixa;
  fechamentoCegoEmpresa: boolean;
}): ConferenciaCaixa {
  const cego =
    input.conferencia.fechamento_cego || input.fechamentoCegoEmpresa;
  if (!cego) {
    return input.conferencia;
  }
  return sanitizarConferenciaCega({
    ...input.conferencia,
    fechamento_cego: true,
  });
}

export function conferenciaRevelaEsperado(conferencia: {
  fechamento_cego?: boolean;
  dinheiro_fisico_esperado?: number;
  meios: MeioConferenciaCaixa[];
}) {
  if (conferencia.dinheiro_fisico_esperado != null) {
    return true;
  }
  return conferencia.meios.some(
    (meio) =>
      meio.valor_esperado != null ||
      meio.diferenca != null ||
      meio.status != null
  );
}

export function totaisParaConferencia(movimentos: Parameters<typeof totaisDoLivro>[0]) {
  const totais = totaisDoLivro(movimentos);
  return {
    saldo_inicial: totais.saldoInicial,
    vendas_liquidas: totais.vendasTotal,
    recebimentos_carteira: totais.recebimentosCarteira,
    suprimentos: totais.suprimentos,
    sangrias: totais.sangrias,
    estornos: totais.estornos,
    dinheiro_fisico_esperado: totais.saldoAtual,
  };
}
