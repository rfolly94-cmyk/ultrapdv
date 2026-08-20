import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { avaliarStatusFiscalProduto } from "@/lib/fiscal/status-fiscal-produto";
import { escolherFiscalDaEmpresa } from "@/lib/produtos/dados-fiscais-produto";
import { ProdutoCadastroForm } from "./produto-cadastro-form";
import { ProdutoFiscalForm } from "./produto-fiscal-form";
import { ProdutosWorkspace } from "./produtos-workspace";
import { ProdutosModuleTabs } from "@/components/produtos/produtos-module-tabs";
import { PageAlert } from "@/components/ui/page-alert";
import { PageHeader } from "@/components/ui/page-header";
import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import { temPermissao } from "@/lib/permissoes/tem-permissao";

type PageProps = {
  searchParams: Promise<{
    erro?: string;
    sucesso?: string;
    fiscal?: string;
    novo?: string;
  }>;
};

const GRUPO_FISCAL_SELECT = `
  id,
  nome,
  ativo,
  cfop_interno,
  cfop_interestadual,
  icms_cst_csosn,
  icms_aliquota,
  pis_cst,
  pis_aliquota,
  cofins_cst,
  cofins_aliquota,
  ipi_aplicavel,
  ipi_cst,
  ipi_aliquota,
  ipi_enquadramento,
  cst_ibscbs,
  classificacao_ibscbs,
  aliquota_ibs_uf,
  aliquota_ibs_municipio,
  aliquota_cbs
`;

