import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { FiscalModuleTabs } from "@/components/fiscal/fiscal-module-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { FiscalDocumentosLista } from "@/components/fiscal/fiscal-documentos-lista";
import {
  hrefOrigemEmissaoFiscal,
  rotuloOrigemEmissaoFiscal,
} from "@/lib/fiscal/acoes-emissao";
import { classificacaoResumoDaEmissao } from "@/lib/fiscal/apresentacao-emissao";
import { rotuloTipoOperacao } from "@/lib/fiscal/operacoes/catalogo";

export const dynamic = "force-dynamic";

export default async function FiscalPage() {
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

  const { data: emissoes, error: emissoesError } = await supabase
    .from("fiscal_emissoes")
    .select(
      `
      id,
      origem_id,
      origem_tipo,
      tipo_operacao_interno,
      modelo,
      serie,
      numero,
      status,
      chave_acesso,
      protocolo,
      cstat,
      motivo,
      geranet_http_status,
      geranet_situacao,
      erro_comunicacao,
      resposta_resumo,
      autorizada_at,
      created_at
    `
    )
    .eq("empresa_id", vinculo.empresa_id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (emissoesError) {
    throw new Error(emissoesError.message);
  }

  const vendaIds = [
    ...new Set(
      (emissoes ?? [])
        .filter((item) => item.origem_tipo === "venda")
        .map((item) => item.origem_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const devolucaoIds = [
    ...new Set(
      (emissoes ?? [])
        .filter((item) => item.origem_tipo === "devolucao_fornecedor")
        .map((item) => item.origem_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const operacaoIds = [
    ...new Set(
      (emissoes ?? [])
        .filter((item) => item.origem_tipo === "operacao_fiscal")
        .map((item) => item.origem_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const vendas =
    vendaIds.length > 0
      ? (
          await supabase
            .from("vendas")
            .select("id, numero, cliente_nome, valor_total")
            .eq("empresa_id", vinculo.empresa_id)
            .in("id", vendaIds)
        ).data ?? []
      : [];

  const devolucoes =
    devolucaoIds.length > 0
      ? (
          await supabase
            .from("fiscal_devolucoes_fornecedor")
            .select("id, documento_entrada_id")
            .eq("empresa_id", vinculo.empresa_id)
            .in("id", devolucaoIds)
        ).data ?? []
      : [];

  const operacoes =
    operacaoIds.length > 0
      ? (
          await supabase
            .from("fiscal_operacoes")
            .select(
              "id, tipo_operacao_interno, destinatario_tipo, destinatario_id, destino_empresa_id"
            )
            .eq("empresa_id", vinculo.empresa_id)
            .in("id", operacaoIds)
        ).data ?? []
      : [];

  const itensOperacao =
    operacaoIds.length > 0
      ? (
          await supabase
            .from("fiscal_operacoes_itens")
            .select("operacao_id, valor_total")
            .eq("empresa_id", vinculo.empresa_id)
            .in("operacao_id", operacaoIds)
        ).data ?? []
      : [];

  const entradaIds = [
    ...new Set(
      devolucoes
        .map((item) => item.documento_entrada_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const entradas =
    entradaIds.length > 0
      ? (
          await supabase
            .from("fiscal_documentos_entrada")
            .select("id, numero, razao_social_emitente")
            .eq("empresa_id", vinculo.empresa_id)
            .in("id", entradaIds)
        ).data ?? []
      : [];

  const clienteOperacaoIds = [
    ...new Set(
      operacoes
        .filter((item) => item.destinatario_tipo === "cliente")
        .map((item) => item.destinatario_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const destinoEmpresaIds = [
    ...new Set(
      operacoes
        .map((item) => item.destino_empresa_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const clientesOperacao =
    clienteOperacaoIds.length > 0
      ? (
          await supabase
            .from("clientes")
            .select("id, nome")
            .eq("empresa_id", vinculo.empresa_id)
            .in("id", clienteOperacaoIds)
        ).data ?? []
      : [];
  const empresasDestino =
    destinoEmpresaIds.length > 0
      ? (
          await supabase
            .from("empresas")
            .select("id, razao_social, nome_fantasia")
            .in("id", destinoEmpresaIds)
        ).data ?? []
      : [];
  const { data: empresaOrigem } = await supabase
    .from("empresas")
    .select("id, razao_social, nome_fantasia")
    .eq("id", vinculo.empresa_id)
    .maybeSingle();

  const vendaPorId = new Map(vendas.map((venda) => [venda.id, venda]));
  const entradaPorDevolucaoId = new Map(
    devolucoes.map((devolucao) => [
      devolucao.id,
      entradas.find((entrada) => entrada.id === devolucao.documento_entrada_id) ??
        null,
    ])
  );
  const operacaoPorId = new Map(operacoes.map((item) => [item.id, item]));
  const clienteOperacaoPorId = new Map(
    clientesOperacao.map((item) => [item.id, item])
  );
  const empresaDestinoPorId = new Map(
    empresasDestino.map((item) => [String(item.id), item])
  );
  const valorOperacaoPorId = new Map<string, number>();
  for (const item of itensOperacao) {
    const id = String(item.operacao_id);
    valorOperacaoPorId.set(
      id,
      (valorOperacaoPorId.get(id) ?? 0) + Number(item.valor_total ?? 0)
    );
  }
  const nomeEmpresaOrigem = String(
    empresaOrigem?.nome_fantasia || empresaOrigem?.razao_social || "Origem"
  );

  const itens = (emissoes ?? []).map((emissao) => {
    const origemHref = hrefOrigemEmissaoFiscal(
      emissao.origem_tipo,
      emissao.origem_id
    );
    const venda =
      emissao.origem_tipo === "venda" && emissao.origem_id
        ? vendaPorId.get(emissao.origem_id)
        : null;
    const entrada =
      emissao.origem_tipo === "devolucao_fornecedor" && emissao.origem_id
        ? entradaPorDevolucaoId.get(emissao.origem_id)
        : null;
    const operacao =
      emissao.origem_tipo === "operacao_fiscal" && emissao.origem_id
        ? operacaoPorId.get(emissao.origem_id)
        : null;
    const tipoOperacao =
      String(
        operacao?.tipo_operacao_interno ||
          emissao.tipo_operacao_interno ||
          (emissao.origem_tipo === "venda"
            ? "venda"
            : emissao.origem_tipo === "devolucao_fornecedor"
              ? "devolucao_fornecedor"
              : "")
      ) || "outra";
    const destinoEmpresa = operacao?.destino_empresa_id
      ? empresaDestinoPorId.get(String(operacao.destino_empresa_id))
      : null;
    const destNome =
      destinoEmpresa?.nome_fantasia || destinoEmpresa?.razao_social || "";
    const clienteOperacao = operacao?.destinatario_id
      ? clienteOperacaoPorId.get(operacao.destinatario_id)
      : null;

    return {
      id: emissao.id,
      origemHref,
      origemLabel: rotuloOrigemEmissaoFiscal(emissao.origem_tipo),
      tipoOperacao,
      tipoLabel: rotuloTipoOperacao(tipoOperacao),
      modelo: emissao.modelo,
      serie: emissao.serie,
      numero: String(emissao.numero),
      status: emissao.status,
      cstat: emissao.cstat,
      motivo: emissao.motivo,
      geranetHttpStatus: emissao.geranet_http_status,
      geranetSituacao: emissao.geranet_situacao,
      erroComunicacao: emissao.erro_comunicacao,
      classificacao: classificacaoResumoDaEmissao(emissao.resposta_resumo),
      protocolo: emissao.protocolo,
      chaveAcesso: emissao.chave_acesso,
      cliente:
        venda?.cliente_nome ??
        entrada?.razao_social_emitente ??
        (tipoOperacao === "transferencia" && destNome
          ? `${nomeEmpresaOrigem} → ${destNome}`
          : clienteOperacao?.nome) ??
        (emissao.origem_tipo === "devolucao_fornecedor"
          ? "Devolução ao fornecedor"
          : "—"),
      valor:
        Number(venda?.valor_total ?? 0) ||
        (operacao ? valorOperacaoPorId.get(String(operacao.id)) ?? 0 : 0),
      data: emissao.autorizada_at ?? emissao.created_at,
    };
  });

  return (
    <div className="updv-page">
      <PageHeader
        title="Fiscal"
        description="Documentos fiscais emitidos pela empresa."
        count={itens.length}
        actions={
          <Link href="/fiscal/nfe/nova" className="updv-btn updv-btn-primary">
            Nova NF-e
          </Link>
        }
      />
      <FiscalModuleTabs />
      <FiscalDocumentosLista documentos={itens} />
    </div>
  );
}
