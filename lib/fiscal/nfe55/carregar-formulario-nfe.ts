import { notFound } from "next/navigation";

import type { DadosTransporteVenda } from "@/components/vendas/transporte-venda-form";
import { buscarCaixaAbertoEmpresa } from "@/lib/caixa/sessao-aberta";
import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import { temPermissao } from "@/lib/permissoes/tem-permissao";
import { pagamentosRascunhoDoSnapshot } from "@/lib/fiscal/nfe55/pagamentos-rascunho";
import { lerCabecalhoFiscalDoSnapshot } from "@/lib/fiscal/nfe55/cabecalho-fiscal";
import { totaisNotaDoSnapshot } from "@/lib/fiscal/nfe55/totais-nota";
import { lerEnderecoEntregaDoSnapshot } from "@/lib/fiscal/nfe55/endereco-entrega";
import { lerAutorizadosXmlDoSnapshot } from "@/lib/fiscal/nfe55/autorizados-xml";
import { bloqueioCancelamentoOperacaoFiscal } from "@/lib/fiscal/operacoes/status-operacao";
import {
  lerSnapshotDestinatarioFiscal,
  normalizarIndicadorIeDestinatario,
} from "@/lib/fiscal/destinatario/resolver-destinatario-fiscal";
import {
  resolverPoliticaCancelamentoFiscal,
  serializarPoliticaCancelamento,
} from "@/lib/fiscal/politica-cancelamento";
import {
  classificarIntegracaoPix,
  pixConfigPublicoPdv,
} from "@/lib/pagamentos/pix/modo-ativo";
import { filtrarFormasPagamentoCheckoutPdv } from "@/lib/pdv/formas-pagamento-checkout";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { classificacaoResumoDaEmissao } from "@/lib/fiscal/apresentacao-emissao";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const COLUNAS_CLIENTE = `
  id, empresa_id, nome, nome_fantasia, tipo_pessoa, cpf_cnpj, inscricao_estadual,
  contribuinte_icms, indicador_ie_destinatario, consumidor_final, telefone, email, cep, uf, municipio, bairro,
  logradouro, numero, complemento, codigo_municipio_ibge
`;

function mapearCliente(cliente: Record<string, unknown>) {
  return {
    id: String(cliente.id),
    nome: String(cliente.nome ?? ""),
    nomeFantasia: cliente.nome_fantasia ? String(cliente.nome_fantasia) : null,
    tipoPessoa: String(cliente.tipo_pessoa ?? ""),
    cpfCnpj: String(cliente.cpf_cnpj ?? ""),
    inscricaoEstadual: cliente.inscricao_estadual
      ? String(cliente.inscricao_estadual)
      : null,
    contribuinteIcms: Boolean(cliente.contribuinte_icms),
    indicadorIe: normalizarIndicadorIeDestinatario(
      cliente.indicador_ie_destinatario,
      Boolean(cliente.contribuinte_icms)
    ),
    consumidorFinal: Boolean(cliente.consumidor_final),
    telefone: cliente.telefone ? String(cliente.telefone) : null,
    email: cliente.email ? String(cliente.email) : null,
    cep: cliente.cep ? String(cliente.cep) : null,
    uf: cliente.uf ? String(cliente.uf) : null,
    municipio: cliente.municipio ? String(cliente.municipio) : null,
    codigoMunicipioIbge: cliente.codigo_municipio_ibge
      ? String(cliente.codigo_municipio_ibge)
      : null,
    bairro: cliente.bairro ? String(cliente.bairro) : null,
    logradouro: cliente.logradouro ? String(cliente.logradouro) : null,
    numero: cliente.numero ? String(cliente.numero) : null,
    complemento: cliente.complemento ? String(cliente.complemento) : null,
  };
}

