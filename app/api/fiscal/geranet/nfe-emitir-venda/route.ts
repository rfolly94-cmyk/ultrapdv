import {
  createHash,
} from "node:crypto";

import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createClient,
} from "@/lib/supabase/server";

import {
  createAdminClient,
} from "@/lib/supabase/admin";
import {
  capturaErroAutorizacaoFiscal,
  exigirEmissaoNfe,
} from "@/lib/fiscal/acesso-operacao";
import {
  ErroAssinaturaRestrita,
  exigirEmpresaOperacional,
} from "@/lib/assinatura/exigir-empresa-operacional";

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
import {
  distribuirValorProporcional,
} from "@/lib/fiscal/nfe55/totais-nota";
import {
  aplicarPagamentosRascunhoNaEmissaoNfeVenda,
  aplicarPrecosComerciaisOperacaoNosItensVenda,
  precosComerciaisOperacaoCompativeis,
  totaisFiscaisEmissaoNfeVenda,
  totalFiscalEsperadoEmissaoNfeVenda,
  trocoEmissaoNfeVenda,
} from "@/lib/fiscal/nfe55/valores-comerciais-nfe";
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
import {
  montarInformacaoAdicionalFisco,
  montarInformacaoComplementarNfe,
  textoUsuarioInfAdFiscoNfe,
  textoUsuarioInfCplNfe,
} from "@/lib/fiscal/nfe55/infos-adicionais";

import {
  montarPayloadNfeGeranet,
  type IndicadorIeDestinatarioNfe,
  type ConsumidorFinalNfe,
} from "@/lib/fiscal/geranet/montar-payload-nfe";
import { prepararNfeVenda } from "@/lib/fiscal/nfe55/preparar-nfe-venda";
import { montarPayloadNfeVendaPreparada } from "@/lib/fiscal/nfe55/payload-nfe-venda";
import {
  ieDestinatarioParaGeranet,
  origemSnapshotAInicializar,
  resolverDestinatarioFiscalDaOrigem,
  snapshotDestinatarioParaPersistir,
  lerSnapshotDestinatarioFiscal,
} from "@/lib/fiscal/destinatario/resolver-destinatario-fiscal";
import { mesclarSnapshotOperacao, pagamentosRascunhoDoSnapshot } from "@/lib/fiscal/nfe55/pagamentos-rascunho";
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
  argsNumeroManualReservaNfe,
  escolherNumeracaoNfe55,
  lerCabecalhoFiscalDoSnapshot,
  resolverPayloadCabecalhoNfe,
} from "@/lib/fiscal/nfe55/cabecalho-fiscal";
import { obterLogomarcaFiscalHex } from "@/lib/empresa/obter-logomarca-fiscal-hex";
import { hexDocumentoFiscalPersistivel } from "@/lib/fiscal/documento-fiscal";

import type {
  SegredosFiscaisGeranet,
} from "@/lib/fiscal/geranet/montar-payload-nfce";

import type {
  AmbienteGeranet,
  CodigoRegimeTributario,
} from "@/lib/fiscal/geranet/resolver-politica-ibscbs";

import {
  formatarDataHoraGeranet,
} from "@/lib/fiscal/geranet/data-hora";
import {
  exigirFusoHorarioFiscalDaEmissao,
} from "@/lib/fiscal/fuso-horario-empresa";

import {
  chamarGeranet,
  persistenciaFalhaComunicacaoEmitir,
  patchEmissaoFalhaComunicacao,
} from "@/lib/fiscal/geranet/cliente-geranet";
import { obterSegredosFiscaisEmissao } from "@/lib/fiscal/geranet/credencial-plataforma";
import {
  classificarRespostaEmitir,
  extraBloqueioRetransmissaoFiscal,
  emissaoBloqueiaRetransmissao,
  historicoErroTecnico,
  mensagemBloqueioEmissao,
  montarErroEmitirNaoAutorizada,
  persistirClassificacaoNaoAutorizada,
} from "@/lib/fiscal/geranet/classificar-emissao";
import {
  aplicarValorTotalNotaGeranet,
} from "@/lib/fiscal/geranet/diagnostico-total-nota";
import {
  avaliarBloqueioRascunhoFiscal,
  carregarEmissaoPorChaveIdempotencia,
  claimTentativaEmissaoFiscal,
  geranetLogIdDe,
  registrarRespostaTentativaFiscal,
  snapshotItensDaTransmissao,
} from "@/lib/fiscal/emissao-tentativas";
import {
  validarPagamentosEletronicosParaEmissao,
} from "@/lib/fiscal/validar-pagamentos-eletronicos";
import {
  filtrarPagamentosFinanceiros,
  somarValoresPagamento,
} from "@/lib/vendas/pagamentos-financeiros";
import {
  MENSAGEM_NATUREZA_VENDA_AUSENTE,
  MENSAGEM_NATUREZA_VENDA_INVALIDA,
  type NaturezaOperacaoFiscal,
} from "@/lib/fiscal/operacoes/catalogo";
import {
  assertIdentidadeFiscalNfe,
  naturezaEstaCompleta,
} from "@/lib/fiscal/operacoes/resolver-natureza";
import {
  resolverCfopEfetivo,
  normalizarRegrasCfopDaEmpresaAtiva,
} from "@/lib/fiscal/operacoes/resolver-cfop";

