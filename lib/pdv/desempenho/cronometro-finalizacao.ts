export const PREFIXO_LOG_DESEMPENHO_PDV = "[pdv] desempenho";

export const CLASSES_TEMPO_FINALIZACAO = [
  "operador",
  "tef",
  "pix",
  "supabase",
  "nfce",
  "impressao",
  "interface",
] as const;

export type ClasseTempoFinalizacao = (typeof CLASSES_TEMPO_FINALIZACAO)[number];

export const ETAPAS_FINALIZACAO = [
  "interacao_operador",
  "validacao_frontend",
  "conector_descoberta",
  "tef_status",
  "tef_inicializar",
  "tef_identidade",
  "tef_iniciar",
  "tef_pagamento",
  "tef_resultado",
  "tef_liberar_confirmacao",
  "tef_confirmar_conector",
  "tef_registrar_confirmacao",
  "tef_desfazimento",
  "persistencia_venda",
  "supabase_cliente",
  "supabase_autenticacao",
  "supabase_vinculo",
  "supabase_permissao",
  "supabase_formas",
  "supabase_pedido",
  "supabase_teto",
  "supabase_pix",
  "supabase_tef",
  "supabase_reserva_tef",
  "supabase_dados_fiscais_tef",
  "supabase_estoque",
  "supabase_caixa",
  "supabase_cliente_documento",
  "supabase_rpc_finalizar",
  "supabase_snapshot",
  "supabase_vinculo_pedido",
  "supabase_vinculo_tef",
  "revalidar_caixa",
  "gaveta",
  "atualizacao_visual",
  "nfce_emissao",
  "nfce_autenticacao",
  "nfce_carga_venda",
  "nfce_pagamentos_tef",
  "nfce_ambiente_tef",
  "nfce_produtos",
  "nfce_idempotencia",
  "nfce_snapshot_itens",
  "nfce_reserva",
  "nfce_logomarca",
  "nfce_montar_payload",
  "nfce_claim",
  "nfce_geranet",
  "nfce_persistir_retorno",
  "impressao_baixar_pdf",
  "impressao_conector",
  "pix_autorizacao",
  "pdv_liberado",
] as const;

export type EtapaFinalizacao = (typeof ETAPAS_FINALIZACAO)[number];

export const RPCS_FINALIZACAO = [
  "rpc_finalizar_venda",
  "rpc_finalizar_venda_com_caixa",
] as const;

export type RpcFinalizacaoMedida = (typeof RPCS_FINALIZACAO)[number];

const CHAVES_EVENTO = [
  "tipo",
  "correlacao",
  "etapa",
  "classe",
  "papel",
  "duracaoMs",
  "ok",
  "vendaId",
  "quantidade",
  "rpc",
  "totalMs",
  "pdvLiberadoMs",
  "porClasse",
] as const;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ExtraMedicao = {
  quantidade?: number;
  rpc?: RpcFinalizacaoMedida;
};

export type EventoEtapaFinalizacao = {
  tipo: "etapa";
  correlacao: string;
  etapa: EtapaFinalizacao;
  classe: ClasseTempoFinalizacao;
  papel: "parte" | "total";
  duracaoMs: number;
  ok: boolean;
  vendaId?: string;
  quantidade?: number;
  rpc?: RpcFinalizacaoMedida;
};

export type ResumoFinalizacao = {
  tipo: "resumo";
  correlacao: string;
  ok: boolean;
  totalMs: number;
  porClasse: Record<ClasseTempoFinalizacao, number>;
  vendaId?: string;
  pdvLiberadoMs?: number;
};

export type MedidorFinalizacao = {
  medir<T>(
    etapa: EtapaFinalizacao,
    classe: ClasseTempoFinalizacao,
    trabalho: () => T | PromiseLike<T>,
    extra?: ExtraMedicao
  ): Promise<Awaited<T>>;
};

type EmissorDesempenho = (evento: EventoEtapaFinalizacao | ResumoFinalizacao) => void;

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

export function lerCorrelacaoFinalizacao(valor: unknown): string | null {
  const correlacao = texto(valor);
  return UUID.test(correlacao) ? correlacao : null;
}

function etapaValida(valor: unknown): EtapaFinalizacao | null {
  return ETAPAS_FINALIZACAO.includes(valor as EtapaFinalizacao)
    ? (valor as EtapaFinalizacao)
    : null;
}

