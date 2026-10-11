import type { SupabaseClient } from "@supabase/supabase-js";

import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { obterSegredosFiscaisEmissao } from "@/lib/fiscal/geranet/credencial-plataforma";
import {
  DistribuicaoDescontoFiscalError,
  distribuirDescontoItens,
  mapaDescontoFiscalPorItem,
  valorBrutoItemEmCentavos,
} from "@/lib/fiscal/distribuir-desconto-itens";
import { montarItemGeranet } from "@/lib/fiscal/geranet/montar-item";
import { lerCodigoRegimeTributario } from "@/lib/fiscal/geranet/resolver-icms-geranet";
import { camposIpiDoGrupo, parsePerfilIpi } from "@/lib/fiscal/ipi";
import {
  escolherNumeracaoNfe55,
  lerCabecalhoFiscalDoSnapshot,
  resolverPayloadCabecalhoNfe,
} from "@/lib/fiscal/nfe55/cabecalho-fiscal";
import {
  lerAutorizadosXmlDoSnapshot,
  validarAutorizadosXml,
} from "@/lib/fiscal/nfe55/autorizados-xml";
import {
  lerEnderecoEntregaDoSnapshot,
  validarEnderecoEntrega,
} from "@/lib/fiscal/nfe55/endereco-entrega";
import {
  faturaNfeDoSnapshot,
  faturaParaPayloadGeranet,
  validarFaturaParaEmissaoNfe,
} from "@/lib/fiscal/nfe55/fatura-nfe";
import {
  faturaPermitidaNoPayloadNfe,
  mapearDetalhamentoFiscalNfe55,
  TPAG_DUPLICATA_MERCANTIL,
  validarPagamentoFiscalNfe55,
} from "@/lib/fiscal/nfe55/pagamento-fiscal-nfe";
import { mesclarSnapshotOperacao, pagamentosRascunhoDoSnapshot } from "@/lib/fiscal/nfe55/pagamentos-rascunho";
import type { PreparadaParaPayloadNfeOperacao } from "@/lib/fiscal/nfe55/payload-nfe-operacao";
import {
  distribuirValorProporcional,
  totaisNotaDoSnapshot,
} from "@/lib/fiscal/nfe55/totais-nota";
import { totaisComerciaisNfeDosItens } from "@/lib/fiscal/nfe55/valores-comerciais-nfe";
import { aplicarPagamentosRascunhoNaEmissaoNfeVenda } from "@/lib/fiscal/nfe55/valores-comerciais-nfe";
import {
  ieDestinatarioParaGeranet,
  origemSnapshotAInicializar,
  resolverDestinatarioFiscalDaOrigem,
  snapshotDestinatarioParaPersistir,
  lerSnapshotDestinatarioFiscal,
} from "@/lib/fiscal/destinatario/resolver-destinatario-fiscal";
import type { NaturezaOperacaoFiscal } from "@/lib/fiscal/operacoes/catalogo";
import { MENSAGEM_TRANSFERENCIA_DESTINO_INELEGIVEL } from "@/lib/fiscal/operacoes/catalogo";
import { destinoTransferenciaElegivel } from "@/lib/fiscal/operacoes/elegibilidade-transferencia";
import { escolherNaturezaParaTipoOperacao } from "@/lib/fiscal/operacoes/resolver-natureza";
import {
  normalizarRegrasCfopDaEmpresaAtiva,
  resolverCfopEfetivo,
  tipoDestinoPorUf,
} from "@/lib/fiscal/operacoes/resolver-cfop";
import {
  MENSAGEM_FRETE_9_COM_DADOS,
  transporteConflitaComFrete9,
} from "@/lib/fiscal/transporte/dados-transporte-venda";
import { carregarTransporteNfe55 } from "@/lib/fiscal/transporte/resolver-transporte-nfe";


export type ModoPreparacaoNfeOperacao = "preview" | "emissao";

