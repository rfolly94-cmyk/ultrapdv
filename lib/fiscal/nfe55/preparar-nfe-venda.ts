import type { SupabaseClient } from "@supabase/supabase-js";

import {
  montarItemGeranet,
  type ItemGeranet,
  type OperacaoFiscal,
} from "@/lib/fiscal/geranet/montar-item";
import {
  camposIpiDoGrupo,
  parsePerfilIpi,
  pendenciasIpiDocumento,
} from "@/lib/fiscal/ipi";
import {
  grupoGeranetDoSnapshotTributario,
  lerSnapshotTributarioItem,
  resolverTributacaoItemVenda,
  snapshotTributarioItemCompleto,
  vendaTemTributacaoItensCongelada,
} from "@/lib/fiscal/snapshot-tributario-venda";
import { mensagemEmissaoItemAvulsoSemFiscal } from "@/lib/pdv/item-avulso";
import {
  DistribuicaoDescontoFiscalError,
  conferirSomaItensFiscaisComVenda,
  distribuirDescontoItens,
  mapaDescontoFiscalPorItem,
  paraCentavos,
  valorBrutoItemEmCentavos,
  valorLiquidoFiscalEmCentavos,
} from "@/lib/fiscal/distribuir-desconto-itens";
import { distribuirValorProporcional } from "@/lib/fiscal/nfe55/totais-nota";
import {
  aplicarPagamentosRascunhoNaEmissaoNfeVenda,
  aplicarPrecosComerciaisOperacaoNosItensVenda,
  precosComerciaisOperacaoCompativeis,
  totaisFiscaisEmissaoNfeVenda,
  totalFiscalEsperadoEmissaoNfeVenda,
  trocoEmissaoNfeVenda,
} from "@/lib/fiscal/nfe55/valores-comerciais-nfe";
import {
  ieDestinatarioParaGeranet,
  origemSnapshotAInicializar,
  resolverDestinatarioFiscalDaOrigem,
  snapshotDestinatarioParaPersistir,
  lerSnapshotDestinatarioFiscal,
} from "@/lib/fiscal/destinatario/resolver-destinatario-fiscal";
import {
  mesclarSnapshotOperacao,
  pagamentosRascunhoDoSnapshot,
} from "@/lib/fiscal/nfe55/pagamentos-rascunho";
import {
  faturaNfeDoSnapshot,
  faturaParaPayloadGeranet,
  validarFaturaParaEmissaoNfe,
} from "@/lib/fiscal/nfe55/fatura-nfe";
import {
  TPAG_DUPLICATA_MERCANTIL,
  conferenciaComercialNfeComDuplicata,
  faturaPermitidaNoPayloadNfe,
  formaEhPagamentoPosterior,
  mapearDetalhamentoFiscalNfe55,
  pagamentoEhDuplicataMercantil,
  validarPagamentoFiscalNfe55,
} from "@/lib/fiscal/nfe55/pagamento-fiscal-nfe";
import {
  escolherNumeracaoNfe55,
  lerCabecalhoFiscalDoSnapshot,
} from "@/lib/fiscal/nfe55/cabecalho-fiscal";
import type { SegredosFiscaisGeranet } from "@/lib/fiscal/geranet/montar-payload-nfce";
import type {
  AmbienteGeranet,
  CodigoRegimeTributario,
} from "@/lib/fiscal/geranet/resolver-politica-ibscbs";
import { formatarDataHoraGeranet } from "@/lib/fiscal/geranet/data-hora";
import { exigirFusoHorarioFiscalDaEmissao } from "@/lib/fiscal/fuso-horario-empresa";
import { obterSegredosFiscaisEmissao } from "@/lib/fiscal/geranet/credencial-plataforma";
import { validarPagamentosEletronicosParaEmissao } from "@/lib/fiscal/validar-pagamentos-eletronicos";
import {
  filtrarPagamentosFinanceiros,
  somarValoresPagamento,
} from "@/lib/vendas/pagamentos-financeiros";
import {
  MENSAGEM_NATUREZA_VENDA_AUSENTE,
  MENSAGEM_NATUREZA_VENDA_INVALIDA,
  type NaturezaOperacaoFiscal,
} from "@/lib/fiscal/operacoes/catalogo";
import { naturezaEstaCompleta } from "@/lib/fiscal/operacoes/resolver-natureza";
import {
  resolverCfopEfetivo,
  normalizarRegrasCfopDaEmpresaAtiva,
} from "@/lib/fiscal/operacoes/resolver-cfop";
import {
  MENSAGEM_FRETE_9_COM_DADOS,
  transporteConflitaComFrete9,
} from "@/lib/fiscal/transporte/dados-transporte-venda";
import { carregarTransporteNfe55 } from "@/lib/fiscal/transporte/resolver-transporte-nfe";
import type {
  ConsumidorFinalNfe,
  IndicadorIeDestinatarioNfe,
} from "@/lib/fiscal/geranet/montar-payload-nfe";

export type ModoPreparacaoNfeVenda = "preview" | "emissao";

export type FalhaPreparacaoNfeVenda = {
  ok: false;
  erro: string;
  status: number;
  extra?: Record<string, unknown>;
};

function falha(
  mensagem: string,
  status = 422,
  extra?: Record<string, unknown>
): FalhaPreparacaoNfeVenda {
  return {
    ok: false,
    erro: mensagem,
    status,
    ...(extra ? { extra } : {}),
  };
}

function texto(valor: unknown) {
  return String(valor ?? "").trim();
}

function somenteDigitos(valor: unknown) {
  return texto(valor).replace(/\D/g, "");
}

function numero(valor: unknown, padrao = 0) {
  if (valor === null || valor === undefined || valor === "") {
    return padrao;
  }
  const n = Number(valor);
  return Number.isFinite(n) ? n : NaN;
}

function idsUnicos(valores: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      valores.filter(
        (valor): valor is string =>
          typeof valor === "string" && valor.length > 0
      )
    )
  );
}

