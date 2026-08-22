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
  exigirEmissaoNfce,
} from "@/lib/fiscal/acesso-operacao";

import {
  montarItemGeranet,
  type ItemGeranet,
  type OperacaoFiscal,
} from "@/lib/fiscal/geranet/montar-item";
import {
  camposIpiDoGrupo,
} from "@/lib/fiscal/ipi";

import {
  montarPayloadNfceGeranet,
  type SegredosFiscaisGeranet,
} from "@/lib/fiscal/geranet/montar-payload-nfce";
import { obterLogomarcaFiscalHex } from "@/lib/empresa/obter-logomarca-fiscal-hex";
import { aplicarContingenciaContratoGeranet } from "@/lib/fiscal/geranet/contingencia-contrato";

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
  DistribuicaoDescontoFiscalError,
  conferirSomaItensFiscaisComVenda,
  distribuirDescontoItens,
  mapaDescontoFiscalPorItem,
  paraCentavos,
  valorBrutoItemEmCentavos,
  valorLiquidoFiscalEmCentavos,
} from "@/lib/fiscal/distribuir-desconto-itens";

import {
  chamarGeranet,
  persistenciaFalhaComunicacaoEmitir,
} from "@/lib/fiscal/geranet/cliente-geranet";
import {
  ehRejeicaoFiscalReal,
  MENSAGEM_BLOQUEIO_RETRANSMISSAO,
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
import { filtrarPagamentosFinanceiros } from "@/lib/vendas/pagamentos-financeiros";

type Body = {
  confirmar?: string;
  venda_id?: string;
  justificativa?: string;
};

type PayloadNfceMutavel = {
  [key: string]: unknown;
  idCsc?: string;
  csc?: string;
  nfe: {
    [key: string]: unknown;
    empresa?: Record<string, unknown>;
    itens?: unknown[];
    pagamento?: {
      troco: number;
      detalhamento:
        Array<{
          tipo: string;
          valor: number;
          indicadorPagamento:
            | "0"
            | "1";
        }>;
    };
    contingencia?: string;
    justificativaContingencia?: string;
    numeroVenda?: string;
  };
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

function chaveContingencia(
  vendaId: string
) {
  const bytes =
    createHash("sha256")
      .update(
        `ultrapdv:nfce65:contingencia:${vendaId}`
      )
      .digest()
      .subarray(
        0,
        16
      );

  bytes[6] =
    (bytes[6] &
      0x0f) |
    0x50;

  bytes[8] =
    (bytes[8] &
      0x3f) |
    0x80;

  const hex =
    bytes.toString(
      "hex"
    );

  return [
    hex.slice(
      0,
      8
    ),
    hex.slice(
      8,
      12
    ),
    hex.slice(
      12,
      16
    ),
    hex.slice(
      16,
      20
    ),
    hex.slice(
      20,
      32
    ),
  ].join("-");
}

async function evento(
  admin:
    ReturnType<
      typeof createAdminClient
    >,
  empresaId: string,
  emissaoId: string,
  tipo:
    | "gerada"
    | "autorizada"
    | "rejeitada"
    | "comunicacao_ambigua",
  detalhes:
    Record<
      string,
      unknown
    >
) {
  await admin
    .from(
      "fiscal_contingencia_eventos"
    )
    .insert({
      empresa_id:
        empresaId,
      emissao_id:
        emissaoId,
      tipo,
      detalhes,
    });
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
      data: claims,
      error: authError,
    } =
      await supabase.auth.getClaims();

    if (
      authError ||
      !claims?.claims?.sub
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
          String(claims.claims.sub)
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
      await exigirEmissaoNfce({
        empresaId: String(vinculo.empresa_id),
        origem: "nfce-contingencia-venda",
      });
    } catch (error) {
      const authz = capturaErroAutorizacaoFiscal(error);
      if (authz) {
        return erro(authz.mensagem, authz.status);
      }
      throw error;
    }

    const empresaId =
      vinculo.empresa_id;

    const body =
      await request
        .json()
        .catch(
          () => null
        ) as
        | Body
        | null;

    if (!body) {
      return erro(
        "JSON da requisição é inválido.",
        400
      );
    }

    if (
      body.confirmar !==
      "EMITIR_NFCE_CONTINGENCIA_OFFLINE"
    ) {
      return erro(
        "Confirmação explícita de contingência ausente.",
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

    const [
      vendaResult,
      itensResult,
      pagamentosResult,
      empresaResult,
      fiscalResult,
      nfceResult,
      numeracoesResult,
      configResult,
      segredosResult,
      emissoesResult,
    ] =
      await Promise.all([
        supabase
          .from(
            "vendas"
          )
          .select(`
            id,
            numero,
            status,
            modelo_fiscal_intencao,
            valor_produtos,
            desconto,
            valor_total,
            troco,
            observacao
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
            troco,
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
          .from(
            "empresas"
          )
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
            codigo_regime_tributario,
            indicador_presenca_padrao,
            indicativo_intermediador_padrao,
            natureza_operacao_padrao,
            informacao_complementar_padrao,
            fuso_horario,
            ambiente,
            ativo
          `)
          .eq(
            "empresa_id",
            empresaId
          )
          .maybeSingle(),

        supabase
          .from(
            "fiscal_nfce_config"
          )
          .select(`
            id,
            id_csc,
            csc_configurado,
            ativo
          `)
          .eq(
            "empresa_id",
            empresaId
          )
          .eq(
            "ativo",
            true
          )
          .limit(2),

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
            "65"
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

        supabase
          .from(
            "fiscal_contingencia_config"
          )
          .select(`
            nfce_offline_habilitada,
            justificativa_padrao
          `)
          .eq(
            "empresa_id",
            empresaId
          )
          .maybeSingle(),

        admin.rpc(
          "obter_segredos_fiscais",
          {
            p_empresa_id:
              empresaId,
          }
        ),

        admin
          .from(
            "fiscal_emissoes"
          )
          .select(`
            id,
            modelo,
            serie,
            numero,
            status,
            tipo_emissao,
            chave_acesso,
            protocolo,
            xml_contingencia_hex
          `)
          .eq(
            "empresa_id",
            empresaId
          )
          .eq(
            "origem_tipo",
            "venda"
          )
          .eq(
            "origem_id",
            vendaId
          )
          .order(
            "created_at",
            {
              ascending:
                false,
            }
          ),
      ]);

    const primeiroErro =
      vendaResult.error ??
      itensResult.error ??
      pagamentosResult.error ??
      empresaResult.error ??
      fiscalResult.error ??
      nfceResult.error ??
      numeracoesResult.error ??
      configResult.error ??
      emissoesResult.error;

    if (
      primeiroErro
    ) {
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

    const empresa =
      empresaResult.data;

    const fiscal =
      fiscalResult.data;

    const itensVenda =
      itensResult.data ??
      [];

    const pagamentos =
      pagamentosResult.data ??
      [];

    const nfceConfigs =
      nfceResult.data ??
      [];

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

    const config =
      configResult.data;

    const emissoes =
      emissoesResult.data ??
      [];

    const segredos =
      (segredosResult.data ??
        {}) as SegredosFiscaisGeranet;

    if (
      !config
        ?.nfce_offline_habilitada
    ) {
      return erro(
        "A contingência NFC-e está desativada em Configurações Fiscais → Contingência.",
        403
      );
    }

    const justificativa =
      texto(
        body.justificativa
      ) ||
      texto(
        config
          .justificativa_padrao
      );

    if (
      justificativa.length <
        15 ||
      justificativa.length >
        256
    ) {
      return erro(
        "A justificativa da contingência deve possuir entre 15 e 256 caracteres.",
        400
      );
    }

    if (
      !venda ||
      venda.status !==
        "finalizada"
    ) {
      return erro(
        "Venda não encontrada ou não finalizada.",
        409
      );
    }

    if (
      venda
        .modelo_fiscal_intencao ===
      "55"
    ) {
      return erro(
        "Esta venda está marcada para NF-e modelo 55. A contingência offline deste módulo é exclusiva da NFC-e 65.",
        409
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

    const contingenciaExistente =
      emissoes.find(
        (item) =>
          item.modelo ===
            "65" &&
          item
            .tipo_emissao ===
            "contingencia_offline"
      );

    if (
      contingenciaExistente
    ) {
      if (
        contingenciaExistente
          .status ===
        "aguardando_transmissao_contingencia"
      ) {
        return json(
          {
            ok: true,
            contingencia:
              true,
            autorizada:
              false,
            reutilizada:
              true,
            emissao_id:
              contingenciaExistente.id,
            serie:
              contingenciaExistente.serie,
            numero:
              String(
                contingenciaExistente.numero
              ),
            status:
              contingenciaExistente.status,
            mensagem:
              "Esta venda já possui NFC-e em contingência aguardando transmissão. Nenhum novo número foi gerado.",
          },
          202
        );
      }

      return erro(
        `Esta venda já possui uma NFC-e de contingência com status ${contingenciaExistente.status}. Resolva esse documento antes de gerar outro.`,
        409,
        {
          emissao_id:
            contingenciaExistente.id,
          status:
            contingenciaExistente.status,
        }
      );
    }

    const rejeitadaAnterior =
      emissoes.find(
        (item) =>
          item.status ===
          "rejeitada"
      );

    if (
      rejeitadaAnterior
    ) {
      return erro(
        "Esta venda já possui uma rejeição fiscal explícita. A contingência não pode ser usada para contornar rejeição; corrija o motivo fiscal e emita novamente pelo fluxo normal.",
        409,
        {
          emissao_id:
            rejeitadaAnterior.id,
        }
      );
    }

    const canceladaAnterior =
      emissoes.find(
        (item) =>
          item.status ===
          "cancelada"
      );

    if (
      canceladaAnterior
    ) {
      return erro(
        "Esta venda já possui documento fiscal cancelado. Revise o histórico fiscal antes de gerar uma nova NFC-e.",
        409,
        {
          emissao_id:
            canceladaAnterior.id,
        }
      );
    }

    const autorizada =
      emissoes.find(
        (item) =>
          item.status ===
          "autorizada"
      );

    if (autorizada) {
      return erro(
        "Esta venda já possui documento fiscal autorizado.",
        409,
        {
          emissao_id:
            autorizada.id,
        }
      );
    }

    const sensivel =
      emissoes.find(
        (item) =>
          [
            "enviando",
            "erro_comunicacao",
            "aguardando_reconciliacao",
            "transmitindo_contingencia",
          ].includes(
            item.status
          )
      );

    if (sensivel) {
      return erro(
        sensivel.status === "aguardando_reconciliacao" ||
          sensivel.status === "enviando"
          ? MENSAGEM_BLOQUEIO_RETRANSMISSAO
          : `Existe emissão fiscal em estado sensível (${sensivel.status}). Não gere contingência até reconciliar.`,
        409,
        {
          emissao_id:
            sensivel.id,
          podeConsultarNovamente: true,
          podeRetransmitir: false,
        }
      );
    }

    const reservaPura =
      emissoes.find(
        (item) =>
          item.status ===
          "reservada"
      );

    if (reservaPura) {
      return erro(
        "Existe uma reserva fiscal anterior nesta venda. Descarte a reserva segura antes de gerar a contingência.",
        409,
        {
          emissao_id:
            reservaPura.id,
        }
      );
    }

    if (
      itensVenda.length ===
      0
    ) {
      return erro(
        "A venda não possui itens."
      );
    }

    const pagamentosConfirmados =
      filtrarPagamentosFinanceiros(
        pagamentos
      ).filter(
        (pagamento) =>
          numero(
            pagamento.valor
          ) > 0
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
      const pagamento of
      pagamentosConfirmados
    ) {
      if (
        !/^\d{2}$/.test(
          texto(
            pagamento
              .codigo_fiscal
          )
        )
      ) {
        return erro(
          `Forma de pagamento "${pagamento.forma_pagamento_nome ?? pagamento.forma_pagamento_codigo ?? "Pagamento"}" não possui código fiscal válido.`
        );
      }
    }

    const bloqueioEletronico =
      validarPagamentosEletronicosParaEmissao({
        modelo: "65",
        pagamentos: pagamentosConfirmados,
      });

    if (bloqueioEletronico) {
      return erro(bloqueioEletronico);
    }

    if (
      nfceConfigs.length !==
      1
    ) {
      return erro(
        "Deve existir exatamente uma configuração NFC-e ativa."
      );
    }

    if (
      numeracoes.length !==
      1
    ) {
      return erro(
        numeracoes.length ===
          0
          ? "Numeração NFC-e ativa não encontrada."
          : "Existe mais de uma série NFC-e ativa. Mantenha somente uma série ativa."
      );
    }

    const nfceConfig =
      nfceConfigs[0];

    const numeracao =
      numeracoes[0];

    const idCsc =
      texto(
        nfceConfig.id_csc
      );

    if (
      !nfceConfig
        .csc_configurado ||
      !/^\d{1,6}$/.test(
        idCsc
      ) ||
      Number(
        idCsc
      ) <= 0
    ) {
      return erro(
        "CSC / ID CSC da NFC-e não está corretamente configurado."
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

    const csc =
      texto(
        segredos.csc
      );

    if (
      !apiKey ||
      !certificado ||
      !senhaCertificado ||
      !csc
    ) {
      return erro(
        "API Key, certificado, senha ou CSC não estão completamente configurados."
      );
    }

    const cnpj =
      somenteDigitos(
        empresa.cnpj
      );

    if (
      cnpj.length !==
      14
    ) {
      return erro(
        "CNPJ do emitente é inválido."
      );
    }

    const ie =
      texto(
        fiscal
          .inscricao_estadual
      );

    const uf =
      texto(
        fiscal.uf
      )
        .toUpperCase();

    const crt =
      Number(
        fiscal
          .codigo_regime_tributario
      );

    if (
      !ie ||
      !/^[A-Z]{2}$/.test(
        uf
      ) ||
      ![1, 2, 3].includes(
        crt
      )
    ) {
      return erro(
        "IE, UF ou CRT do emitente está inválido."
      );
    }

    let fuso: string;

    try {
      fuso =
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
          fuso
        );
    } catch (
      error
    ) {
      return erro(
        error instanceof Error
          ? error.message
          : "Fuso horário fiscal inválido."
      );
    }

    const ambiente:
      AmbienteGeranet =
      Number(
        fiscal.ambiente
      ) === 1
        ? "1"
        : "2";

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
          .from(
            "produtos"
          )
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

    const erroProdutos =
      produtosResult.error ??
      produtosFiscalResult.error;

    if (
      erroProdutos
    ) {
      return erro(
        erroProdutos.message,
        500
      );
    }

    const produtosMap =
      new Map(
        (
          produtosResult.data ??
          []
        ).map(
          (item) => [
            item.id,
            item,
          ] as const
        )
      );

    const fiscalProdutoMap =
      new Map(
        (
          produtosFiscalResult.data ??
          []
        ).map(
          (item) => [
            item.produto_id,
            item,
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
          (item) =>
            item.grupo_fiscal_id
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
          (item) => [
            item.id,
            item,
          ] as const
        )
      );

    const operacao:
      OperacaoFiscal =
      "interna";

    const codigoRegimeTributario =
      crt as
        CodigoRegimeTributario;

    const itensFiscais: ItemGeranet[] = [];

    const snapshots:
      Array<{
        id: string;
        dados:
          Record<
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

    for (
      const [
        indice,
        itemVenda,
      ] of
        itensVenda.entries()
    ) {
      const produto =
        produtosMap.get(
          itemVenda.produto_id
        );

      if (
        !produto ||
        !produto.ativo
      ) {
        return erro(
          `Produto do item ${indice + 1} não encontrado ou inativo.`
        );
      }

      const fiscalProduto =
        fiscalProdutoMap.get(
          itemVenda.produto_id
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
          `Grupo Fiscal do item ${indice + 1} não encontrado ou inativo.`
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
        ) ||
        null;

      const origemProduto =
        texto(
          itemVenda
            .origem_produto ??
          fiscalProduto
            ?.origem_produto
        );

      const cfop =
        texto(
          itemVenda.cfop ??
          grupo
            .cfop_interno
        );

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
        ).length !==
          8 ||
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
          `Configuração fiscal incompleta no item ${indice + 1}: ${itemVenda.produto_nome}.`
        );
      }

      const cstIbscbs =
        texto(
          itemVenda
            .cst_ibscbs ??
          grupo.cst_ibscbs
        ) ||
        null;

      const classificacaoIbscbs =
        texto(
          itemVenda
            .classificacao_ibscbs ??
          grupo
            .classificacao_ibscbs
        ) ||
        null;

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

          modelo: "65",
          perfilIpi: null,
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
              itemVenda.quantidade
            ),
          desconto:
            descontosFiscais.get(
              itemVenda.id
            ) ??
            numero(
              itemVenda.desconto
            ),
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
        });

      if (
        paraCentavos(item.valorTotal) !==
          brutoEsperado ||
        paraCentavos(item.desconto) !==
          paraCentavos(descontoFiscal) ||
        liquidoEsperado < 0
      ) {
        return erro(
          `Total fiscal do item ${indice + 1} diverge da fórmula Geranet. Nenhum número foi reservado.`
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

    const totalPagamentos =
      pagamentosConfirmados.reduce(
        (
          total,
          pagamento
        ) =>
          total +
          numero(
            pagamento.valor
          ),
        0
      );

    const troco =
      numero(
        venda.troco
      );

    if (
      Math.abs(
        (
          totalPagamentos -
          troco
        ) -
        numero(
          venda.valor_total
        )
      ) >
      0.01
    ) {
      return erro(
        "Pagamentos líquidos divergem do total da venda. Nenhum número foi reservado."
      );
    }

    const emissaoPrevia = await carregarEmissaoPorChaveIdempotencia(
      admin,
      empresaId,
      chaveContingencia(vendaId)
    );
    const bloqueioRascunho = avaliarBloqueioRascunhoFiscal(emissaoPrevia);
    if (bloqueioRascunho.tipo !== "seguir") {
      if (bloqueioRascunho.tipo === "autorizada") {
        return json({
          ok: true,
          autorizada: true,
          contingencia: false,
          reutilizada: true,
          emissao_id: bloqueioRascunho.emissao.id,
          serie: bloqueioRascunho.emissao.serie,
          numero: String(bloqueioRascunho.emissao.numero),
          chave: bloqueioRascunho.emissao.chave_acesso,
          protocolo: bloqueioRascunho.emissao.protocolo,
          mensagem: "A emissão já está autorizada.",
        });
      }
      return erro(
        bloqueioRascunho.tipo === "bloquear"
          ? bloqueioRascunho.mensagem
          : `Esta venda já possui uma NFC-e de contingência com status ${bloqueioRascunho.emissao.status}. Resolva esse documento antes de gerar outro.`,
        409,
        {
          emissao_id: bloqueioRascunho.emissao.id,
          status: bloqueioRascunho.emissao.status,
          podeConsultarNovamente: true,
          podeRetransmitir: false,
        }
      );
    }

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
        (item) =>
          item.error
      )?.error;

    if (
      erroSnapshot
    ) {
      return erro(
        `Não foi possível congelar os dados fiscais: ${erroSnapshot.message}`,
        500
      );
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
            "65",
          p_serie:
            numeracao.serie,
          p_ambiente:
            Number(
              ambiente
            ),
          p_chave_idempotencia:
            chaveContingencia(
              vendaId
            ),
          p_origem_tipo:
            "venda",
          p_origem_id:
            vendaId,
        }
      );

    if (
      reservaError
    ) {
      return erro(
        `Falha ao reservar numeração NFC-e: ${reservaError.message}`,
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
      !reserva?.emissao_id
    ) {
      return erro(
        "A reserva fiscal não retornou uma emissão válida.",
        500
      );
    }

    const emissaoId =
      reserva.emissao_id;

    const {
      data: emissao,
      error: emissaoError,
    } =
      await admin
        .from(
          "fiscal_emissoes"
        )
        .select(`
          id,
          status,
          serie,
          numero,
          ambiente,
          codigo_numerico,
          chave_acesso,
          protocolo,
          cstat
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
      emissaoError ||
      !emissao
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

    await admin
      .from(
        "fiscal_emissoes"
      )
      .update({
        tipo_emissao:
          "contingencia_offline",
        contingencia_justificativa:
          justificativa,
        contingencia_erro:
          null,
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
      emissao.status ===
      "autorizada"
    ) {
      return json({
        ok: true,
        autorizada:
          true,
        contingencia:
          false,
        emissao_id:
          emissaoId,
        serie:
          emissao.serie,
        numero:
          String(
            emissao.numero
          ),
        chave:
          emissao
            .chave_acesso,
        protocolo:
          emissao.protocolo,
        mensagem:
          "A emissão já está autorizada.",
      });
    }

    if (
      emissao.status !==
      "reservada"
    ) {
      return erro(
        `A emissão reservada está com status ${emissao.status} e não pode iniciar contingência.`,
        409,
        {
          emissao_id:
            emissaoId,
        }
      );
    }

    const primeiroPagamento =
      pagamentosConfirmados[0];
    const itemNfce = itensFiscais[0];
    if (!itemNfce) {
      return erro("A venda não possui itens.");
    }

    const payloadBase =
      montarPayloadNfceGeranet({
        emitente: {
          logomarca:
            await obterLogomarcaFiscalHex(
              String(empresaId)
            ),
          cnpj:
            empresa.cnpj,
          inscricaoEstadual:
            ie,
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
          uf,
          cep:
            fiscal.cep,
          codigoRegimeTributario,
          tipoAtividade:
            texto(
              fiscal
                .tipo_atividade
            ) ||
            "3",
          informacaoComplementar:
            fiscal
              .informacao_complementar_padrao,
        },

        config: {
          ambiente,
          serie:
            emissao.serie,
          numeroNota:
            emissao.numero,
          idCsc,
          indicadorPresenca:
            String(
              fiscal
                .indicador_presenca_padrao
            ),
          indicativoIntermediador:
            String(
              fiscal
                .indicativo_intermediador_padrao
            ),
          naturezaOperacao:
            fiscal
              .natureza_operacao_padrao,
          informacaoComplementar:
            texto(
              venda.observacao
            ) ||
            fiscal
              .informacao_complementar_padrao,
          dataEmissao:
            dataHoraFiscal,
          dataSaida:
            dataHoraFiscal,
          fusoHorario:
            fuso,
        },

        segredos,

        item: itemNfce,

        pagamento: {
          tipo:
            texto(
              primeiroPagamento
                .codigo_fiscal
            ),
          valor:
            numero(
              primeiroPagamento.valor
            ),
          indicadorPagamento:
            texto(
              primeiroPagamento
                .indicador_pagamento
            ) ===
              "1"
              ? "1"
              : "0",
          troco,
        },

        codigoNumerico:
          emissao
            .codigo_numerico,
      });

    const payload =
      payloadBase as
        unknown as
        PayloadNfceMutavel;

    // --------------------------------------------------------
    // CSC / QR-Code NFC-e
    // Geranet documenta o par em dois pontos do payload:
    //   payload.idCsc / payload.csc
    //   nfe.empresa.idCodigoSegurancaContribuinte /
    //   nfe.empresa.codigoSegurancaContribuinte
    //
    // Não logar nem retornar o CSC.
    // --------------------------------------------------------
    payload.idCsc =
      idCsc;

    payload.csc =
      csc;

    if (
      !payload.nfe ||
      !payload.nfe.empresa
    ) {
      return erro(
        "O builder NFC-e não retornou nfe.empresa. Nada foi transmitido.",
        500,
        {
          emissao_id:
            emissaoId,
        }
      );
    }

    payload.nfe.empresa
      .idCodigoSegurancaContribuinte =
      idCsc.padStart(
        5,
        "0"
      );

    payload.nfe.empresa
      .codigoSegurancaContribuinte =
      csc;

    payload.nfe.itens =
      itensFiscais;

    payload.nfe.pagamento = {
      troco,
      detalhamento:
        pagamentosConfirmados.map(
          (pagamento) => ({
            tipo:
              texto(
                pagamento
                  .codigo_fiscal
              ),
            valor:
              numero(
                pagamento.valor
              ),
            indicadorPagamento:
              texto(
                pagamento
                  .indicador_pagamento
              ) ===
                "1"
                ? "1"
                : "0",
          })
        ),
    };

    aplicarContingenciaContratoGeranet(
      payload.nfe,
      "sim",
      justificativa
    );

    payload.nfe.numeroVenda =
      texto(
        venda.numero
      );

    const diagnosticoTotal = aplicarValorTotalNotaGeranet({
      modelo: "65",
      nfe: payload.nfe,
      itensFiscais,
    });

    const claim = await claimTentativaEmissaoFiscal({
      admin,
      empresaId,
      emissaoId,
      usuarioId: String(claims.claims.sub),
      payload,
      snapshotItens: snapshotItensDaTransmissao(itensFiscais),
    });

    if (!claim.ok) {
      return erro(
        claim.motivo === "erro"
          ? claim.mensagem
          : MENSAGEM_BLOQUEIO_RETRANSMISSAO,
        claim.motivo === "erro" ? 500 : 409,
        {
          emissao_id: emissaoId,
          podeConsultarNovamente: true,
          podeRetransmitir: false,
        }
      );
    }

    const tentativaId = claim.tentativaId;

    let resultado:
      Awaited<
        ReturnType<
          typeof chamarGeranet
        >
      >;

    try {
      resultado =
        await chamarGeranet({
          apiKey,
          endpoint:
            "/api/v1/nfe/emitir",
          payload,
          timeoutMs:
            45_000,
        });
    } catch (
      error
    ) {
      const persistencia =
        persistenciaFalhaComunicacaoEmitir(error);

      await admin
        .from(
          "fiscal_emissoes"
        )
        .update({
          status:
            persistencia.status,
          tipo_emissao:
            "contingencia_offline",
          contingencia_justificativa:
            justificativa,
          contingencia_erro:
            persistencia.motivo,
          erro_comunicacao:
            persistencia.motivo,
          motivo: persistencia.motivo,
          resposta_resumo: {
            classificacao: persistencia.classificacaoResumo,
          },
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
        motivo: persistencia.motivo,
        resposta: {
          erro: persistencia.motivo,
          classificacao: persistencia.classificacaoResumo,
        },
        classificacaoInicial: persistencia.status,
      });

      await evento(
        admin,
        empresaId,
        emissaoId,
        "comunicacao_ambigua",
        {
          fase:
            "geracao_contingencia",
          motivo: persistencia.motivo,
        }
      );

      return erro(
        persistencia.retransmitir
          ? `${persistencia.motivo} A mesma NFC-e em contingência pode ser gerada novamente sem novo número.`
          : `${persistencia.motivo}\n\n${MENSAGEM_BLOQUEIO_RETRANSMISSAO}`,
        502,
        {
          emissao_id:
            emissaoId,
          status:
            persistencia.status,
          podeConsultarNovamente: true,
          podeRetransmitir: persistencia.retransmitir,
        }
      );
    }

    const geranet =
      resultado.dados;

    const situacao =
      texto(
        geranet.situacao
      )
        .toLowerCase();

    const mensagem =
      texto(
        geranet.mensagem
      );

    const chave =
      texto(
        geranet.chave
      );

    const protocolo =
      texto(
        geranet.protocolo
      );

    const cstat =
      texto(
        geranet.cstat
      );

    const xml =
      texto(
        geranet.xml
      );

    const pdf =
      texto(
        geranet.pdf
      );

    const agora =
      new Date()
        .toISOString();

    const autorizadaImediatamente =
      resultado.httpStatus ===
        200 &&
      resultado.httpOk &&
      situacao ===
        "sucesso" &&
      /^\d{44}$/.test(
        chave
      ) &&
      Boolean(
        protocolo
      );

    if (
      autorizadaImediatamente
    ) {
      await admin
        .from(
          "fiscal_emissoes"
        )
        .update({
          status:
            "autorizada",
          tipo_emissao:
            "contingencia_offline",
          contingencia_justificativa:
            justificativa,
          contingencia_gerada_at:
            agora,
          contingencia_transmitida_at:
            agora,
          contingencia_erro:
            null,
          chave_acesso:
            chave,
          protocolo,
          cstat:
            cstat ||
            null,
          motivo:
            mensagem ||
            "Autorizado o uso da NFC-e.",
          geranet_http_status:
            resultado
              .httpStatus,
          geranet_situacao:
            texto(
              geranet.situacao
            ) ||
            null,
          resposta_resumo:
            resultado.resumo,
          xml_hex:
            xml ||
            null,
          pdf_hex:
            pdf ||
            null,
          xml_contingencia_hex:
            xml ||
            null,
          pdf_contingencia_hex:
            pdf ||
            null,
          erro_comunicacao:
            null,
          respondida_at:
            agora,
          autorizada_at:
            agora,
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
        httpStatus: resultado.httpStatus,
        cstat,
        motivo: mensagem,
        geranetLogId: geranetLogIdDe(geranet),
        resposta: resultado.resumo,
        xmlHex: xml || null,
        pdfHex: pdf || null,
        classificacaoInicial: "autorizada",
      });

      await evento(
        admin,
        empresaId,
        emissaoId,
        "autorizada",
        {
          http_status:
            resultado
              .httpStatus,
          chave,
          protocolo,
          cstat:
            cstat ||
            null,
        }
      );

      return json({
        ok: true,
        contingencia:
          false,
        autorizada:
          true,
        emissao_id:
          emissaoId,
        serie:
          emissao.serie,
        numero:
          String(
            emissao.numero
          ),
        chave,
        protocolo,
        cstat:
          cstat ||
          null,
        mensagem:
          mensagem ||
          "A SEFAZ voltou a responder e a NFC-e foi autorizada imediatamente.",
      });
    }

    if (
      resultado.httpStatus ===
        202 &&
      resultado.httpOk &&
      xml
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
              "aguardando_transmissao_contingencia",
            tipo_emissao:
              "contingencia_offline",
            contingencia_justificativa:
              justificativa,
            contingencia_gerada_at:
              agora,
            contingencia_erro:
              null,
            chave_acesso:
              /^\d{44}$/.test(
                chave
              )
                ? chave
                : null,
            cstat:
              cstat ||
              null,
            motivo:
              mensagem ||
              "NFC-e gerada em contingência offline; aguardando transmissão à SEFAZ.",
            geranet_http_status:
              202,
            geranet_situacao:
              texto(
                geranet.situacao
              ) ||
              null,
            resposta_resumo:
              resultado.resumo,
            xml_contingencia_hex:
              xml,
            pdf_contingencia_hex:
              pdf ||
              null,
            xml_hex:
              xml,
            pdf_hex:
              pdf ||
              null,
            erro_comunicacao:
              null,
            respondida_at:
              agora,
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
          "A Geranet gerou a NFC-e de contingência, mas houve falha ao persistir o XML local. NÃO gere outra nota.",
          500,
          {
            emissao_id:
              emissaoId,
          }
        );
      }

      await registrarRespostaTentativaFiscal({
        admin,
        empresaId,
        tentativaId,
        httpStatus: 202,
        cstat,
        motivo: mensagem,
        geranetLogId: geranetLogIdDe(geranet),
        resposta: resultado.resumo,
        xmlHex: xml || null,
        pdfHex: pdf || null,
        classificacaoInicial: "aguardando_transmissao_contingencia",
      });

      await evento(
        admin,
        empresaId,
        emissaoId,
        "gerada",
        {
          http_status:
            202,
          chave:
            /^\d{44}$/.test(
              chave
            )
              ? chave
              : null,
          possui_pdf:
            Boolean(
              pdf
            ),
        }
      );

      return json(
        {
          ok: true,
          contingencia:
            true,
          autorizada:
            false,
          emissao_id:
            emissaoId,
          serie:
            emissao.serie,
          numero:
            String(
              emissao.numero
            ),
          chave:
            /^\d{44}$/.test(
              chave
            )
              ? chave
              : null,
          status:
            "aguardando_transmissao_contingencia",
          mensagem:
            "NFC-e gerada em contingência offline. O XML ainda NÃO está autorizado e deve ser transmitido posteriormente à SEFAZ.",
          danfe_url:
            pdf
              ? `/api/fiscal/contingencia/${emissaoId}/arquivo?tipo=pdf`
              : null,
        },
        202
      );
    }

    const rejeicaoExplicita = ehRejeicaoFiscalReal({
      httpOk: resultado.httpOk,
      httpStatus: resultado.httpStatus,
      situacao,
      cstat,
      mensagem,
    });

    if (
      rejeicaoExplicita
    ) {
      await admin
        .from(
          "fiscal_emissoes"
        )
        .update({
          status:
            "rejeitada",
          tipo_emissao:
            "contingencia_offline",
          contingencia_justificativa:
            justificativa,
          contingencia_erro:
            mensagem ||
            "Geranet rejeitou a geração de contingência.",
          geranet_http_status:
            resultado
              .httpStatus,
          geranet_situacao:
            texto(
              geranet.situacao
            ) ||
            null,
          cstat:
            cstat ||
            null,
          motivo:
            mensagem ||
            "Geranet rejeitou a geração de contingência.",
          resposta_resumo:
            resultado.resumo,
          xml_hex:
            xml ||
            null,
          pdf_hex:
            pdf ||
            null,
          respondida_at:
            agora,
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
        httpStatus: resultado.httpStatus,
        cstat,
        motivo: mensagem,
        geranetLogId: geranetLogIdDe(geranet),
        resposta: resultado.resumo,
        xmlHex: xml || null,
        pdfHex: pdf || null,
        classificacaoInicial: "rejeitada",
      });

      await evento(
        admin,
        empresaId,
        emissaoId,
        "rejeitada",
        {
          http_status:
            resultado
              .httpStatus,
          cstat:
            cstat ||
            null,
          mensagem:
            mensagem ||
            null,
        }
      );

      return erro(
        mensagem ||
        "A Geranet rejeitou a geração da NFC-e em contingência.",
        422,
        {
          emissao_id:
            emissaoId,
          cstat:
            cstat ||
            null,
          diagnostico_total:
            diagnosticoTotal,
        }
      );
    }

    const motivoAmbiguo =
      mensagem ||
      `Resposta não conclusiva da Geranet (HTTP ${resultado.httpStatus}).`;

    await admin
      .from(
        "fiscal_emissoes"
      )
      .update({
        status:
          "aguardando_reconciliacao",
        tipo_emissao:
          "contingencia_offline",
        contingencia_justificativa:
          justificativa,
        contingencia_erro:
          motivoAmbiguo,
        geranet_http_status:
          resultado
            .httpStatus,
        geranet_situacao:
          texto(
            geranet.situacao
          ) ||
          null,
        motivo:
          motivoAmbiguo,
        resposta_resumo:
          resultado.resumo,
        xml_contingencia_hex:
          xml ||
          null,
        pdf_contingencia_hex:
          pdf ||
          null,
        respondida_at:
          agora,
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
      httpStatus: resultado.httpStatus,
      cstat,
      motivo: motivoAmbiguo,
      geranetLogId: geranetLogIdDe(geranet),
      resposta: resultado.resumo,
      xmlHex: xml || null,
      pdfHex: pdf || null,
      classificacaoInicial: "aguardando_reconciliacao",
    });

    await evento(
      admin,
      empresaId,
      emissaoId,
      "comunicacao_ambigua",
      {
        http_status:
          resultado
            .httpStatus,
        situacao:
          texto(
            geranet.situacao
          ) ||
          null,
        mensagem:
          mensagem ||
          null,
      }
    );

    return erro(
      `${motivoAmbiguo} Não gere outra NFC-e até reconciliar.`,
      409,
      {
        emissao_id:
          emissaoId,
        status:
          "aguardando_reconciliacao",
      }
    );
  } catch (
    error
  ) {
    console.error(
      "[NFCE CONTINGENCIA VENDA]",
      error
    );

    return erro(
      error instanceof Error
        ? error.message
        : "Erro interno ao gerar NFC-e em contingência.",
      500
    );
  }
}