import {
  MENSAGEM_FRETE_9_COM_DADOS,
  transporteConflitaComFrete9,
} from "@/lib/fiscal/transporte/dados-transporte-venda";
import { transporteNfeParaPayloadGeranet } from "@/lib/fiscal/transporte/mapear-transporte-geranet";
import { carregarTransporteNfe55 } from "@/lib/fiscal/transporte/resolver-transporte-nfe";

type Body = {
  confirmar?: string;
  venda_id?: string;
  serie?: number | string;
};

function json(
  body: unknown,
  status = 200
) {
  return NextResponse.json(
    body,
    { status }
  );
}

function erro(
  mensagem: string,
  status = 422,
  extra?: Record<
    string,
    unknown
  >
) {
  return json(
    {
      ok: false,
      erro: mensagem,
      ...(extra ?? {}),
    },
    status
  );
}

function texto(
  valor: unknown
) {
  return String(
    valor ?? ""
  ).trim();
}

function somenteDigitos(
  valor: unknown
) {
  return texto(valor).replace(
    /\D/g,
    ""
  );
}

function numero(
  valor: unknown,
  padrao = 0
) {
  if (
    valor === null ||
    valor === undefined ||
    valor === ""
  ) {
    return padrao;
  }

  const n =
    Number(valor);

  return Number.isFinite(n)
    ? n
    : NaN;
}

function uuidValido(
  valor: string
) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    valor
  );
}

function idsUnicos(
  valores: Array<
    string |
    null |
    undefined
  >
) {
  return Array.from(
    new Set(
      valores.filter(
        (
          valor
        ): valor is string =>
          typeof valor ===
            "string" &&
          valor.length > 0
      )
    )
  );
}

/**
 * Não podemos usar venda.id diretamente porque a mesma venda pode
 * ter tido tentativa NFC-e (65). fiscal_emissoes possui idempotência
 * única por empresa, então derivamos um UUID estável por modelo.
 */
