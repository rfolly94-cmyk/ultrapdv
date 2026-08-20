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
import { ErroPermissao } from "@/lib/permissoes/erro";
import { exigirPermissao } from "@/lib/permissoes/exigir-permissao";
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

import {
  montarPayloadNfeGeranet,
  type IndicadorIeDestinatarioNfe,
  type ConsumidorFinalNfe,
} from "@/lib/fiscal/geranet/montar-payload-nfe";
import {
  ieDestinatarioParaGeranet,
  origemSnapshotAInicializar,
  resolverDestinatarioFiscalDaOrigem,
  snapshotDestinatarioParaPersistir,
  lerSnapshotDestinatarioFiscal,
} from "@/lib/fiscal/destinatario/resolver-destinatario-fiscal";
import { mesclarSnapshotOperacao } from "@/lib/fiscal/nfe55/pagamentos-rascunho";
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
  conferenciaFinanceiraVenda,
  filtrarPagamentosFinanceiros,
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
      await exigirPermissao({ modulo: "fiscal", acao: "emitir_nfe" });
      await exigirEmpresaOperacional(String(vinculo.empresa_id));
    } catch (error) {
      if (error instanceof ErroPermissao) {
        return erro(error.message, error.status);
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
            classificacao_ibscbs
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

        admin.rpc(
          "obter_segredos_fiscais",
          {
            p_empresa_id:
              empresaId,
          }
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
      return erro(
        primeiroErro.message,
        500
      );
    }

    if (
      segredosResult.error
    ) {
      return erro(
        "Não foi possível ler os segredos fiscais.",
        500
      );
    }

    const venda =
      vendaResult.data;

    const itensVenda =
      itensResult.data ??
      [];

    const pagamentos =
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
      return erro(
        "Venda não encontrada.",
        404
      );
    }

    if (
      venda.status !==
      "finalizada"
    ) {
      return erro(
        "Somente venda finalizada pode emitir NF-e."
      );
    }

    if (
      !venda.cliente_id
    ) {
      return erro(
        "NF-e exige cliente identificado na venda."
      );
    }

    const transporteResolvido = await carregarTransporteNfe55({
      db: supabase,
      empresaId,
      vendaId,
    });
    if (transporteConflitaComFrete9(transporteResolvido.dados)) {
      return erro(MENSAGEM_FRETE_9_COM_DADOS);
    }
    const modalidadeFrete =
      transporteResolvido.dados.mod_frete ?? "9";

    if (
      itensVenda.length ===
      0
    ) {
      return erro(
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
      return erro(
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
          venda.cliente_id
        )
        .maybeSingle();

    if (
      clienteError
    ) {
      return erro(
        clienteError.message,
        500
      );
    }

    if (
      !cliente ||
      !cliente.ativo
    ) {
      return erro(
        "Cliente da venda não encontrado ou inativo."
      );
    }

    if (
      String(cliente.empresa_id) !==
      String(empresaId)
    ) {
      return erro(
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
      return erro(
        "CPF do destinatário inválido."
      );
    }

    if (
      cliente.tipo_pessoa ===
        "J" &&
      documento.length !== 14
    ) {
      return erro(
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
      return erro(
        "Endereço fiscal do destinatário está incompleto."
      );
    }

    const { data: operacaoVenda } =
      await supabase
        .from("fiscal_operacoes")
        .select(
          "id, empresa_id, snapshot_fiscal, natureza_id, fin_nfe, natureza_descricao, tp_nf"
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
    const snapshotOperacao =
      operacaoVenda &&
      String(operacaoVenda.empresa_id) ===
        String(empresaId)
        ? operacaoVenda.snapshot_fiscal
        : null;
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
      return erro(
        "Cliente marcado como contribuinte ICMS precisa ter Inscrição Estadual."
      );
    }

    const consumidorFinal:
      ConsumidorFinalNfe =
        destinatarioFiscal.consumidorFinal;

    if (
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
        return erro(
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
          return erro(
            snapOpErro.message,
            500
          );
        }
      }
    }

    const pagamentosConfirmados =
      filtrarPagamentosFinanceiros(
        pagamentos
      );

    if (
      pagamentosConfirmados.length ===
        0
    ) {
      return erro(
        "A venda não possui pagamento confirmado."
      );
    }

    for (
      const pagamento
      of pagamentosConfirmados
    ) {
      if (
        !/^\d{2}$/.test(
          texto(
            pagamento.codigo_fiscal
          )
        )
      ) {
        return erro(
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
        return erro(
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
      return erro(bloqueioEletronico);
    }

    const trocoVenda =
      numero(
        venda.troco
      );

    const conferencia =
      conferenciaFinanceiraVenda({
        valorTotal:
          venda.valor_total,
        pagamentos,
        troco:
          venda.troco,
      });

    if (
      !conferencia.ok
    ) {
      return erro(
        "Pagamentos líquidos não conferem com o total da venda."
      );
    }

    if (
      !empresa ||
      !empresa.ativo
    ) {
      return erro(
        "Empresa não encontrada ou inativa."
      );
    }

    if (
      !fiscal ||
      !fiscal.ativo
    ) {
      return erro(
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
      return erro(
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
      return erro(
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
      return erro(
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
      return erro(
        "CNPJ do emitente inválido."
      );
    }

    if (
      !ieEmitente
    ) {
      return erro(
        "Inscrição Estadual do emitente não configurada."
      );
    }

    if (
      ![1, 2, 3].includes(
        crt
      )
    ) {
      return erro(
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
      return erro(
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
      return erro(
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
          new Date(),
          fusoHorario
        );
    } catch (
      errorFuso
    ) {
      return erro(
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
      return erro(
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
      return erro(
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
      return erro(
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
      return erro(
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
      return erro(
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
      return erro(
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

    const pendenciasIpi =
      pendenciasIpiDocumento({
        modelo: "55",
        perfilIpi,
        grupos: (grupos ?? []).map(
          (grupo) => camposIpiDoGrupo(grupo)
        ),
      });

    if (pendenciasIpi.length > 0) {
      return erro(pendenciasIpi[0]);
    }

    const ambiente:
      AmbienteGeranet =
      Number(
        fiscal.ambiente
      ) === 1
        ? "1"
        : "2";

    const confirmacaoEsperada =
      ambiente === "1"
        ? "EMITIR_NFE55_VENDA_PRODUCAO"
        : "EMITIR_NFE55_VENDA_HOMOLOGACAO";

    if (
      confirmacaoRecebida !==
      confirmacaoEsperada
    ) {
      return erro(
        ambiente === "1"
          ? "A empresa está em PRODUÇÃO. Confirmação de produção obrigatória."
          : "A empresa está em HOMOLOGAÇÃO. Confirmação de homologação obrigatória.",
        409
      );
    }

    const codigoRegimeTributario =
      crt as
        CodigoRegimeTributario;

    const itensFiscais: ItemGeranet[] = [];

    const snapshots:
      Array<{
        id: string;
        dados: Record<
          string,
          unknown
        >;
      }> = [];

    let descontosFiscais: Map<string, number>;

    try {
      descontosFiscais = mapaDescontoFiscalPorItem(
        distribuirDescontoItens({
          descontoVenda: numero(venda.desconto),
          itens: itensVenda.map((item) => ({
            id: item.id,
            quantidade: numero(item.quantidade),
            valorUnitario: numero(item.valor_unitario),
            desconto: numero(item.desconto),
          })),
        })
      );
    } catch (error) {
      return erro(
        error instanceof DistribuicaoDescontoFiscalError
          ? error.message
          : "Não foi possível ratear o desconto fiscal da venda. Nenhum número foi reservado."
      );
    }

    const totaisNota = totaisNotaDoSnapshot(
      operacaoVenda &&
        String(operacaoVenda.empresa_id) === String(empresaId)
        ? operacaoVenda.snapshot_fiscal
        : null
    );
    const temTotaisSnapshot =
      totaisNota.frete > 0 ||
      totaisNota.seguro > 0 ||
      totaisNota.outro > 0 ||
      totaisNota.desconto > 0;
    const valorFrete = temTotaisSnapshot
      ? totaisNota.frete
      : numero(venda.frete);
    const valorSeguro = temTotaisSnapshot ? totaisNota.seguro : 0;
    const valorOutro = temTotaisSnapshot
      ? totaisNota.outro
      : numero(venda.acrescimo);
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
      return erro(
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

      if (
        !produto ||
        !produto.ativo
      ) {
        return erro(
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
          .grupo_fiscal_id;

      const grupo =
        grupoId
          ? gruposMap.get(
              grupoId
            )
          : undefined;

      if (
        !grupo ||
        !grupo.ativo
      ) {
        return erro(
          `Grupo Fiscal do item ${
            indice + 1
          } não encontrado ou inativo.`
        );
      }

      const ncm =
        texto(
          itemVenda.ncm ??
          fiscalProduto?.ncm
        );

      const cest =
        texto(
          itemVenda.cest ??
          fiscalProduto?.cest
        ) || null;

      const origemProduto =
        texto(
          itemVenda
            .origem_produto ??
          fiscalProduto
            ?.origem_produto
        );

      // NF-e de venda escolhe CFOP conforme UF do destinatário
      // nos campos atuais do grupo fiscal. Sem CFOP inventado.
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

      if (
        !cfopResolvido.ok
      ) {
        return erro(
          `${cfopResolvido.mensagem} Produto: ${itemVenda.produto_nome}.`
        );
      }

      const cfop =
        cfopResolvido.cfop;

      const icms =
        texto(
          itemVenda
            .icms_cst_csosn ??
          grupo
            .icms_cst_csosn
        );

      const pis =
        texto(
          itemVenda.pis_cst ??
          grupo.pis_cst
        );

      const cofins =
        texto(
          itemVenda
            .cofins_cst ??
          grupo
            .cofins_cst
        );

      if (
        somenteDigitos(
          ncm
        ).length !== 8 ||
        !/^\d{4}$/.test(
          cfop
        ) ||
        !/^\d$/.test(
          origemProduto
        ) ||
        !icms ||
        !/^\d{2}$/.test(
          pis
        ) ||
        !/^\d{2}$/.test(
          cofins
        )
      ) {
        return erro(
          `Configuração fiscal incompleta no item ${
            indice + 1
          }: ${
            itemVenda
              .produto_nome
          }.`
        );
      }

      const cstIbscbs =
        texto(
          itemVenda
            .cst_ibscbs ??
          grupo.cst_ibscbs
        ) || null;

      const classificacaoIbscbs =
        texto(
          itemVenda
            .classificacao_ibscbs ??
          grupo
            .classificacao_ibscbs
        ) || null;

      const {
        item,
      } =
        montarItemGeranet({
          produto: {
            codigo:
              itemVenda
                .produto_codigo,
            codigoBarras:
              produto
                .codigo_barras,
            nome:
              itemVenda
                .produto_nome,
            unidadeMedida:
              itemVenda
                .unidade_medida,
            tipoItem:
              produto
                .tipo_item,
            precoVenda:
              itemVenda
                .valor_unitario,
          },

          fiscal: {
            ncm,
            cest,
            origemProduto,
          },

          grupo: {
            cfopInterno:
              cfop,
            cfopInterestadual:
              cfop,
            icmsCstCsosn:
              icms,
            pisCst:
              pis,
            pisAliquota:
              grupo
                .pis_aliquota,
            cofinsCst:
              cofins,
            cofinsAliquota:
              grupo
                .cofins_aliquota,
            cstIbscbs,
            classificacaoIbscbs,
            aliquotaIbsUf:
              grupo
                .aliquota_ibs_uf,
            aliquotaIbsMunicipio:
              grupo
                .aliquota_ibs_municipio,
            aliquotaCbs:
              grupo
                .aliquota_cbs,
            percentualReducaoIbsUf:
              grupo
                .percentual_reducao_ibs_uf,
            percentualReducaoIbsMunicipio:
              grupo
                .percentual_reducao_ibs_municipio,
            percentualReducaoCbs:
              grupo
                .percentual_reducao_cbs,
            ibscbsManual:
              grupo
                .ibscbs_manual,
            ...camposIpiDoGrupo(grupo),
          },

          modelo: "55",
          perfilIpi: parsePerfilIpi(
            fiscal.perfil_ipi
          ),
          codigoRegimeTributario,
          ambiente,
          forcarIbscbsHomologacao:
            false,
          dataEmissao:
            new Date()
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
        return erro(
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
        dados: {
          grupo_fiscal_id:
            grupo.id,
          ncm,
          cest,
          origem_produto:
            origemProduto,
          cfop,
          icms_cst_csosn:
            icms,
          pis_cst:
            pis,
          cofins_cst:
            cofins,
          cst_ibscbs:
            cstIbscbs,
          classificacao_ibscbs:
            classificacaoIbscbs,
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
        valorTotalVenda: numero(
          venda.valor_total
        ),
      });

    if (divergenciaTotais) {
      return erro(divergenciaTotais);
    }

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
        snapshots.map(
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

    const payload =
      montarPayloadNfeGeranet({
        ambiente,
        ufEmitente,
        certificadoDigital:
          certificado,
        senhaCertificadoDigital:
          senhaCertificado,

        emitente: {
          logomarca:
            await obterLogomarcaFiscalHex(
              String(empresaId)
            ),
          cnpj:
            empresa.cnpj,
          inscricaoEstadual:
            ieEmitente,
          razaoSocial:
            empresa
              .razao_social,
          nomeFantasia:
            empresa
              .nome_fantasia,
          telefone:
            fiscal.telefone,
          email:
            fiscal.email,
          logradouro:
            fiscal.logradouro,
          numero:
            fiscal.numero,
          complemento:
            fiscal.complemento,
          bairro:
            fiscal.bairro,
          municipio:
            fiscal.municipio,
          codigoMunicipio:
            fiscal
              .codigo_municipio_ibge,
          uf:
            ufEmitente,
          cep:
            fiscal.cep,
          codigoRegimeTributario:
            crt,
          tipoAtividade:
            fiscal
              .tipo_atividade ??
            "3",
          informacaoComplementar:
            fiscal
              .informacao_complementar_padrao,
        },

        destinatario: {
          cpf:
            cliente
              .tipo_pessoa ===
            "F"
              ? documento
              : "",
          cnpj:
            cliente
              .tipo_pessoa ===
            "J"
              ? documento
              : "",
          inscricaoEstadual:
            ieDestinatarioParaGeranet({
              indicadorIEdestinatario:
                indicadorIe,
              inscricaoEstadual:
                cliente.inscricao_estadual,
            }),
          razaoSocial:
            cliente.nome,
          nomeFantasia:
            cliente
              .nome_fantasia,
          consumidorFinal,
          indicadorIEdestinatario:
            indicadorIe,
          telefone:
            cliente.telefone,
          email:
            cliente.email,
          logradouro:
            cliente.logradouro,
          numero:
            cliente.numero,
          complemento:
            cliente.complemento,
          bairro:
            cliente.bairro,
          municipio:
            cliente.municipio,
          codigoMunicipio:
            cliente
              .codigo_municipio_ibge,
          codigoPais:
            "1058",
          nomePais:
            "Brasil",
          uf:
            clienteUf,
          cep:
            cliente.cep,
          entrega: enderecoEntregaDoSnapshotParaGeranet(
            snapshotOperacao
          ),
        },

        autorizadosXml:
          autorizadosXmlDoSnapshotParaGeranet(
            snapshotOperacao
          ),

        responsavelTecnico:
          responsavelTecnicoDoCadastroFiscal({
            fiscal,
            csrt: csrtResult.error
              ? null
              : csrtResult.data,
          }),

        config: {
          serie:
            emissaoAtual.serie,
          numeroNota:
            emissaoAtual.numero,
          codigoNumerico:
            emissaoAtual
              .codigo_numerico,
          dataSaida:
            cabecalhoNfe.dataSaida,
          dataEmissao:
            cabecalhoNfe.dataEmissao,
          fusoHorario:
            fusoHorario,
          indicadorPresenca:
            cabecalhoNfe.indicadorPresenca,
          indicativoIntermediador:
            cabecalhoNfe.indicativoIntermediador,
          naturezaOperacao:
            identidadeEmissao.descricao,
          informacaoComplementar:
            fiscal
              .informacao_complementar_padrao,
          tipo:
            cabecalhoNfe.tpNf ||
            identidadeEmissao.tpNf,
          frete:
            modalidadeFrete,
          finalidade:
            identidadeEmissao.finNfe,
          numeroVenda:
            venda.numero,
        },

        transporte: transporteNfeParaPayloadGeranet(
          transporteResolvido.dados
        ),

        pagamento: {
          troco:
            trocoVenda,
          detalhamento:
            pagamentosConfirmados.map(
              (
                pagamento
              ) => ({
                tipo:
                  texto(
                    pagamento
                      .codigo_fiscal
                  ),
                valor:
                  numero(
                    pagamento
                      .valor
                  ),
                indicadorPagamento:
                  texto(
                    pagamento
                      .indicador_pagamento
                  ) as
                    | "0"
                    | "1",
              })
            ),
        },

        itens:
          itensFiscais,
      });

    const diagnosticoTotal = aplicarValorTotalNotaGeranet({
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
