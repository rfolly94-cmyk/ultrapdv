import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  capturaErroAutorizacaoFiscal,
  exigirEmissaoNfe,
} from "@/lib/fiscal/acesso-operacao";
import {
  ErroAssinaturaRestrita,
  exigirEmpresaOperacional,
} from "@/lib/assinatura/exigir-empresa-operacional";
import { registroPertenceAEmpresaAtiva } from "@/lib/empresa/assert-registro-empresa-ativa";
import { obterLogomarcaFiscalHex } from "@/lib/empresa/obter-logomarca-fiscal-hex";
import { aplicarValorTotalNotaGeranet } from "@/lib/fiscal/geranet/diagnostico-total-nota";
import {
  avaliarBloqueioRascunhoFiscal,
  carregarEmissaoPorChaveIdempotencia,
  claimTentativaEmissaoFiscal,
  geranetLogIdDe,
  registrarRespostaTentativaFiscal,
  snapshotItensDaTransmissao,
} from "@/lib/fiscal/emissao-tentativas";
import {
  chamarGeranet,
  persistenciaFalhaComunicacaoEmitir,
  patchEmissaoFalhaComunicacao,
} from "@/lib/fiscal/geranet/cliente-geranet";
import {
  classificarRespostaEmitir,
  extraBloqueioRetransmissaoFiscal,
  historicoErroTecnico,
  mensagemBloqueioEmissao,
  montarErroEmitirNaoAutorizada,
  persistirClassificacaoNaoAutorizada,
} from "@/lib/fiscal/geranet/classificar-emissao";
import { formatarDataHoraGeranet } from "@/lib/fiscal/geranet/data-hora";
import { exigirFusoHorarioFiscalDaEmissao } from "@/lib/fiscal/fuso-horario-empresa";
import { montarItemGeranet } from "@/lib/fiscal/geranet/montar-item";
import { montarPayloadNfeGeranet } from "@/lib/fiscal/geranet/montar-payload-nfe";
import {
  DistribuicaoDescontoFiscalError,
  distribuirDescontoItens,
  mapaDescontoFiscalPorItem,
  valorBrutoItemEmCentavos,
} from "@/lib/fiscal/distribuir-desconto-itens";
import {
  distribuirValorProporcional,
  totaisNotaDoSnapshot,
} from "@/lib/fiscal/nfe55/totais-nota";
import {
  enderecoEntregaDoSnapshotParaGeranet,
  lerEnderecoEntregaDoSnapshot,
  validarEnderecoEntrega,
} from "@/lib/fiscal/nfe55/endereco-entrega";
import {
  autorizadosXmlDoSnapshotParaGeranet,
  lerAutorizadosXmlDoSnapshot,
  validarAutorizadosXml,
} from "@/lib/fiscal/nfe55/autorizados-xml";
import { responsavelTecnicoDoCadastroFiscal } from "@/lib/fiscal/nfe55/responsavel-tecnico";
import { mesclarSnapshotOperacao } from "@/lib/fiscal/nfe55/pagamentos-rascunho";
import {
  argsNumeroManualReservaNfe,
  escolherNumeracaoNfe55,
  lerCabecalhoFiscalDoSnapshot,
  resolverPayloadCabecalhoNfe,
} from "@/lib/fiscal/nfe55/cabecalho-fiscal";
import { lerCodigoRegimeTributario } from "@/lib/fiscal/geranet/resolver-icms-geranet";
import {
  ieDestinatarioParaGeranet,
  origemSnapshotAInicializar,
  resolverDestinatarioFiscalDaOrigem,
  snapshotDestinatarioParaPersistir,
  lerSnapshotDestinatarioFiscal,
} from "@/lib/fiscal/destinatario/resolver-destinatario-fiscal";
import {
  montarInformacaoAdicionalFisco,
  montarInformacaoComplementarNfe,
  textoUsuarioInfAdFiscoNfe,
  textoUsuarioInfCplNfe,
} from "@/lib/fiscal/nfe55/infos-adicionais";
import {
  MENSAGEM_FRETE_9_COM_DADOS,
  transporteConflitaComFrete9,
} from "@/lib/fiscal/transporte/dados-transporte-venda";
import { transporteNfeParaPayloadGeranet } from "@/lib/fiscal/transporte/mapear-transporte-geranet";
import { carregarTransporteNfe55 } from "@/lib/fiscal/transporte/resolver-transporte-nfe";
import type { NaturezaOperacaoFiscal } from "@/lib/fiscal/operacoes/catalogo";
import { assertIdentidadeFiscalNfe } from "@/lib/fiscal/operacoes/resolver-natureza";
import { escolherNaturezaParaTipoOperacao } from "@/lib/fiscal/operacoes/resolver-natureza";
import { normalizarRegrasCfopDaEmpresaAtiva, resolverCfopEfetivo, tipoDestinoPorUf } from "@/lib/fiscal/operacoes/resolver-cfop";
import { operacaoPodeEmitir } from "@/lib/fiscal/operacoes/status-operacao";
import { destinoTransferenciaElegivel } from "@/lib/fiscal/operacoes/elegibilidade-transferencia";
import { MENSAGEM_TRANSFERENCIA_DESTINO_INELEGIVEL } from "@/lib/fiscal/operacoes/catalogo";
import { camposIpiDoGrupo, parsePerfilIpi } from "@/lib/fiscal/ipi";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function erro(mensagem: string, status = 422, extra?: Record<string, unknown>) {
  return json({ ok: false, erro: mensagem, ...(extra ?? {}) }, status);
}

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function somenteDigitos(valor: unknown) {
  return texto(valor).replace(/\D/g, "");
}

