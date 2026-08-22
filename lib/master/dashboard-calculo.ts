export type EmpresaDashboardEntrada = {
  id: string;
  nome: string;
  cadastro: string;
};

export type AssinaturaDashboardEntrada = {
  empresaId: string;
  planoId: string | null;
  planoNome: string | null;
  status: string;
  vencimentoEm: string | null;
  valorMensalContratado: number | null;
  valorCatalogo: number | null;
};

export type DistribuicaoPlano = {
  planoId: string | null;
  nome: string;
  quantidade: number;
  percentual: number;
};

export type PontoCrescimento = {
  chave: string;
  rotulo: string;
  valor: number;
};

export type AlertaEmpresa = {
  empresaId: string;
  nome: string;
  motivo: string;
  status: string;
  prioridade: number;
};

export type DashboardMasterCalculado = {
  empresas: number;
  ativas: number;
  trial: number;
  suspensas: number;
  carencia: number;
  canceladas: number;
  semAssinatura: number;
  assinaturasAtivas: number;
  mrrContratado: number;
  novasNoMes: number;
  novasMesAnterior: number;
  deltaNovas: number;
  planoLider: { planoId: string | null; nome: string; quantidade: number } | null;
  distribuicao: DistribuicaoPlano[];
  crescimento: PontoCrescimento[];
  atencao: AlertaEmpresa[];
  recentes: Array<{
    id: string;
    nome: string;
    plano: string;
    status: string;
    rotuloStatus: string;
    cadastro: string;
  }>;
};

function numeroOuNulo(valor: unknown) {
  if (valor == null || valor === "") {
    return null;
  }
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function partesSaoPaulo(data: Date) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(data);
  return {
    ano: Number(partes.find((item) => item.type === "year")?.value ?? "1970"),
    mes: Number(partes.find((item) => item.type === "month")?.value ?? "1"),
    dia: Number(partes.find((item) => item.type === "day")?.value ?? "1"),
  };
}

function calendarioDeValor(valor: string | Date) {
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : partesSaoPaulo(valor);
  }
  const texto = String(valor).trim();
  const dia = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dia) {
    return {
      ano: Number(dia[1]),
      mes: Number(dia[2]),
      dia: Number(dia[3]),
    };
  }
  const data = new Date(texto);
  return Number.isNaN(data.getTime()) ? null : partesSaoPaulo(data);
}

export function diasCalendarioAte(
  alvo: string | Date | null | undefined,
  agora: Date
) {
  if (!alvo) {
    return null;
  }
  const fim = calendarioDeValor(alvo);
  const hoje = partesSaoPaulo(agora);
  if (!fim) {
    return null;
  }
  const utcFim = Date.UTC(fim.ano, fim.mes - 1, fim.dia);
  const utcHoje = Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia);
  return Math.round((utcFim - utcHoje) / 86_400_000);
}

export function rotuloTrialRestante(dias: number) {
  if (dias < 0) {
    return "Teste encerrado";
  }
  if (dias === 0) {
    return "Teste termina hoje";
  }
  if (dias === 1) {
    return "Teste termina amanhã";
  }
  return `Teste termina em ${dias} dias`;
}

export function valorMrrAssinatura(entrada: {
  status: string;
  valorMensalContratado: number | null;
  valorCatalogo?: number | null;
}) {
  const status = String(entrada.status ?? "");
  const contratado = numeroOuNulo(entrada.valorMensalContratado);

  if (status === "trial") {
    if (contratado == null || contratado <= 0) {
      return 0;
    }
    return contratado;
  }

  if (status !== "ativa") {
    return 0;
  }

  if (contratado != null) {
    return Math.max(0, contratado);
  }

  return Math.max(0, numeroOuNulo(entrada.valorCatalogo) ?? 0);
}

export function somarMrrContratado(assinaturas: AssinaturaDashboardEntrada[]) {
  return assinaturas.reduce(
    (total, item) =>
      total +
      valorMrrAssinatura({
        status: item.status,
        valorMensalContratado: item.valorMensalContratado,
        valorCatalogo: item.valorCatalogo,
      }),
    0
  );
}

function rotuloStatusLista(status: string | null) {
  if (!status) {
    return "Sem assinatura";
  }
  const mapa: Record<string, string> = {
    trial: "Em teste",
    ativa: "Ativa",
    carencia: "Carência",
    suspensa: "Suspensa",
    cancelada: "Cancelada",
  };
  return mapa[status] ?? status;
}