function classeValida(valor: unknown): ClasseTempoFinalizacao | null {
  return CLASSES_TEMPO_FINALIZACAO.includes(valor as ClasseTempoFinalizacao)
    ? (valor as ClasseTempoFinalizacao)
    : null;
}

function duracaoValida(valor: unknown) {
  const numero = typeof valor === "number" ? valor : Number.NaN;
  if (!Number.isFinite(numero) || numero < 0 || numero > 30 * 60 * 1000) {
    return null;
  }
  return Math.round(numero);
}

function quantidadeValida(valor: unknown) {
  return typeof valor === "number" &&
    Number.isInteger(valor) &&
    valor >= 0 &&
    valor <= 100
    ? valor
    : null;
}

function rpcValida(valor: unknown): RpcFinalizacaoMedida | null {
  return RPCS_FINALIZACAO.includes(valor as RpcFinalizacaoMedida)
    ? (valor as RpcFinalizacaoMedida)
    : null;
}

export function montarEventoDesempenho(
  bruto: Record<string, unknown>
): EventoEtapaFinalizacao | ResumoFinalizacao | null {
  const correlacao = lerCorrelacaoFinalizacao(bruto.correlacao);
  const tipo = bruto.tipo === "resumo" ? "resumo" : bruto.tipo === "etapa" ? "etapa" : null;
  if (!correlacao || !tipo) {
    return null;
  }

  const vendaInformada = bruto.vendaId == null ? undefined : lerCorrelacaoFinalizacao(bruto.vendaId);
  if (bruto.vendaId != null && !vendaInformada) {
    return null;
  }

  if (tipo === "resumo") {
    const totalMs = duracaoValida(bruto.totalMs);
    const ok = bruto.ok === true || bruto.ok === false ? bruto.ok : null;
    if (totalMs == null || ok == null || !bruto.porClasse || typeof bruto.porClasse !== "object") {
      return null;
    }
    const porClasse = classesZeradas();
    for (const classe of CLASSES_TEMPO_FINALIZACAO) {
      const duracao = duracaoValida(
        (bruto.porClasse as Record<string, unknown>)[classe]
      );
      if (duracao == null) {
        return null;
      }
      porClasse[classe] = duracao;
    }
    const pdvLiberadoMs =
      bruto.pdvLiberadoMs == null ? undefined : duracaoValida(bruto.pdvLiberadoMs);
    if (bruto.pdvLiberadoMs != null && pdvLiberadoMs == null) {
      return null;
    }
    return {
      tipo,
      correlacao,
      ok,
      totalMs,
      porClasse,
      ...(vendaInformada ? { vendaId: vendaInformada } : {}),
      ...(pdvLiberadoMs != null ? { pdvLiberadoMs } : {}),
    };
  }

  const etapa = etapaValida(bruto.etapa);
  const classe = classeValida(bruto.classe);
  const duracaoMs = duracaoValida(bruto.duracaoMs);
  const papel = bruto.papel === "total" ? "total" : bruto.papel === "parte" ? "parte" : null;
  const ok = bruto.ok === true || bruto.ok === false ? bruto.ok : null;
  if (!etapa || !classe || duracaoMs == null || !papel || ok == null) {
    return null;
  }
  const quantidade =
    bruto.quantidade == null ? undefined : quantidadeValida(bruto.quantidade);
  if (bruto.quantidade != null && quantidade == null) {
    return null;
  }
  const rpc = bruto.rpc == null ? undefined : rpcValida(bruto.rpc);
  if (bruto.rpc != null && !rpc) {
    return null;
  }

  return {
    tipo,
    correlacao,
    etapa,
    classe,
    papel,
    duracaoMs,
    ok,
    ...(vendaInformada ? { vendaId: vendaInformada } : {}),
    ...(quantidade != null ? { quantidade } : {}),
    ...(rpc ? { rpc } : {}),
  };
}

function emitirPadrao(evento: EventoEtapaFinalizacao | ResumoFinalizacao) {
  console.info(PREFIXO_LOG_DESEMPENHO_PDV, evento);
}

function classesZeradas(): Record<ClasseTempoFinalizacao, number> {
  return {
    operador: 0,
    tef: 0,
    pix: 0,
    supabase: 0,
    nfce: 0,
    impressao: 0,
    interface: 0,
  };
}