function chaveIdempotenciaOperacao(operacaoId: string) {
  const bytes = createHash("sha256")
    .update(`ultrapdv:nfe55:operacao-fiscal:${operacaoId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const admin = createAdminClient();

  try {
    const { data: claimsData, error: authError } =
      await supabase.auth.getClaims();
    if (authError || !claimsData?.claims?.sub) {
      return erro("Não autenticado.", 401);
    }

    const { data: vinculo } = await supabase
      .from("usuarios_empresas")
      .select("empresa_id")
      .eq("usuario_id", String(claimsData.claims.sub))
      .eq("principal", true)
      .eq("ativo", true)
      .maybeSingle();
    if (!vinculo) {
      return erro("Empresa ativa não encontrada.", 403);
    }

    try {
      await exigirEmissaoNfe({
        empresaId: String(vinculo.empresa_id),
        origem: "nfe-emitir-operacao",
      });
      await exigirEmpresaOperacional(String(vinculo.empresa_id));
    } catch (error) {
      const authz = capturaErroAutorizacaoFiscal(error);
      if (authz) {
        return erro(authz.mensagem, authz.status);
      }
      if (error instanceof ErroAssinaturaRestrita) {
        return erro(error.message, 403);
      }
      throw error;
    }

    const empresaId = String(vinculo.empresa_id);
    const body = (await request.json().catch(() => ({}))) as {
      operacao_id?: string;
    };
    const operacaoId = texto(body.operacao_id);
    if (!operacaoId) {
      return erro("Informe a operação fiscal.");
    }
    if (texto(request.headers.get("Idempotency-Key")) !== operacaoId) {
      return erro(
        "O header Idempotency-Key deve conter o UUID da operação fiscal.",
        400
      );
    }

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
      return erro("Operação não encontrada nesta empresa.", 404);
    }
    if (
      operacao.tipo_operacao_interno !== "bonificacao" &&
      operacao.tipo_operacao_interno !== "transferencia"
    ) {
      return erro("Tipo de operação não implementado nesta emissão.");
    }
    if (operacao.saida_estoque_processada_at) {
      return erro("A saída desta operação já foi processada.");
    }
    if (!operacaoPodeEmitir(operacao.status) && operacao.status !== "enviando") {
      return erro("Conclua a verificação fiscal antes de emitir.");
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
        .eq("operacao_id", operacaoId),
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
        .eq("tipo_operacao_interno", operacao.tipo_operacao_interno),
      supabase
        .from("fiscal_natureza_cfop_regras")
        .select("empresa_id, natureza_id, grupo_fiscal_id, tipo_destino, cfop, ativo")
        .eq("empresa_id", empresaId)
        .eq("ativo", true),
      admin.rpc("obter_segredos_fiscais", { p_empresa_id: empresaId }),
      admin.rpc("obter_csrt_fiscal", { p_empresa_id: empresaId }),
    ]);

    const empresa = empresaResult.data;
    const fiscal = fiscalResult.data;
    if (!empresa || String(empresa.id) !== empresaId || !fiscal) {
      return erro("Dados fiscais da empresa ativa incompletos.");
    }

    const naturezaEscolhida = escolherNaturezaParaTipoOperacao({
      empresaIdAtiva: empresaId,
      tipoOperacaoInterno: operacao.tipo_operacao_interno,
      naturezaId: operacao.natureza_id,
      naturezas: (naturezasResult.data ?? []) as NaturezaOperacaoFiscal[],
    });
    if (!naturezaEscolhida.ok) {
      return erro(naturezaEscolhida.mensagem);
    }
    const naturezaCongelada = {
      ...naturezaEscolhida.natureza,
      descricao:
        texto(operacao.natureza_descricao) || naturezaEscolhida.natureza.descricao,
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

    let destinatario: {
      cpf?: string;
      cnpj?: string;
      inscricaoEstadual: string;
      razaoSocial: string;
      nomeFantasia?: string | null;
      consumidorFinal: "0" | "1";
      indicadorIEdestinatario: "1" | "2" | "9";
      telefone?: string | null;
      email?: string | null;
      logradouro: string;
      numero: string;
      complemento?: string | null;
      bairro: string;
      municipio: string;
      codigoMunicipio: string;
      uf: string;
      cep: string;
    } | null = null;

    if (
      operacao.tipo_operacao_interno === "bonificacao" ||
      operacao.tipo_operacao_interno === "venda"
    ) {
      if (operacao.destinatario_tipo !== "cliente" || !operacao.destinatario_id) {
        return erro("Selecione um destinatário da empresa ativa.");
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
        return erro("Destinatário não pertence à empresa ativa.");
      }
      const documento = somenteDigitos(cliente.cpf_cnpj);
      const origemVenda = operacao.venda_id ? "pdv" : "nfe_manual";
      const destinatarioFiscal = resolverDestinatarioFiscalDaOrigem({
        modelo: "55",
        tipoOperacaoInterno: String(operacao.tipo_operacao_interno),
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
        return erro("Destinatário contribuinte precisa ter Inscrição Estadual.");
      }
      const snapAtual = lerSnapshotDestinatarioFiscal(operacao.snapshot_fiscal);
      if (!snapAtual.consumidorFinalDefinido || !snapAtual.indicadorIe) {
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
                    tipoOperacaoInterno: String(operacao.tipo_operacao_interno),
                  }),
                indicadorIe,
              })
            ),
          })
          .eq("id", operacao.id)
          .eq("empresa_id", empresaId);
        if (snapErro) {
          return erro(snapErro.message, 500);
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
        return erro(MENSAGEM_TRANSFERENCIA_DESTINO_INELEGIVEL);
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
        return erro(MENSAGEM_TRANSFERENCIA_DESTINO_INELEGIVEL);
      }
      const ie = texto(destFiscal.inscricao_estadual);
      const destinatarioFiscal = resolverDestinatarioFiscalDaOrigem({
        modelo: "55",
        tipoOperacaoInterno: "transferencia",
        origemVenda: "nfe_manual",
        snapshotOperacao: operacao.snapshot_fiscal,
        contribuinteIcms: Boolean(ie && ie.toUpperCase() !== "ISENTO"),
        indicadorIeCadastro:
          ie && ie.toUpperCase() === "ISENTO" ? "2" : ie ? "1" : "9",
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

    if (!destinatario || !/^[A-Z]{2}$/.test(destinatario.uf)) {
      return erro("Endereço fiscal do destinatário está incompleto.");
    }

    const itens = itensResult.data ?? [];
    if (itens.length === 0) {
      return erro("Inclua ao menos um item.");
    }
    const produtoIds = itens.map((item) => String(item.produto_id));
    const { data: produtos } = await supabase
      .from("produtos")
      .select(
        "id, empresa_id, nome, codigo, codigo_barras, unidade_medida, tipo_item, grupo_fiscal_id, preco_venda"
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
              id, empresa_id, nome, icms_cst_csosn, pis_cst, pis_aliquota,
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
    const tipoDestino = tipoDestinoPorUf(fiscal.uf, destinatario.uf);
    if (!tipoDestino) {
      return erro("Não foi possível determinar o destino interno/interestadual.");
    }

    let crt;
    try {
      crt = lerCodigoRegimeTributario(fiscal.codigo_regime_tributario);
    } catch (errorCrt) {
      return erro(
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
      return erro(
        errorRateio instanceof DistribuicaoDescontoFiscalError ||
          errorRateio instanceof Error
          ? errorRateio.message
          : "Não foi possível ratear os totais da NF-e."
      );
    }

    for (const item of itens) {
      const produto = produtoPorId.get(String(item.produto_id));
      if (!produto || !registroPertenceAEmpresaAtiva(produto, empresaId)) {
        return erro("Há produto de outra empresa nesta operação.");
      }
      const fiscalProduto = fiscalProdutoPorId.get(String(produto.id));
      const grupo = grupoPorId.get(String(produto.grupo_fiscal_id ?? item.grupo_fiscal_id));
      if (!grupo || !registroPertenceAEmpresaAtiva(grupo, empresaId)) {
        return erro(`Grupo fiscal de ${produto.nome} não pertence à empresa ativa.`);
      }
      const snapshot = (item.snapshot_fiscal ?? {}) as { cfop?: string };
      const cfopSnapshot = texto(snapshot.cfop || item.cfop_resolvido);
      const cfopResolvido = /^\d{4}$/.test(cfopSnapshot)
        ? { ok: true as const, cfop: cfopSnapshot }
        : resolverCfopEfetivo({
            tipoOperacaoInterno: operacao.tipo_operacao_interno,
            tipoDestino,
            naturezaId: naturezaCongelada.id,
            grupoFiscalId: grupo.id,
            empresaIdAtiva: empresaId,
            naturezaPadrao: naturezaCongelada.padrao,
            naturezaDescricao: naturezaCongelada.descricao,
            grupoFiscal: { nome: grupo.nome },
            regras,
          });
      if (!cfopResolvido.ok) {
        return erro(cfopResolvido.mensagem);
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
      return erro(escolhaSerie.mensagem);
    }
    const numeracao = escolhaSerie.numeracao;
    if (!numeracao) {
      return erro("Não há numeração de NF-e 55 ativa para o ambiente da empresa.");
    }
    if (segredosResult.error) {
      return erro("Não foi possível ler os segredos fiscais.", 500);
    }

    const chaveIdempotencia = chaveIdempotenciaOperacao(operacaoId);
    const emissaoPrevia = await carregarEmissaoPorChaveIdempotencia(
      admin,
      empresaId,
      chaveIdempotencia
    );
    const bloqueioRascunho = avaliarBloqueioRascunhoFiscal(emissaoPrevia);
    if (bloqueioRascunho.tipo === "autorizada") {
      await admin
        .from("fiscal_operacoes")
        .update({ status: "aguardando_saida" })
        .eq("id", operacaoId)
        .eq("empresa_id", empresaId);
      return json({
        ok: true,
        autorizada: true,
        reutilizada: true,
        emissao_id: bloqueioRascunho.emissao.id,
        chave: bloqueioRascunho.emissao.chave_acesso,
        protocolo: bloqueioRascunho.emissao.protocolo,
        mensagem: "Esta operação já possui NF-e autorizada.",
      });
    }
    if (bloqueioRascunho.tipo === "bloquear" || bloqueioRascunho.tipo === "inutilizacao" || bloqueioRascunho.tipo === "inutilizada") {
      if (bloqueioRascunho.emissao.status === "aguardando_reconciliacao") {
        await admin
          .from("fiscal_operacoes")
          .update({ status: "aguardando_reconciliacao" })
          .eq("id", operacaoId)
          .eq("empresa_id", empresaId);
      }
      return erro(
        bloqueioRascunho.tipo === "bloquear"
          ? bloqueioRascunho.mensagem
          : bloqueioRascunho.tipo === "inutilizacao"
            ? "Conclua a inutilização da numeração anterior antes de emitir novamente."
            : "Esta emissão foi inutilizada e não pode receber novo rascunho fiscal.",
        409,
        {
          emissao_id: bloqueioRascunho.emissao.id,
          status: bloqueioRascunho.emissao.status,
          podeConsultarNovamente: true,
          podeRetransmitir: false,
        }
      );
    }

    const segredos = Array.isArray(segredosResult.data)
      ? segredosResult.data[0]
      : segredosResult.data;
    const apiKey = texto(segredos?.geranet_api_key);
    const certificado = texto(segredos?.certificado_a1);
    const senhaCertificado = texto(segredos?.senha_certificado);
    if (!apiKey || !certificado || !senhaCertificado) {
      return erro("API Key/certificado/senha fiscal incompletos.");
    }
    const ufEmitente = texto(fiscal.uf).toUpperCase();
    const ieEmitente = texto(fiscal.inscricao_estadual);
    if (!/^[A-Z]{2}$/.test(ufEmitente) || !ieEmitente) {
      return erro("UF ou IE da empresa ativa incompletos.");
    }

    const transporteResolvido = await carregarTransporteNfe55({
      db: supabase,
      empresaId,
      operacaoId,
      vendaId: operacao.venda_id,
    });
    if (transporteConflitaComFrete9(transporteResolvido.dados)) {
      return erro(MENSAGEM_FRETE_9_COM_DADOS);
    }
    const erroEntrega = validarEnderecoEntrega(
      lerEnderecoEntregaDoSnapshot(operacao.snapshot_fiscal)
    );
    if (erroEntrega) {
      return erro(erroEntrega);
    }
    const erroAutorizadosXml = validarAutorizadosXml(
      lerAutorizadosXmlDoSnapshot(operacao.snapshot_fiscal)
    );
    if (erroAutorizadosXml) {
      return erro(erroAutorizadosXml);
    }

    const { data: reservaData, error: reservaError } = await admin.rpc(
      "rpc_reservar_emissao_fiscal",
      {
        p_empresa_id: empresaId,
        p_modelo: "55",
        p_serie: numeracao.serie,
        p_ambiente: ambienteNumero,
        p_chave_idempotencia: chaveIdempotencia,
        p_origem_tipo: "operacao_fiscal",
        p_origem_id: operacaoId,
        ...argsNumeroManualReservaNfe(cabecalhoRascunho),
      }
    );
    if (reservaError) {
      return erro(`Falha ao reservar numeração NF-e: ${reservaError.message}`, 500);
    }
    const reserva = Array.isArray(reservaData) ? reservaData[0] : reservaData;
    if (!reserva?.emissao_id) {
      return erro("A reserva fiscal não retornou uma emissão válida.", 500);
    }
    const emissaoId = String(reserva.emissao_id);

    let identidadeFiscal: ReturnType<typeof assertIdentidadeFiscalNfe>;
    try {
      identidadeFiscal = assertIdentidadeFiscalNfe({
        naturezaId: naturezaCongelada.id,
        descricao: naturezaCongelada.descricao,
        tpNf: naturezaCongelada.tp_nf,
        finNfe: naturezaCongelada.fin_nfe,
      });
    } catch (errorIdentidade) {
      return erro(
        errorIdentidade instanceof Error
          ? errorIdentidade.message
          : "Identidade fiscal incompleta."
      );
    }

    await admin
      .from("fiscal_emissoes")
      .update({
        tipo_operacao_interno: operacao.tipo_operacao_interno,
        natureza_id: identidadeFiscal.naturezaId,
        tp_nf: identidadeFiscal.tpNf,
        fin_nfe: identidadeFiscal.finNfe,
      })
      .eq("id", emissaoId)
      .eq("empresa_id", empresaId);

    await admin
      .from("fiscal_operacoes")
      .update({
        emissao_fiscal_id: emissaoId,
        natureza_id: identidadeFiscal.naturezaId,
        natureza_descricao: identidadeFiscal.descricao,
        tp_nf: identidadeFiscal.tpNf,
        fin_nfe: identidadeFiscal.finNfe,
      })
      .eq("id", operacaoId)
      .eq("empresa_id", empresaId);

    const { data: emissaoAtual, error: emissaoAtualError } = await admin
      .from("fiscal_emissoes")
      .select(
        "id, status, numero, serie, codigo_numerico, chave_acesso, protocolo, cstat, motivo, geranet_http_status, erro_comunicacao, resposta_resumo"
      )
      .eq("id", emissaoId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (emissaoAtualError || !emissaoAtual) {
      return erro("Reserva criada, mas não foi possível reler a emissão.", 500, {
        emissao_id: emissaoId,
      });
    }
    if (emissaoAtual.status === "autorizada") {
      await admin
        .from("fiscal_operacoes")
        .update({ status: "aguardando_saida" })
        .eq("id", operacaoId)
        .eq("empresa_id", empresaId);
      return json({
        ok: true,
        autorizada: true,
        reutilizada: true,
        emissao_id: emissaoId,
        chave: emissaoAtual.chave_acesso,
        protocolo: emissaoAtual.protocolo,
        mensagem: "Esta operação já possui NF-e autorizada.",
      });
    }
    if (emissaoAtual.status === "aguardando_reconciliacao") {
      await admin
        .from("fiscal_operacoes")
        .update({ status: "aguardando_reconciliacao" })
        .eq("id", operacaoId)
        .eq("empresa_id", empresaId);
      return erro(
        mensagemBloqueioEmissao(emissaoAtual),
        409,
        extraBloqueioRetransmissaoFiscal({
          id: emissaoId,
          status: emissaoAtual.status,
        })
      );
    }
    if (emissaoAtual.status === "enviando") {
      return erro(
        mensagemBloqueioEmissao(emissaoAtual),
        409,
        extraBloqueioRetransmissaoFiscal({
          id: emissaoId,
          status: emissaoAtual.status,
        })
      );
    }

    let fusoHorario: string;
    try {
      fusoHorario = exigirFusoHorarioFiscalDaEmissao({
        empresaIdDaEmissao: empresaId,
        fiscal,
      });
    } catch (errorFuso) {
      return erro(
        errorFuso instanceof Error
          ? errorFuso.message
          : "Fuso horário fiscal da empresa não está configurado."
      );
    }

    const dataHora = formatarDataHoraGeranet(
      new Date(),
      fusoHorario
    );
    const cabecalhoNfe = resolverPayloadCabecalhoNfe({
      snapshot: operacao.snapshot_fiscal,
      finNfeOperacao: operacao.fin_nfe,
      finNfeNatureza: identidadeFiscal.finNfe,
      tpNfOperacao: operacao.tp_nf,
      indicadorPresencaPadraoEmpresa: fiscal.indicador_presenca_padrao,
      indicativoIntermediadorPadraoEmpresa: fiscal.indicativo_intermediador_padrao,
      dataHoraEmissao: dataHora,
    });

    const payload = montarPayloadNfeGeranet({
      ambiente,
      ufEmitente,
      certificadoDigital: certificado,
      senhaCertificadoDigital: senhaCertificado,
      emitente: {
        logomarca: await obterLogomarcaFiscalHex(empresaId),
        cnpj: empresa.cnpj,
        inscricaoEstadual: ieEmitente,
        razaoSocial: empresa.razao_social,
        nomeFantasia: empresa.nome_fantasia,
        telefone: fiscal.telefone,
        email: fiscal.email,
        logradouro: fiscal.logradouro,
        numero: fiscal.numero,
        complemento: fiscal.complemento,
        bairro: fiscal.bairro,
        municipio: fiscal.municipio,
        codigoMunicipio: fiscal.codigo_municipio_ibge,
        uf: ufEmitente,
        cep: fiscal.cep,
        codigoRegimeTributario: crt,
        tipoAtividade: fiscal.tipo_atividade ?? "3",
        informacaoComplementar: fiscal.informacao_complementar_padrao,
      },
      destinatario: {
        ...destinatario,
        codigoPais: "1058",
        nomePais: "Brasil",
        entrega: enderecoEntregaDoSnapshotParaGeranet(operacao.snapshot_fiscal),
      },
      autorizadosXml: autorizadosXmlDoSnapshotParaGeranet(operacao.snapshot_fiscal),
      responsavelTecnico: responsavelTecnicoDoCadastroFiscal({
        fiscal,
        csrt: csrtResult.error ? null : csrtResult.data,
      }),
      config: {
        serie: emissaoAtual.serie,
        numeroNota: emissaoAtual.numero,
        codigoNumerico: texto(emissaoAtual.codigo_numerico),
        dataSaida: cabecalhoNfe.dataSaida,
        dataEmissao: cabecalhoNfe.dataEmissao,
        fusoHorario,
        indicadorPresenca: cabecalhoNfe.indicadorPresenca || "9",
        indicativoIntermediador: cabecalhoNfe.indicativoIntermediador || "0",
        naturezaOperacao: identidadeFiscal.descricao,
        tipo: cabecalhoNfe.tpNf || identidadeFiscal.tpNf,
        finalidade: cabecalhoNfe.finNfe || identidadeFiscal.finNfe,
        frete: transporteResolvido.dados.mod_frete ?? "9",
        informacaoAdicionalFisco: montarInformacaoAdicionalFisco({
          textoUsuario: textoUsuarioInfAdFiscoNfe({
            snapshot: operacao.snapshot_fiscal,
            coluna: operacao.informacao_adicional_fisco,
          }),
        }),
        informacaoComplementar: montarInformacaoComplementarNfe({
          textosAutomaticos: [],
          padraoEmpresa: fiscal.informacao_complementar_padrao,
          textoUsuario: textoUsuarioInfCplNfe({
            snapshot: operacao.snapshot_fiscal,
            coluna: operacao.informacao_complementar_usuario,
          }),
        }),
      },
      transporte: transporteNfeParaPayloadGeranet(transporteResolvido.dados),
      pagamento: {
        troco: 0,
        detalhamento: [{ tipo: "90", valor: 0, indicadorPagamento: "0" }],
      },
      itens: itensFiscais,
    });

    aplicarValorTotalNotaGeranet({
      modelo: "55",
      nfe: payload.nfe,
      itensFiscais,
    });

    const claim = await claimTentativaEmissaoFiscal({
      admin,
      empresaId,
      emissaoId,
      usuarioId: String(claimsData.claims.sub),
      payload,
      snapshotItens: snapshotItensDaTransmissao(itensFiscais),
    });
    if (!claim.ok) {
      return erro(claim.mensagem, claim.motivo === "erro" ? 500 : 409, {
        emissao_id: emissaoId,
        podeConsultarNovamente: true,
        podeRetransmitir: false,
      });
    }
    const tentativaId = claim.tentativaId;

    await admin
      .from("fiscal_operacoes")
      .update({ status: "enviando" })
      .eq("id", operacaoId)
      .eq("empresa_id", empresaId);

    let resultadoGeranet: Awaited<ReturnType<typeof chamarGeranet>>;
    try {
      resultadoGeranet = await chamarGeranet({
        apiKey,
        endpoint: "/api/v1/nfe/emitir",
        payload,
        timeoutMs: 45_000,
      });
    } catch (e) {
      const persistencia = persistenciaFalhaComunicacaoEmitir(e);
      await admin
        .from("fiscal_emissoes")
        .update(patchEmissaoFalhaComunicacao(persistencia))
        .eq("id", emissaoId)
        .eq("empresa_id", empresaId);
      await registrarRespostaTentativaFiscal({
        admin,
        empresaId,
        tentativaId,
        motivo: persistencia.motivo,
        resposta: {
          erro: persistencia.motivo,
          classificacao: persistencia.classificacaoResumo,
        },
        classificacaoInicial: persistencia.status,
      });
      await admin
        .from("fiscal_operacoes")
        .update({
          status: persistencia.retransmitir
            ? "pronta_para_emissao"
            : "aguardando_reconciliacao",
        })
        .eq("id", operacaoId)
        .eq("empresa_id", empresaId);
      const respostaErro = montarErroEmitirNaoAutorizada({
        persistencia: persistirClassificacaoNaoAutorizada(
          persistencia.retransmitir ? "erro_envio" : "aguardando_reconciliacao"
        ),
        motivoTecnico: persistencia.motivo,
        emissaoId,
        modelo: "55",
      });
      return erro(
        respostaErro.mensagem,
        respostaErro.statusHttp,
        respostaErro.extra
      );
    }

    const geranet = resultadoGeranet.dados;
    const chave = texto(geranet.chave);
    const protocolo = texto(geranet.protocolo);
    const situacao = texto(geranet.situacao).toLowerCase();
    const autorizado =
      resultadoGeranet.httpOk &&
      situacao === "sucesso" &&
      /^\d{44}$/.test(chave) &&
      protocolo.length > 0;

    if (autorizado) {
      await admin
        .from("fiscal_emissoes")
        .update({
          status: "autorizada",
          chave_acesso: chave,
          protocolo,
          cstat: texto(geranet.cstat) || null,
          motivo: texto(geranet.mensagem) || null,
          geranet_http_status: resultadoGeranet.httpStatus,
          geranet_situacao: texto(geranet.situacao) || null,
          resposta_resumo: resultadoGeranet.resumo,
          xml_hex: texto(geranet.xml) || null,
          pdf_hex: texto(geranet.pdf) || null,
          erro_comunicacao: null,
          respondida_at: new Date().toISOString(),
          autorizada_at: new Date().toISOString(),
        })
        .eq("id", emissaoId)
        .eq("empresa_id", empresaId);
      await registrarRespostaTentativaFiscal({
        admin,
        empresaId,
        tentativaId,
        httpStatus: resultadoGeranet.httpStatus,
        cstat: geranet.cstat,
        motivo: geranet.mensagem,
        geranetLogId: geranetLogIdDe(geranet),
        resposta: resultadoGeranet.resumo,
        xmlHex: texto(geranet.xml) || null,
        pdfHex: texto(geranet.pdf) || null,
        classificacaoInicial: "autorizada",
      });
      await admin
        .from("fiscal_operacoes")
        .update({ status: "aguardando_saida" })
        .eq("id", operacaoId)
        .eq("empresa_id", empresaId);
      return json({
        ok: true,
        autorizada: true,
        emissao_id: emissaoId,
        chave,
        protocolo,
        mensagem: "NF-e autorizada. O estoque ainda não foi movimentado.",
      });
    }

    const classificacaoEmissao = classificarRespostaEmitir({
      httpOk: resultadoGeranet.httpOk,
      httpStatus: resultadoGeranet.httpStatus,
      situacao,
      cstat: geranet.cstat,
      mensagem: geranet.mensagem,
      chave,
      protocolo,
    });

    if (classificacaoEmissao !== "rejeitada") {
      const persistencia = persistirClassificacaoNaoAutorizada(
        classificacaoEmissao === "erro_envio"
          ? "erro_envio"
          : "aguardando_reconciliacao"
      );
      const motivoTecnico = texto(geranet.mensagem) || persistencia.mensagemPadrao;
      await admin
        .from("fiscal_emissoes")
        .update({
          status: persistencia.status,
          geranet_http_status: resultadoGeranet.httpStatus,
          geranet_situacao: texto(geranet.situacao) || null,
          cstat: texto(geranet.cstat) || null,
          motivo: motivoTecnico,
          erro_comunicacao: motivoTecnico,
          resposta_resumo: {
            ...resultadoGeranet.resumo,
            classificacao: persistencia.classificacaoResumo,
            historico: [historicoErroTecnico(motivoTecnico)],
          },
          xml_hex: texto(geranet.xml) || null,
          pdf_hex: texto(geranet.pdf) || null,
          respondida_at: new Date().toISOString(),
        })
        .eq("id", emissaoId)
        .eq("empresa_id", empresaId);
      await registrarRespostaTentativaFiscal({
        admin,
        empresaId,
        tentativaId,
        httpStatus: resultadoGeranet.httpStatus,
        cstat: geranet.cstat,
        motivo: motivoTecnico,
        geranetLogId: geranetLogIdDe(geranet),
        resposta: {
          ...resultadoGeranet.resumo,
          classificacao: persistencia.classificacaoResumo,
        },
        xmlHex: texto(geranet.xml) || null,
        pdfHex: texto(geranet.pdf) || null,
        classificacaoInicial: persistencia.status,
      });
      await admin
        .from("fiscal_operacoes")
        .update({
          status: persistencia.retransmitir
            ? "pronta_para_emissao"
            : "aguardando_reconciliacao",
        })
        .eq("id", operacaoId)
        .eq("empresa_id", empresaId);
      const respostaErro = montarErroEmitirNaoAutorizada({
        persistencia,
        motivoTecnico,
        emissaoId,
        httpGeranet: resultadoGeranet.httpStatus,
        geranet: resultadoGeranet.resumo,
        modelo: "55",
      });
      return erro(
        respostaErro.mensagem,
        respostaErro.statusHttp,
        respostaErro.extra
      );
    }

    await admin
      .from("fiscal_emissoes")
      .update({
        status: "rejeitada",
        cstat: texto(geranet.cstat) || null,
        motivo: texto(geranet.mensagem) || "Documento rejeitado.",
        geranet_http_status: resultadoGeranet.httpStatus,
        geranet_situacao: texto(geranet.situacao) || null,
        erro_comunicacao: null,
        resposta_resumo: {
          ...(resultadoGeranet.resumo ?? {}),
          classificacao: "rejeitada",
        },
        respondida_at: new Date().toISOString(),
      })
      .eq("id", emissaoId)
      .eq("empresa_id", empresaId);
    await registrarRespostaTentativaFiscal({
      admin,
      empresaId,
      tentativaId,
      httpStatus: resultadoGeranet.httpStatus,
      cstat: geranet.cstat,
      motivo: geranet.mensagem,
      geranetLogId: geranetLogIdDe(geranet),
      resposta: {
        ...(resultadoGeranet.resumo ?? {}),
        classificacao: "rejeitada",
      },
      xmlHex: texto(geranet.xml) || null,
      pdfHex: texto(geranet.pdf) || null,
      classificacaoInicial: "rejeitada",
    });
    await admin
      .from("fiscal_operacoes")
      .update({ status: "rejeitada" })
      .eq("id", operacaoId)
      .eq("empresa_id", empresaId);
    return erro(texto(geranet.mensagem) || "NF-e rejeitada.", 422, {
      emissao_id: emissaoId,
      status: "rejeitada",
    });
  } catch (error) {
    return erro(
      error instanceof Error ? error.message : "Falha inesperada ao emitir a NF-e.",
      500
    );
  }
}