export default async function ProdutosPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;

  const supabase = await createClient();

  const { data: claimsData, error: authError } =
    await supabase.auth.getClaims();

  if (authError || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id, perfil")
    .eq("usuario_id", String(claimsData.claims.sub))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  const [
    { data: categorias, error: categoriasError },
    { data: marcas, error: marcasError },
    { data: gruposFiscais, error: gruposFiscaisError },
  ] = await Promise.all([
    supabase
      .from("categorias")
      .select("id, nome, ativo")
      .eq("empresa_id", vinculo.empresa_id)
      .order("ativo", { ascending: false })
      .order("nome"),
    supabase
      .from("marcas")
      .select("id, nome, ativo")
      .eq("empresa_id", vinculo.empresa_id)
      .order("ativo", { ascending: false })
      .order("nome"),
    supabase
      .from("grupos_fiscais")
      .select(GRUPO_FISCAL_SELECT)
      .eq("empresa_id", vinculo.empresa_id)
      .order("ativo", { ascending: false })
      .order("nome"),
  ]);

  if (categoriasError) {
    throw new Error(categoriasError.message);
  }

  if (marcasError) {
    throw new Error(marcasError.message);
  }

  if (gruposFiscaisError) {
    throw new Error(gruposFiscaisError.message);
  }

  const [
    { data: produtos, error },
    { data: estoques, error: estoqueError },
  ] = await Promise.all([
    supabase
      .from("produtos")
      .select(`
        id,
        codigo,
        codigo_barras,
        nome,
        descricao,
        categoria_id,
        marca_id,
        grupo_fiscal_id,
        unidade_medida,
        preco_custo,
        preco_venda,
        ativo,
        catalogo_publicado,
        catalogo_descricao,
        catalogo_destaque,
        catalogo_mostrar_preco,
        catalogo_imagem_path,

        produtos_fiscal (
          empresa_id,
          ncm,
          cest,
          origem_produto
        )
      `)
      .eq("empresa_id", vinculo.empresa_id)
      .order("nome"),
    supabase
      .from("estoque_atual")
      .select("produto_id, quantidade")
      .eq("empresa_id", vinculo.empresa_id),
  ]);

  if (error) {
    throw new Error(error.message);
  }

  if (estoqueError) {
    throw new Error(estoqueError.message);
  }

  const grupos = gruposFiscais ?? [];
  const gruposAtivos = grupos.filter((grupo) => grupo.ativo);
  const gruposPorId = new Map(
    grupos.map((grupo) => [grupo.id, grupo])
  );
  const categoriasPorId = new Map(
    (categorias ?? []).map((item) => [item.id, item])
  );
  const marcasPorId = new Map(
    (marcas ?? []).map((item) => [item.id, item])
  );
  const estoquePorProduto = new Map(
    (estoques ?? []).map((item) => [
      item.produto_id,
      Number(item.quantidade ?? 0),
    ])
  );
  const categoriasAtivas = (categorias ?? []).filter(
    (item) => item.ativo
  );
  const marcasAtivas = (marcas ?? []).filter(
    (item) => item.ativo
  );
  const sessao = await obterPermissoesSessao();
  const podeInformarEstoqueInicial = temPermissao(
    sessao?.permissoes,
    "estoque",
    "ajustar"
  );
  const podeImportar = temPermissao(sessao?.permissoes, "produtos", "importar");
  const podeCriar = temPermissao(sessao?.permissoes, "produtos", "criar");

  const produtoFiscal = params.fiscal
    ? produtos?.find((produto) => produto.id === params.fiscal)
    : null;

  const fiscal = escolherFiscalDaEmpresa(
    produtoFiscal?.produtos_fiscal,
    vinculo.empresa_id
  );

  return (
    <main className="updv-page">
      <PageHeader
        title="Produtos"
        description="Cadastro de produtos da empresa."
        count={produtos?.length ?? 0}
        actions={
          <div className="flex flex-wrap gap-2">
            {podeImportar && (
              <a
                href="/configuracoes/importar-dados?tipo=produtos"
                className="updv-btn updv-btn-ghost"
              >
                Importar produtos
              </a>
            )}
            {podeCriar && (
              <a href="/produtos?novo=1" className="updv-btn updv-btn-primary">
                Novo produto
              </a>
            )}
          </div>
        }
      />
      <ProdutosModuleTabs />

      {params.erro && <PageAlert type="erro">{params.erro}</PageAlert>}
      {params.sucesso && (
        <PageAlert type="sucesso">{params.sucesso}</PageAlert>
      )}

      {params.novo && (
        <div className="mx-4 mb-3 mt-3 rounded-md border border-zinc-200 bg-white p-5">
          <ProdutoCadastroForm
            categorias={categoriasAtivas}
            marcas={marcasAtivas}
            gruposFiscais={gruposAtivos}
            podeInformarEstoqueInicial={podeInformarEstoqueInicial}
          />
          <a href="/produtos" className="updv-btn updv-btn-ghost mt-3">
            Cancelar
          </a>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">

        <ProdutosWorkspace
          categorias={categorias ?? []}
          marcas={marcas ?? []}
          gruposFiscais={grupos}
          produtos={(produtos ?? []).map((produto) => {
            const fiscalProduto = escolherFiscalDaEmpresa(
              produto.produtos_fiscal,
              vinculo.empresa_id
            );

            const grupo = produto.grupo_fiscal_id
              ? gruposPorId.get(produto.grupo_fiscal_id) ?? null
              : null;

            const status = avaliarStatusFiscalProduto({
              ncm: fiscalProduto?.ncm,
              grupo,
            });

            return {
              id: produto.id,
              codigo: produto.codigo,
              codigo_barras: produto.codigo_barras,
              nome: produto.nome,
              descricao: produto.descricao,
              categoria_id: produto.categoria_id,
              marca_id: produto.marca_id,
              grupo_fiscal_id: produto.grupo_fiscal_id,
              unidade_medida: produto.unidade_medida,
              preco_custo: produto.preco_custo,
              preco_venda: produto.preco_venda,
              ativo: produto.ativo,
              catalogo_publicado: Boolean(produto.catalogo_publicado),
              catalogo_descricao: produto.catalogo_descricao,
              catalogo_destaque: Boolean(produto.catalogo_destaque),
              catalogo_mostrar_preco:
                produto.catalogo_mostrar_preco !== false,
              catalogo_imagem_path: produto.catalogo_imagem_path,
              quantidade:
                estoquePorProduto.get(produto.id) ?? 0,
              categoria_nome:
                categoriasPorId.get(produto.categoria_id ?? "")
                  ?.nome ?? null,
              marca_nome:
                marcasPorId.get(produto.marca_id ?? "")
                  ?.nome ?? null,
              grupo_nome: grupo?.nome ?? null,
              grupo_ativo: grupo?.ativo ?? false,
              ncm: fiscalProduto?.ncm ?? null,
              cest: fiscalProduto?.cest ?? null,
              origem_produto: fiscalProduto?.origem_produto ?? null,
              fiscal_ok: status.ok,
              fiscal_rotulo: status.rotulo,
              fiscal_motivo: status.motivo,
            };
          })}
        />

        {produtoFiscal && (
          <ProdutoFiscalForm
            produtoId={produtoFiscal.id}
            produtoNome={produtoFiscal.nome}
            grupoFiscalId={produtoFiscal.grupo_fiscal_id}
            ncm={fiscal?.ncm ?? null}
            cest={fiscal?.cest ?? null}
            origemProduto={fiscal?.origem_produto ?? null}
            grupos={grupos}
          />
        )}
      </div>
    </main>
  );
}