export type FalhaPreparacaoNfeOperacao = {
  ok: false;
  erro: string;
  status: number;
};

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function somenteDigitos(valor: unknown) {
  return texto(valor).replace(/\D/g, "");
}

function falha(erro: string, status = 422): FalhaPreparacaoNfeOperacao {
  return { ok: false, erro, status };
}

export async function prepararNfeOperacao(input: {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  empresaId: string;
  operacaoId: string;
  modo: ModoPreparacaoNfeOperacao;
}): Promise<
  | ({ ok: true } & PreparadaParaPayloadNfeOperacao & {
      numeracao: { serie: number | string };
      cabecalhoRascunho: ReturnType<typeof lerCabecalhoFiscalDoSnapshot>;
      ambienteNumero: 1 | 2;
      apiKey: string;
    })
  | FalhaPreparacaoNfeOperacao
> {
  const { supabase, admin, empresaId, operacaoId, modo } = input;
  const { data: operacao } = await supabase
    .from("fiscal_operacoes")
    .select(
      `
      id, empresa_id, status, tipo_operacao_interno, natureza_id,
      destinatario_tipo, destinatario_id, destino_empresa_id,
      vinculo_transferencia_id, destino_gerenciado_no_ultra,
      tp_nf, fin_nfe, natureza_descricao, saida_estoque_processada_at,
      snapshot_fiscal, dados_transporte, informacao_complementar_usuario,
      informacao_adicional_fisco, emissao_fiscal_id, venda_id
    `
    )
    .eq("id", operacaoId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (!operacao || !registroPertenceAEmpresaAtiva(operacao, empresaId)) {
    return falha("Operação não encontrada nesta empresa.", 404);
  }
  const tipo = String(operacao.tipo_operacao_interno);
  if (tipo !== "bonificacao" && tipo !== "transferencia" && tipo !== "venda") {
    return falha("Tipo de operação não implementado nesta emissão.");
  }

  const [
    itensResult,
    empresaResult,
    fiscalResult,
    numeracoesResult,
    naturezasResult,
    regrasResult,
    segredosResult,
    csrtResult,
  ] = await Promise.all([
    supabase
      .from("fiscal_operacoes_itens")
      .select(
        "id, empresa_id, produto_id, quantidade, valor_unitario, grupo_fiscal_id, cfop_resolvido, snapshot_fiscal"
      )
      .eq("empresa_id", empresaId)
      .eq("operacao_id", operacaoId)
      .order("created_at", { ascending: true }),
    supabase
      .from("empresas")
      .select("id, razao_social, nome_fantasia, cnpj, ativo")
      .eq("id", empresaId)
      .maybeSingle(),
    supabase
      .from("empresas_fiscal")
      .select(
        `
        empresa_id, inscricao_estadual, telefone, email, logradouro, numero,
        complemento, bairro, cep, municipio, codigo_municipio_ibge, uf,
        tipo_atividade, codigo_regime_tributario, indicador_presenca_padrao,
        indicativo_intermediador_padrao, informacao_complementar_padrao,
        fuso_horario, ambiente, ativo, perfil_ipi,
        responsavel_tecnico_cnpj, responsavel_tecnico_contato,
        responsavel_tecnico_email, responsavel_tecnico_fone,
        responsavel_tecnico_id_csrt
      `
      )
      .eq("empresa_id", empresaId)
      .maybeSingle(),
    supabase
      .from("fiscal_numeracoes")
      .select("id, modelo, ambiente, serie, proximo_numero, ativo")
      .eq("empresa_id", empresaId)
      .eq("modelo", "55")
      .eq("ativo", true),
    supabase
      .from("fiscal_naturezas_operacao")
      .select(
        "id, empresa_id, tipo_operacao_interno, descricao, tp_nf, fin_nfe, padrao, ativo"
      )
      .eq("empresa_id", empresaId)
      .eq("tipo_operacao_interno", tipo),
    supabase
      .from("fiscal_natureza_cfop_regras")
      .select("empresa_id, natureza_id, grupo_fiscal_id, tipo_destino, cfop, ativo")
      .eq("empresa_id", empresaId)
      .eq("ativo", true),
    obterSegredosFiscaisEmissao(admin, empresaId),
    admin.rpc("obter_csrt_fiscal", { p_empresa_id: empresaId }),
  ]);

  const empresa = empresaResult.data;
  const fiscal = fiscalResult.data;
  if (!empresa || String(empresa.id) !== empresaId || !fiscal) {
    return falha("Dados fiscais da empresa ativa incompletos.");
  }

  const naturezaEscolhida = escolherNaturezaParaTipoOperacao({
    empresaIdAtiva: empresaId,
    tipoOperacaoInterno: tipo,
    naturezaId: operacao.natureza_id,
    naturezas: (naturezasResult.data ?? []) as NaturezaOperacaoFiscal[],
  });
  if (!naturezaEscolhida.ok) {
    return falha(naturezaEscolhida.mensagem);
  }
  const naturezaCongelada = {
    ...naturezaEscolhida.natureza,
    descricao: texto(operacao.natureza_descricao) || naturezaEscolhida.natureza.descricao,
    tp_nf: texto(operacao.tp_nf) || naturezaEscolhida.natureza.tp_nf,
    fin_nfe:
      resolverPayloadCabecalhoNfe({
        snapshot: operacao.snapshot_fiscal,
        finNfeOperacao: operacao.fin_nfe,
        finNfeNatureza: naturezaEscolhida.natureza.fin_nfe,
        indicadorPresencaPadraoEmpresa: "",
        dataHoraEmissao: "",
      }).finNfe ||
      texto(operacao.fin_nfe) ||
      naturezaEscolhida.natureza.fin_nfe,
  };

  let destinatario: PreparadaParaPayloadNfeOperacao["destinatario"] | null = null;

  if (tipo === "bonificacao" || tipo === "venda") {
    if (operacao.destinatario_tipo !== "cliente" || !operacao.destinatario_id) {
      return falha("Selecione um destinatário da empresa ativa.");
    }
    const { data: cliente } = await supabase
      .from("clientes")
      .select(
        `
        id, empresa_id, nome, nome_fantasia, tipo_pessoa, cpf_cnpj,
        inscricao_estadual, contribuinte_icms, indicador_ie_destinatario,
        consumidor_final, telefone,
        email, cep, logradouro, numero, complemento, bairro, municipio,
        codigo_municipio_ibge, uf, ativo
      `
      )
      .eq("id", operacao.destinatario_id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!cliente || !registroPertenceAEmpresaAtiva(cliente, empresaId)) {
      return falha("Destinatário não pertence à empresa ativa.");
    }
    const documento = somenteDigitos(cliente.cpf_cnpj);
    const origemVenda = operacao.venda_id ? "pdv" : "nfe_manual";
    const destinatarioFiscal = resolverDestinatarioFiscalDaOrigem({
      modelo: "55",
      tipoOperacaoInterno: tipo,
      origemVenda,
      snapshotOperacao: operacao.snapshot_fiscal,
      contribuinteIcms: cliente.contribuinte_icms,
      indicadorIeCadastro: cliente.indicador_ie_destinatario
        ? String(cliente.indicador_ie_destinatario)
        : null,
      consumidorFinalCadastro: cliente.consumidor_final,
    });
    const indicadorIe = destinatarioFiscal.indicadorIEdestinatario;
    if (indicadorIe === "1" && !texto(cliente.inscricao_estadual)) {
      return falha("Destinatário contribuinte precisa ter Inscrição Estadual.");
    }
    const snapAtual = lerSnapshotDestinatarioFiscal(operacao.snapshot_fiscal);
    if (
      modo === "emissao" &&
      (!snapAtual.consumidorFinalDefinido || !snapAtual.indicadorIe)
    ) {
      const { error: snapErro } = await supabase
        .from("fiscal_operacoes")
        .update({
          snapshot_fiscal: mesclarSnapshotOperacao(
            operacao.snapshot_fiscal,
            snapshotDestinatarioParaPersistir({
              consumidorFinal: destinatarioFiscal.consumidorFinal === "1",
              origem:
                snapAtual.origem ??
                origemSnapshotAInicializar({
                  origemVenda,
                  tipoOperacaoInterno: tipo,
                }),
              indicadorIe,
            })
          ),
        })
        .eq("id", operacao.id)
        .eq("empresa_id", empresaId);
      if (snapErro) {
        return falha(snapErro.message, 500);
      }
    }
    destinatario = {
      cpf: cliente.tipo_pessoa === "F" ? documento : "",
      cnpj: cliente.tipo_pessoa === "J" ? documento : "",
      inscricaoEstadual: ieDestinatarioParaGeranet({
        indicadorIEdestinatario: indicadorIe,
        inscricaoEstadual: cliente.inscricao_estadual,
      }),
      razaoSocial: String(cliente.nome),
      nomeFantasia: cliente.nome_fantasia,
      consumidorFinal: destinatarioFiscal.consumidorFinal,
      indicadorIEdestinatario: indicadorIe,
      telefone: cliente.telefone,
      email: cliente.email,
      logradouro: texto(cliente.logradouro),
      numero: texto(cliente.numero) || "S/N",
      complemento: cliente.complemento,
      bairro: texto(cliente.bairro),
      municipio: texto(cliente.municipio),
      codigoMunicipio: texto(cliente.codigo_municipio_ibge),
      uf: texto(cliente.uf).toUpperCase(),
      cep: texto(cliente.cep),
    };
  } else {
    const { data: vinculoDest } = await supabase
      .from("fiscal_vinculos_transferencia")
      .select("id, empresa_origem_id, empresa_destino_id, ativo")
      .eq("id", operacao.vinculo_transferencia_id)
      .eq("empresa_origem_id", empresaId)
      .maybeSingle();
    if (
      !vinculoDest ||
      !destinoTransferenciaElegivel({
        empresaOrigemId: empresaId,
        destinoEmpresaId: String(vinculoDest.empresa_destino_id),
        vinculos: [vinculoDest],
      })
    ) {
      return falha(MENSAGEM_TRANSFERENCIA_DESTINO_INELEGIVEL);
    }
    const [{ data: destEmpresa }, { data: destFiscal }] = await Promise.all([
      supabase
        .from("empresas")
        .select("id, razao_social, nome_fantasia, cnpj")
        .eq("id", vinculoDest.empresa_destino_id)
        .maybeSingle(),
      supabase
        .from("empresas_fiscal")
        .select(
          `
          empresa_id, inscricao_estadual, telefone, email, logradouro, numero,
          complemento, bairro, cep, municipio, codigo_municipio_ibge, uf
        `
        )
        .eq("empresa_id", vinculoDest.empresa_destino_id)
        .maybeSingle(),
    ]);
    if (!destEmpresa || !destFiscal) {
      return falha(MENSAGEM_TRANSFERENCIA_DESTINO_INELEGIVEL);
    }
    const ie = texto(destFiscal.inscricao_estadual);
    const destinatarioFiscal = resolverDestinatarioFiscalDaOrigem({
      modelo: "55",
      tipoOperacaoInterno: "transferencia",
      origemVenda: "nfe_manual",
      snapshotOperacao: operacao.snapshot_fiscal,
      contribuinteIcms: Boolean(ie && ie.toUpperCase() !== "ISENTO"),
      indicadorIeCadastro: ie && ie.toUpperCase() === "ISENTO" ? "2" : ie ? "1" : "9",
    });
    destinatario = {
      cnpj: somenteDigitos(destEmpresa.cnpj),
      inscricaoEstadual: ieDestinatarioParaGeranet({
        indicadorIEdestinatario: destinatarioFiscal.indicadorIEdestinatario,
        inscricaoEstadual: ie,
      }),
      razaoSocial: String(destEmpresa.razao_social),
      nomeFantasia: destEmpresa.nome_fantasia,
      consumidorFinal: destinatarioFiscal.consumidorFinal,
      indicadorIEdestinatario: destinatarioFiscal.indicadorIEdestinatario,
      telefone: destFiscal.telefone,
      email: destFiscal.email,
      logradouro: texto(destFiscal.logradouro),
      numero: texto(destFiscal.numero) || "S/N",
      complemento: destFiscal.complemento,
      bairro: texto(destFiscal.bairro),
      municipio: texto(destFiscal.municipio),
      codigoMunicipio: texto(destFiscal.codigo_municipio_ibge),
      uf: texto(destFiscal.uf).toUpperCase(),
      cep: texto(destFiscal.cep),
    };
  }

  if (!destinatario || !/^[A-Z]{2}$/.test(String(destinatario.uf ?? ""))) {
    return falha("Endereço fiscal do destinatário está incompleto.");
  }

  const itens = itensResult.data ?? [];
  if (itens.length === 0) {
    return falha("Inclua ao menos um item.");
  }
  const produtoIds = itens.map((item) => String(item.produto_id));
  const { data: produtos } = await supabase
    .from("produtos")
    .select(
      "id, empresa_id, nome, codigo, codigo_barras, unidade_medida, tipo_item, grupo_fiscal_id"
    )
    .eq("empresa_id", empresaId)
    .in("id", produtoIds);
  const { data: produtosFiscal } = await supabase
    .from("produtos_fiscal")
    .select("produto_id, empresa_id, ncm, cest, origem_produto")
    .eq("empresa_id", empresaId)
    .in("produto_id", produtoIds);
  const grupoIds = [
    ...new Set(
      (produtos ?? [])
        .map((produto) => produto.grupo_fiscal_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const { data: grupos } =
    grupoIds.length > 0
      ? await supabase
          .from("grupos_fiscais")
          .select(
            `
            id, empresa_id, nome, cfop_interno, cfop_interestadual, icms_cst_csosn, pis_cst, pis_aliquota,
            cofins_cst, cofins_aliquota, cst_ibscbs, classificacao_ibscbs,
            aliquota_ibs_uf, aliquota_ibs_municipio, aliquota_cbs,
            percentual_reducao_ibs_uf, percentual_reducao_ibs_municipio,
            percentual_reducao_cbs, ipi_aplicavel, ipi_cst, ipi_aliquota,
            ipi_enquadramento, ibscbs_manual
          `
          )
          .eq("empresa_id", empresaId)
          .in("id", grupoIds)
      : { data: [] };

  const produtoPorId = new Map((produtos ?? []).map((p) => [String(p.id), p]));
  const fiscalProdutoPorId = new Map(
    (produtosFiscal ?? []).map((item) => [String(item.produto_id), item])
  );
  const grupoPorId = new Map((grupos ?? []).map((g) => [String(g.id), g]));
  const regras = normalizarRegrasCfopDaEmpresaAtiva(regrasResult.data, empresaId);
  const tipoDestino = tipoDestinoPorUf(fiscal.uf, String(destinatario.uf));
  if (!tipoDestino) {
    return falha("Não foi possível determinar o destino interno/interestadual.");
  }

  let crt;
  try {
    crt = lerCodigoRegimeTributario(fiscal.codigo_regime_tributario);
  } catch (errorCrt) {
    return falha(
      errorCrt instanceof Error
        ? errorCrt.message
        : "CRT da empresa da emissão não está configurado."
    );
  }
  const ambienteNumero = Number(fiscal.ambiente) === 1 ? 1 : 2;
  const ambiente = ambienteNumero === 1 ? "1" : "2";
  const itensFiscais = [];
  const totaisNota = totaisNotaDoSnapshot(operacao.snapshot_fiscal);
  const itensBase = itens.map((item) => ({
    id: String(item.id),
    baseCentavos: valorBrutoItemEmCentavos({
      quantidade: Number(item.quantidade),
      valorUnitario: Number(item.valor_unitario),
    }),
  }));
  let descontosFiscais = new Map<string, number>();
  let fretesPorItem = new Map<string, number>();
  let segurosPorItem = new Map<string, number>();
  let outrosPorItem = new Map<string, number>();
  try {
    descontosFiscais = mapaDescontoFiscalPorItem(
      distribuirDescontoItens({
        descontoVenda: totaisNota.desconto,
        itens: itens.map((item) => ({
          id: String(item.id),
          quantidade: Number(item.quantidade),
          valorUnitario: Number(item.valor_unitario),
          desconto: 0,
        })),
      })
    );
    fretesPorItem = distribuirValorProporcional({
      valor: totaisNota.frete,
      itens: itensBase,
    });
    segurosPorItem = distribuirValorProporcional({
      valor: totaisNota.seguro,
      itens: itensBase,
    });
    outrosPorItem = distribuirValorProporcional({
      valor: totaisNota.outro,
      itens: itensBase,
    });
  } catch (errorRateio) {
    return falha(
      errorRateio instanceof DistribuicaoDescontoFiscalError || errorRateio instanceof Error
        ? errorRateio.message
        : "Não foi possível ratear os totais da NF-e."
    );
  }

  for (const item of itens) {
    const produto = produtoPorId.get(String(item.produto_id));
    if (!produto || !registroPertenceAEmpresaAtiva(produto, empresaId)) {
      return falha("Há produto de outra empresa nesta operação.");
    }
    const fiscalProduto = fiscalProdutoPorId.get(String(produto.id));
    const grupo = grupoPorId.get(String(produto.grupo_fiscal_id ?? item.grupo_fiscal_id));
    if (!grupo || !registroPertenceAEmpresaAtiva(grupo, empresaId)) {
      return falha(`Grupo fiscal de ${produto.nome} não pertence à empresa ativa.`);
    }
    const snapshot = (item.snapshot_fiscal ?? {}) as { cfop?: string };
    const cfopSnapshot = texto(snapshot.cfop || item.cfop_resolvido);
    const cfopResolvido = /^\d{4}$/.test(cfopSnapshot)
      ? { ok: true as const, cfop: cfopSnapshot }
      : resolverCfopEfetivo({
          tipoOperacaoInterno: tipo,
          tipoDestino,
          naturezaId: naturezaCongelada.id,
          grupoFiscalId: grupo.id,
          empresaIdAtiva: empresaId,
          naturezaPadrao: naturezaCongelada.padrao,
          naturezaDescricao: naturezaCongelada.descricao,
          grupoFiscal: {
            nome: grupo.nome,
            cfopInterno: grupo.cfop_interno,
            cfopInterestadual: grupo.cfop_interestadual,
          },
          regras,
        });
    if (!cfopResolvido.ok) {
      return falha(cfopResolvido.mensagem);
    }
    const montado = montarItemGeranet({
      produto: {
        codigo: String(produto.codigo ?? produto.id),
        codigoBarras: produto.codigo_barras,
        nome: String(produto.nome),
        unidadeMedida: String(produto.unidade_medida ?? "UN"),
        tipoItem: produto.tipo_item,
        precoVenda: item.valor_unitario,
      },
      fiscal: {
        ncm: fiscalProduto?.ncm,
        cest: fiscalProduto?.cest,
        origemProduto: fiscalProduto?.origem_produto,
      },
      grupo: {
        cfopInterno: cfopResolvido.cfop,
        cfopInterestadual: cfopResolvido.cfop,
        icmsCstCsosn: grupo.icms_cst_csosn,
        pisCst: grupo.pis_cst,
        pisAliquota: grupo.pis_aliquota,
        cofinsCst: grupo.cofins_cst,
        cofinsAliquota: grupo.cofins_aliquota,
        cstIbscbs: grupo.cst_ibscbs,
        classificacaoIbscbs: grupo.classificacao_ibscbs,
        aliquotaIbsUf: grupo.aliquota_ibs_uf,
        aliquotaIbsMunicipio: grupo.aliquota_ibs_municipio,
        aliquotaCbs: grupo.aliquota_cbs,
        percentualReducaoIbsUf: grupo.percentual_reducao_ibs_uf,
        percentualReducaoIbsMunicipio: grupo.percentual_reducao_ibs_municipio,
        percentualReducaoCbs: grupo.percentual_reducao_cbs,
        ibscbsManual: grupo.ibscbs_manual,
        ...camposIpiDoGrupo(grupo),
      },
      modelo: "55",
      perfilIpi: parsePerfilIpi(fiscal.perfil_ipi),
      codigoRegimeTributario: crt,
      ambiente,
      forcarIbscbsHomologacao: false,
      dataEmissao: new Date().toISOString(),
      operacao: tipoDestino,
      quantidade: item.quantidade,
      valorUnitario: item.valor_unitario,
      desconto: descontosFiscais.get(String(item.id)) ?? 0,
      frete: fretesPorItem.get(String(item.id)) ?? 0,
      seguro: segurosPorItem.get(String(item.id)) ?? 0,
      outro: outrosPorItem.get(String(item.id)) ?? 0,
    });
    itensFiscais.push(montado.item);
  }

  const cabecalhoRascunho = lerCabecalhoFiscalDoSnapshot(operacao.snapshot_fiscal);
  const escolhaSerie = escolherNumeracaoNfe55({
    numeracoes: numeracoesResult.data ?? [],
    ambiente: ambienteNumero,
    serieEscolhida: cabecalhoRascunho.serie,
  });
  if (!escolhaSerie.ok) {
    return falha(escolhaSerie.mensagem);
  }
  const numeracao = escolhaSerie.numeracao;
  if (!numeracao) {
    return falha("Não há numeração de NF-e 55 ativa para o ambiente da empresa.");
  }
  if (segredosResult.error) {
    return falha("Não foi possível ler os segredos fiscais.", 500);
  }
  const segredos = Array.isArray(segredosResult.data)
    ? segredosResult.data[0]
    : segredosResult.data;
  const apiKey = texto(segredos?.geranet_api_key);
  const certificado = texto(segredos?.certificado_a1);
  const senhaCertificado = texto(segredos?.senha_certificado);
  if (!apiKey || !certificado || !senhaCertificado) {
    return falha("API Key/certificado/senha fiscal incompletos.");
  }
  const ufEmitente = texto(fiscal.uf).toUpperCase();
  const ieEmitente = texto(fiscal.inscricao_estadual);
  if (!/^[A-Z]{2}$/.test(ufEmitente) || !ieEmitente) {
    return falha("UF ou IE da empresa ativa incompletos.");
  }

  const transporteResolvido = await carregarTransporteNfe55({
    db: supabase,
    empresaId,
    operacaoId,
    vendaId: operacao.venda_id,
  });
  if (transporteConflitaComFrete9(transporteResolvido.dados)) {
    return falha(MENSAGEM_FRETE_9_COM_DADOS);
  }
  const erroEntrega = validarEnderecoEntrega(
    lerEnderecoEntregaDoSnapshot(operacao.snapshot_fiscal)
  );
  if (erroEntrega) {
    return falha(erroEntrega);
  }
  const erroAutorizadosXml = validarAutorizadosXml(
    lerAutorizadosXmlDoSnapshot(operacao.snapshot_fiscal)
  );
  if (erroAutorizadosXml) {
    return falha(erroAutorizadosXml);
  }

  const comerciais = totaisComerciaisNfeDosItens({
    itens: itens.map((item) => ({
      quantidade: Number(item.quantidade),
      valorUnitario: Number(item.valor_unitario),
    })),
    totais: totaisNota,
  });

  let detalhamentoFiscal: PreparadaParaPayloadNfeOperacao["detalhamentoFiscal"] = [
    { tipo: "90", valor: 0, indicadorPagamento: "0" },
  ];
  let faturaGeranet: PreparadaParaPayloadNfeOperacao["faturaGeranet"] = null;
  let troco = 0;

  if (tipo === "venda") {
    const pagamentosRascunho = pagamentosRascunhoDoSnapshot(operacao.snapshot_fiscal);
    const faturaSnapshot = faturaNfeDoSnapshot(operacao.snapshot_fiscal);
    if (pagamentosRascunho.length === 0 && (faturaSnapshot?.valorLiquidoCentavos ?? 0) <= 0) {
      return falha("Informe o pagamento da venda antes de visualizar a NF-e.");
    }
    const formaIds = [...new Set(pagamentosRascunho.map((pagamento) => pagamento.formaPagamentoId))];
    const { data: formasRascunho, error: formasErro } =
      formaIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("formas_pagamento")
            .select(
              "id, empresa_id, codigo, nome, codigo_fiscal, permite_parcelamento, permite_fiado"
            )
            .eq("empresa_id", empresaId)
            .in("id", formaIds);
    if (formasErro) {
      return falha(formasErro.message, 500);
    }
    const formas = (formasRascunho ?? []).filter(
      (forma) => String(forma.empresa_id) === empresaId
    );
    const overlay = aplicarPagamentosRascunhoNaEmissaoNfeVenda({
      origemOperacaoFiscal: true,
      pagamentosVenda: [],
      pagamentosRascunho,
      formas,
    });
    if (!overlay.ok) {
      return falha(overlay.erro);
    }
    const cobertura = faturaSnapshot?.valorLiquidoCentavos ?? 0;
    detalhamentoFiscal = mapearDetalhamentoFiscalNfe55({
      pagamentos: overlay.pagamentos,
      formas,
      duplicataMercantilCentavos: cobertura,
    });
    const erroFatura = validarFaturaParaEmissaoNfe({
      temDuplicataMercantil: detalhamentoFiscal.some(
        (item) => item.tipo === TPAG_DUPLICATA_MERCANTIL
      ),
      fatura: faturaSnapshot,
      totalAPrazoCentavos: Math.round(
        detalhamentoFiscal
          .filter((item) => item.tipo === TPAG_DUPLICATA_MERCANTIL)
          .reduce((soma, item) => soma + Number(item.valor), 0) * 100
      ),
    });
    if (erroFatura) {
      return falha(erroFatura);
    }
    faturaGeranet = faturaPermitidaNoPayloadNfe(
      detalhamentoFiscal,
      faturaParaPayloadGeranet(faturaSnapshot)
    );
    const erroPagamento = validarPagamentoFiscalNfe55({
      detalhamento: detalhamentoFiscal,
      totalNfe: comerciais.vNF,
      troco: 0,
      fatura: faturaGeranet,
    });
    if (erroPagamento) {
      return falha(erroPagamento);
    }
  }

  return {
    ok: true,
    operacao,
    empresa,
    fiscal,
    crt,
    ambiente,
    ufEmitente,
    ieEmitente,
    certificado,
    senhaCertificado,
    destinatario,
    naturezaCongelada: {
      id: naturezaCongelada.id,
      descricao: naturezaCongelada.descricao,
      tp_nf: naturezaCongelada.tp_nf,
      fin_nfe: naturezaCongelada.fin_nfe,
    },
    transporte: transporteResolvido.dados,
    itensFiscais,
    detalhamentoFiscal,
    faturaGeranet,
    troco,
    csrt: csrtResult.error ? null : (csrtResult.data as string | null | undefined),
    numeracao: { serie: numeracao.serie ?? 1 },
    cabecalhoRascunho,
    ambienteNumero,
    apiKey,
  };
}
