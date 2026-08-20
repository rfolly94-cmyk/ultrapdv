import { notFound, redirect } from "next/navigation";

import { DevolucaoFornecedorDetalhe } from "@/components/fiscal/entrada/devolucao-fornecedor-detalhe";
import { PageHeader } from "@/components/ui/page-header";
import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { bloqueioCancelamentoDevolucaoFornecedor } from "@/lib/fiscal/entrada/devolucao-status";
import {
  grupoFiscalIdParaDevolucaoFornecedor,
} from "@/lib/fiscal/entrada/resolver-grupo-fiscal-devolucao";
import { parseEmitenteNfeEntrada } from "@/lib/fiscal/entrada/parse-xml-nfe";
import { tipoDestinoPorUf } from "@/lib/fiscal/operacoes/resolver-cfop";
import {
  resolverPoliticaCancelamentoFiscal,
  serializarPoliticaCancelamento,
} from "@/lib/fiscal/politica-cancelamento";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { classificacaoResumoDaEmissao } from "@/lib/fiscal/apresentacao-emissao";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function DevolucaoFornecedorPage({ params }: PageProps) {
  const { id } = await params;
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

  const { data: devolucao } = await supabase
    .from("fiscal_devolucoes_fornecedor")
    .select(
      `
      id, empresa_id, status, documento_entrada_id, natureza_id,
      chave_documento_origem, emissao_fiscal_id, tp_nf, fin_nfe,
      natureza_descricao, tipo_destino, uf_empresa, uf_fornecedor,
      saida_estoque_processada_at, created_at, dados_transporte,
      informacao_complementar_usuario, informacao_adicional_fisco, snapshot_fiscal
    `
    )
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (!devolucao || !registroPertenceAEmpresaAtiva(devolucao, empresaId)) {
    notFound();
  }

  const [{ data: entrada }, { data: itens }, { data: naturezas }, { data: movimentos }] =
    await Promise.all([
      supabase
        .from("fiscal_documentos_entrada")
        .select("id, empresa_id, numero, serie, razao_social_emitente, chave_acesso, xml_original, cnpj_emitente")
        .eq("id", devolucao.documento_entrada_id)
        .eq("empresa_id", empresaId)
        .maybeSingle(),
      supabase
        .from("fiscal_devolucoes_fornecedor_itens")
        .select(
          `
          id, quantidade, valor_unitario_original, valor_total, cfop_resolvido,
          ncm, produto_id, grupo_fiscal_id, documento_entrada_item_id, snapshot_fiscal,
          fiscal_documentos_entrada_itens!documento_entrada_item_id (
            descricao_original, cfop_original, dados_fiscais_original,
            documento_entrada_id, numero_item, quantidade_entrada_efetivada
          )
        `
        )
        .eq("empresa_id", empresaId)
        .eq("devolucao_id", devolucao.id),
      supabase
        .from("fiscal_naturezas_operacao")
        .select(
          "id, empresa_id, tipo_operacao_interno, descricao, tp_nf, fin_nfe, padrao, ativo"
        )
        .eq("empresa_id", empresaId)
        .eq("tipo_operacao_interno", "devolucao_fornecedor")
        .eq("ativo", true),
      supabase
        .from("estoque_movimentacoes")
        .select(
          "id, created_at, tipo, origem, quantidade, saldo_anterior, saldo_posterior, empresa_id"
        )
        .eq("empresa_id", empresaId)
        .eq("devolucao_fornecedor_id", devolucao.id)
        .order("created_at"),
    ]);

  if (!entrada || !registroPertenceAEmpresaAtiva(entrada, empresaId)) {
    notFound();
  }

  const produtoIds = [
    ...new Set(
      (itens ?? [])
        .map((item) => item.produto_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const { data: produtos } =
    produtoIds.length > 0
      ? await supabase
          .from("produtos")
          .select("id, empresa_id, nome, grupo_fiscal_id")
          .eq("empresa_id", empresaId)
          .in("id", produtoIds)
      : { data: [] };

  const produtoPorId = new Map(
    (produtos ?? [])
      .filter((produto) => registroPertenceAEmpresaAtiva(produto, empresaId))
      .map((produto) => [String(produto.id), produto])
  );

  const grupoIds = [
    ...new Set(
      (itens ?? [])
        .map((item) => {
          const produto = produtoPorId.get(String(item.produto_id));
          return grupoFiscalIdParaDevolucaoFornecedor({
            empresaIdAtiva: empresaId,
            snapshotFiscal: item.snapshot_fiscal,
            grupoFiscalIdItemDevolucao: item.grupo_fiscal_id,
            produtoEmpresaId: produto?.empresa_id,
            produtoGrupoFiscalId: produto?.grupo_fiscal_id,
          }).grupoFiscalId;
        })
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const [{ data: fiscalEmpresa }, { data: grupos }] = await Promise.all([
    supabase
      .from("empresas_fiscal")
      .select("empresa_id, uf, fuso_horario")
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    grupoIds.length > 0
      ? supabase
          .from("grupos_fiscais")
          .select("id, empresa_id, nome")
          .eq("empresa_id", empresaId)
          .in("id", grupoIds)
      : Promise.resolve({ data: [] }),
  ]);

  const emitente = entrada.xml_original
    ? parseEmitenteNfeEntrada(String(entrada.xml_original))
    : null;
  const destino = tipoDestinoPorUf(fiscalEmpresa?.uf, emitente?.uf);
  const grupoPorId = new Map(
    (grupos ?? [])
      .filter((grupo) => registroPertenceAEmpresaAtiva(grupo, empresaId))
      .map((grupo) => [String(grupo.id), String(grupo.nome)])
  );

  const entradaIdsItens = [
    ...new Set(
      (itens ?? [])
        .map((item) => {
          const original = Array.isArray(item.fiscal_documentos_entrada_itens)
            ? item.fiscal_documentos_entrada_itens[0]
            : item.fiscal_documentos_entrada_itens;
          return original?.documento_entrada_id
            ? String(original.documento_entrada_id)
            : "";
        })
        .filter(Boolean)
    ),
  ];

  const [{ data: entradasOrigem }, { data: transportadorasCadastro }] =
    await Promise.all([
      entradaIdsItens.length > 0
        ? supabase
            .from("fiscal_documentos_entrada")
            .select("id, empresa_id, numero, serie, chave_acesso")
            .eq("empresa_id", empresaId)
            .in("id", entradaIdsItens)
        : Promise.resolve({ data: [] }),
      supabase
        .from("transportadoras")
        .select(
          `
          id, nome_razao_social, nome_fantasia, cpf_cnpj, inscricao_estadual,
          rntrc, telefone, email, logradouro, numero, complemento, bairro,
          municipio, codigo_municipio_ibge, uf, cep
        `
        )
        .eq("empresa_id", empresaId)
        .eq("ativo", true)
        .order("nome_razao_social"),
    ]);

  const entradaOrigemPorId = new Map(
    (entradasOrigem ?? [])
      .filter((item) => registroPertenceAEmpresaAtiva(item, empresaId))
      .map((item) => [String(item.id), item])
  );

  const transportadoraIds = (transportadorasCadastro ?? []).map((item) =>
    String(item.id)
  );
  const { data: veiculosCadastro } =
    transportadoraIds.length > 0
      ? await supabase
          .from("transportadoras_veiculos")
          .select("id, transportadora_id, placa, uf, rntrc, descricao")
          .eq("empresa_id", empresaId)
          .eq("ativo", true)
          .in("transportadora_id", transportadoraIds)
      : { data: [] };

  let emissao = null;
  if (devolucao.emissao_fiscal_id) {
    const { data } = await supabase
      .from("fiscal_emissoes")
      .select(
        "id, empresa_id, status, modelo, serie, numero, chave_acesso, protocolo, cstat, motivo, geranet_http_status, geranet_situacao, erro_comunicacao, resposta_resumo, tentativas, origem_tipo, origem_id, autorizada_at"
      )
      .eq("id", devolucao.emissao_fiscal_id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (data && registroPertenceAEmpresaAtiva(data, empresaId)) {
      emissao = data;
    }
  }

  const { data: eventosFiscais } = emissao
    ? await supabase
        .from("fiscal_emissao_eventos")
        .select(
          `
          id,
          emissao_id,
          tipo,
          status,
          sequencia,
          justificativa,
          texto_correcao,
          cstat,
          protocolo,
          motivo,
          xml_hex,
          concluido_at,
          created_at
        `
        )
        .eq("empresa_id", empresaId)
        .eq("emissao_id", emissao.id)
        .order("created_at", { ascending: false })
    : { data: [] };

  const { data: tentativasFiscais } = emissao
    ? await supabase
        .from("fiscal_emissao_tentativas")
        .select(
          "id, emissao_id, tentativa, cstat, motivo, classificacao_inicial, http_status, iniciada_at, respondida_at, finalizada_at"
        )
        .eq("empresa_id", empresaId)
        .eq("emissao_id", emissao.id)
        .order("tentativa", { ascending: true })
    : { data: [] };

  if (
    emissao?.status === "autorizada" &&
    !devolucao.saida_estoque_processada_at &&
    devolucao.status !== "aguardando_saida" &&
    devolucao.status !== "concluida"
  ) {
    const admin = createAdminClient();
    await admin
      .from("fiscal_devolucoes_fornecedor")
      .update({ status: "aguardando_saida" })
      .eq("id", devolucao.id)
      .eq("empresa_id", empresaId)
      .neq("status", "concluida");
    devolucao.status = "aguardando_saida";
  }

  if (
    emissao?.status === "aguardando_reconciliacao" &&
    devolucao.status !== "aguardando_reconciliacao"
  ) {
    const admin = createAdminClient();
    await admin
      .from("fiscal_devolucoes_fornecedor")
      .update({ status: "aguardando_reconciliacao" })
      .eq("id", devolucao.id)
      .eq("empresa_id", empresaId);
    devolucao.status = "aguardando_reconciliacao";
  }

  return (
    <div className="updv-page">
      <PageHeader
        title="Devolução ao fornecedor"
        breadcrumb={[
          { label: "Fiscal", href: "/fiscal" },
          { label: "Notas de entrada", href: "/fiscal/entradas" },
          {
            label: `Nota ${entrada.numero}`,
            href: `/fiscal/entradas/${entrada.id}`,
          },
          { label: "Devolução" },
        ]}
      />
      <DevolucaoFornecedorDetalhe
        devolucao={{
          id: String(devolucao.id),
          status: String(devolucao.status),
          chaveOrigem: String(devolucao.chave_documento_origem),
          naturezaDescricao: devolucao.natureza_descricao,
          naturezaId: devolucao.natureza_id,
          tpNf: devolucao.tp_nf,
          finNfe: devolucao.fin_nfe,
          tipoDestino: devolucao.tipo_destino,
          saidaProcessadaEm: devolucao.saida_estoque_processada_at,
          dadosTransporte: (devolucao.dados_transporte ??
            null) as import("@/components/vendas/transporte-venda-form").DadosTransporteVenda | null,
          informacaoComplementarUsuario:
            devolucao.informacao_complementar_usuario,
          informacaoAdicionalFisco: devolucao.informacao_adicional_fisco,
          serieEmissao: emissao?.serie ? String(emissao.serie) : null,
          numeroEmissao: emissao?.numero ? String(emissao.numero) : null,
        }}
        entrada={{
          id: String(entrada.id),
          numero: String(entrada.numero),
          fornecedor: String(entrada.razao_social_emitente),
          ufFornecedor: emitente?.uf ?? null,
          ufEmpresa: fiscalEmpresa?.uf
            ? String(fiscalEmpresa.uf).toUpperCase()
            : null,
        }}
        contexto={{
          destino,
          regraCfopConfigurada: (itens ?? []).every((item) =>
            /^\d{4}$/.test(String(item.cfop_resolvido ?? ""))
          ),
        }}
        naturezas={(naturezas ?? [])
          .filter((natureza) =>
            registroPertenceAEmpresaAtiva(natureza, empresaId)
          )
          .map((natureza) => ({
            id: String(natureza.id),
            descricao: String(natureza.descricao),
            tpNf: String(natureza.tp_nf),
            finNfe: String(natureza.fin_nfe),
          }))}
        itens={(itens ?? []).map((item) => {
          const original = Array.isArray(item.fiscal_documentos_entrada_itens)
            ? item.fiscal_documentos_entrada_itens[0]
            : item.fiscal_documentos_entrada_itens;
          const produto = produtoPorId.get(String(item.produto_id));
          const grupoId = grupoFiscalIdParaDevolucaoFornecedor({
            empresaIdAtiva: empresaId,
            snapshotFiscal: item.snapshot_fiscal,
            grupoFiscalIdItemDevolucao: item.grupo_fiscal_id,
            produtoEmpresaId: produto?.empresa_id,
            produtoGrupoFiscalId: produto?.grupo_fiscal_id,
          }).grupoFiscalId;
          return {
            id: String(item.id),
            descricao: original?.descricao_original || produto?.nome || "Item",
            quantidade: Number(item.quantidade),
            valorTotal: Number(item.valor_total ?? 0),
            cfop: item.cfop_resolvido,
            cfopOriginal: original?.cfop_original
              ? String(original.cfop_original)
              : null,
            ncm: item.ncm,
            grupoFiscalNome: grupoId
              ? grupoPorId.get(String(grupoId)) ?? null
              : null,
            documentoEntradaId: original?.documento_entrada_id
              ? String(original.documento_entrada_id)
              : null,
            numeroItemOriginal: original?.numero_item
              ? Number(original.numero_item)
              : null,
            quantidadeRecebida: Number(
              original?.quantidade_entrada_efetivada ?? 0
            ),
            cstOriginal: String(
              (item.snapshot_fiscal as { cst_original?: string } | null)
                ?.cst_original ??
                (item.snapshot_fiscal as { csosn_original?: string } | null)
                  ?.csosn_original ??
                ""
            ),
            csosnDevolucao: String(
              (item.snapshot_fiscal as { icms_cst_csosn?: string } | null)
                ?.icms_cst_csosn ?? ""
            ),
            chaveOrigem: String(
              (item.snapshot_fiscal as { chave_documento_origem?: string } | null)
                ?.chave_documento_origem ??
                entradaOrigemPorId.get(String(original?.documento_entrada_id ?? ""))
                  ?.chave_acesso ??
                ""
            ),
            numeroOrigem: String(
              entradaOrigemPorId.get(String(original?.documento_entrada_id ?? ""))
                ?.numero ?? entrada.numero
            ),
          };
        })}
        emissao={
          emissao
            ? {
                id: String(emissao.id),
                status: String(emissao.status),
                modelo: String(emissao.modelo ?? "55"),
                serie: String(emissao.serie ?? ""),
                numero: String(emissao.numero ?? ""),
                chaveAcesso: emissao.chave_acesso,
                protocolo: emissao.protocolo,
                cstat: emissao.cstat,
                motivo: emissao.motivo,
                geranetHttpStatus: emissao.geranet_http_status,
                geranetSituacao: emissao.geranet_situacao,
                erroComunicacao: emissao.erro_comunicacao,
                classificacao: classificacaoResumoDaEmissao(emissao.resposta_resumo),
                origemTipo: emissao.origem_tipo,
                autorizadaAt: emissao.autorizada_at,
              }
            : null
        }
        eventos={(eventosFiscais ?? []).map((evento) => ({
          id: String(evento.id),
          emissao_id: evento.emissao_id,
          tipo: String(evento.tipo),
          status: String(evento.status),
          sequencia: evento.sequencia,
          justificativa: evento.justificativa,
          texto_correcao: evento.texto_correcao,
          cstat: evento.cstat,
          protocolo: evento.protocolo,
          motivo: evento.motivo,
          xml_hex: evento.xml_hex,
          concluido_at: evento.concluido_at,
          created_at: String(evento.created_at),
        }))}
        tentativas={(tentativasFiscais ?? []).map((tentativa) => ({
          id: String(tentativa.id),
          emissao_id: String(tentativa.emissao_id),
          tentativa: Number(tentativa.tentativa),
          cstat: tentativa.cstat,
          motivo: tentativa.motivo,
          classificacao_inicial: tentativa.classificacao_inicial,
          http_status: tentativa.http_status,
          iniciada_at: tentativa.iniciada_at,
          respondida_at: tentativa.respondida_at,
          finalizada_at: tentativa.finalizada_at,
        }))}
        tentativasCabecalho={Number(emissao?.tentativas ?? 0)}
        politicaCancelamento={
          emissao
            ? serializarPoliticaCancelamento(
                resolverPoliticaCancelamentoFiscal({
                  uf: fiscalEmpresa?.uf ?? "",
                  modelo: String(emissao.modelo ?? "55"),
                  status: String(emissao.status),
                  autorizadoEm: emissao.autorizada_at,
                  fusoHorario: fiscalEmpresa?.fuso_horario ?? null,
                })
              )
            : null
        }
        bloqueioCancelamentoOperacional={bloqueioCancelamentoDevolucaoFornecedor(
          devolucao.saida_estoque_processada_at
        )}
        transportadoras={(transportadorasCadastro ?? []).map((transportadora) => ({
          id: String(transportadora.id),
          nome_razao_social: String(transportadora.nome_razao_social ?? ""),
          nome_fantasia: String(transportadora.nome_fantasia ?? ""),
          cpf_cnpj: String(transportadora.cpf_cnpj ?? ""),
          inscricao_estadual: String(transportadora.inscricao_estadual ?? ""),
          rntrc: String(transportadora.rntrc ?? ""),
          telefone: String(transportadora.telefone ?? ""),
          email: String(transportadora.email ?? ""),
          logradouro: String(transportadora.logradouro ?? ""),
          numero: String(transportadora.numero ?? ""),
          complemento: String(transportadora.complemento ?? ""),
          bairro: String(transportadora.bairro ?? ""),
          municipio: String(transportadora.municipio ?? ""),
          codigo_municipio_ibge: String(
            transportadora.codigo_municipio_ibge ?? ""
          ),
          uf: String(transportadora.uf ?? ""),
          cep: String(transportadora.cep ?? ""),
          veiculos: (veiculosCadastro ?? [])
            .filter(
              (veiculo) =>
                String(veiculo.transportadora_id) === String(transportadora.id)
            )
            .map((veiculo) => ({
              id: String(veiculo.id),
              placa: String(veiculo.placa ?? ""),
              uf: String(veiculo.uf ?? ""),
              rntrc: String(veiculo.rntrc ?? ""),
              descricao: String(veiculo.descricao ?? ""),
            })),
        }))}
        movimentacoes={(movimentos ?? [])
          .filter((mov) => registroPertenceAEmpresaAtiva(mov, empresaId))
          .map((mov) => ({
            id: String(mov.id),
            createdAt: String(mov.created_at),
            tipo: String(mov.tipo),
            origem: String(mov.origem),
            quantidade: Number(mov.quantidade),
            saldoAnterior: Number(mov.saldo_anterior),
            saldoPosterior: Number(mov.saldo_posterior),
          }))}
      />
    </div>
  );
}