function mesAnterior(ano: number, mes: number) {
  if (mes === 1) {
    return { ano: ano - 1, mes: 12 };
  }
  return { ano, mes: mes - 1 };
}

function chaveMes(ano: number, mes: number) {
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

function rotuloMesCurto(ano: number, mes: number) {
  const rotulo = new Intl.DateTimeFormat("pt-BR", {
    month: "short",
    timeZone: "UTC",
  })
    .format(new Date(Date.UTC(ano, mes - 1, 1)))
    .replace(".", "");
  return rotulo.charAt(0).toUpperCase() + rotulo.slice(1);
}

export function crescimentoMensal(
  empresas: EmpresaDashboardEntrada[],
  agora: Date,
  meses: 6 | 12
): PontoCrescimento[] {
  const atual = partesSaoPaulo(agora);
  const pontos: PontoCrescimento[] = [];
  let ano = atual.ano;
  let mes = atual.mes;

  for (let i = 0; i < meses; i += 1) {
    pontos.unshift({
      chave: chaveMes(ano, mes),
      rotulo: rotuloMesCurto(ano, mes),
      valor: 0,
    });
    const anterior = mesAnterior(ano, mes);
    ano = anterior.ano;
    mes = anterior.mes;
  }

  const indice = new Map(pontos.map((item, i) => [item.chave, i]));
  for (const empresa of empresas) {
    const cal = calendarioDeValor(empresa.cadastro);
    if (!cal) {
      continue;
    }
    const chave = chaveMes(cal.ano, cal.mes);
    const posicao = indice.get(chave);
    if (posicao == null) {
      continue;
    }
    pontos[posicao] = {
      ...pontos[posicao],
      valor: pontos[posicao].valor + 1,
    };
  }

  return pontos;
}

export function novasEmpresasNoMes(
  empresas: EmpresaDashboardEntrada[],
  agora: Date
) {
  const atual = partesSaoPaulo(agora);
  const anterior = mesAnterior(atual.ano, atual.mes);
  const chaveAtual = chaveMes(atual.ano, atual.mes);
  const chaveAnterior = chaveMes(anterior.ano, anterior.mes);
  let noMes = 0;
  let noAnterior = 0;

  for (const empresa of empresas) {
    const cal = calendarioDeValor(empresa.cadastro);
    if (!cal) {
      continue;
    }
    const chave = chaveMes(cal.ano, cal.mes);
    if (chave === chaveAtual) {
      noMes += 1;
    } else if (chave === chaveAnterior) {
      noAnterior += 1;
    }
  }

  return {
    noMes,
    noAnterior,
    delta: noMes - noAnterior,
  };
}

export function distribuicaoPorPlano(
  empresas: EmpresaDashboardEntrada[],
  assinaturas: AssinaturaDashboardEntrada[]
): DistribuicaoPlano[] {
  const porEmpresa = new Map(assinaturas.map((item) => [item.empresaId, item]));
  const contagem = new Map<
    string,
    { planoId: string | null; nome: string; quantidade: number }
  >();

  for (const empresa of empresas) {
    const assinatura = porEmpresa.get(empresa.id);
    const planoId = assinatura?.planoId ?? null;
    const nome =
      planoId && assinatura?.planoNome ? assinatura.planoNome : "Sem assinatura";
    const chave = planoId ?? "sem-assinatura";
    const atual = contagem.get(chave) ?? {
      planoId,
      nome,
      quantidade: 0,
    };
    atual.quantidade += 1;
    contagem.set(chave, atual);
  }

  const total = empresas.length;
  const linhas = [...contagem.values()].sort((a, b) => {
    if (a.nome === "Sem assinatura") {
      return 1;
    }
    if (b.nome === "Sem assinatura") {
      return -1;
    }
    return b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, "pt-BR");
  });

  return linhas.map((item) => ({
    ...item,
    percentual: total > 0 ? Math.round((item.quantidade / total) * 100) : 0,
  }));
}

export function planoMaisUtilizado(distribuicao: DistribuicaoPlano[]) {
  const comPlano = distribuicao.filter((item) => item.planoId);
  if (comPlano.length === 0) {
    return null;
  }
  return comPlano.reduce((melhor, item) =>
    item.quantidade > melhor.quantidade ? item : melhor
  );
}

