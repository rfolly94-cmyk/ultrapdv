import { formatarMoeda } from "@/lib/relatorios/formatacao";
import { ROTULO_CATEGORIA_NOTIFICACAO } from "@/lib/notificacoes/tipos";

import {
  MENSAGEM_IA_FALHA_CONSULTA,
  MENSAGEM_IA_SEM_PERMISSAO,
  type ResultadoFerramentaIa,
} from "../tipos";
import type { IntencaoResolvida, NomeIntencaoDeterministica } from "./tipos";

function num(valor: unknown) {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function texto(valor: unknown) {
  const saida = String(valor ?? "").trim();
  return saida || "";
}

function rotuloPeriodo(periodo: string) {
  const mapa: Record<string, string> = {
    hoje: "Hoje",
    ontem: "Ontem",
    anteontem: "Anteontem",
    "7d": "Nos últimos 7 dias",
    "30d": "Nos últimos 30 dias",
    mes: "Neste mês",
    mes_anterior: "No mês passado",
    semana: "Nesta semana",
    semana_anterior: "Na semana passada",
    ano: "Neste ano",
  };
  return mapa[periodo] ?? periodo;
}

function primeiro<T>(lista: unknown): T | null {
  return Array.isArray(lista) && lista[0] ? (lista[0] as T) : null;
}

export function montarRespostaDeterministica(
  intencao: IntencaoResolvida,
  resultado: ResultadoFerramentaIa
): string {
  if (!resultado.ok) {
    if (resultado.codigo === "sem_permissao") {
      return MENSAGEM_IA_SEM_PERMISSAO;
    }
    return resultado.erro || MENSAGEM_IA_FALHA_CONSULTA;
  }
  const dados = resultado.dados ?? {};
  const fn = TEMPLATES[intencao.nome];
  return fn ? fn(intencao, dados) : MENSAGEM_IA_FALHA_CONSULTA;
}

type Template = (intencao: IntencaoResolvida, dados: Record<string, unknown>) => string;

const TEMPLATES: Record<NomeIntencaoDeterministica, Template> = {
  "vendas.resumo": (_intencao, dados) => {
    const qtd = num(dados.quantidadeVendas);
    const total = num(dados.total);
    const ticket = num(dados.ticketMedio);
    const periodo = texto(dados.periodo) || "hoje";
    if (qtd === 0) {
      return `${rotuloPeriodo(periodo)} ainda não houve vendas válidas.`;
    }
    return `${rotuloPeriodo(periodo)} foram ${qtd} ${qtd === 1 ? "venda" : "vendas"}, totalizando ${formatarMoeda(total)}. Ticket médio: ${formatarMoeda(ticket)}.`;
  },
  "vendas.ticket": (_intencao, dados) => {
    const qtd = num(dados.quantidadeVendas);
    const ticket = num(dados.ticketMedio);
    const periodo = texto(dados.periodo) || "hoje";
    if (qtd === 0) {
      return `${rotuloPeriodo(periodo)} ainda não houve vendas para calcular o ticket médio.`;
    }
    return `${rotuloPeriodo(periodo)} o ticket médio foi ${formatarMoeda(ticket)}, com ${qtd} ${qtd === 1 ? "venda" : "vendas"}.`;
  },
  "vendas.maior": (_intencao, dados) => {
    const maior = dados.maiorVenda as { numero?: unknown; total?: unknown } | null;
    const periodo = texto(dados.periodo) || "hoje";
    if (!maior) {
      return `${rotuloPeriodo(periodo)} não encontrei uma venda destacada.`;
    }
    return `${rotuloPeriodo(periodo)} a maior venda foi a nº ${texto(maior.numero) || "—"}, no valor de ${formatarMoeda(num(maior.total))}.`;
  },
  "vendas.formas": (_intencao, dados) => {
    const formas = Array.isArray(dados.formas)
      ? (dados.formas as Array<{ nome?: unknown; valor?: unknown; operacoes?: unknown }>)
      : [];
    const periodo = texto(dados.periodo) || "hoje";
    if (!formas.length) {
      return `${rotuloPeriodo(periodo)} não há formas de pagamento registradas.`;
    }
    const linhas = formas
      .slice(0, 5)
      .map(
        (item) =>
          `${texto(item.nome) || "Forma"}: ${formatarMoeda(num(item.valor))} (${num(item.operacoes)} ${num(item.operacoes) === 1 ? "operação" : "operações"})`
      );
    return `${rotuloPeriodo(periodo)} as formas de pagamento mais usadas foram:\n${linhas.join("\n")}`;
  },
  "vendas.comparativo": (_intencao, dados) => {
    const atual = (dados.atual ?? {}) as Record<string, unknown>;
    const comparativo = dados.comparativo as Record<string, unknown> | null;
    const periodo = texto(atual.periodo) || "o período";
    const base = `${rotuloPeriodo(periodo)} o faturamento foi ${formatarMoeda(num(atual.total))}, em ${num(atual.quantidadeVendas)} vendas.`;
    if (!comparativo) {
      return base;
    }
    const evolucao = comparativo.evolucaoPercentual;
    const trecho =
      evolucao == null
        ? "Não há base anterior para comparar."
        : `Em relação ao período anterior (${formatarMoeda(num(comparativo.total))}), a variação foi de ${num(evolucao)}%.`;
    return `${base} ${trecho}`;
  },
  "vendas.ranking_produtos": (_intencao, dados) => {
    const ranking = Array.isArray(dados.ranking)
      ? (dados.ranking as Array<{ nome?: unknown; quantidade?: unknown; total?: unknown }>)
      : [];
    const periodo = texto(dados.periodo) || "hoje";
    if (!ranking.length) {
      return `${rotuloPeriodo(periodo)} não há produtos vendidos para montar o ranking.`;
    }
    const topo = ranking[0];
    const extras = ranking
      .slice(1, 5)
      .map((item, index) => `${index + 2}º ${texto(item.nome)} (${formatarMoeda(num(item.total))})`);
    return `${rotuloPeriodo(periodo)} o produto mais vendido foi ${texto(topo.nome)}, com ${num(topo.quantidade)} unidades e ${formatarMoeda(num(topo.total))}.${extras.length ? ` Na sequência: ${extras.join("; ")}.` : ""}`;
  },
  "carteira.maior_devedor": (_intencao, dados) => {
    const cliente = primeiro<{
      nome?: unknown;
      debitoAberto?: unknown;
      vencido?: unknown;
    }>(dados.clientes);
    if (!cliente) {
      return "Nenhum cliente possui saldo em aberto nesta empresa.";
    }
    const aberto = num(cliente.debitoAberto);
    const vencido = num(cliente.vencido);
    const vencidoTrecho =
      vencido > 0
        ? ` Desse total, ${formatarMoeda(vencido)} está vencido.`
        : " Não há valor vencido nesse saldo.";
    return `${texto(cliente.nome)} possui atualmente o maior saldo em aberto: ${formatarMoeda(aberto)}.${vencidoTrecho}`;
  },
  "carteira.vencidos": (_intencao, dados) => {
    const qtd = num(dados.quantidade);
    const total = num(dados.totalVencido);
    const clientes = Array.isArray(dados.clientes)
      ? (dados.clientes as Array<{ nome?: unknown; vencido?: unknown }>)
      : [];
    if (qtd === 0) {
      return "Nenhum cliente está com contas vencidas no momento.";
    }
    const nomes = clientes
      .slice(0, 5)
      .map((item) => `${texto(item.nome)} (${formatarMoeda(num(item.vencido))})`);
    return `Há ${qtd} ${qtd === 1 ? "cliente" : "clientes"} com contas vencidas, somando ${formatarMoeda(total)}. Destaque: ${nomes.join("; ")}.`;
  },
  "carteira.totais": (_intencao, dados) => {
    const qtd = num(dados.quantidade);
    const aberto = num(dados.totalAberto);
    const vencido = num(dados.totalVencido);
    if (qtd === 0) {
      return "Nenhum cliente possui saldo em aberto nesta empresa.";
    }
    return `${qtd} ${qtd === 1 ? "cliente está devendo" : "clientes estão devendo"}. Total em aberto: ${formatarMoeda(aberto)}. Desse valor, ${formatarMoeda(vencido)} está vencido.`;
  },
  "carteira.cliente": (_intencao, dados) => {
    const cliente = primeiro<{
      nome?: unknown;
      debitoAberto?: unknown;
      vencido?: unknown;
      creditoAberto?: unknown;
      limiteDisponivel?: unknown;
    }>(dados.itens) ?? primeiro(dados.clientes);
    if (!cliente) {
      return "Não encontrei esse cliente nesta empresa.";
    }
    return `${texto(cliente.nome)} está com ${formatarMoeda(num(cliente.debitoAberto))} em aberto, ${formatarMoeda(num(cliente.vencido))} vencido, ${formatarMoeda(num(cliente.creditoAberto))} de crédito e ${formatarMoeda(num(cliente.limiteDisponivel))} de limite disponível.`;
  },
  "estoque.zerados": (_intencao, dados) => {
    const resumo = (dados.resumo ?? {}) as Record<string, unknown>;
    const itens = Array.isArray(dados.itens)
      ? (dados.itens as Array<{ nome?: unknown; quantidade?: unknown }>)
      : [];
    const qtd = num(resumo.zerados);
    if (qtd === 0) {
      return "Nenhum produto ativo está com estoque zerado.";
    }
    const nomes = itens.slice(0, 5).map((item) => texto(item.nome));
    return `${qtd} ${qtd === 1 ? "produto está" : "produtos estão"} sem estoque.${nomes.length ? ` Exemplos: ${nomes.join(", ")}.` : ""}`;
  },
  "estoque.negativos": (_intencao, dados) => {
    const resumo = (dados.resumo ?? {}) as Record<string, unknown>;
    const itens = Array.isArray(dados.itens)
      ? (dados.itens as Array<{ nome?: unknown; quantidade?: unknown }>)
      : [];
    const qtd = num(resumo.negativos);
    if (qtd === 0) {
      return "Nenhum produto ativo está com estoque negativo.";
    }
    const nomes = itens
      .slice(0, 5)
      .map((item) => `${texto(item.nome)} (${num(item.quantidade)})`);
    return `${qtd} ${qtd === 1 ? "produto está" : "produtos estão"} com estoque negativo.${nomes.length ? ` Destaque: ${nomes.join("; ")}.` : ""}`;
  },
  "estoque.baixo": (_intencao, dados) => {
    const resumo = (dados.resumo ?? {}) as Record<string, unknown>;
    const abaixo = num(resumo.baixo) + num(resumo.zerados) + num(resumo.negativos);
    const itens = Array.isArray(dados.itens)
      ? (dados.itens as Array<{ nome?: unknown; quantidade?: unknown }>)
      : [];
    if (abaixo === 0) {
      return "Nenhum produto ativo está abaixo do mínimo, zerado ou negativo.";
    }
    const nomes = itens.slice(0, 5).map((item) => texto(item.nome));
    return `${abaixo} ${abaixo === 1 ? "produto precisa" : "produtos precisam"} de atenção no estoque (${num(resumo.baixo)} abaixo do mínimo, ${num(resumo.zerados)} zerados, ${num(resumo.negativos)} negativos).${nomes.length ? ` Exemplos: ${nomes.join(", ")}.` : ""}`;
  },
  "produto.consulta": (_intencao, dados) => templateProduto(dados, "consulta"),
  "clientes.ranking": (_intencao, dados) => {
    const ranking = Array.isArray(dados.rankingClientes)
      ? (dados.rankingClientes as Array<{
          nome?: unknown;
          quantidade?: unknown;
          total?: unknown;
        }>)
      : [];
    const periodo = texto(dados.periodo) || "hoje";
    if (!ranking.length) {
      return `${rotuloPeriodo(periodo)} não há clientes identificados nas vendas.`;
    }
    const topo = ranking[0];
    return `${rotuloPeriodo(periodo)} quem mais comprou foi ${texto(topo.nome)}, com ${num(topo.quantidade)} ${num(topo.quantidade) === 1 ? "compra" : "compras"} e ${formatarMoeda(num(topo.total))}.`;
  },
  "clientes.compras": (intencao, dados) => {
    const cliente = primeiro<{ nome?: unknown }>(dados.itens);
    const nome = texto(cliente?.nome) || "O cliente";
    const qtd = num(dados.quantidadeVendas);
    const total = num(dados.total);
    const ultima = dados.ultimaVenda as { numero?: unknown; total?: unknown } | null;
    if (qtd === 0) {
      return `${nome} não possui compras no período consultado (${rotuloPeriodo(intencao.periodo)}).`;
    }
    const trechoUltima = ultima
      ? ` A última venda registrada é a nº ${texto(ultima.numero) || "—"}, de ${formatarMoeda(num(ultima.total))}.`
      : "";
    return `${nome} comprou ${qtd} ${qtd === 1 ? "vez" : "vezes"} ${rotuloPeriodo(intencao.periodo).toLowerCase()}, totalizando ${formatarMoeda(total)}.${trechoUltima}`;
  },
  "caixa.status": (_intencao, dados) => {
    if (dados.aberto === false) {
      return "Não há caixa aberto nesta empresa no momento.";
    }
    const saldo =
      dados.saldoAtual == null
        ? "O saldo esperado está oculto neste caixa."
        : `O saldo esperado é ${formatarMoeda(num(dados.saldoAtual))}.`;
    return `O caixa nº ${texto(dados.numero) || "atual"} está aberto. Entradas: ${formatarMoeda(num(dados.entradas))}. Saídas: ${formatarMoeda(num(dados.saidas))}. Suprimentos: ${formatarMoeda(num(dados.suprimentos))}. Sangrias: ${formatarMoeda(num(dados.sangrias))}. ${saldo}`;
  },
  "notificacoes.resumo": (_intencao, dados) => {
    const contador = num(dados.contador);
    if (contador === 0) {
      return "Você não tem avisos pendentes na Central de Notificações.";
    }
    const porCategoria = (dados.porCategoria ?? {}) as Record<string, unknown>;
    const partes = Object.entries(porCategoria)
      .filter(([, qtd]) => num(qtd) > 0)
      .map(([chave, qtd]) => {
        const rotulo =
          {
            estoque: "estoque",
            financeiro: "financeiros",
            fiscal: "fiscal",
            validade: "validade",
            caixa: "caixa",
            sistema: "sistema",
          }[chave] ??
          ROTULO_CATEGORIA_NOTIFICACAO[
            chave as keyof typeof ROTULO_CATEGORIA_NOTIFICACAO
          ] ??
          chave;
        return `${qtd} de ${String(rotulo).toLowerCase()}`;
      });
    return `Você tem ${contador} ${contador === 1 ? "aviso" : "avisos"}:${partes.length ? `\n${partes.join(",\n")}.` : ""}`;
  },
  "fiscal.notas_rejeitadas": (_intencao, dados) => {
    const qtd = num(dados.quantidade);
    const itens = Array.isArray(dados.itens)
      ? (dados.itens as Array<{ modelo?: unknown; numero?: unknown; motivo?: unknown }>)
      : [];
    if (qtd === 0) {
      return "Não há notas rejeitadas no momento.";
    }
    const destaque = itens[0];
    const motivo = texto(destaque?.motivo);
    return `Há ${qtd} ${qtd === 1 ? "nota rejeitada" : "notas rejeitadas"}.${destaque ? ` A mais recente é a ${texto(destaque.modelo)} nº ${texto(destaque.numero)}${motivo ? `: ${motivo}` : "."}` : ""}`;
  },
  "fiscal.reconciliacao": (_intencao, dados) => {
    const qtd = num(dados.quantidade);
    if (qtd === 0) {
      return "Não existem notas aguardando reconciliação.";
    }
    return `Há ${qtd} ${qtd === 1 ? "nota aguardando" : "notas aguardando"} reconciliação. Nada será retransmitido automaticamente.`;
  },
  "fiscal.diagnostico": (_intencao, dados) => {
    const status = texto(dados.status) || "desconhecido";
    const motivo = texto(dados.motivo);
    return `A ${texto(dados.modelo) || "nota"} nº ${texto(dados.numero) || "—"} está com status "${status}".${motivo ? ` Motivo: ${motivo}` : " Não há motivo detalhado cadastrado."} O Assistente não retransmite o documento.`;
  },
  "fiscal.ncm_cadastrado": (_intencao, dados) => templateProduto(dados, "ncm"),
  "fiscal.ncm_vigente": (_intencao, dados) => {
    const produto = templateProduto(dados, "ncm");
    const vigente = dados.ncmVigente as { status?: unknown; motivo?: unknown } | undefined;
    if (!vigente) {
      return produto;
    }
    const status = texto(vigente.status);
    if (status === "vigente") {
      return `${produto} Esse NCM está vigente na base oficial.`;
    }
    return `${produto} Validação na base oficial: ${texto(vigente.motivo) || status}.`;
  },
  "fiscal.cest": (_intencao, dados) => templateProduto(dados, "cest"),
  "fiscal.ibs_cbs": (_intencao, dados) => templateProduto(dados, "ibs"),
  "fiscal.grupo": (_intencao, dados) => templateProduto(dados, "grupo"),
};

function templateProduto(
  dados: Record<string, unknown>,
  foco: "consulta" | "ncm" | "cest" | "ibs" | "grupo"
) {
  const itens = Array.isArray(dados.itens)
    ? (dados.itens as Array<{ nome?: unknown }>)
    : [];
  if (!dados.nome && itens.length > 1) {
    return `Encontrei ${itens.length} produtos. Qual deles você quer consultar?`;
  }
  if (!dados.nome && itens.length === 0) {
    return "Informe o produto ou abra a ficha na tela.";
  }
  const nome = texto(dados.nome) || texto(itens[0]?.nome) || "Produto";
  const grupo = (dados.grupoFiscal ?? null) as {
    nome?: unknown;
    cstIbscbs?: unknown;
    cClassTrib?: unknown;
  } | null;
  if (foco === "ncm") {
    return dados.ncm
      ? `O NCM cadastrado em ${nome} é ${texto(dados.ncm)}.`
      : `${nome} não possui NCM cadastrado.`;
  }
  if (foco === "cest") {
    return dados.cest
      ? `O CEST atual de ${nome} é ${texto(dados.cest)}. CEST no cadastro não implica ST na operação.`
      : `${nome} não possui CEST cadastrado.`;
  }
  if (foco === "ibs") {
    if (!grupo) {
      return `${nome} não possui grupo fiscal com CST IBS/CBS cadastrado.`;
    }
    return `${nome} está no grupo ${texto(grupo.nome)}. CST IBS/CBS: ${texto(grupo.cstIbscbs) || "—"}. cClassTrib: ${texto(grupo.cClassTrib) || "—"}.`;
  }
  if (foco === "grupo") {
    return grupo
      ? `O grupo fiscal atual de ${nome} é ${texto(grupo.nome)}.`
      : `${nome} não está vinculado a um grupo fiscal.`;
  }
  const ativo = dados.ativo === false ? "inativo" : "ativo";
  return `${nome} (${texto(dados.codigo) || "sem código"}) está ${ativo}. Preço de venda: ${formatarMoeda(num(dados.precoVenda))}. Estoque atual: ${num(dados.estoque)}.`;
}
