import { filtrarRegistrosDaEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { hrefOrigemEmissaoFiscal } from "@/lib/fiscal/acoes-emissao";
import { paginarSemAlterarTotais } from "./calculo";
import { buscarEmLotes, obterContextoRelatorio } from "./contexto";
import { formatarDataHora, formatarMoeda, numeroSeguro } from "./formatacao";
import { noIntervalo, resolverPeriodoRelatorio } from "./periodo";
import type { FiltrosRelatorio, RelatorioMontado } from "./tipos";

const PENDENTES = [
  "rejeitada",
  "erro_comunicacao",
  "aguardando_reconciliacao",
  "enviando",
  "aguardando_transmissao_contingencia",
  "transmitindo_contingencia",
];

export function relatorioFiscalSomenteLeitura() {
  return {
    emite: false,
    reenvia: false,
    reconcilia: false,
    alteraStatus: false,
    geraNumero: false,
  };
}

export async function carregarRelatorioFiscal(
  filtros: FiltrosRelatorio
): Promise<RelatorioMontado & { opcoes: Record<string, Array<{ id: string; nome: string }>> }> {
  const ctx = await obterContextoRelatorio();
  const janela = resolverPeriodoRelatorio(filtros.periodo, filtros.de, filtros.ate);

  const { data, error } = await ctx.supabase
    .from("fiscal_emissoes")
    .select(
      "id, empresa_id, origem_id, origem_tipo, modelo, serie, numero, status, created_at, autorizada_at"
    )
    .eq("empresa_id", ctx.empresaId)
    .gte("created_at", janela.inicio.toISOString())
    .order("created_at", { ascending: false })
    .limit(4000);

  if (error) {
    throw new Error(error.message);
  }

  let emissoes = filtrarRegistrosDaEmpresaAtiva(data ?? [], ctx.empresaId).filter((item) =>
    noIntervalo(item.autorizada_at || item.created_at, janela.inicio, janela.fim)
  );

  if (filtros.modelo === "55" || filtros.modelo === "65") {
    emissoes = emissoes.filter((item) => String(item.modelo) === filtros.modelo);
  }
  if (filtros.status) {
    emissoes = emissoes.filter((item) => item.status === filtros.status);
  }

  const vendaIds = [
    ...new Set(
      emissoes
        .filter((item) => item.origem_tipo === "venda" && item.origem_id)
        .map((item) => String(item.origem_id))
    ),
  ];
  const valoresVenda = new Map<string, number>();
  if (vendaIds.length > 0) {
    const vendas = await buscarEmLotes(vendaIds, async (fatia) => {
      const { data: linhas } = await ctx.supabase
        .from("vendas")
        .select("id, empresa_id, valor_total")
        .eq("empresa_id", ctx.empresaId)
        .in("id", fatia);
      return filtrarRegistrosDaEmpresaAtiva(linhas ?? [], ctx.empresaId);
    });
    for (const venda of vendas) {
      valoresVenda.set(String(venda.id), numeroSeguro(venda.valor_total));
    }
  }

  const contar = (status: string) =>
    emissoes.filter((item) => item.status === status).length;

  const pendencias = emissoes.filter((item) => PENDENTES.includes(item.status));
  const pagina = paginarSemAlterarTotais(emissoes, filtros.pagina, filtros.porPagina);

  return {
    titulo: "Documentos fiscais",
    vazio: "Nenhum documento fiscal encontrado para este período.",
    indicadores: [
      { label: "NF-e autorizadas", valor: String(emissoes.filter((item) => String(item.modelo) === "55" && item.status === "autorizada").length) },
      { label: "NFC-e autorizadas", valor: String(emissoes.filter((item) => String(item.modelo) === "65" && item.status === "autorizada").length) },
      { label: "Rejeitadas", valor: String(contar("rejeitada")) },
      { label: "Canceladas", valor: String(contar("cancelada")) },
      { label: "Aguardando reconciliação", valor: String(contar("aguardando_reconciliacao")) },
      { label: "Em processamento", valor: String(contar("enviando") + contar("transmitindo_contingencia")) },
    ],
    colunas: ["Data", "Modelo", "Série", "Número", "Venda", "Valor", "Status"],
    linhas: pagina.registros.map((item) => ({
      id: item.id,
      href: hrefOrigemEmissaoFiscal(item.origem_tipo, item.origem_id) ?? "/fiscal",
      celulas: [
        formatarDataHora(item.autorizada_at || item.created_at),
        String(item.modelo) === "55" ? "55 NF-e" : String(item.modelo) === "65" ? "65 NFC-e" : String(item.modelo),
        String(item.serie ?? "—"),
        String(item.numero ?? "—"),
        item.origem_tipo === "venda" && item.origem_id ? "Abrir venda" : "—",
        formatarMoeda(
          item.origem_id ? valoresVenda.get(String(item.origem_id)) ?? 0 : 0
        ),
        item.status,
      ],
    })),
    totalFiltrado: pagina.total,
    extra: {
      titulo: "Pendências fiscais",
      colunas: ["Data", "Modelo", "Número", "Status"],
      linhas: pendencias.slice(0, 50).map((item) => ({
        id: item.id,
        href: hrefOrigemEmissaoFiscal(item.origem_tipo, item.origem_id) ?? "/fiscal",
        celulas: [
          formatarDataHora(item.created_at),
          String(item.modelo),
          String(item.numero ?? "—"),
          item.status,
        ],
      })),
    },
    opcoes: {},
  };
}