export function empresasQuePrecisamAtencao(
  empresas: EmpresaDashboardEntrada[],
  assinaturas: AssinaturaDashboardEntrada[],
  agora: Date,
  limite = 8
): AlertaEmpresa[] {
  const porEmpresa = new Map(assinaturas.map((item) => [item.empresaId, item]));
  const alertas: AlertaEmpresa[] = [];

  for (const empresa of empresas) {
    const assinatura = porEmpresa.get(empresa.id);
    if (!assinatura) {
      alertas.push({
        empresaId: empresa.id,
        nome: empresa.nome,
        motivo: "Sem assinatura",
        status: "sem_assinatura",
        prioridade: 40,
      });
      continue;
    }

    if (assinatura.status === "suspensa") {
      alertas.push({
        empresaId: empresa.id,
        nome: empresa.nome,
        motivo: "Assinatura suspensa",
        status: "suspensa",
        prioridade: 10,
      });
      continue;
    }

    if (assinatura.status === "trial") {
      const dias = diasCalendarioAte(assinatura.vencimentoEm, agora);
      if (dias == null) {
        continue;
      }
      if (dias < 0) {
        alertas.push({
          empresaId: empresa.id,
          nome: empresa.nome,
          motivo: rotuloTrialRestante(dias),
          status: "trial",
          prioridade: 20,
        });
        continue;
      }
      if (dias <= 7) {
        alertas.push({
          empresaId: empresa.id,
          nome: empresa.nome,
          motivo: rotuloTrialRestante(dias),
          status: "trial",
          prioridade: 30 + dias,
        });
      }
      continue;
    }

    if (assinatura.status === "ativa") {
      const dias = diasCalendarioAte(assinatura.vencimentoEm, agora);
      if (dias != null && dias < 0) {
        alertas.push({
          empresaId: empresa.id,
          nome: empresa.nome,
          motivo: "Assinatura vencida",
          status: "ativa",
          prioridade: 20,
        });
      }
    }
  }

  return alertas
    .sort((a, b) => a.prioridade - b.prioridade || a.nome.localeCompare(b.nome, "pt-BR"))
    .slice(0, limite);
}

export function montarDashboardMaster({
  empresas,
  assinaturas,
  agora = new Date(),
  meses = 6,
}: {
  empresas: EmpresaDashboardEntrada[];
  assinaturas: AssinaturaDashboardEntrada[];
  agora?: Date;
  meses?: 6 | 12;
}): DashboardMasterCalculado {
  const porEmpresa = new Map(assinaturas.map((item) => [item.empresaId, item]));
  const contar = (status: string) =>
    assinaturas.filter((item) => item.status === status).length;
  const novas = novasEmpresasNoMes(empresas, agora);
  const distribuicao = distribuicaoPorPlano(empresas, assinaturas);
  const lider = planoMaisUtilizado(distribuicao);

  const recentes = [...empresas]
    .sort((a, b) => String(b.cadastro).localeCompare(String(a.cadastro)))
    .slice(0, 5)
    .map((empresa) => {
      const assinatura = porEmpresa.get(empresa.id);
      return {
        id: empresa.id,
        nome: empresa.nome,
        plano: assinatura?.planoNome || "—",
        status: assinatura?.status || "",
        rotuloStatus: rotuloStatusLista(assinatura?.status ?? null),
        cadastro: empresa.cadastro,
      };
    });

  return {
    empresas: empresas.length,
    ativas: contar("ativa"),
    trial: contar("trial"),
    suspensas: contar("suspensa"),
    carencia: contar("carencia"),
    canceladas: contar("cancelada"),
    semAssinatura: Math.max(0, empresas.length - assinaturas.length),
    assinaturasAtivas: contar("ativa"),
    mrrContratado: somarMrrContratado(assinaturas),
    novasNoMes: novas.noMes,
    novasMesAnterior: novas.noAnterior,
    deltaNovas: novas.delta,
    planoLider: lider
      ? {
          planoId: lider.planoId,
          nome: lider.nome,
          quantidade: lider.quantidade,
        }
      : null,
    distribuicao,
    crescimento: crescimentoMensal(empresas, agora, meses),
    atencao: empresasQuePrecisamAtencao(empresas, assinaturas, agora),
    recentes,
  };
}

export type EventoDashboardMaster = {
  id: string;
  quando: string;
  tipo: string;
  rotulo: string;
  empresaId: string | null;
  empresaNome: string;
  detalhe: string;
  administrador: string;
};

export type DashboardMasterPainelDados = DashboardMasterCalculado & {
  meses: 6 | 12;
  atividade: EventoDashboardMaster[];
};

export function mesesDashboard(valor: string | null | undefined): 6 | 12 {
  return valor === "12" ? 12 : 6;
}