/**
 * Resolve os dados fiscais da NF-e modelo 55 de uma venda.
 * Preview e emissão usam esta função. Efeitos colaterais de
 * gravação de snapshot do destinatário só ocorrem em "emissao".
 * Não reserva número, não grava tentativa e não transmite.
 */
export async function prepararNfeVenda(input: {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  empresaId: string;
  vendaId: string;
  modo: ModoPreparacaoNfeVenda;
  serie?: number | string | null;
  confirmacao?: string | null;
  agora?: Date;
}) {
  const { supabase, admin, empresaId, vendaId, modo } = input;
  const body = { serie: input.serie };
  const confirmacaoRecebida = texto(input.confirmacao);
  const instanteCabecalho = input.agora ?? new Date();

    const [
      vendaResult,
      itensResult,
      pagamentosResult,
      empresaResult,
      fiscalResult,
      numeracoesResult,
      segredosResult,
      csrtResult,
    ] =
      await Promise.all([
        supabase
          .from("vendas")
          .select(`
            id,
            numero,
            cliente_id,
            status,
            valor_produtos,
            desconto,
            valor_total,
            troco,
            acrescimo,
            frete,
            observacao,
            dados_transporte,
            natureza_id,
            snapshot_fiscal
          `)
          .eq(
            "empresa_id",
            empresaId
          )
          .eq(
            "id",
            vendaId
          )
          .maybeSingle(),

        supabase
          .from(
            "vendas_itens"
          )
          .select(`
            id,
            produto_id,
            produto_codigo,
            produto_nome,
            unidade_medida,
            quantidade,
            valor_unitario,
            desconto,
            acrescimo,
            valor_total,
            grupo_fiscal_id,
            ncm,
            cest,
            origem_produto,
            cfop,
            icms_cst_csosn,
            pis_cst,
            cofins_cst,
            cst_ibscbs,
            classificacao_ibscbs,
            origem_item,
            snapshot_fiscal
          `)
          .eq(
            "empresa_id",
            empresaId
          )
          .eq(
            "venda_id",
            vendaId
          )
          .order(
            "created_at",
            {
              ascending:
                true,
            }
          ),

        supabase
          .from(
            "vendas_pagamentos"
          )
          .select(`
            id,
            forma_pagamento_codigo,
            forma_pagamento_nome,
            codigo_fiscal,
            indicador_pagamento,
            valor,
            bandeira,
            autorizacao,
            status
          `)
          .eq(
            "empresa_id",
            empresaId
          )
          .eq(
            "venda_id",
            vendaId
          )
          .order(
            "created_at",
            {
              ascending:
                true,
            }
          ),

        supabase
          .from("empresas")
          .select(`
            id,
            razao_social,
            nome_fantasia,
            cnpj,
            ativo
          `)
          .eq(
            "id",
            empresaId
          )
          .maybeSingle(),

        supabase
          .from(
            "empresas_fiscal"
          )
          .select(`
            empresa_id,
            inscricao_estadual,
            telefone,
            email,
            logradouro,
            numero,
            complemento,
            bairro,
            cep,
            municipio,
            codigo_municipio_ibge,
            uf,
            tipo_atividade,
            perfil_ipi,
            codigo_regime_tributario,
            indicador_presenca_padrao,
            indicativo_intermediador_padrao,
            natureza_operacao_padrao,
            informacao_complementar_padrao,
            fuso_horario,
            ambiente,
            ativo,
            responsavel_tecnico_cnpj,
            responsavel_tecnico_contato,
            responsavel_tecnico_email,
            responsavel_tecnico_fone,
            responsavel_tecnico_id_csrt
          `)
          .eq(
            "empresa_id",
            empresaId
          )
          .maybeSingle(),

        supabase
          .from(
            "fiscal_numeracoes"
          )
          .select(`
            id,
            modelo,
            ambiente,
            serie,
            proximo_numero,
            ativo
          `)
          .eq(
            "empresa_id",
            empresaId
          )
          .eq(
            "modelo",
            "55"
          )
          .eq(
            "ativo",
            true
          )
          .order(
            "serie",
            {
              ascending:
                true,
            }
          ),

        obterSegredosFiscaisEmissao(
          admin,
          empresaId
        ),
        admin.rpc(
          "obter_csrt_fiscal",
          {
            p_empresa_id:
              empresaId,
          }
        ),
      ]);

    const primeiroErro =
      vendaResult.error ??
      itensResult.error ??
      pagamentosResult.error ??
      empresaResult.error ??
      fiscalResult.error ??
      numeracoesResult.error;

    if (primeiroErro) {
      return falha(
        primeiroErro.message,
        500
      );
    }

    if (
      segredosResult.error
    ) {
      return falha(
        "Não foi possível ler os segredos fiscais.",
        500
      );
    }

    const venda =
      vendaResult.data;

    let itensVenda =
      itensResult.data ??
      [];

    let pagamentos =
      pagamentosResult.data ??
      [];

    const empresa =
      empresaResult.data;

    const fiscal =
      fiscalResult.data;

    const ambienteFiscalNumero =
      Number(
        fiscal?.ambiente
      ) === 1
        ? 1
        : 2;

    const numeracoes =
      (
        numeracoesResult.data ??
        []
      ).filter(
        (item) =>
          Number(
            item.ambiente
          ) ===
          ambienteFiscalNumero
      );

    const segredos =
      (
        segredosResult.data ??
        {}
      ) as
        SegredosFiscaisGeranet;

    if (!venda) {
      return falha(
        "Venda não encontrada.",
        404
      );
    }

    if (
      venda.status !==
      "finalizada"
    ) {
      return falha(
        "Somente venda finalizada pode emitir NF-e."
      );
    }

    if (
      !venda.cliente_id
    ) {
      return falha(
        "NF-e exige cliente identificado na venda."
      );
    }

    const { data: operacaoDestino } =
      await supabase
        .from("fiscal_operacoes")
        .select("destinatario_id, empresa_id")
        .eq("empresa_id", empresaId)
        .eq("venda_id", venda.id)
        .maybeSingle();
    const clienteIdEmissao =
      operacaoDestino &&
      String(operacaoDestino.empresa_id) ===
        String(empresaId) &&
      operacaoDestino.destinatario_id
        ? String(operacaoDestino.destinatario_id)
        : String(venda.cliente_id);

    const transporteResolvido = await carregarTransporteNfe55({
      db: supabase,
      empresaId,
      vendaId,
    });
    if (transporteConflitaComFrete9(transporteResolvido.dados)) {
      return falha(MENSAGEM_FRETE_9_COM_DADOS);
    }
    const modalidadeFrete =
      transporteResolvido.dados.mod_frete ?? "9";

    if (
      itensVenda.length ===
      0
    ) {
      return falha(
        "A venda não possui itens."
      );
    }

    if (
      itensVenda.some(
        (item) =>
          numero(
            item.acrescimo
          ) > 0
      )
    ) {
      return falha(
        "Esta etapa ainda não transmite acréscimo por item."
      );
    }

    const {
      data: cliente,
      error: clienteError,
    } =
      await supabase
        .from("clientes")
        .select(`
          id,
          nome,
          nome_fantasia,
          tipo_pessoa,
          cpf_cnpj,
          inscricao_estadual,
          empresa_id,
          contribuinte_icms,
          indicador_ie_destinatario,
          consumidor_final,
          telefone,
          email,
          cep,
          logradouro,
          numero,
          complemento,
          bairro,
          municipio,
          codigo_municipio_ibge,
          uf,
          ativo
        `)
        .eq(
          "empresa_id",
          empresaId
        )
        .eq(
          "id",
          clienteIdEmissao
        )
        .maybeSingle();

    if (
      clienteError
    ) {
      return falha(
        clienteError.message,
        500
      );
    }

    if (
      !cliente ||
      !cliente.ativo
    ) {
      return falha(
        "Cliente da venda não encontrado ou inativo."
      );
    }

    if (
      String(cliente.empresa_id) !==
      String(empresaId)
    ) {
      return falha(
        "Destinatário não pertence à empresa ativa."
      );
    }

    const documento =
      somenteDigitos(
        cliente.cpf_cnpj
      );

    if (
      cliente.tipo_pessoa ===
        "F" &&
      documento.length !== 11
    ) {
      return falha(
        "CPF do destinatário inválido."
      );
    }

    if (
      cliente.tipo_pessoa ===
        "J" &&
      documento.length !== 14
    ) {
      return falha(
        "CNPJ do destinatário inválido."
      );
    }

    const clienteUf =
      texto(
        cliente.uf
      ).toUpperCase();

    if (
      somenteDigitos(
        cliente.cep
      ).length !== 8 ||
      !texto(
        cliente.logradouro
      ) ||
      !texto(
        cliente.numero
      ) ||
      !texto(
        cliente.bairro
      ) ||
      !texto(
        cliente.municipio
      ) ||
      somenteDigitos(
        cliente
          .codigo_municipio_ibge
      ).length !== 7 ||
      !/^[A-Z]{2}$/.test(
        clienteUf
      )
    ) {
      return falha(
        "Endereço fiscal do destinatário está incompleto."
      );
    }

    const { data: operacaoVenda } =
      await supabase
        .from("fiscal_operacoes")
        .select(
          "id, empresa_id, snapshot_fiscal, natureza_id, fin_nfe, natureza_descricao, tp_nf, informacao_complementar_usuario, informacao_adicional_fisco"
        )
        .eq(
          "empresa_id",
          empresaId
        )
        .eq(
          "venda_id",
          venda.id
        )
        .maybeSingle();
    const origemOperacaoFiscal =
      operacaoVenda != null &&
      String(operacaoVenda.empresa_id) ===
        String(empresaId);
    if (origemOperacaoFiscal && operacaoVenda) {
      const { data: itensOperacaoFiscal, error: itensOperacaoErro } =
        await supabase
          .from("fiscal_operacoes_itens")
          .select("produto_id, quantidade, valor_unitario")
          .eq("empresa_id", empresaId)
          .eq("operacao_id", operacaoVenda.id)
          .order("created_at", { ascending: true });
      if (itensOperacaoErro) {
        return falha(itensOperacaoErro.message, 500);
      }
      const itensOperacao = itensOperacaoFiscal ?? [];
      if (!precosComerciaisOperacaoCompativeis(itensVenda, itensOperacao)) {
        return falha(
          "Itens da operação fiscal divergem da venda. Quantidade e preço editados não puderam ser aplicados."
        );
      }
      itensVenda = aplicarPrecosComerciaisOperacaoNosItensVenda(
        itensVenda,
        itensOperacao
      );
    }
    const snapshotOperacao =
      origemOperacaoFiscal && operacaoVenda
        ? operacaoVenda.snapshot_fiscal
        : null;
    let overlayPagamentos = false;
    let formasOverlay: Array<{
      id: string;
      codigo?: string | null;
      nome?: string | null;
      codigo_fiscal?: string | null;
      permite_parcelamento?: boolean | null;
      permite_fiado?: boolean | null;
    }> = [];
    if (origemOperacaoFiscal && operacaoVenda) {
      const pagamentosRascunho = pagamentosRascunhoDoSnapshot(
        operacaoVenda.snapshot_fiscal
      );
      if (pagamentosRascunho.length > 0) {
        const formaIds = [
          ...new Set(
            pagamentosRascunho.map((pagamento) => pagamento.formaPagamentoId)
          ),
        ];
        const { data: formasRascunho, error: formasErro } = await supabase
          .from("formas_pagamento")
          .select(
            "id, empresa_id, codigo, nome, codigo_fiscal, permite_parcelamento, permite_fiado"
          )
          .eq("empresa_id", empresaId)
          .in("id", formaIds);
        if (formasErro) {
          return falha(formasErro.message, 500);
        }
        formasOverlay = (formasRascunho ?? []).filter(
          (forma) => String(forma.empresa_id) === String(empresaId)
        );
        const overlayPagamento = aplicarPagamentosRascunhoNaEmissaoNfeVenda({
          origemOperacaoFiscal: true,
          pagamentosVenda: pagamentos,
          pagamentosRascunho,
          formas: formasOverlay,
        });
        if (!overlayPagamento.ok) {
          return falha(overlayPagamento.erro);
        }
        pagamentos = overlayPagamento.pagamentos;
        overlayPagamentos = overlayPagamento.overlay;
      }
    }
    const snapshotDestinatario =
      lerSnapshotDestinatarioFiscal(
        snapshotOperacao
      );
    const snapshotVenda =
      lerSnapshotDestinatarioFiscal(
        venda.snapshot_fiscal
      );
    const destinatarioFiscal =
      resolverDestinatarioFiscalDaOrigem({
        modelo: "55",
        tipoOperacaoInterno: "venda",
        origemVenda: "pdv",
        snapshotOperacao,
        snapshotVenda: venda.snapshot_fiscal,
        contribuinteIcms:
          cliente.contribuinte_icms,
        indicadorIeCadastro:
          cliente.indicador_ie_destinatario,
        consumidorFinalCadastro:
          cliente.consumidor_final,
      });
    const indicadorIe:
      IndicadorIeDestinatarioNfe =
        destinatarioFiscal.indicadorIEdestinatario;

    if (
      indicadorIe === "1" &&
      !texto(
        cliente.inscricao_estadual
      )
    ) {
      return falha(
        "Cliente marcado como contribuinte ICMS precisa ter Inscrição Estadual."
      );
    }

    const consumidorFinal:
      ConsumidorFinalNfe =
        destinatarioFiscal.consumidorFinal;

    if (
      modo === "emissao" &&
      !snapshotDestinatario.consumidorFinalDefinido &&
      !snapshotVenda.consumidorFinalDefinido
    ) {
      const patchDestinatario =
        snapshotDestinatarioParaPersistir({
          consumidorFinal:
            consumidorFinal === "1",
          origem:
            origemSnapshotAInicializar({
              origemVenda: "pdv",
              tipoOperacaoInterno: "venda",
            }),
          indicadorIe,
        });
      const { error: snapVendaErro } =
        await supabase
          .from("vendas")
          .update({
            snapshot_fiscal:
              mesclarSnapshotOperacao(
                venda.snapshot_fiscal,
                patchDestinatario
              ),
          })
          .eq("id", venda.id)
          .eq("empresa_id", empresaId);
      if (snapVendaErro) {
        return falha(
          snapVendaErro.message,
          500
        );
      }
      if (
        operacaoVenda &&
        String(operacaoVenda.empresa_id) ===
          String(empresaId)
      ) {
        const { error: snapOpErro } =
          await supabase
            .from("fiscal_operacoes")
            .update({
              snapshot_fiscal:
                mesclarSnapshotOperacao(
                  operacaoVenda.snapshot_fiscal,
                  patchDestinatario
                ),
            })
            .eq("id", operacaoVenda.id)
            .eq("empresa_id", empresaId);
        if (snapOpErro) {
          return falha(
            snapOpErro.message,
            500
          );
        }
      }
    }

    let pagamentosConfirmados =
      filtrarPagamentosFinanceiros(
        pagamentos
      );
    const faturaSnapshot = faturaNfeDoSnapshot(snapshotOperacao);
    const coberturaFaturaCentavos = faturaSnapshot?.valorLiquidoCentavos ?? 0;

    if (
      pagamentosConfirmados.length ===
        0 &&
      coberturaFaturaCentavos <= 0
    ) {
      return falha(
        "A venda não possui pagamento confirmado."
      );
    }

    if (formasOverlay.length === 0) {
      const { data: formasEmpresa, error: formasEmpresaErro } = await supabase
        .from("formas_pagamento")
        .select(
          "id, empresa_id, codigo, nome, codigo_fiscal, permite_parcelamento, permite_fiado"
        )
        .eq("empresa_id", empresaId);
      if (formasEmpresaErro) {
        return falha(formasEmpresaErro.message, 500);
      }
      formasOverlay = (formasEmpresa ?? []).filter(
        (forma) => String(forma.empresa_id) === String(empresaId)
      );
    }

    for (
      const pagamento
      of pagamentosConfirmados
    ) {
      const forma = formasOverlay.find(
        (item) =>
          String(item.id) === String(pagamento.id ?? "") ||
          (item.codigo &&
            String(item.codigo) ===
              String(pagamento.forma_pagamento_codigo ?? "")) ||
          (item.codigo_fiscal &&
            String(item.codigo_fiscal) ===
              String(pagamento.codigo_fiscal ?? ""))
      );
      if (formaEhPagamentoPosterior(forma)) {
        continue;
      }
      if (
        !/^\d{2}$/.test(
          texto(
            pagamento.codigo_fiscal
          )
        )
      ) {
        return falha(
          `Forma de pagamento ${
            pagamento
              .forma_pagamento_nome ??
            pagamento
              .forma_pagamento_codigo ??
            pagamento.id
          } sem tPag válido.`
        );
      }

      if (
        !["0", "1"].includes(
          texto(
            pagamento
              .indicador_pagamento
          )
        )
      ) {
        return falha(
          "Indicador de pagamento inválido."
        );
      }
    }

    const bloqueioEletronico =
      validarPagamentosEletronicosParaEmissao({
        modelo: "55",
        pagamentos: pagamentosConfirmados,
      });

    if (bloqueioEletronico) {
      return falha(bloqueioEletronico);
    }

    const totaisParaConferencia = totaisFiscaisEmissaoNfeVenda({
      origemOperacaoFiscal,
      snapshotOperacao,
      venda: {
        acrescimo: venda.acrescimo,
        desconto: venda.desconto,
        frete: venda.frete,
      },
    });
    const totalParaConferencia = totalFiscalEsperadoEmissaoNfeVenda({
      origemOperacaoFiscal,
      itens: itensVenda.map((item) => ({
        quantidade: numero(item.quantidade),
        valorUnitario: numero(item.valor_unitario),
      })),
      totais: totaisParaConferencia,
      valorTotalVenda: numero(venda.valor_total),
    });
    const somaPagamentosConfirmados = somarValoresPagamento(
      filtrarPagamentosFinanceiros(pagamentos)
    );
    const trocoVenda = trocoEmissaoNfeVenda({
      origemOperacaoFiscal,
      overlayPagamentos,
      somaPagamentos: somaPagamentosConfirmados,
      totalFiscal: totalParaConferencia,
      trocoVenda: numero(venda.troco),
    });

    const jaTemDuplicataNoPagamento = pagamentosConfirmados.some((pagamento) =>
      pagamentoEhDuplicataMercantil(pagamento, formasOverlay)
    );
    const coberturaDuplicataCentavos = jaTemDuplicataNoPagamento
      ? 0
      : coberturaFaturaCentavos;
    const conferencia =
      conferenciaComercialNfeComDuplicata({
        valorTotal:
          totalParaConferencia,
        pagamentos,
        troco:
          trocoVenda,
        coberturaDuplicataCentavos,
      });

    if (
      !conferencia.ok
    ) {
      return falha(
        "Pagamentos líquidos não conferem com o total da venda."
      );
    }

    const detalhamentoFiscal = mapearDetalhamentoFiscalNfe55({
      pagamentos: pagamentosConfirmados,
      formas: formasOverlay,
      duplicataMercantilCentavos: coberturaDuplicataCentavos,
    });
    const temDuplicataMercantil = detalhamentoFiscal.some(
      (item) => item.tipo === TPAG_DUPLICATA_MERCANTIL
    );
    const erroFatura = validarFaturaParaEmissaoNfe({
      temDuplicataMercantil,
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
    const faturaGeranet = faturaPermitidaNoPayloadNfe(
      detalhamentoFiscal,
      faturaParaPayloadGeranet(faturaSnapshot)
    );
    const erroPagamentoFiscal = validarPagamentoFiscalNfe55({
      detalhamento: detalhamentoFiscal,
      totalNfe: totalParaConferencia,
      troco: trocoVenda,
      fatura: faturaGeranet,
    });
    if (erroPagamentoFiscal) {
      return falha(erroPagamentoFiscal);
    }

    if (
      !empresa ||
      !empresa.ativo
    ) {
      return falha(
        "Empresa não encontrada ou inativa."
      );
    }

    if (
      !fiscal ||
      !fiscal.ativo
    ) {
      return falha(
        "Configuração fiscal da empresa não encontrada ou inativa."
      );
    }

    const naturezaIdVenda =
      texto(
        operacaoVenda &&
          String(operacaoVenda.empresa_id) ===
            String(empresaId)
          ? operacaoVenda.natureza_id
          : null
      ) ||
      texto(
        venda.natureza_id
      );

    let naturezaQuery =
      supabase
        .from(
          "fiscal_naturezas_operacao"
        )
        .select(`
          id,
          empresa_id,
          tipo_operacao_interno,
          descricao,
          tp_nf,
          fin_nfe,
          padrao,
          ativo
        `)
        .eq(
          "empresa_id",
          empresaId
        )
        .eq(
          "tipo_operacao_interno",
          "venda"
        )
        .eq(
          "ativo",
          true
        );

    naturezaQuery =
      naturezaIdVenda
        ? naturezaQuery.eq(
            "id",
            naturezaIdVenda
          )
        : naturezaQuery.eq(
            "padrao",
            true
          );

    const {
      data: naturezaVenda,
      error: naturezaVendaError,
    } =
      await naturezaQuery.maybeSingle();

    if (
      naturezaVendaError
    ) {
      return falha(
        `Falha ao carregar natureza de operação: ${naturezaVendaError.message}`,
        500
      );
    }

    const natureza =
      naturezaVenda as
        | NaturezaOperacaoFiscal
        | null;

    if (
      !natureza ||
      natureza.tipo_operacao_interno !==
        "venda" ||
      !naturezaEstaCompleta(
        natureza,
        empresaId
      )
    ) {
      return falha(
        naturezaIdVenda
          ? MENSAGEM_NATUREZA_VENDA_INVALIDA
          : MENSAGEM_NATUREZA_VENDA_AUSENTE
      );
    }

    const ufEmitente =
      texto(
        fiscal.uf
      ).toUpperCase();

    if (
      !/^[A-Z]{2}$/.test(
        ufEmitente
      )
    ) {
      return falha(
        "UF do emitente inválida."
      );
    }

    const operacao:
      OperacaoFiscal =
        clienteUf ===
        ufEmitente
          ? "interna"
          : "interestadual";

    const ieEmitente =
      texto(
        fiscal
          .inscricao_estadual
      );

    const crt =
      Number(
        fiscal
          .codigo_regime_tributario
      );

    if (
      somenteDigitos(
        empresa.cnpj
      ).length !== 14
    ) {
      return falha(
        "CNPJ do emitente inválido."
      );
    }

    if (
      !ieEmitente
    ) {
      return falha(
        "Inscrição Estadual do emitente não configurada."
      );
    }

    if (
      ![1, 2, 3].includes(
        crt
      )
    ) {
      return falha(
        "CRT não suportado pelo motor fiscal atual."
      );
    }

    if (
      somenteDigitos(
        fiscal.cep
      ).length !== 8 ||
      !texto(
        fiscal.logradouro
      ) ||
      !texto(
        fiscal.numero
      ) ||
      !texto(
        fiscal.bairro
      ) ||
      !texto(
        fiscal.municipio
      ) ||
      somenteDigitos(
        fiscal
          .codigo_municipio_ibge
      ).length !== 7
    ) {
      return falha(
        "Cadastro fiscal do emitente está incompleto."
      );
    }

    let fusoHorario: string;

    try {
      fusoHorario =
        exigirFusoHorarioFiscalDaEmissao({
          empresaIdDaEmissao: empresaId,
          fiscal,
        });
    } catch (errorFuso) {
      return falha(
        errorFuso instanceof Error
          ? errorFuso.message
          : "Fuso horário fiscal da empresa não está configurado."
      );
    }

    let dataHoraFiscal:
      string;

    try {
      dataHoraFiscal =
        formatarDataHoraGeranet(
          instanteCabecalho,
          fusoHorario
        );
    } catch (
      errorFuso
    ) {
      return falha(
        errorFuso
          instanceof Error
          ? errorFuso.message
          : "Fuso horário fiscal inválido."
      );
    }

    const apiKey =
      texto(
        segredos
          .geranet_api_key
      );

    const certificado =
      texto(
        segredos
          .certificado_a1
      );

    const senhaCertificado =
      texto(
        segredos
          .senha_certificado
      );

    if (
      !apiKey ||
      !certificado ||
      !senhaCertificado
    ) {
      return falha(
        "API Key/certificado/senha fiscal incompletos."
      );
    }

    const cabecalhoRascunho =
      lerCabecalhoFiscalDoSnapshot(
        snapshotOperacao
      );

    const serieInformada =
      cabecalhoRascunho.serie !=
      null
        ? cabecalhoRascunho.serie
        : body.serie ===
            undefined
          ? null
          : Number(
              body.serie
            );

    const escolhaSerie =
      escolherNumeracaoNfe55({
        numeracoes,
        ambiente:
          ambienteFiscalNumero,
        serieEscolhida:
          serieInformada,
      });

    if (!escolhaSerie.ok) {
      return falha(
        escolhaSerie.mensagem
      );
    }

    const numeracao =
      escolhaSerie.numeracao;

    const produtoIds =
      idsUnicos(
        itensVenda.map(
          (item) =>
            item.produto_id
        )
      );

    const [
      produtosResult,
      produtosFiscalResult,
    ] =
      await Promise.all([
        supabase
          .from("produtos")
          .select(`
            id,
            codigo_barras,
            tipo_item,
            grupo_fiscal_id,
            ativo
          `)
          .eq(
            "empresa_id",
            empresaId
          )
          .in(
            "id",
            produtoIds
          ),

        supabase
          .from(
            "produtos_fiscal"
          )
          .select(`
            produto_id,
            ncm,
            cest,
            origem_produto
          `)
          .eq(
            "empresa_id",
            empresaId
          )
          .in(
            "produto_id",
            produtoIds
          ),
      ]);

    const erroProduto =
      produtosResult.error ??
      produtosFiscalResult.error;

    if (
      erroProduto
    ) {
      return falha(
        erroProduto.message,
        500
      );
    }

    const produtosMap =
      new Map(
        (
          produtosResult.data ??
          []
        ).map(
          (produto) => [
            produto.id,
            produto,
          ] as const
        )
      );

    const fiscalProdutoMap =
      new Map(
        (
          produtosFiscalResult.data ??
          []
        ).map(
          (
            fiscalProduto
          ) => [
            fiscalProduto
              .produto_id,
            fiscalProduto,
          ] as const
        )
      );

    const grupoIds =
      idsUnicos([
        ...itensVenda.map(
          (item) =>
            item.grupo_fiscal_id
        ),
        ...(
          produtosResult.data ??
          []
        ).map(
          (produto) =>
            produto.grupo_fiscal_id
        ),
      ]);

    if (
      grupoIds.length ===
      0
    ) {
      return falha(
        "Nenhum Grupo Fiscal encontrado para os itens."
      );
    }

    const {
      data: grupos,
      error: gruposError,
    } =
      await supabase
        .from(
          "grupos_fiscais"
        )
        .select(`
          id,
          nome,
          ativo,
          cfop_interno,
          cfop_interestadual,
          icms_cst_csosn,
          pis_cst,
          pis_aliquota,
          cofins_cst,
          cofins_aliquota,
          cst_ibscbs,
          classificacao_ibscbs,
          aliquota_ibs_uf,
          aliquota_ibs_municipio,
          aliquota_cbs,
          percentual_reducao_ibs_uf,
          percentual_reducao_ibs_municipio,
          percentual_reducao_cbs,
          ipi_aplicavel,
          ipi_cst,
          ipi_aliquota,
          ipi_enquadramento,
          ibscbs_manual
        `)
        .eq(
          "empresa_id",
          empresaId
        )
        .in(
          "id",
          grupoIds
        );

    if (
      gruposError
    ) {
      return falha(
        gruposError.message,
        500
      );
    }

    const gruposMap =
      new Map(
        (
          grupos ??
          []
        ).map(
          (grupo) => [
            grupo.id,
            grupo,
          ] as const
        )
      );

    const {
      data: regrasCfopRows,
      error: regrasCfopError,
    } =
      await supabase
        .from(
          "fiscal_natureza_cfop_regras"
        )
        .select(`
          empresa_id,
          natureza_id,
          grupo_fiscal_id,
          tipo_destino,
          cfop,
          ativo
        `)
        .eq(
          "empresa_id",
          empresaId
        )
        .eq(
          "natureza_id",
          natureza.id
        )
        .eq(
          "ativo",
          true
        );

    if (
      regrasCfopError
    ) {
      return falha(
        regrasCfopError.message,
        500
      );
    }

    const regrasCfop =
      normalizarRegrasCfopDaEmpresaAtiva(
        regrasCfopRows,
        empresaId
      );

    const perfilIpi = parsePerfilIpi(
      fiscal.perfil_ipi
    );

    const vendaTributacaoCongelada =
      vendaTemTributacaoItensCongelada(
        venda.snapshot_fiscal
      );

    const gruposIpi = vendaTributacaoCongelada
      ? itensVenda.map((item) => {
          const snap = lerSnapshotTributarioItem(item.snapshot_fiscal);
          return camposIpiDoGrupo({
            ipi_aplicavel: snap?.ipi_aplicavel,
            ipi_cst: snap?.ipi_cst,
            ipi_aliquota: snap?.ipi_aliquota,
            ipi_enquadramento: snap?.ipi_enquadramento,
          });
        })
      : (grupos ?? []).map(
          (grupo) => camposIpiDoGrupo(grupo)
        );

    const pendenciasIpi =
      pendenciasIpiDocumento({
        modelo: "55",
        perfilIpi,
        grupos: gruposIpi,
      });

    if (pendenciasIpi.length > 0) {
      return falha(pendenciasIpi[0]);
    }

    const ambiente:
      AmbienteGeranet =
      Number(
        fiscal.ambiente
      ) === 1
        ? "1"
        : "2";

    if (modo === "emissao") {
      const confirmacaoEsperada =
        ambiente === "1"
          ? "EMITIR_NFE55_VENDA_PRODUCAO"
          : "EMITIR_NFE55_VENDA_HOMOLOGACAO";

      if (
        confirmacaoRecebida !==
        confirmacaoEsperada
      ) {
        return falha(
          ambiente === "1"
            ? "A empresa está em PRODUÇÃO. Confirmação de produção obrigatória."
            : "A empresa está em HOMOLOGAÇÃO. Confirmação de homologação obrigatória.",
          409
        );
      }
    }

    const codigoRegimeTributario =
      crt as
        CodigoRegimeTributario;

    const itensFiscais: ItemGeranet[] = [];

    const snapshots:
      Array<{
        id: string;
        persistirFallback: boolean;
        dados: Record<
          string,
          unknown
        >;
      }> = [];

    let descontosFiscais: Map<string, number>;

    const totaisNota = totaisFiscaisEmissaoNfeVenda({
      origemOperacaoFiscal,
      snapshotOperacao,
      venda,
    });
    const valorFrete = totaisNota.frete;
    const valorSeguro = totaisNota.seguro;
    const valorOutro = totaisNota.outro;

    try {
      descontosFiscais = mapaDescontoFiscalPorItem(
        distribuirDescontoItens({
          descontoVenda: totaisNota.desconto,
          itens: itensVenda.map((item) => ({
            id: item.id,
            quantidade: numero(item.quantidade),
            valorUnitario: numero(item.valor_unitario),
            desconto: numero(item.desconto),
          })),
        })
      );
    } catch (error) {
      return falha(
        error instanceof DistribuicaoDescontoFiscalError
          ? error.message
          : "Não foi possível ratear o desconto fiscal da venda. Nenhum número foi reservado."
      );
    }
    const itensBaseVenda = itensVenda.map((item) => ({
      id: item.id,
      baseCentavos: valorBrutoItemEmCentavos({
        quantidade: numero(item.quantidade),
        valorUnitario: numero(item.valor_unitario),
      }),
    }));
    let fretesPorItem = new Map<string, number>();
    let segurosPorItem = new Map<string, number>();
    let outrosPorItem = new Map<string, number>();
    try {
      fretesPorItem = distribuirValorProporcional({
        valor: valorFrete,
        itens: itensBaseVenda,
      });
      segurosPorItem = distribuirValorProporcional({
        valor: valorSeguro,
        itens: itensBaseVenda,
      });
      outrosPorItem = distribuirValorProporcional({
        valor: valorOutro,
        itens: itensBaseVenda,
      });
    } catch (errorRateio) {
      return falha(
        errorRateio instanceof Error
          ? errorRateio.message
          : "Não foi possível ratear frete, seguro ou outras despesas. Nenhum número foi reservado."
      );
    }

    for (
      const [
        indice,
        itemVenda,
      ] of
        itensVenda.entries()
    ) {
      const produto =
        produtosMap.get(
          itemVenda
            .produto_id
        );

      const snapshotCompleto =
        snapshotTributarioItemCompleto(
          itemVenda.snapshot_fiscal
        );

      const bloqueioAvulso =
        mensagemEmissaoItemAvulsoSemFiscal(itemVenda);
      if (bloqueioAvulso) {
        return falha(bloqueioAvulso);
      }

      if (
        !snapshotCompleto &&
        (
          !produto ||
          !produto.ativo
        )
      ) {
        return falha(
          `Produto do item ${
            indice + 1
          } não encontrado ou inativo.`
        );
      }

      const fiscalProduto =
        fiscalProdutoMap.get(
          itemVenda
            .produto_id
        );

      const grupoId =
        itemVenda
          .grupo_fiscal_id ??
        produto
          ?.grupo_fiscal_id;

      const grupo =
        grupoId
          ? gruposMap.get(
              grupoId
            )
          : undefined;

      const tributacao =
        resolverTributacaoItemVenda({
          item: itemVenda,
          produto,
          fiscalProduto,
          grupo,
          vendaTributacaoCongelada,
          tipoDestino: operacao,
          indiceItem: indice + 1,
        });

      if (!tributacao.ok) {
        return falha(
          tributacao.mensagem
        );
      }

      let cfop = tributacao.valor.cfop;
      let grupoGeranet = tributacao.valor.grupoGeranet;

      if (tributacao.valor.persistirFallback) {
        if (!grupo || !grupo.ativo) {
          return falha(
            `Grupo Fiscal do item ${
              indice + 1
            } não encontrado ou inativo.`
          );
        }

        const cfopResolvido =
          resolverCfopEfetivo({
            tipoOperacaoInterno:
              "venda",
            tipoDestino:
              operacao,
            grupoFiscal: {
              nome:
                grupo.nome,
              cfopInterno:
                grupo.cfop_interno,
              cfopInterestadual:
                grupo.cfop_interestadual,
            },
            naturezaId:
              natureza.id,
            grupoFiscalId:
              grupo.id,
            regras:
              regrasCfop,
            empresaIdAtiva:
              empresaId,
            naturezaPadrao:
              Boolean(
                natureza.padrao
              ),
            naturezaDescricao:
              natureza.descricao,
          });

        if (!cfopResolvido.ok) {
          return falha(
            `${cfopResolvido.mensagem} Produto: ${itemVenda.produto_nome}.`
          );
        }

        cfop = cfopResolvido.cfop;
        grupoGeranet = grupoGeranetDoSnapshotTributario(
          tributacao.valor.snapshot,
          cfop
        );
      }

      const ncm = tributacao.valor.ncm;
      const cest = tributacao.valor.cest;
      const origemProduto = tributacao.valor.origemProduto;
      const icms = tributacao.valor.icms;
      const pis = tributacao.valor.pis;
      const cofins = tributacao.valor.cofins;
      const cstIbscbs = tributacao.valor.cstIbscbs;
      const classificacaoIbscbs =
        tributacao.valor.classificacaoIbscbs;

      const {
        item,
      } =
        montarItemGeranet({
          produto: {
            codigo:
              itemVenda
                .produto_codigo,
            codigoBarras:
              tributacao.valor.codigoBarras ??
              produto
                ?.codigo_barras,
            nome:
              itemVenda
                .produto_nome,
            unidadeMedida:
              itemVenda
                .unidade_medida,
            tipoItem:
              tributacao.valor.tipoItem ??
              produto
                ?.tipo_item,
            precoVenda:
              itemVenda
                .valor_unitario,
          },

          fiscal: {
            ncm,
            cest,
            origemProduto,
          },

          grupo: grupoGeranet,

          modelo: "55",
          perfilIpi: parsePerfilIpi(
            fiscal.perfil_ipi
          ),
          codigoRegimeTributario,
          ambiente,
          forcarIbscbsHomologacao:
            false,
          dataEmissao:
            (input.agora ?? new Date())
              .toISOString(),
          operacao,
          quantidade:
            numero(
              itemVenda
                .quantidade
            ),
          valorUnitario:
            numero(
              itemVenda
                .valor_unitario
            ),
          desconto:
            descontosFiscais.get(
              itemVenda.id
            ) ??
            numero(
              itemVenda
                .desconto
            ),
          frete:
            fretesPorItem.get(
              itemVenda.id
            ) ?? 0,
          seguro:
            segurosPorItem.get(
              itemVenda.id
            ) ?? 0,
          outro:
            outrosPorItem.get(
              itemVenda.id
            ) ?? 0,
        });

      const descontoFiscal =
        descontosFiscais.get(
          itemVenda.id
        ) ??
        numero(
          itemVenda.desconto
        );
      const brutoEsperado =
        valorBrutoItemEmCentavos({
          quantidade: numero(
            itemVenda.quantidade
          ),
          valorUnitario: numero(
            itemVenda.valor_unitario
          ),
        });
      const liquidoEsperado =
        valorLiquidoFiscalEmCentavos({
          quantidade: numero(
            itemVenda.quantidade
          ),
          valorUnitario: numero(
            itemVenda.valor_unitario
          ),
          desconto: descontoFiscal,
          frete: fretesPorItem.get(itemVenda.id) ?? 0,
          seguro: segurosPorItem.get(itemVenda.id) ?? 0,
          outro: outrosPorItem.get(itemVenda.id) ?? 0,
        });

      if (
        paraCentavos(item.valorTotal) !==
          brutoEsperado ||
        paraCentavos(item.desconto) !==
          paraCentavos(descontoFiscal) ||
        liquidoEsperado < 0
      ) {
        return falha(
          `Total fiscal do item ${
            indice + 1
          } diverge da fórmula Geranet. Nenhum número foi reservado.`
        );
      }

      itensFiscais.push(
        item
      );

      snapshots.push({
        id:
          itemVenda.id,
        persistirFallback:
          tributacao.valor.persistirFallback,
        dados: {
          snapshot_fiscal:
            tributacao.valor.snapshot,
        },
      });
    }

    const divergenciaTotais =
      conferirSomaItensFiscaisComVenda({
        itensFiscais: itensFiscais as Array<{
          valorTotal?: unknown;
          desconto?: unknown;
          quantidade?: unknown;
          valorUnitario?: unknown;
          frete?: unknown;
          seguro?: unknown;
          outro?: unknown;
        }>,
        valorTotalVenda: totalFiscalEsperadoEmissaoNfeVenda({
          origemOperacaoFiscal,
          itens: itensVenda.map((item) => ({
            quantidade: numero(item.quantidade),
            valorUnitario: numero(item.valor_unitario),
          })),
          totais: totaisNota,
          valorTotalVenda: numero(venda.valor_total),
        }),
      });

    if (divergenciaTotais) {
      return falha(divergenciaTotais);
    }


    return {
      ok: true as const,
      empresaId,
      venda,
      cliente,
      documento,
      clienteUf,
      indicadorIe,
      consumidorFinal,
      empresa,
      fiscal,
      ieEmitente,
      ufEmitente,
      crt,
      ambiente,
      fusoHorario,
      dataHoraFiscal,
      certificado,
      senhaCertificado,
      apiKey,
      snapshotOperacao,
      operacaoVenda,
      natureza,
      cabecalhoRascunho,
      numeracao,
      modalidadeFrete,
      transporteResolvido,
      trocoVenda,
      detalhamentoFiscal,
      faturaGeranet,
      itensFiscais,
      snapshots,
      csrtResult,
      pagamentosConfirmados,
      operacao,
    };
}