function chaveIdempotenciaNfe55(
  vendaId: string
) {
  const bytes =
    createHash("sha256")
      .update(
        `ultrapdv:nfe55:${vendaId}`
      )
      .digest()
      .subarray(0, 16);

  // UUID v5-like determinístico.
  bytes[6] =
    (bytes[6] & 0x0f) |
    0x50;

  bytes[8] =
    (bytes[8] & 0x3f) |
    0x80;

  const hex =
    bytes.toString("hex");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export async function POST(
  request: NextRequest
) {
  const supabase =
    await createClient();

  const admin =
    createAdminClient();

  try {
    const {
      data: claimsData,
      error: authError,
    } =
      await supabase.auth.getClaims();

    if (
      authError ||
      !claimsData
        ?.claims
        ?.sub
    ) {
      return erro(
        "Não autenticado.",
        401
      );
    }

    const {
      data: vinculo,
    } =
      await supabase
        .from(
          "usuarios_empresas"
        )
        .select(
          "empresa_id"
        )
        .eq(
          "usuario_id",
          String(claimsData.claims.sub)
        )
        .eq(
          "principal",
          true
        )
        .eq(
          "ativo",
          true
        )
        .maybeSingle();

    if (!vinculo) {
      return erro(
        "Empresa ativa não encontrada.",
        403
      );
    }

    try {
      await exigirEmissaoNfe({
        empresaId: String(vinculo.empresa_id),
        origem: "nfe-emitir-venda",
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

    const empresaId =
      vinculo.empresa_id;

    let body: Body;

    try {
      body =
        await request.json();
    } catch {
      return erro(
        "JSON da requisição é inválido.",
        400
      );
    }

    const confirmacaoRecebida =
      texto(
        body.confirmar
      );

    if (
      ![
        "EMITIR_NFE55_VENDA_HOMOLOGACAO",
        "EMITIR_NFE55_VENDA_PRODUCAO",
      ].includes(
        confirmacaoRecebida
      )
    ) {
      return erro(
        "Confirmação explícita da emissão ausente.",
        400
      );
    }

    const vendaId =
      texto(
        body.venda_id
      );

    if (
      !uuidValido(
        vendaId
      )
    ) {
      return erro(
        "venda_id inválido.",
        400
      );
    }

    if (
      texto(
        request.headers.get(
          "Idempotency-Key"
        )
      ) !== vendaId
    ) {
      return erro(
        "O header Idempotency-Key deve conter o UUID da venda.",
        400
      );
    }

    const chaveIdempotencia =
      chaveIdempotenciaNfe55(
        vendaId
      );

    const preparado = await prepararNfeVenda({
      supabase,
      admin,
      empresaId,
      vendaId,
      modo: "emissao",
      serie: body.serie,
      confirmacao: confirmacaoRecebida,
    });

    if (!preparado.ok) {
      return erro(
        preparado.erro,
        preparado.status,
        preparado.extra
      );
    }

    const {
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
    } = preparado;


    const emissaoPrevia = await carregarEmissaoPorChaveIdempotencia(
      admin,
      empresaId,
      chaveIdempotencia
    );
    const bloqueioRascunho = avaliarBloqueioRascunhoFiscal(emissaoPrevia);
    if (bloqueioRascunho.tipo === "autorizada") {
      return json({
        ok: true,
        autorizada: true,
        reutilizada: true,
        venda_id: vendaId,
        emissao_id: bloqueioRascunho.emissao.id,
        serie: bloqueioRascunho.emissao.serie,
        numero: String(bloqueioRascunho.emissao.numero),
        chave: bloqueioRascunho.emissao.chave_acesso,
        protocolo: bloqueioRascunho.emissao.protocolo,
        cstat: bloqueioRascunho.emissao.cstat,
        mensagem: "Esta venda já possui NF-e autorizada.",
      });
    }
    if (bloqueioRascunho.tipo === "inutilizacao") {
      return erro(
        "Conclua a inutilização da numeração anterior antes de emitir novamente.",
        409,
        {
          emissao_id: bloqueioRascunho.emissao.id,
          status: bloqueioRascunho.emissao.status,
        }
      );
    }
    if (bloqueioRascunho.tipo === "inutilizada") {
      return erro(
        "Esta emissão foi inutilizada e não pode receber novo rascunho fiscal.",
        409,
        {
          emissao_id: bloqueioRascunho.emissao.id,
          status: bloqueioRascunho.emissao.status,
        }
      );
    }
    if (bloqueioRascunho.tipo === "bloquear") {
      return erro(bloqueioRascunho.mensagem, 409, extraBloqueioRetransmissaoFiscal(bloqueioRascunho.emissao));
    }

    // Congela os dados fiscais resolvidos ANTES da reserva.
    const resultadosSnapshot =
      await Promise.all(
        snapshots
          .filter(
            (snapshot) =>
              snapshot.persistirFallback
          )
          .map(
          (snapshot) =>
            admin
              .from(
                "vendas_itens"
              )
              .update(
                snapshot.dados
              )
              .eq(
                "empresa_id",
                empresaId
              )
              .eq(
                "venda_id",
                vendaId
              )
              .eq(
                "id",
                snapshot.id
              )
        )
      );

    const erroSnapshot =
      resultadosSnapshot.find(
        (resultado) =>
          resultado.error
      )?.error;

    if (
      erroSnapshot
    ) {
      return erro(
        `Não foi possível congelar os dados fiscais: ${erroSnapshot.message}`,
        500
      );
    }

    const erroEntrega = validarEnderecoEntrega(
      lerEnderecoEntregaDoSnapshot(snapshotOperacao)
    );
    if (erroEntrega) {
      return erro(erroEntrega);
    }
    const erroAutorizadosXml = validarAutorizadosXml(
      lerAutorizadosXmlDoSnapshot(snapshotOperacao)
    );
    if (erroAutorizadosXml) {
      return erro(erroAutorizadosXml);
    }

    const {
      data: reservaData,
      error: reservaError,
    } =
      await admin.rpc(
        "rpc_reservar_emissao_fiscal",
        {
          p_empresa_id:
            empresaId,
          p_modelo:
            "55",
          p_serie:
            numeracao.serie,
          p_ambiente:
            Number(ambiente),
          p_chave_idempotencia:
            chaveIdempotencia,
          p_origem_tipo:
            "venda",
          p_origem_id:
            vendaId,
          ...argsNumeroManualReservaNfe(
            cabecalhoRascunho
          ),
        }
      );

    if (
      reservaError
    ) {
      return erro(
        `Falha ao reservar numeração NF-e: ${reservaError.message}`,
        500
      );
    }

    const reserva =
      Array.isArray(
        reservaData
      )
        ? reservaData[0]
        : reservaData;

    if (
      !reserva
        ?.emissao_id
    ) {
      return erro(
        "A reserva fiscal não retornou uma emissão válida.",
        500
      );
    }

    const emissaoId =
      reserva.emissao_id;

    const cabecalhoNfe =
      resolverPayloadCabecalhoNfe({
        snapshot:
          snapshotOperacao,
        finNfeOperacao:
          operacaoVenda &&
          String(
            operacaoVenda.empresa_id
          ) ===
            String(
              empresaId
            )
            ? texto(
                operacaoVenda.fin_nfe
              )
            : null,
        finNfeNatureza:
          natureza.fin_nfe,
        tpNfOperacao:
          operacaoVenda &&
          String(
            operacaoVenda.empresa_id
          ) ===
            String(
              empresaId
            )
            ? texto(
                operacaoVenda.tp_nf
              )
            : null,
        indicadorPresencaPadraoEmpresa:
          fiscal.indicador_presenca_padrao,
        indicativoIntermediadorPadraoEmpresa:
          fiscal.indicativo_intermediador_padrao,
        dataHoraEmissao:
          dataHoraFiscal,
      });

    let identidadeFiscal: ReturnType<
      typeof assertIdentidadeFiscalNfe
    >;

    try {
      identidadeFiscal =
        assertIdentidadeFiscalNfe({
          naturezaId:
            natureza.id,
          descricao:
            texto(
              operacaoVenda?.natureza_descricao
            ) ||
            natureza.descricao,
          tpNf:
            cabecalhoNfe.tpNf ||
            natureza.tp_nf,
          finNfe:
            cabecalhoNfe.finNfe ||
            natureza.fin_nfe,
        });
    } catch (
      errorIdentidade
    ) {
      return erro(
        errorIdentidade instanceof
          Error
          ? errorIdentidade.message
          : MENSAGEM_NATUREZA_VENDA_AUSENTE
      );
    }

    const {
      error:
        snapshotError,
    } =
      await admin
        .from(
          "fiscal_emissoes"
        )
        .update({
          tipo_operacao_interno:
            "venda",
          natureza_id:
            identidadeFiscal.naturezaId,
          tp_nf:
            identidadeFiscal.tpNf,
          fin_nfe:
            identidadeFiscal.finNfe,
        })
        .eq(
          "id",
          emissaoId
        )
        .eq(
          "empresa_id",
          empresaId
        );

    if (
      snapshotError
    ) {
      return erro(
        `Falha ao gravar a identidade fiscal da emissão: ${snapshotError.message}`,
        500,
        {
          emissao_id:
            emissaoId,
        }
      );
    }

    const {
      data: emissaoAtual,
      error:
        emissaoAtualError,
    } =
      await admin
        .from(
          "fiscal_emissoes"
        )
        .select(`
          id,
          status,
          numero,
          serie,
          codigo_numerico,
          chave_acesso,
          protocolo,
          cstat,
          motivo,
          geranet_http_status,
          erro_comunicacao,
          resposta_resumo,
          tipo_operacao_interno,
          natureza_id,
          tp_nf,
          fin_nfe
        `)
        .eq(
          "id",
          emissaoId
        )
        .eq(
          "empresa_id",
          empresaId
        )
        .maybeSingle();

    if (
      emissaoAtualError ||
      !emissaoAtual
    ) {
      return erro(
        "Reserva criada, mas não foi possível reler a emissão.",
        500,
        {
          emissao_id:
            emissaoId,
        }
      );
    }

    if (
      emissaoAtual
        .status ===
      "autorizada"
    ) {
      return json({
        ok: true,
        autorizada:
          true,
        reutilizada:
          true,
        venda_id:
          vendaId,
        emissao_id:
          emissaoAtual.id,
        serie:
          emissaoAtual.serie,
        numero:
          String(
            emissaoAtual.numero
          ),
        chave:
          emissaoAtual
            .chave_acesso,
        protocolo:
          emissaoAtual
            .protocolo,
        cstat:
          emissaoAtual.cstat,
        mensagem:
          "Esta venda já possui NF-e autorizada.",
      });
    }

    if (
      emissaoAtual.status ===
      "aguardando_inutilizacao"
    ) {
      return erro(
        "Conclua a inutilização da numeração anterior antes de emitir novamente.",
        409,
        {
          emissao_id: emissaoId,
          status: emissaoAtual.status,
        }
      );
    }

    if (
      emissaoAtual.status ===
      "inutilizada"
    ) {
      return erro(
        "A reserva devolveu uma emissão já inutilizada. Aplique a migration de reserva após inutilização e tente de novo.",
        409,
        {
          emissao_id: emissaoId,
          status: emissaoAtual.status,
        }
      );
    }

    if (
      emissaoBloqueiaRetransmissao(
        emissaoAtual
      )
    ) {
      return erro(
        mensagemBloqueioEmissao(emissaoAtual),
        409,
        extraBloqueioRetransmissaoFiscal({
          id: emissaoId,
          status: emissaoAtual.status,
        })
      );
    }

    let identidadeEmissao: ReturnType<
      typeof assertIdentidadeFiscalNfe
    >;

    try {
      identidadeEmissao =
        assertIdentidadeFiscalNfe({
          naturezaId:
            emissaoAtual.natureza_id,
          descricao:
            natureza.descricao,
          tpNf:
            emissaoAtual.tp_nf,
          finNfe:
            emissaoAtual.fin_nfe,
        });
    } catch (
      errorIdentidadeEmissao
    ) {
      return erro(
        errorIdentidadeEmissao instanceof
          Error
          ? errorIdentidadeEmissao.message
          : MENSAGEM_NATUREZA_VENDA_AUSENTE,
        422,
        {
          emissao_id:
            emissaoId,
        }
      );
    }

    const {
      payload,
      diagnosticoTotal,
    } = montarPayloadNfeVendaPreparada({
      preparada: preparado,
      logomarca: await obterLogomarcaFiscalHex(
        String(empresaId)
      ),
      serie: emissaoAtual.serie,
      numeroNota: emissaoAtual.numero,
      codigoNumerico: texto(
        emissaoAtual.codigo_numerico
      ),
      dataSaida: cabecalhoNfe.dataSaida,
      dataEmissao: cabecalhoNfe.dataEmissao,
      indicadorPresenca: cabecalhoNfe.indicadorPresenca,
      indicativoIntermediador: cabecalhoNfe.indicativoIntermediador,
      tpNf: cabecalhoNfe.tpNf || identidadeEmissao.tpNf,
      identidade: {
        descricao: identidadeEmissao.descricao,
        tpNf: identidadeEmissao.tpNf,
        finNfe: identidadeEmissao.finNfe,
      },
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
      return erro(
        claim.mensagem,
        claim.motivo === "erro" ? 500 : 409,
        {
          emissao_id: emissaoId,
          podeConsultarNovamente: true,
          podeRetransmitir: false,
        }
      );
    }

    const tentativaId = claim.tentativaId;

    let resultadoGeranet:
      Awaited<
        ReturnType<
          typeof chamarGeranet
        >
      >;

    try {
      resultadoGeranet =
        await chamarGeranet({
          apiKey,
          endpoint:
            "/api/v1/nfe/emitir",
          payload,
          timeoutMs:
            45_000,
        });
    } catch (
      e
    ) {
      const persistencia =
        persistenciaFalhaComunicacaoEmitir(e);

      await admin
        .from(
          "fiscal_emissoes"
        )
        .update(
          patchEmissaoFalhaComunicacao(
            persistencia
          )
        )
        .eq(
          "id",
          emissaoId
        )
        .eq(
          "empresa_id",
          empresaId
        );

      await registrarRespostaTentativaFiscal({
        admin,
        empresaId,
        tentativaId,
        motivo: persistencia.motivo,
        endpoint: "/api/v1/nfe/emitir",
        erroTransporte: persistencia.motivo,
        resposta: {
          erro: persistencia.motivo,
          classificacao: persistencia.classificacaoResumo,
        },
        classificacaoInicial: persistencia.status,
      });

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

    const httpOk =
      resultadoGeranet
        .httpOk;

    const httpStatus =
      resultadoGeranet
        .httpStatus;

    const geranet =
      resultadoGeranet
        .dados;

    const resumo =
      resultadoGeranet
        .resumo;

    const chave =
      texto(
        geranet.chave
      );

    const protocolo =
      texto(
        geranet
          .protocolo
      );

    const situacao =
      texto(
        geranet
          .situacao
      ).toLowerCase();

    const autorizado =
      httpOk &&
      situacao ===
        "sucesso" &&
      /^\d{44}$/.test(
        chave
      ) &&
      protocolo.length > 0;

    if (
      autorizado
    ) {
      const {
        error:
          updateError,
      } =
        await admin
          .from(
            "fiscal_emissoes"
          )
          .update({
            status:
              "autorizada",
            chave_acesso:
              chave,
            protocolo,
            cstat:
              texto(
                geranet
                  .cstat
              ) || null,
            motivo:
              texto(
                geranet
                  .mensagem
              ) || null,
            geranet_http_status:
              httpStatus,
            geranet_situacao:
              texto(
                geranet
                  .situacao
              ) || null,
            resposta_resumo:
              resumo,
            xml_hex: hexDocumentoFiscalPersistivel(geranet.xml, "xml"),
            pdf_hex: hexDocumentoFiscalPersistivel(geranet.pdf, "pdf"),
            erro_comunicacao:
              null,
            respondida_at:
              new Date()
                .toISOString(),
            autorizada_at:
              new Date()
                .toISOString(),
          })
          .eq(
            "id",
            emissaoId
          )
          .eq(
            "empresa_id",
            empresaId
          );

      if (
        updateError
      ) {
        return erro(
          "Geranet autorizou, mas falhou ao persistir localmente. NÃO retransmita.",
          500,
          {
            emissao_id:
              emissaoId,
            chave,
            protocolo,
          }
        );
      }

      await registrarRespostaTentativaFiscal({
        admin,
        empresaId,
        tentativaId,
        httpStatus,
        cstat: geranet.cstat,
        motivo: geranet.mensagem,
        geranetLogId: geranetLogIdDe(geranet),
        resposta: geranet,
        xmlHex: hexDocumentoFiscalPersistivel(geranet.xml, "xml"),
        pdfHex: hexDocumentoFiscalPersistivel(geranet.pdf, "pdf"),
        classificacaoInicial: "autorizada",
      });

      await admin
        .from("vendas")
        .update({
          modelo_fiscal_intencao:
            "55",
        })
        .eq(
          "empresa_id",
          empresaId
        )
        .eq(
          "id",
          vendaId
        );

      return json({
        ok: true,
        autorizada:
          true,
        ambiente:
          ambiente === "1"
            ? "producao"
            : "homologacao",
        modelo:
          "55",
        venda_id:
          vendaId,
        emissao_id:
          emissaoId,
        serie:
          emissaoAtual.serie,
        numero:
          String(
            emissaoAtual.numero
          ),
        chave,
        protocolo,
        cstat:
          texto(
            geranet.cstat
          ) || null,
        mensagem:
          texto(
            geranet
              .mensagem
          ) ||
          "NF-e autorizada.",
        itens:
          itensFiscais.length,
        pagamentos:
          pagamentosConfirmados.length,
        operacao,
        diagnostico_total:
          diagnosticoTotal,
      });
    }

    const classificacaoEmissao =
      classificarRespostaEmitir({
        httpOk,
        httpStatus,
        situacao,
        cstat: geranet.cstat,
        mensagem: geranet.mensagem,
        chave,
        protocolo,
      });

    if (
      classificacaoEmissao !==
      "rejeitada"
    ) {
      const persistencia =
        persistirClassificacaoNaoAutorizada(
          classificacaoEmissao ===
            "erro_envio"
            ? "erro_envio"
            : "aguardando_reconciliacao"
        );
      const motivoTecnico =
        texto(
          geranet.mensagem
        ) ||
        persistencia.mensagemPadrao;

      await admin
        .from(
          "fiscal_emissoes"
        )
        .update({
          status:
            persistencia.status,
          geranet_http_status:
            httpStatus,
          geranet_situacao:
            texto(
              geranet
                .situacao
            ) || null,
          cstat:
            texto(
              geranet
                .cstat
            ) || null,
          motivo:
            motivoTecnico,
          erro_comunicacao:
            motivoTecnico,
          resposta_resumo: {
            ...resumo,
            classificacao:
              persistencia.classificacaoResumo,
            historico: [
              historicoErroTecnico(
                motivoTecnico
              ),
            ],
          },
          xml_hex: hexDocumentoFiscalPersistivel(geranet.xml, "xml"),
          pdf_hex: hexDocumentoFiscalPersistivel(geranet.pdf, "pdf"),
          respondida_at:
            new Date()
              .toISOString(),
        })
        .eq(
          "id",
          emissaoId
        )
        .eq(
          "empresa_id",
          empresaId
        );

      await registrarRespostaTentativaFiscal({
        admin,
        empresaId,
        tentativaId,
        httpStatus,
        cstat: geranet.cstat,
        motivo: motivoTecnico,
        geranetLogId: geranetLogIdDe(geranet),
        endpoint: "/api/v1/nfe/emitir",
        resposta: geranet,
        xmlHex: hexDocumentoFiscalPersistivel(geranet.xml, "xml"),
        pdfHex: hexDocumentoFiscalPersistivel(geranet.pdf, "pdf"),
        classificacaoInicial: persistencia.status,
      });

      const respostaErro = montarErroEmitirNaoAutorizada({
        persistencia,
        motivoTecnico,
        emissaoId,
        httpGeranet: httpStatus,
        geranet: resumo,
        modelo: "55",
      });

      return erro(
        respostaErro.mensagem,
        respostaErro.statusHttp,
        respostaErro.extra
      );
    }

    await admin
      .from(
        "fiscal_emissoes"
      )
      .update({
        status:
          "rejeitada",
        geranet_http_status:
          httpStatus,
        geranet_situacao:
          texto(
            geranet
              .situacao
          ) || null,
        cstat:
          texto(
            geranet.cstat
          ) || null,
        motivo:
          texto(
            geranet
              .mensagem
          ) ||
          `Geranet HTTP ${httpStatus}`,
        erro_comunicacao:
          null,
        resposta_resumo:
          {
            ...resumo,
            classificacao:
              "rejeitada",
          },
        xml_hex: hexDocumentoFiscalPersistivel(geranet.xml, "xml"),
        pdf_hex: hexDocumentoFiscalPersistivel(geranet.pdf, "pdf"),
        respondida_at:
          new Date()
            .toISOString(),
      })
      .eq(
        "id",
        emissaoId
      )
      .eq(
        "empresa_id",
        empresaId
      );

    await registrarRespostaTentativaFiscal({
      admin,
      empresaId,
      tentativaId,
      httpStatus,
      cstat: geranet.cstat,
      motivo: geranet.mensagem,
      geranetLogId: geranetLogIdDe(geranet),
      resposta: {
        ...resumo,
        classificacao: "rejeitada",
      },
      xmlHex: hexDocumentoFiscalPersistivel(geranet.xml, "xml"),
      pdfHex: hexDocumentoFiscalPersistivel(geranet.pdf, "pdf"),
      classificacaoInicial: "rejeitada",
    });

    return erro(
      texto(
        geranet
          .mensagem
      ) ||
      "NF-e rejeitada.",
      httpStatus ===
      401
        ? 401
        : 422,
      {
        venda_id:
          vendaId,
        emissao_id:
          emissaoId,
        status:
          "rejeitada",
        serie:
          emissaoAtual.serie,
        numero:
          String(
            emissaoAtual.numero
          ),
        geranet:
          resumo,
        diagnostico_total:
          diagnosticoTotal,
      }
    );
  } catch (
    e
  ) {
    console.error(
      "[NFE55 EMITIR VENDA]",
      e instanceof Error
        ? e.message
        : "Erro desconhecido"
    );

    return erro(
      e instanceof Error
        ? e.message
        : "Erro interno na emissão NF-e.",
      500
    );
  }
}
