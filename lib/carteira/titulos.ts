export type StatusTituloCarteira =
  | "ABERTO"
  | "PARCIAL"
  | "QUITADO"
  | "CANCELADO";

export type AbaVendasCarteira = "EM_ABERTO" | "QUITADAS" | "TODAS";

export type TituloParaOrdenacao = {
  id: string;
  status: string;
  created_at: string;
  quitado_em?: string | null;
  numero_venda?: number | string | null;
};

export function normalizarStatusTitulo(status: string): StatusTituloCarteira {
  const valor = String(status ?? "").trim().toUpperCase();
  if (valor === "PARCIAL") {
    return "PARCIAL";
  }
  if (valor === "QUITADO") {
    return "QUITADO";
  }
  if (valor === "CANCELADO" || valor === "CANCELADA") {
    return "CANCELADO";
  }
  return "ABERTO";
}

export function tituloTemSaldo(status: string, valorAberto?: number) {
  const normalizado = normalizarStatusTitulo(status);
  if (normalizado === "CANCELADO" || normalizado === "QUITADO") {
    return false;
  }
  if (typeof valorAberto === "number") {
    return valorAberto > 0;
  }
  return normalizado === "ABERTO" || normalizado === "PARCIAL";
}

export function tituloPassaNaAba(
  status: string,
  aba: AbaVendasCarteira,
  valorAberto?: number
) {
  const normalizado = normalizarStatusTitulo(status);

  if (aba === "EM_ABERTO") {
    return tituloTemSaldo(normalizado, valorAberto);
  }

  if (aba === "QUITADAS") {
    return normalizado === "QUITADO";
  }

  return true;
}

function instante(valor: string | null | undefined) {
  const tempo = Date.parse(String(valor ?? ""));
  return Number.isFinite(tempo) ? tempo : 0;
}

/**
 * Vendas com saldo sempre acima das quitadas.
 * Dentro das quitadas: data/hora da quitação mais recente.
 * Número da venda não é a chave de ordenação.
 */
export function ordenarTitulosCarteira<T extends TituloParaOrdenacao>(
  titulos: T[]
): T[] {
  return [...titulos].sort((a, b) => {
    const statusA = normalizarStatusTitulo(a.status);
    const statusB = normalizarStatusTitulo(b.status);
    const grupoA = grupoOrdenacao(statusA);
    const grupoB = grupoOrdenacao(statusB);

    if (grupoA !== grupoB) {
      return grupoA - grupoB;
    }

    if (statusA === "QUITADO" && statusB === "QUITADO") {
      const quitacao =
        instante(b.quitado_em) - instante(a.quitado_em);
      if (quitacao !== 0) {
        return quitacao;
      }
    }

    const criacao = instante(b.created_at) - instante(a.created_at);
    if (criacao !== 0) {
      return criacao;
    }

    return String(b.id).localeCompare(String(a.id));
  });
}

function grupoOrdenacao(status: StatusTituloCarteira) {
  if (status === "ABERTO" || status === "PARCIAL") {
    return 0;
  }
  if (status === "QUITADO") {
    return 1;
  }
  return 2;
}

export function dataQuitacaoTitulo(input: {
  status: string;
  updated_at?: string | null;
  recebimentosProcessadosEm?: Array<string | null | undefined>;
}) {
  if (normalizarStatusTitulo(input.status) !== "QUITADO") {
    return null;
  }

  const datas = (input.recebimentosProcessadosEm ?? [])
    .map((valor) => String(valor ?? "").trim())
    .filter(Boolean)
    .sort((a, b) => instante(b) - instante(a));

  return datas[0] || input.updated_at || null;
}

export function buscaTituloCarteira(
  query: string,
  titulo: {
    numero_venda?: number | string | null;
    itens?: Array<{
      produto_nome?: string | null;
      produto_codigo?: string | null;
    }>;
  }
) {
  const termo = query.trim().toLowerCase();
  if (!termo) {
    return true;
  }

  const numero = String(titulo.numero_venda ?? "").toLowerCase();
  if (numero.includes(termo)) {
    return true;
  }

  return (titulo.itens ?? []).some((item) => {
    const nome = String(item.produto_nome ?? "").toLowerCase();
    const codigo = String(item.produto_codigo ?? "").toLowerCase();
    return nome.includes(termo) || codigo.includes(termo);
  });
}