export type CronometroFinalizacao = MedidorFinalizacao & {
  readonly correlacao: string | null;
  readonly ativo: boolean;
  marcar(
    etapa: EtapaFinalizacao,
    classe: ClasseTempoFinalizacao,
    duracaoMs: number,
    ok: boolean,
    extra?: ExtraMedicao & { papel?: "parte" | "total" }
  ): void;
  medirSync<T>(
    etapa: EtapaFinalizacao,
    classe: ClasseTempoFinalizacao,
    trabalho: () => T,
    extra?: ExtraMedicao
  ): T;
  definirVenda(vendaId: string): void;
  publicarResumo(ok: boolean): ResumoFinalizacao | null;
};

export function criarCronometroFinalizacao(
  correlacaoInformada: unknown,
  opcoes?: {
    agora?: () => number;
    emitir?: EmissorDesempenho;
    incluirPdvLiberado?: boolean;
  }
): CronometroFinalizacao {
  const correlacao = lerCorrelacaoFinalizacao(correlacaoInformada);
  const agora = opcoes?.agora ?? (() => performance.now());
  const emitir = opcoes?.emitir ?? emitirPadrao;
  const inicio = agora();
  const eventos: EventoEtapaFinalizacao[] = [];
  let vendaId: string | undefined;

  function registrar(
    etapa: EtapaFinalizacao,
    classe: ClasseTempoFinalizacao,
    duracaoMs: number,
    ok: boolean,
    extra?: ExtraMedicao & { papel?: "parte" | "total" }
  ) {
    if (!correlacao) {
      return;
    }
    const evento = montarEventoDesempenho({
      tipo: "etapa",
      correlacao,
      etapa,
      classe,
      papel: extra?.papel ?? "parte",
      duracaoMs,
      ok,
      vendaId,
      quantidade: extra?.quantidade,
      rpc: extra?.rpc,
    });
    if (!evento || evento.tipo !== "etapa") {
      return;
    }
    eventos.push(evento);
    emitir(evento);
  }

  const inerte: CronometroFinalizacao = {
    correlacao,
    ativo: Boolean(correlacao),
    marcar(etapa, classe, duracaoMs, ok, extra) {
      registrar(etapa, classe, duracaoMs, ok, extra);
    },
    async medir<T>(
      etapa: EtapaFinalizacao,
      classe: ClasseTempoFinalizacao,
      trabalho: () => T | PromiseLike<T>,
      extra?: ExtraMedicao
    ): Promise<Awaited<T>> {
      if (!correlacao) {
        return await trabalho();
      }
      const marco = agora();
      try {
        const valor = await trabalho();
        registrar(etapa, classe, agora() - marco, true, extra);
        return valor;
      } catch (error) {
        registrar(etapa, classe, agora() - marco, false, extra);
        throw error;
      }
    },
    medirSync(etapa, classe, trabalho, extra) {
      if (!correlacao) {
        return trabalho();
      }
      const marco = agora();
      try {
        const valor = trabalho();
        registrar(etapa, classe, agora() - marco, true, extra);
        return valor;
      } catch (error) {
        registrar(etapa, classe, agora() - marco, false, extra);
        throw error;
      }
    },
    definirVenda(informada) {
      const valida = lerCorrelacaoFinalizacao(informada);
      if (valida) {
        vendaId = valida;
      }
    },
    publicarResumo(ok) {
      if (!correlacao) {
        return null;
      }
      const totalMs = duracaoValida(agora() - inicio) ?? 0;
      if (opcoes?.incluirPdvLiberado) {
        registrar("pdv_liberado", "interface", totalMs, ok, { papel: "total" });
      }
      const porClasse = classesZeradas();
      for (const evento of eventos) {
        if (evento.papel === "total") {
          continue;
        }
        porClasse[evento.classe] += evento.duracaoMs;
      }
      const resumo = montarEventoDesempenho({
        tipo: "resumo",
        correlacao,
        ok,
        totalMs,
        porClasse,
        vendaId,
        pdvLiberadoMs: opcoes?.incluirPdvLiberado ? totalMs : undefined,
      });
      if (!resumo || resumo.tipo !== "resumo") {
        return null;
      }
      emitir(resumo);
      return resumo;
    },
  };

  return inerte;
}

export function chavesPublicadasDesempenho(
  evento: EventoEtapaFinalizacao | ResumoFinalizacao
) {
  return Object.keys(evento).filter((chave) =>
    CHAVES_EVENTO.includes(chave as (typeof CHAVES_EVENTO)[number])
  );
}
