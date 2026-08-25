import { classificarFormaCaixa } from "./formas";
import { montarHistoricoCiclos } from "./reabertura";
import { rotuloStatusDiferencaCaixa, statusDiferencaCaixa } from "./conferencia";
import type {
  CaixaCicloFechamento,
  CaixaFechamentoMeio,
  CaixaMovimento,
  CaixaReabertura,
  CaixaSessao,
  CaixaTotais,
} from "./tipos";
import { formatarDataHora, formatarMoeda } from "@/lib/relatorios/formatacao";

const ROTULO_TIPO: Record<string, string> = {
  abertura: "Abertura",
  suprimento: "Suprimento",
  sangria: "Sangria",
  ajuste: "Ajuste",
  venda: "Venda",
  recebimento_carteira: "Recebimento Carteira",
  estorno_recebimento: "Estorno de recebimento",
};

export type RelatorioCaixaEmpresa = {
  razaoSocial: string;
  nomeFantasia: string | null;
  cnpj: string;
  logoUrl: string | null;
  filialNome: string | null;
};

export type RelatorioCaixaDados = CaixaSessao &
  CaixaTotais & {
    movimentos: CaixaMovimento[];
    conferencia: CaixaFechamentoMeio[];
  };

function moeda(valor: number | null | undefined) {
  if (valor === null || valor === undefined) {
    return "—";
  }
  return formatarMoeda(valor);
}

function texto(valor: string | null | undefined) {
  const saida = String(valor ?? "").trim();
  return saida || "—";
}

function referenciaMovimento(movimento: CaixaMovimento) {
  if (movimento.venda_numero != null) {
    return `Venda #${movimento.venda_numero}`;
  }
  if (movimento.venda_id) {
    return "Venda";
  }
  return texto(movimento.descricao);
}

function agruparMeiosRelatorio(meios: CaixaFechamentoMeio[]) {
  const grupos: Record<
    "dinheiro" | "pix" | "debito" | "credito" | "outros",
    { esperado: number; informado: number; diferenca: number }
  > = {
    dinheiro: { esperado: 0, informado: 0, diferenca: 0 },
    pix: { esperado: 0, informado: 0, diferenca: 0 },
    debito: { esperado: 0, informado: 0, diferenca: 0 },
    credito: { esperado: 0, informado: 0, diferenca: 0 },
    outros: { esperado: 0, informado: 0, diferenca: 0 },
  };

  for (const meio of meios) {
    const classe = classificarFormaCaixa({
      tipo: meio.forma_tipo_snapshot,
      codigo: meio.forma_codigo_snapshot,
      nome: meio.forma_nome_snapshot,
    });
    const chave =
      classe === "dinheiro" ||
      classe === "pix" ||
      classe === "debito" ||
      classe === "credito"
        ? classe
        : "outros";
    grupos[chave].esperado += meio.valor_esperado;
    grupos[chave].informado += meio.valor_informado;
    grupos[chave].diferenca += meio.diferenca;
  }

  return grupos;
}

function linhasMeios(meios: CaixaFechamentoMeio[], fechado: boolean) {
  const grupos = agruparMeiosRelatorio(meios);
  const rotulos: Array<[keyof typeof grupos, string]> = [
    ["dinheiro", "Dinheiro"],
    ["pix", "PIX"],
    ["debito", "Debito"],
    ["credito", "Credito"],
    ["outros", "Outros"],
  ];
  const linhas: string[] = [];
  for (const [chave, rotulo] of rotulos) {
    const grupo = grupos[chave];
    if (
      grupo.esperado === 0 &&
      grupo.informado === 0 &&
      chave === "outros"
    ) {
      continue;
    }
    if (fechado) {
      linhas.push(
        `${rotulo}: esperado ${moeda(grupo.esperado)} | informado ${moeda(grupo.informado)} | diferenca ${moeda(grupo.diferenca)}`
      );
    } else {
      linhas.push(`${rotulo}: esperado ${moeda(grupo.esperado)}`);
    }
  }
  return linhas;
}

export function nomeArquivoRelatorioCaixa(input: {
  numero: number;
  aberto_em: string;
}) {
  const data = String(input.aberto_em ?? "").slice(0, 10).replace(/-/g, "");
  return `caixa-${input.numero}${data ? `-${data}` : ""}.pdf`;
}

export function urlPdfRelatorioCaixa(caixaId: string, download = false) {
  const qs = download ? "?download=1" : "";
  return `/api/impressao/caixa/${caixaId}${qs}`;
}

