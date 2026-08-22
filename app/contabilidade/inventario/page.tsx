import { gerarInventarioAction } from "@/app/contabilidade/actions";
import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { PageAlert } from "@/components/ui/page-alert";
import { StatusBadge } from "@/components/ui/status-badge";
import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import { temPermissao } from "@/lib/permissoes/tem-permissao";
import { obterContextoContabilidade, planoContabilidadePermitidoNaSessao } from "@/lib/contabilidade/contexto";
import { carregarProdutosEscrituracao } from "@/lib/contabilidade/inventario";

export const metadata = {
  title: "Inventário fiscal",
};

const quantidadeFmt = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 3,
});

type PageProps = {
  searchParams: Promise<{
    erro?: string;
    sucesso?: string;
    inventario?: string;
  }>;
};

export default async function ContabilidadeInventarioPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const plano = await planoContabilidadePermitidoNaSessao();
  if (!plano.permitido) {
    return null;
  }
  const ctx = await obterContextoContabilidade();
  const sessaoPermissoes = await obterPermissoesSessao();
  const podeGerar = Boolean(
    sessaoPermissoes &&
      temPermissao(sessaoPermissoes.permissoes, "contabilidade", "inventario")
  );

  const [{ data: snapshots }, produtos] = await Promise.all([
    ctx.supabase
      .from("inventarios_fiscais")
      .select("id, data_snapshot, gerado_em, itens_count, quantidade_total, valor_total")
      .eq("empresa_id", ctx.empresaId)
      .order("data_snapshot", { ascending: false })
      .limit(24),
    carregarProdutosEscrituracao(ctx.supabase, ctx.empresaId),
  ]);

  const grupos = (
    await ctx.supabase
      .from("grupos_fiscais")
      .select("id, nome")
      .eq("empresa_id", ctx.empresaId)
  ).data ?? [];
  const grupoPorId = new Map(grupos.map((item) => [item.id, item.nome]));
  const estoquePorId = new Map(
    produtos.estoques.map((item) => [item.produto_id, Number(item.quantidade ?? 0)])
  );

  const itensSnapshot = params.inventario
    ? (
        await ctx.supabase
          .from("inventario_fiscal_itens")
          .select(
            "codigo, descricao, ncm, unidade, quantidade, custo_unitario, valor_total, custo_disponivel"
          )
          .eq("empresa_id", ctx.empresaId)
          .eq("inventario_id", params.inventario)
          .order("descricao")
          .limit(500)
      ).data
    : null;

  return (
    <>
      {params.erro && <PageAlert type="erro">{params.erro}</PageAlert>}
      {params.sucesso && <PageAlert type="sucesso">{params.sucesso}</PageAlert>}

      <div className="flex flex-wrap items-end justify-between gap-3 px-4 py-3">
        <p className="max-w-xl text-[12px] text-zinc-500">
          O snapshot é uma fotografia. Não movimenta estoque. Custo usado:
          médio do estoque (custo_medio); se ausente, custo de cadastro
          (preco_custo). Sem custo confiável, a quantidade é gravada e o
          valor fica como não disponível.
        </p>
        {podeGerar && (
          <form action={gerarInventarioAction} className="flex items-center gap-2">
            <input
              type="date"
              name="data_snapshot"
              required
              className="updv-input h-8 text-[12px]"
            />
            <button type="submit" className="updv-btn updv-btn-primary">
              Gerar snapshot de inventário
            </button>
          </form>
        )}
      </div>

      <h2 className="px-4 text-[13px] font-semibold">Snapshots</h2>
      <DataTable minWidth={800}>
        <thead>
          <tr>
            <th>Data</th>
            <th>Gerado em</th>
            <th className="num">Itens</th>
            <th className="num">Quantidade</th>
            <th className="num">Valor</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {(snapshots ?? []).length === 0 && (
            <DataTableEmpty colSpan={6}>
              Nenhum snapshot gerado ainda.
            </DataTableEmpty>
          )}
          {(snapshots ?? []).map((item) => (
            <tr key={item.id}>
              <td>{item.data_snapshot}</td>
              <td>{new Date(item.gerado_em).toLocaleString("pt-BR")}</td>
              <td className="num">{item.itens_count}</td>
              <td className="num">{quantidadeFmt.format(Number(item.quantidade_total))}</td>
              <td className="num">
                {Number(item.valor_total).toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
              </td>
              <td>
                <a
                  href={`/contabilidade/inventario?inventario=${item.id}`}
                  className="updv-btn-row"
                >
                  Ver itens
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>

      {itensSnapshot && (
        <>
          <h2 className="mt-4 px-4 text-[13px] font-semibold">
            Itens do snapshot
          </h2>
          <DataTable minWidth={900}>
            <thead>
              <tr>
                <th>Código</th>
                <th>Descrição</th>
                <th>NCM</th>
                <th>Un.</th>
                <th className="num">Qtd</th>
                <th className="num">Custo</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {itensSnapshot.map((item, index) => (
                <tr key={`${item.codigo}-${index}`}>
                  <td>{item.codigo}</td>
                  <td className="max-w-[240px] truncate">{item.descricao}</td>
                  <td>{item.ncm ?? "—"}</td>
                  <td>{item.unidade ?? "—"}</td>
                  <td className="num">{quantidadeFmt.format(Number(item.quantidade))}</td>
                  <td className="num">
                    {item.custo_disponivel
                      ? Number(item.custo_unitario).toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })
                      : "Custo não disponível"}
                  </td>
                  <td className="num">
                    {item.valor_total == null
                      ? "—"
                      : Number(item.valor_total).toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </>
      )}

      <h2 className="mt-4 px-4 text-[13px] font-semibold">
        Produtos para escrituração
      </h2>
      <DataTable minWidth={1000}>
        <thead>
          <tr>
            <th>Código</th>
            <th>Descrição</th>
            <th>Un.</th>
            <th>NCM</th>
            <th>CEST</th>
            <th>Origem</th>
            <th>Grupo fiscal</th>
            <th>Status</th>
            <th className="num">Estoque</th>
          </tr>
        </thead>
        <tbody>
          {produtos.produtos.slice(0, 200).map((produto) => {
            const fiscal = Array.isArray(produto.produtos_fiscal)
              ? produto.produtos_fiscal[0]
              : produto.produtos_fiscal;
            return (
              <tr key={produto.id}>
                <td>{produto.codigo}</td>
                <td className="max-w-[220px] truncate">{produto.nome}</td>
                <td>{produto.unidade_medida ?? "—"}</td>
                <td>{fiscal?.ncm ?? "—"}</td>
                <td>{fiscal?.cest ?? "—"}</td>
                <td>{fiscal?.origem_produto ?? "—"}</td>
                <td>
                  {produto.grupo_fiscal_id
                    ? grupoPorId.get(produto.grupo_fiscal_id) ?? "—"
                    : "—"}
                </td>
                <td>
                  <StatusBadge status={produto.ativo ? "ativo" : "inativo"} />
                </td>
                <td className="num">
                  {quantidadeFmt.format(estoquePorId.get(produto.id) ?? 0)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
    </>
  );
}
