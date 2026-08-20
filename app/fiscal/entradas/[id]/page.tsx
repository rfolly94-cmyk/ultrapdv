import { notFound, redirect } from "next/navigation";

import { aplicarVinculosConhecidos } from "@/app/fiscal/entradas/actions";
import { EntradaDetalhe } from "@/components/fiscal/entrada/entrada-detalhe";
import { PageAlert } from "@/components/ui/page-alert";
import { PageHeader } from "@/components/ui/page-header";
import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import {
  documentoEntradaPodeEditar,
  statusEntradaExibido,
} from "@/lib/fiscal/entrada/status";
import { reconhecerItemEntrada } from "@/lib/fiscal/entrada/vinculo-fornecedor";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string; sucesso?: string }>;
};

export default async function NotaEntradaDetalhePage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();

  if (error || !claimsData?.claims?.sub) {
    redirect("/login");
  }

  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id")
    .eq("usuario_id", String(claimsData.claims.sub))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (!vinculo) {
    redirect("/onboarding");
  }

  const empresaId = String(vinculo.empresa_id);

  const { data: documento, error: documentoError } = await supabase
    .from("fiscal_documentos_entrada")
    .select(
      `
      id,
      empresa_id,
      fornecedor_id,
      chave_acesso,
      modelo,
      serie,
      numero,
      data_emissao,
      data_entrada,
      cnpj_emitente,
      razao_social_emitente,
      ie_emitente,
      valor_produtos,
      valor_total,
      protocolo,
      status,
      origem,
      importado_por,
      entrada_estoque_processada_at,
      entrada_estoque_processada_por,
      created_at
    `
    )
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (documentoError) {
    throw new Error(documentoError.message);
  }

  if (!documento || !registroPertenceAEmpresaAtiva(documento, empresaId)) {
    notFound();
  }

  const { data: statusReconciliado } = await supabase.rpc(
    "rpc_reconciliar_status_entrada",
    {
      p_empresa_id: empresaId,
      p_documento_id: documento.id,
    }
  );

  const statusAtual = String(statusReconciliado ?? documento.status);

  if (documentoEntradaPodeEditar(statusAtual)) {
    await aplicarVinculosConhecidos({ documentoId: String(documento.id) });
  }

  const [{ data: documentoAtual }, { data: itens }, { data: produtos }, { data: vinculos }, { data: movimentos }, { data: devolucoes }] =
    await Promise.all([
      supabase
        .from("fiscal_documentos_entrada")
        .select(
          `
          id,
          empresa_id,
          fornecedor_id,
          chave_acesso,
          modelo,
          serie,
          numero,
          data_emissao,
          data_entrada,
          cnpj_emitente,
          razao_social_emitente,
          ie_emitente,
          valor_produtos,
          valor_total,
          protocolo,
          status,
          origem,
          importado_por,
          entrada_estoque_processada_at,
          entrada_estoque_processada_por,
          created_at
        `
        )
        .eq("id", id)
        .eq("empresa_id", empresaId)
        .maybeSingle(),
      supabase
        .from("fiscal_documentos_entrada_itens")
        .select(
          `
          id,
          empresa_id,
          numero_item,
          codigo_fornecedor,
          descricao_original,
          ean,
          ncm,
          cest,
          cfop_original,
          unidade,
          quantidade_xml,
          quantidade_recebida,
          quantidade_entrada_efetivada,
          valor_unitario,
          valor_total,
          desconto,
          produto_id,
          grupo_fiscal_id,
          fator_conversao,
          fator_conversao_confirmado
        `
        )
        .eq("empresa_id", empresaId)
        .eq("documento_entrada_id", documento.id)
        .order("numero_item"),
      supabase
        .from("produtos")
        .select(
          `
          id,
          empresa_id,
          codigo,
          codigo_barras,
          nome,
          unidade_medida,
          grupo_fiscal_id,
          produtos_fiscal ( ncm, cest )
        `
        )
        .eq("empresa_id", empresaId)
        .eq("ativo", true)
        .order("nome")
        .limit(2000),
      documento.fornecedor_id
        ? supabase
            .from("fornecedores_produtos_vinculos")
            .select(
              `
              id,
              empresa_id,
              fornecedor_id,
              produto_id,
              codigo_produto_fornecedor,
              ean_fornecedor,
              fator_conversao,
              ativo
            `
            )
            .eq("empresa_id", empresaId)
            .eq("fornecedor_id", documento.fornecedor_id)
            .eq("ativo", true)
        : Promise.resolve({ data: [] }),
      supabase
        .from("estoque_movimentacoes")
        .select(
          `
          id,
          empresa_id,
          produto_id,
          created_at,
          tipo,
          origem,
          quantidade,
          saldo_anterior,
          saldo_posterior,
          observacao
        `
        )
        .eq("empresa_id", empresaId)
        .eq("documento_entrada_id", documento.id)
        .order("created_at"),
      supabase
        .from("fiscal_devolucoes_fornecedor")
        .select("id, empresa_id, status, created_at")
        .eq("empresa_id", empresaId)
        .eq("documento_entrada_id", documento.id)
        .order("created_at", { ascending: false }),
    ]);

  const usuarioIds = [
    documento.importado_por,
    documento.entrada_estoque_processada_por,
  ].filter((valor): valor is string => Boolean(valor));

  const usuarios =
    usuarioIds.length > 0
      ? (
          await supabase
            .from("usuarios")
            .select("id, nome")
            .in("id", usuarioIds)
        ).data ?? []
      : [];

  const nomePorUsuario = new Map(
    usuarios.map((usuario) => [usuario.id, usuario.nome as string])
  );

  const produtosEmpresa = (produtos ?? []).filter((produto) =>
    registroPertenceAEmpresaAtiva(produto, empresaId)
  );

  const ncmPorProduto = new Map<string, string | null>();
  for (const produto of produtosEmpresa) {
    const fiscal = Array.isArray(produto.produtos_fiscal)
      ? produto.produtos_fiscal[0]
      : produto.produtos_fiscal;
    ncmPorProduto.set(
      String(produto.id),
      fiscal?.ncm ? String(fiscal.ncm) : null
    );
  }

  const itensEmpresa = (itens ?? []).filter((item) =>
    registroPertenceAEmpresaAtiva(item, empresaId)
  );

  const nota =
    documentoAtual && registroPertenceAEmpresaAtiva(documentoAtual, empresaId)
      ? documentoAtual
      : documento;

  const movimentosEmpresa = (movimentos ?? []).filter((mov) =>
    registroPertenceAEmpresaAtiva(mov, empresaId)
  );

  const status = statusEntradaExibido({
    status: String(nota.status),
    temMovimentoEstoque: movimentosEmpresa.length > 0,
    temQuantidadeEfetivada: itensEmpresa.some(
      (item) => Number(item.quantidade_entrada_efetivada ?? 0) > 0
    ),
  });

  return (
    <div className="updv-page">
      <PageHeader
        title={`NF-e ${nota.numero}`}
        breadcrumb={[
          { label: "Fiscal", href: "/fiscal" },
          { label: "Notas de entrada", href: "/fiscal/entradas" },
          { label: `Nota ${nota.numero}` },
        ]}
      />
      {query.erro ? <PageAlert type="erro">{query.erro}</PageAlert> : null}
      {query.sucesso ? (
        <PageAlert type="sucesso">{query.sucesso}</PageAlert>
      ) : null}
      <EntradaDetalhe
        documento={{
          id: String(nota.id),
          numero: String(nota.numero),
          serie: String(nota.serie ?? ""),
          chaveAcesso: String(nota.chave_acesso),
          modelo: String(nota.modelo ?? "55"),
          status,
          fornecedor: String(nota.razao_social_emitente),
          cnpjEmitente: String(nota.cnpj_emitente),
          ieEmitente: nota.ie_emitente
            ? String(nota.ie_emitente)
            : null,
          valorProdutos: Number(nota.valor_produtos ?? 0),
          valorTotal: Number(nota.valor_total ?? 0),
          protocolo: nota.protocolo ? String(nota.protocolo) : null,
          dataEmissao: nota.data_emissao,
          importadaEm: nota.created_at,
          importadaPor:
            (nota.importado_por
              ? nomePorUsuario.get(nota.importado_por)
              : null) ?? null,
          entradaProcessadaEm: nota.entrada_estoque_processada_at,
          entradaProcessadaPor:
            (nota.entrada_estoque_processada_por
              ? nomePorUsuario.get(nota.entrada_estoque_processada_por)
              : null) ?? null,
          xmlPreservado: true,
        }}
        produtos={produtosEmpresa.map((produto) => ({
          id: String(produto.id),
          empresa_id: String(produto.empresa_id),
          codigo: produto.codigo ? String(produto.codigo) : null,
          codigo_barras: produto.codigo_barras
            ? String(produto.codigo_barras)
            : null,
          nome: String(produto.nome),
          ncm: ncmPorProduto.get(String(produto.id)) ?? null,
          unidade_medida: produto.unidade_medida
            ? String(produto.unidade_medida)
            : null,
        }))}
        itens={itensEmpresa.map((item) => {
          const candidatos = produtosEmpresa.map((produto) => ({
            id: String(produto.id),
            empresa_id: String(produto.empresa_id),
            codigo: produto.codigo ? String(produto.codigo) : null,
            codigo_barras: produto.codigo_barras
              ? String(produto.codigo_barras)
              : null,
            nome: String(produto.nome),
            unidade_medida: produto.unidade_medida
              ? String(produto.unidade_medida)
              : null,
          }));
          const reconhecimento = reconhecerItemEntrada({
            empresaIdAtiva: empresaId,
            fornecedorId: documento.fornecedor_id,
            codigoFornecedor: item.codigo_fornecedor,
            ean: item.ean,
            descricao: item.descricao_original,
            vinculos: (vinculos ?? [])
              .filter((vinculo) =>
                registroPertenceAEmpresaAtiva(vinculo, empresaId)
              )
              .map((vinculo) => ({
                id: String(vinculo.id),
                empresa_id: String(vinculo.empresa_id),
                fornecedor_id: String(vinculo.fornecedor_id),
                produto_id: String(vinculo.produto_id),
                codigo_produto_fornecedor: String(
                  vinculo.codigo_produto_fornecedor
                ),
                ean_fornecedor: vinculo.ean_fornecedor
                  ? String(vinculo.ean_fornecedor)
                  : null,
                fator_conversao: Number(vinculo.fator_conversao ?? 1),
                ativo: Boolean(vinculo.ativo),
              })),
            produtos: candidatos,
          });

          return {
            id: String(item.id),
            numeroItem: Number(item.numero_item),
            descricaoOriginal: String(item.descricao_original),
            codigoFornecedor: item.codigo_fornecedor
              ? String(item.codigo_fornecedor)
              : null,
            ean: item.ean ? String(item.ean) : null,
            ncm: item.ncm ? String(item.ncm) : null,
            cest: item.cest ? String(item.cest) : null,
            cfop: item.cfop_original ? String(item.cfop_original) : null,
            unidade: item.unidade ? String(item.unidade) : null,
            quantidadeXml: Number(item.quantidade_xml ?? 0),
            quantidadeRecebida: Number(item.quantidade_recebida ?? 0),
            quantidadeEntradaEfetivada: item.quantidade_entrada_efetivada
              ? Number(item.quantidade_entrada_efetivada)
              : null,
            valorUnitario: Number(item.valor_unitario ?? 0),
            valorTotal: Number(item.valor_total ?? 0),
            produtoId: item.produto_id ? String(item.produto_id) : null,
            ncmCadastro: item.produto_id
              ? ncmPorProduto.get(String(item.produto_id)) ?? null
              : null,
            fatorConversao: Number(item.fator_conversao ?? 1),
            fatorConversaoConfirmado: Boolean(
              item.fator_conversao_confirmado
            ),
            origem: reconhecimento.origem,
            rotuloOrigem: reconhecimento.rotulo,
            sugestao:
              reconhecimento.produtoId && !reconhecimento.autoVincular
                ? {
                    produtoId: reconhecimento.produtoId,
                    nome:
                      candidatos.find(
                        (produto) => produto.id === reconhecimento.produtoId
                      )?.nome ?? "Produto sugerido",
                    confianca:
                      reconhecimento.origem === "ean" ||
                      reconhecimento.origem === "ean_vinculo"
                        ? ("alta" as const)
                        : reconhecimento.origem === "codigo"
                          ? ("media" as const)
                          : ("baixa" as const),
                    motivo: reconhecimento.rotulo,
                  }
                : null,
          };
        })}
        movimentacoes={(movimentos ?? [])
          .filter((mov) => registroPertenceAEmpresaAtiva(mov, empresaId))
          .map((mov) => ({
            id: String(mov.id),
            createdAt: String(mov.created_at),
            tipo: String(mov.tipo),
            origem: String(mov.origem),
            quantidade: Number(mov.quantidade ?? 0),
            saldoAnterior: Number(mov.saldo_anterior ?? 0),
            saldoPosterior: Number(mov.saldo_posterior ?? 0),
            observacao: mov.observacao ? String(mov.observacao) : null,
          }))}
        devolucoes={(devolucoes ?? [])
          .filter((dev) => registroPertenceAEmpresaAtiva(dev, empresaId))
          .map((dev) => ({
            id: String(dev.id),
            status: String(dev.status),
            createdAt: String(dev.created_at),
          }))}
      />
    </div>
  );
}