export function linhasRelatorioCaixaPdf(input: {
  empresa: RelatorioCaixaEmpresa;
  caixa: RelatorioCaixaDados;
  ocultarEsperado?: boolean;
}): string[] {
  const { empresa, caixa } = input;
  const fechado = caixa.status === "fechado";
  const meios =
    caixa.ciclos_fechamento.at(-1)?.meios ??
    caixa.conferencia ??
    [];
  const diferenca = caixa.diferenca;
  const statusDif =
    fechado && diferenca != null ? rotuloStatusDiferencaCaixa(statusDiferencaCaixa(diferenca)) : null;
  const linhas: string[] = [
    empresa.razaoSocial || empresa.nomeFantasia || "Empresa",
    empresa.cnpj ? `CNPJ: ${empresa.cnpj}` : "CNPJ: —",
  ];

  if (empresa.filialNome) {
    linhas.push(`Filial: ${empresa.filialNome}`);
  }

  linhas.push(
    "",
    `Caixa #${caixa.numero}`,
    `Status: ${caixa.status}${caixa.reaberto ? " · REABERTO" : ""}`,
    `Abertura: ${formatarDataHora(caixa.aberto_em)} por ${texto(caixa.usuario_abertura_nome)}`
  );

  if (fechado) {
    linhas.push(
      `Fechamento: ${formatarDataHora(caixa.fechado_em)} por ${texto(caixa.usuario_fechamento_nome)}`
    );
  }

  if (caixa.reaberto) {
    const ultima = caixa.reaberturas.at(-1);
    linhas.push("SESSAO REABERTA");
    if (ultima) {
      linhas.push(
        `Reaberto em ${formatarDataHora(ultima.reaberto_em)} por ${texto(ultima.reaberto_por_nome)}`
      );
      linhas.push(`Motivo: ${ultima.motivo}`);
    }
  }

  linhas.push("", "Resumo financeiro");
  linhas.push(`Saldo inicial: ${moeda(caixa.saldoInicial)}`);
  linhas.push(`Total de vendas: ${moeda(caixa.vendasTotal)}`);
  linhas.push(`Total recebido em Carteira: ${moeda(caixa.recebimentosCarteira)}`);
  linhas.push(`Suprimentos: ${moeda(caixa.suprimentos)}`);
  linhas.push(`Sangrias: ${moeda(caixa.sangrias)}`);
  linhas.push(`Estornos: ${moeda(caixa.estornos)}`);
  if (input.ocultarEsperado) {
    linhas.push("Dinheiro fisico esperado: —");
  } else {
    linhas.push(`Dinheiro fisico esperado: ${moeda(caixa.saldoAtual)}`);
  }
  if (fechado) {
    linhas.push(`Dinheiro contado: ${moeda(caixa.dinheiro_contado)}`);
    linhas.push(`Diferenca: ${moeda(caixa.diferenca)}`);
    if (statusDif) {
      linhas.push(`Resultado: ${statusDif}`);
    }
  }

  linhas.push("", "Por meio de pagamento");
  if (meios.length === 0) {
    linhas.push("Sem snapshot de meios neste ciclo.");
  } else {
    linhas.push(
      ...linhasMeios(meios, fechado && input.ocultarEsperado !== true)
    );
  }

  const historico = montarHistoricoCiclos({
    ciclos: caixa.ciclos_fechamento,
    reaberturas: caixa.reaberturas,
  });
  if (historico.length > 0) {
    linhas.push("", "Historico de fechamentos e reaberturas");
    for (const evento of historico) {
      if (evento.tipo === "fechamento") {
        linhas.push(
          `Fechado em ${formatarDataHora(evento.em)} por ${texto(evento.porNome)} · Diferenca: ${moeda(evento.diferenca)}`
        );
      } else {
        linhas.push(
          `Reaberto em ${formatarDataHora(evento.em)} por ${texto(evento.porNome)}`
        );
        linhas.push(`Motivo: ${evento.motivo}`);
      }
    }
  }

  linhas.push("", "Movimentacoes");
  linhas.push(
    "Horario | Tipo | Ref | Cliente | Forma | Recebido | Troco | Liquido | Entrada | Saida | Operador"
  );
  if (caixa.movimentos.length === 0) {
    linhas.push("Nenhuma movimentacao.");
  } else {
    for (const movimento of caixa.movimentos) {
      const oculto = movimento.valores_ocultos === true;
      const troco =
        movimento.tipo === "venda" || movimento.tipo === "recebimento_carteira"
          ? movimento.saida
          : 0;
      linhas.push(
        [
          formatarDataHora(movimento.created_at),
          ROTULO_TIPO[movimento.tipo] ?? movimento.tipo,
          referenciaMovimento(movimento),
          texto(movimento.cliente_nome),
          texto(movimento.forma_nome),
          oculto ? "—" : moeda(movimento.entrada),
          oculto ? "—" : moeda(troco),
          oculto ? "—" : moeda(movimento.valor_liquido),
          oculto ? "—" : moeda(movimento.entrada),
          oculto ? "—" : moeda(movimento.saida),
          texto(movimento.usuario_nome),
        ].join(" | ")
      );
    }
  }

  linhas.push("", "UltraPDV");
  return linhas;
}