export async function carregarFormularioNfeEmissao({
  supabase,
  empresaId,
  usuarioId,
  operacaoId,
}: {
  supabase: Supabase;
  empresaId: string;
  usuarioId: string;
  operacaoId?: string | null;
}) {
  let operacao: {
    id: string;
    empresa_id: string;
    tipo_operacao_interno: string;
    status: string;
    natureza_id: string | null;
    destinatario_id: string | null;
    destino_empresa_id: string | null;
    vinculo_transferencia_id: string | null;
    destino_gerenciado_no_ultra: boolean | null;
    natureza_descricao: string | null;
    tp_nf: string | null;
    fin_nfe: string | null;
    saida_estoque_processada_at: string | null;
    recebimento_processado_at: string | null;
    dados_transporte: unknown;
    informacao_complementar_usuario: string | null;
    informacao_adicional_fisco: string | null;
    emissao_fiscal_id: string | null;
    venda_id: string | null;
    snapshot_fiscal: unknown;
  } | null = null;

  if (operacaoId) {
    const { data } = await supabase
      .from("fiscal_operacoes")
      .select(
        `
        id, empresa_id, tipo_operacao_interno, status, natureza_id, destinatario_id,
        destino_empresa_id, vinculo_transferencia_id, destino_gerenciado_no_ultra,
        natureza_descricao, tp_nf, fin_nfe, saida_estoque_processada_at,
        recebimento_processado_at, dados_transporte, informacao_complementar_usuario,
        informacao_adicional_fisco, emissao_fiscal_id, venda_id, snapshot_fiscal
      `
      )
      .eq("id", operacaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!data || !registroPertenceAEmpresaAtiva(data, empresaId)) {
      notFound();
    }
    if (
      data.tipo_operacao_interno !== "bonificacao" &&
      data.tipo_operacao_interno !== "transferencia" &&
      data.tipo_operacao_interno !== "venda"
    ) {
      notFound();
    }
    operacao = data;
  }

  const [
    { data: empresa },
    { data: fiscalEmpresa },
    { data: itens },
    { data: naturezas },
    { data: tiposOperacao },
    { data: numeracoes },
    { data: vinculos },
    { data: transportadorasCadastro },
    { data: acessos },
  ] = await Promise.all([
    supabase
      .from("empresas")
      .select("id, razao_social, nome_fantasia, cnpj")
      .eq("id", empresaId)
      .maybeSingle(),
    supabase
      .from("empresas_fiscal")
      .select(
        "empresa_id, uf, fuso_horario, ambiente, codigo_regime_tributario, indicador_presenca_padrao, indicativo_intermediador_padrao"
      )
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    operacao
      ? supabase
          .from("fiscal_operacoes_itens")
          .select(
            "id, produto_id, quantidade, valor_unitario, valor_total, cfop_resolvido, snapshot_fiscal"
          )
          .eq("empresa_id", empresaId)
          .eq("operacao_id", operacao.id)
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from("fiscal_naturezas_operacao")
      .select(
        "id, empresa_id, descricao, tipo_operacao_interno, tp_nf, fin_nfe, padrao, ativo"
      )
      .eq("empresa_id", empresaId)
      .eq("ativo", true)
      .order("descricao"),
    supabase
      .from("fiscal_tipos_operacao")
      .select("codigo, rotulo, movimenta_estoque, vincula_venda"),
    supabase
      .from("fiscal_numeracoes")
      .select("modelo, ambiente, serie, proximo_numero, ativo")
      .eq("empresa_id", empresaId)
      .in("modelo", ["55", "65"])
      .eq("ativo", true),
    supabase
      .from("fiscal_vinculos_transferencia")
      .select("id, empresa_origem_id, empresa_destino_id, ativo")
      .eq("empresa_origem_id", empresaId)
      .eq("ativo", true),
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
    supabase
      .from("usuarios_empresas")
      .select("empresa_id")
      .eq("usuario_id", usuarioId)
      .eq("ativo", true),
  ]);

  const produtoIds = [...new Set((itens ?? []).map((item) => String(item.produto_id)))];
  const [{ data: produtos }, { data: produtosFiscal }, { data: estoques }] =
    produtoIds.length > 0
      ? await Promise.all([
          supabase
            .from("produtos")
            .select("id, empresa_id, nome, codigo, unidade_medida, grupo_fiscal_id, preco_venda")
            .eq("empresa_id", empresaId)
            .in("id", produtoIds),
          supabase
            .from("produtos_fiscal")
            .select("produto_id, ncm")
            .eq("empresa_id", empresaId)
            .in("produto_id", produtoIds),
          supabase
            .from("estoque_atual")
            .select("produto_id, quantidade")
            .eq("empresa_id", empresaId)
            .in("produto_id", produtoIds),
        ])
      : [
          { data: [] as never[] },
          { data: [] as never[] },
          { data: [] as never[] },
        ];

  const grupoIds = [
    ...new Set(
      (produtos ?? [])
        .map((item) => item.grupo_fiscal_id)
        .filter((id): id is string => Boolean(id))
        .map((id) => String(id))
    ),
  ];
  const { data: grupos } =
    grupoIds.length > 0
      ? await supabase
          .from("grupos_fiscais")
          .select("id, empresa_id, icms_cst_csosn")
          .eq("empresa_id", empresaId)
          .in("id", grupoIds)
      : { data: [] };

  let clientesCarregados: ReturnType<typeof mapearCliente>[] = [];
  if (operacao?.destinatario_id) {
    const { data: cliente } = await supabase
      .from("clientes")
      .select(COLUNAS_CLIENTE)
      .eq("id", operacao.destinatario_id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (cliente && registroPertenceAEmpresaAtiva(cliente, empresaId)) {
      clientesCarregados = [mapearCliente(cliente as Record<string, unknown>)];
    }
  }

  const destIds = (vinculos ?? []).map((item) => String(item.empresa_destino_id));
  const acessoIds = [
    ...new Set(
      (acessos ?? [])
        .map((item) => String(item.empresa_id))
        .filter((item) => item && item !== empresaId)
    ),
  ];
  const empresasIds = [...new Set([...destIds, ...acessoIds])];
  const { data: empresasDest } =
    empresasIds.length > 0
      ? await supabase.from("empresas").select("id, razao_social, nome_fantasia, cnpj").in("id", empresasIds)
      : { data: [] };
  const empresaPorId = new Map((empresasDest ?? []).map((item) => [String(item.id), item]));

  const transportadoraIds = (transportadorasCadastro ?? []).map((item) => String(item.id));
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
  if (operacao?.emissao_fiscal_id) {
    const { data } = await supabase
      .from("fiscal_emissoes")
      .select(
        "id, empresa_id, status, modelo, serie, numero, chave_acesso, protocolo, cstat, motivo, geranet_http_status, geranet_situacao, erro_comunicacao, resposta_resumo, tentativas, autorizada_at"
      )
      .eq("id", operacao.emissao_fiscal_id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (data && registroPertenceAEmpresaAtiva(data, empresaId)) {
      emissao = data;
    }
  }
  if (!emissao && operacao?.venda_id) {
    const { data } = await supabase
      .from("fiscal_emissoes")
      .select(
        "id, empresa_id, status, modelo, serie, numero, chave_acesso, protocolo, cstat, motivo, geranet_http_status, geranet_situacao, erro_comunicacao, resposta_resumo, tentativas, autorizada_at"
      )
      .eq("empresa_id", empresaId)
      .eq("origem_tipo", "venda")
      .eq("origem_id", operacao.venda_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data && registroPertenceAEmpresaAtiva(data, empresaId)) {
      emissao = data;
      if (!operacao.emissao_fiscal_id) {
        const admin = createAdminClient();
        await admin
          .from("fiscal_operacoes")
          .update({ emissao_fiscal_id: data.id })
          .eq("id", operacao.id)
          .eq("empresa_id", empresaId);
        operacao.emissao_fiscal_id = data.id;
      }
    }
  }

  const { data: eventosFiscais } = emissao
    ? await supabase
        .from("fiscal_emissao_eventos")
        .select(
          "id, emissao_id, tipo, status, sequencia, justificativa, texto_correcao, cstat, protocolo, motivo, xml_hex, concluido_at, created_at"
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

  if (operacao && emissao) {
    if (
      operacao.tipo_operacao_interno !== "venda" &&
      emissao.status === "autorizada" &&
      !operacao.saida_estoque_processada_at &&
      operacao.status !== "aguardando_saida" &&
      operacao.status !== "em_transito" &&
      operacao.status !== "concluida"
    ) {
      const admin = createAdminClient();
      await admin
        .from("fiscal_operacoes")
        .update({ status: "aguardando_saida" })
        .eq("id", operacao.id)
        .eq("empresa_id", empresaId);
      operacao.status = "aguardando_saida";
    }
    if (
      operacao.tipo_operacao_interno === "venda" &&
      emissao.status === "autorizada" &&
      operacao.status !== "concluida"
    ) {
      const admin = createAdminClient();
      await admin
        .from("fiscal_operacoes")
        .update({ status: "concluida" })
        .eq("id", operacao.id)
        .eq("empresa_id", empresaId);
      operacao.status = "concluida";
    }
    if (
      emissao.status === "aguardando_reconciliacao" &&
      operacao.status !== "aguardando_reconciliacao"
    ) {
      const admin = createAdminClient();
      await admin
        .from("fiscal_operacoes")
        .update({ status: "aguardando_reconciliacao" })
        .eq("id", operacao.id)
        .eq("empresa_id", empresaId);
      operacao.status = "aguardando_reconciliacao";
    }
  }

  const produtoPorId = new Map((produtos ?? []).map((p) => [String(p.id), p]));
  const ncmPorProduto = new Map(
    (produtosFiscal ?? []).map((item) => [String(item.produto_id), item.ncm])
  );
  const estoquePorId = new Map(
    (estoques ?? []).map((item) => [String(item.produto_id), Number(item.quantidade ?? 0)])
  );
  const icmsPorGrupo = new Map(
    (grupos ?? []).map((item) => [String(item.id), item.icms_cst_csosn])
  );

  const ambiente = String(fiscalEmpresa?.ambiente ?? "");
  const numeracoesDoAmbiente = (numeracoes ?? []).filter(
    (item) => String(item.ambiente) === ambiente
  );
  const seriesNfe = numeracoesDoAmbiente
    .filter((item) => String(item.modelo) === "55")
    .map((item) => ({
      serie: Number(item.serie),
      proximoNumero: Number(item.proximo_numero ?? 1),
    }))
    .filter((item) => Number.isInteger(item.serie) && item.serie > 0)
    .sort((a, b) => a.serie - b.serie);
  const cabecalho = lerCabecalhoFiscalDoSnapshot(operacao?.snapshot_fiscal);
  const numeracao55 =
    (cabecalho.serie != null
      ? seriesNfe.find((item) => item.serie === cabecalho.serie)
      : null) ??
    seriesNfe[0] ??
    null;
  const numeracao65 =
    numeracoesDoAmbiente.find((item) => String(item.modelo) === "65") ??
    (numeracoes ?? []).find((item) => String(item.modelo) === "65") ??
    null;

  const [
    { data: formasPagamento },
    { data: integracaoPix },
    caixaAbertoRegistro,
    sessaoPermissoes,
  ] = await Promise.all([
    supabase
      .from("formas_pagamento")
      .select(
        "id, codigo, nome, tipo, codigo_fiscal, permite_troco, permite_fiado, permite_parcelamento, ordem"
      )
      .eq("empresa_id", empresaId)
      .eq("ativo", true)
      .order("ordem"),
    supabase
      .from("integracoes_pix")
      .select("id, modo, ativo, provedor")
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    buscarCaixaAbertoEmpresa(supabase, empresaId),
    obterPermissoesSessao(),
  ]);

  const snapDestinatario = lerSnapshotDestinatarioFiscal(operacao?.snapshot_fiscal);

  return {
    operacao: {
      id: operacao ? String(operacao.id) : null,
      tipo: operacao ? String(operacao.tipo_operacao_interno) : "",
      status: operacao ? String(operacao.status) : "rascunho",
      naturezaId: operacao?.natureza_id ?? null,
      naturezaDescricao: operacao?.natureza_descricao ?? null,
      tpNf: cabecalho.tpNf ?? operacao?.tp_nf ?? null,
      finNfe: cabecalho.finNfe ?? operacao?.fin_nfe ?? null,
      destinatarioId: operacao?.destinatario_id ?? null,
      destinoEmpresaId: operacao?.destino_empresa_id ?? null,
      vinculoId: operacao?.vinculo_transferencia_id ?? null,
      destinoGerenciado: Boolean(operacao?.destino_gerenciado_no_ultra),
      saidaProcessadaEm: operacao?.saida_estoque_processada_at ?? null,
      recebimentoProcessadoEm: operacao?.recebimento_processado_at ?? null,
      dadosTransporte: (operacao?.dados_transporte ?? null) as DadosTransporteVenda | null,
      informacaoComplementarUsuario: operacao?.informacao_complementar_usuario ?? null,
      informacaoAdicionalFisco: operacao?.informacao_adicional_fisco ?? null,
      serieEmissao: emissao?.serie
        ? String(emissao.serie)
        : cabecalho.serie != null
          ? String(cabecalho.serie)
          : null,
      numeroEmissao: emissao?.numero
        ? String(emissao.numero)
        : cabecalho.numero != null
          ? String(cabecalho.numero)
          : null,
      vendaId: operacao?.venda_id ? String(operacao.venda_id) : null,
      pagamentosRascunho: pagamentosRascunhoDoSnapshot(operacao?.snapshot_fiscal),
      totaisNota: totaisNotaDoSnapshot(operacao?.snapshot_fiscal),
      enderecoEntrega: lerEnderecoEntregaDoSnapshot(operacao?.snapshot_fiscal),
      autorizadosXml: lerAutorizadosXmlDoSnapshot(operacao?.snapshot_fiscal),
      consumidorFinalSnapshot: snapDestinatario.consumidorFinal,
      consumidorFinalOrigem: snapDestinatario.origem,
      indicadorIeSnapshot: snapDestinatario.indicadorIe,
      dataEmissao: cabecalho.dataEmissao,
      horaEmissao: cabecalho.horaEmissao,
      dataSaida: cabecalho.dataSaida,
      horaSaida: cabecalho.horaSaida,
      numeracaoAutomatica: cabecalho.numeracaoAutomatica,
    },
    origemNome: String(empresa?.nome_fantasia || empresa?.razao_social || "Empresa ativa"),
    emitenteCnpj: empresa?.cnpj ? String(empresa.cnpj) : "",
    destinos: (vinculos ?? []).map((vinculo) => {
      const dest = empresaPorId.get(String(vinculo.empresa_destino_id));
      return {
        id: String(vinculo.id),
        empresaDestinoId: String(vinculo.empresa_destino_id),
        nome: String(dest?.nome_fantasia || dest?.razao_social || "Estabelecimento"),
        cnpj: String(dest?.cnpj ?? ""),
      };
    }),
    estabelecimentosParaVincular: acessoIds
      .filter((idDest) => !destIds.includes(idDest))
      .map((idDest) => {
        const dest = empresaPorId.get(idDest);
        return {
          id: idDest,
          nome: String(dest?.nome_fantasia || dest?.razao_social || idDest),
          cnpj: String(dest?.cnpj ?? ""),
        };
      }),
    clientes: clientesCarregados,
    naturezas: (naturezas ?? [])
      .filter((natureza) => registroPertenceAEmpresaAtiva(natureza, empresaId))
      .map((natureza) => ({
        id: String(natureza.id),
        descricao: String(natureza.descricao),
        tipoOperacaoInterno: String(natureza.tipo_operacao_interno),
        tpNf: String(natureza.tp_nf),
        finNfe: String(natureza.fin_nfe),
        padrao: Boolean(natureza.padrao),
      })),
    tiposOperacao: (tiposOperacao ?? []).map((tipo) => ({
      codigo: String(tipo.codigo),
      rotulo: String(tipo.rotulo ?? tipo.codigo),
      movimentaEstoque: Boolean(tipo.movimenta_estoque),
      vinculaVenda: tipo.vincula_venda === true,
    })),
    itens: (itens ?? []).map((item) => {
      const produto = produtoPorId.get(String(item.produto_id));
      const snapshot = (item.snapshot_fiscal ?? {}) as {
        ncm?: string;
        icms_cst_csosn?: string;
      };
      return {
        id: String(item.id),
        descricao: String(produto?.nome || "Item"),
        codigo: produto?.codigo ? String(produto.codigo) : null,
        unidade: produto?.unidade_medida ? String(produto.unidade_medida) : "UN",
        quantidade: Number(item.quantidade),
        valorUnitario: Number(item.valor_unitario),
        valorTotal: Number(item.valor_total),
        precoCatalogo: Number(produto?.preco_venda ?? 0),
        estoque: estoquePorId.get(String(item.produto_id)) ?? 0,
        cfop: item.cfop_resolvido,
        ncm: snapshot.ncm || ncmPorProduto.get(String(item.produto_id)) || null,
        icms:
          snapshot.icms_cst_csosn ||
          icmsPorGrupo.get(String(produto?.grupo_fiscal_id ?? "")) ||
          null,
      };
    }),
    transportadoras: (transportadorasCadastro ?? []).map((transportadora) => ({
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
      codigo_municipio_ibge: String(transportadora.codigo_municipio_ibge ?? ""),
      uf: String(transportadora.uf ?? ""),
      cep: String(transportadora.cep ?? ""),
      veiculos: (veiculosCadastro ?? [])
        .filter((veiculo) => String(veiculo.transportadora_id) === String(transportadora.id))
        .map((veiculo) => ({
          id: String(veiculo.id),
          placa: String(veiculo.placa ?? ""),
          uf: String(veiculo.uf ?? ""),
          rntrc: String(veiculo.rntrc ?? ""),
          descricao: String(veiculo.descricao ?? ""),
        })),
    })),
    emissao: emissao
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
          autorizadaAt: emissao.autorizada_at,
        }
      : null,
    eventos: (eventosFiscais ?? []).map((evento) => ({
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
    })),
    tentativas: (tentativasFiscais ?? []).map((tentativa) => ({
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
    })),
    tentativasCabecalho: Number(emissao?.tentativas ?? 0),
    politicaCancelamento: emissao
      ? serializarPoliticaCancelamento(
          resolverPoliticaCancelamentoFiscal({
            uf: fiscalEmpresa?.uf ?? "",
            modelo: String(emissao.modelo ?? "55"),
            status: String(emissao.status),
            autorizadoEm: emissao.autorizada_at,
            fusoHorario: fiscalEmpresa?.fuso_horario ?? null,
          })
        )
      : null,
    bloqueioCancelamentoOperacional: operacao
      ? bloqueioCancelamentoOperacaoFiscal({
          saidaEstoqueProcessadaAt: operacao.saida_estoque_processada_at,
          status: operacao.status,
        })
      : null,
    seriePrevista: numeracao55?.serie ? String(numeracao55.serie) : "",
    numeroPrevisto: numeracao55?.proximoNumero
      ? String(numeracao55.proximoNumero)
      : "",
    seriesNfe,
    seriePrevistaNfce: numeracao65?.serie ? String(numeracao65.serie) : "",
    numeroPrevistoNfce: numeracao65?.proximo_numero ? String(numeracao65.proximo_numero) : "",
    regimeTributario: String(fiscalEmpresa?.codigo_regime_tributario ?? ""),
    indicadorPresenca:
      cabecalho.indicadorPresenca ??
      String(fiscalEmpresa?.indicador_presenca_padrao ?? "9"),
    intermediador:
      cabecalho.indicativoIntermediador ??
      String(fiscalEmpresa?.indicativo_intermediador_padrao ?? "0"),
    ambienteFiscal: Number(fiscalEmpresa?.ambiente) === 1 ? ("1" as const) : ("2" as const),
    formasPagamento: filtrarFormasPagamentoCheckoutPdv(formasPagamento ?? []),
    pixConfig: pixConfigPublicoPdv(classificarIntegracaoPix(integracaoPix)),
    caixaAberto: caixaAbertoRegistro !== null,
    caixaReabertoAviso: caixaAbertoRegistro?.aviso ?? null,
    podeAbrirCaixa: temPermissao(
      sessaoPermissoes?.permissoes,
      "caixa",
      "abrir"
    ),
  };
}
