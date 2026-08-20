import { paginarSemAlterarTotais, somarPagamentosPorForma, vendaValidaParaFaturamento } from "./calculo";
import { formatarDataHora, formatarMoeda, formatarPercentual, numeroSeguro } from "./formatacao";
import { dataVenda } from "./periodo";
import type { FiltrosRelatorio, RelatorioMontado } from "./tipos";
import { carregarBaseVendas } from "./vendas";
import { pagamentoFinanceiramenteValido } from "@/lib/vendas/pagamentos-financeiros";

export async function carregarRelatorioPagamentos(
  filtros: FiltrosRelatorio
): Promise<RelatorioMontado & { opcoes: Record<string, Array<{ id: string; nome: string }>> }> {
  const base = await carregarBaseVendas(filtros);
  const idsValidas = new Set(
    base.vendas
      .filter((venda) => vendaValidaParaFaturamento(venda.status))
      .map((venda) => venda.id)
  );

  let pagamentos = base.pagamentos.filter(
    (item) =>
      idsValidas.has(item.venda_id) && pagamentoFinanceiramenteValido(item.status)
  );

  if (filtros.formaId) {
    pagamentos = pagamentos.filter(
      (item) => String(item.forma_pagamento_id ?? "") === filtros.formaId
    );
  }

  const resumo = somarPagamentosPorForma(pagamentos, idsValidas);
  const total = resumo.reduce((soma, item) => soma + item.valor, 0);
  const vendasPorId = new Map(base.vendas.map((venda) => [venda.id, venda]));

  const detalhe = pagamentos
    .map((item) => {
      const venda = vendasPorId.get(item.venda_id);
      return {
        id: `${item.venda_id}-${item.forma_pagamento_nome}-${item.valor}`,
        href: `/vendas/${item.venda_id}`,
        data: venda ? dataVenda(venda) : "",
        venda: venda?.numero ?? "—",
        forma:
          item.forma_pagamento_nome || item.forma_pagamento_codigo || "Pagamento",
        valor: numeroSeguro(item.valor),
      };
    })
    .sort((a, b) => String(b.data).localeCompare(String(a.data)));

  const pagina = paginarSemAlterarTotais(detalhe, filtros.pagina, filtros.porPagina);

  return {
    titulo: "Pagamentos",
    vazio: "Nenhum pagamento confirmado neste período.",
    indicadores: resumo.length
      ? resumo.map((item) => ({
          label: item.nome,
          valor: formatarMoeda(item.valor),
          hint: `${item.operacoes} operação(ões)`,
        }))
      : [{ label: "Total recebido", valor: formatarMoeda(0) }],
    colunas: ["Forma", "Operações", "Valor", "% do total"],
    linhas: resumo.map((item) => ({
      id: item.nome,
      celulas: [
        item.nome,
        String(item.operacoes),
        formatarMoeda(item.valor),
        formatarPercentual(item.valor, total),
      ],
    })),
    totalFiltrado: resumo.length,
    extra: {
      titulo: "Detalhamento",
      colunas: ["Data", "Venda", "Forma", "Valor"],
      linhas: pagina.registros.map((item) => ({
        id: item.id,
        href: item.href,
        celulas: [
          formatarDataHora(item.data),
          `#${item.venda}`,
          String(item.forma),
          formatarMoeda(item.valor),
        ],
      })),
    },
    opcoes: {
      formas: (base.formas as Array<{ id: string; nome: string }>).map((forma) => ({
        id: forma.id,
        nome: forma.nome,
      })),
    },
  };
}
