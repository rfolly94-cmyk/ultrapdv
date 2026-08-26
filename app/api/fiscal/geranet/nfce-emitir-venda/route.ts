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
  ErroAssinaturaRestrita,
  exigirEmpresaOperacional,
} from "@/lib/assinatura/exigir-empresa-operacional";

import {
  montarItemGeranet,
  type ItemGeranet,
  type OperacaoFiscal,
} from "@/lib/fiscal/geranet/montar-item";
import {
  resolverTributacaoItemVenda,
  snapshotTributarioItemCompleto,
  vendaTemTributacaoItensCongelada,
} from "@/lib/fiscal/snapshot-tributario-venda";

import {
  montarPayloadNfceGeranet,
  type SegredosFiscaisGeranet,
} from "@/lib/fiscal/geranet/montar-payload-nfce";
import { obterLogomarcaFiscalHex } from "@/lib/empresa/obter-logomarca-fiscal-hex";

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
  patchEmissaoFalhaComunicacao,
} from "@/lib/fiscal/geranet/cliente-geranet";
import {
  classificarRespostaEmitir,
  emissaoBloqueiaRetransmissao,
  emissaoPodeRetentarEnvio,
  historicoErroTecnico,
  mensagemFalhaConsultaSefaz,
  mensagemResultadoRemotoNaoConclusivo,
  MENSAGEM_BLOQUEIO_RETRANSMISSAO,
  nfce65DeveApenasReconciliar,
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

type Body = {
  confirmar?: string;
  venda_id?: string;
  serie?: number | string;
};

type PayloadNfceMutavel = {
  idCsc?: string;
  csc?: string;
  nfe?: {
    empresa?: Record<string, unknown>;
    itens?: unknown[];
    pagamento?: {
      troco?: number;
      detalhamento?: Array<{
        tipo: string;
        valor: number;
        indicadorPagamento: "0" | "1";
      }>;
    };
    numeroVenda?: string;
    valorTotal?: string;
  };
  [key: string]: unknown;
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
  extra?: Record<string, unknown>
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

  const n = Number(valor);

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
  valores: Array<string | null | undefined>
) {
  return Array.from(
    new Set(
      valores.filter(
        (valor): valor is string =>
          typeof valor === "string" &&
          valor.length > 0
      )
    )
  );
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
      !claimsData?.claims?.sub
    ) {
      return erro(
        "Não autenticado.",
        401
      );
    }

    const { data: vinculo } =
      await supabase
        .from("usuarios_empresas")
        .select("empresa_id")
        .eq("usuario_id", String(claimsData.claims.sub))
        .eq("principal", true)
        .eq("ativo", true)
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
        origem: "nfce-emitir-venda",
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
        "EMITIR_NFCE_VENDA_HOMOLOGACAO",
        "EMITIR_NFCE_VENDA_PRODUCAO",
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
      texto(body.venda_id);

    if (!uuidValido(vendaId)) {
      return erro(
        "venda_id inválido.",
        400
      );
    }

    const idempotencyKey =
      texto(
        request.headers.get(
          "Idempotency-Key"
        )
      );

    if (
      idempotencyKey !== vendaId
    ) {
      return erro(
        "O header Idempotency-Key deve ser exatamente o UUID da venda.",
        400
      );
    }

    // Tudo é validado antes da reserva fiscal.
    const [
      vendaResult,
      itensResult,
      pagamentosResult,
      empresaResult,
      fiscalResult,
      nfceResult,
      numeracoesResult,
      segredosResult,
    ] = await Promise.all([
      supabase
        .from("vendas")
        .select(`
          id,
          numero,
          status,
          modelo_fiscal_intencao,
          valor_produtos,
          desconto,
          valor_total,
          troco,
          acrescimo,
          frete,
          snapshot_fiscal
        `)
        .eq("empresa_id", empresaId)
        .eq("id", vendaId)
        .maybeSingle(),

      supabase
        .from("vendas_itens")
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
          snapshot_fiscal
        `)
        .eq("empresa_id", empresaId)
        .eq("venda_id", vendaId)
        .order("created_at", {
          ascending: true,
        }),

      supabase
        .from("vendas_pagamentos")
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
        .eq("empresa_id", empresaId)
        .eq("venda_id", vendaId)
        .order("created_at", {
          ascending: true,
        }),

      supabase
        .from("empresas")
        .select(`
          id,
          razao_social,
          nome_fantasia,
          cnpj,
          ativo
        `)
        .eq("id", empresaId)
        .maybeSingle(),

      supabase
        .from("empresas_fiscal")
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
        .eq("empresa_id", empresaId)
        .maybeSingle(),

      supabase
        .from("fiscal_nfce_config")
        .select(`
          id,
          id_csc,
          csc_configurado,
          ativo
        `)
        .eq("empresa_id", empresaId)
        .eq("ativo", true)
        .limit(2),

      supabase
        .from("fiscal_numeracoes")
        .select(`
          id,
          modelo,
          ambiente,
          serie,
          proximo_numero,
          ativo
        `)
        .eq("empresa_id", empresaId)
        .eq("modelo", "65")
        .eq("ativo", true)
        .order("serie", {
          ascending: true,
        }),

      admin.rpc(
        "obter_segredos_fiscais",
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
      nfceResult.error ??
      numeracoesResult.error;

    if (primeiroErro) {
      return erro(
        primeiroErro.message,
        500
      );
    }

    if (segredosResult.error) {
      return erro(
        "Não foi possível ler os segredos fiscais.",
        500
      );
    }

    const venda =
      vendaResult.data;

    const itensVenda =
      itensResult.data ?? [];

    const pagamentos =
      pagamentosResult.data ?? [];

    const empresa =
      empresaResult.data;

    const fiscal =
      fiscalResult.data;

    const nfceConfigs =
      nfceResult.data ?? [];

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
      (segredosResult.data ?? {}) as
        SegredosFiscaisGeranet;

    if (!venda) {
      return erro(
        "Venda não encontrada.",
        404
      );
    }

    if (
      venda.status !== "finalizada"
    ) {
      return erro(
        "Somente venda finalizada pode emitir NFC-e."
      );
    }

    if (
      venda.modelo_fiscal_intencao ===
      "55"
    ) {
      return erro(
        "Esta venda está marcada para NF-e modelo 55."
      );
    }

    if (
      numero(venda.acrescimo) > 0 ||
      numero(venda.frete) > 0
    ) {
      return erro(
        "Esta etapa ainda não transmite vendas com acréscimo ou frete."
      );
    }

    if (
      itensVenda.length === 0
    ) {
      return erro(
        "A venda não possui itens."
      );
    }

    if (
      itensVenda.some(
        (item) =>
          numero(item.acrescimo) > 0
      )
    ) {
      return erro(
        "Esta etapa ainda não transmite acréscimo por item."
      );
    }

    const pagamentosConfirmados =
      filtrarPagamentosFinanceiros(
        pagamentos
      );

    if (
      pagamentosConfirmados.length === 0
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
            pagamento.forma_pagamento_nome ??
            pagamento.forma_pagamento_codigo ??
            pagamento.id
          } sem tPag válido.`
        );
      }

      if (
        !["0", "1"].includes(
          texto(
            pagamento.indicador_pagamento
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
        modelo: "65",
        pagamentos: pagamentosConfirmados,
      });

    if (bloqueioEletronico) {
      return erro(bloqueioEletronico);
    }

    const trocoVenda =
      numero(venda.troco);

    const conferencia =
      conferenciaFinanceiraVenda({
        valorTotal: venda.valor_total,
        pagamentos,
        troco: venda.troco,
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
        "Configuração fiscal não encontrada ou inativa."
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

    let dataHoraFiscal: string;

    try {
      dataHoraFiscal =
        formatarDataHoraGeranet(
          new Date(),
          fusoHorario
        );
    } catch (e) {
      return erro(
        e instanceof Error
          ? e.message
          : "Fuso horário fiscal inválido."
      );
    }

    if (
      nfceConfigs.length !== 1
    ) {
      return erro(
        "Deve existir exatamente uma configuração NFC-e ativa."
      );
    }

    const nfceConfig =
      nfceConfigs[0];

    const idCsc =
      texto(
        nfceConfig.id_csc
      );

    if (
      !/^\d{1,6}$/.test(
        idCsc
      ) ||
      Number(idCsc) <= 0 ||
      !nfceConfig.csc_configurado
    ) {
      return erro(
        "CSC/ID CSC não está pronto."
      );
    }

    const apiKey =
      texto(
        segredos.geranet_api_key
      );

    const certificado =
      texto(
        segredos.certificado_a1
      );

    const senhaCertificado =
      texto(
        segredos.senha_certificado
      );

    const csc =
      texto(segredos.csc);

    if (
      !apiKey ||
      !certificado ||
      !senhaCertificado ||
      !csc
    ) {
      return erro(
        "Segredos fiscais incompletos."
      );
    }

    const serieInformada =
      body.serie === undefined
        ? null
        : Number(body.serie);

    let numeracao:
      | (typeof numeracoes)[number]
      | undefined;

    if (
      serieInformada !== null
    ) {
      if (
        !Number.isInteger(
          serieInformada
        ) ||
        serieInformada <= 0
      ) {
        return erro(
          "Série inválida."
        );
      }

      numeracao =
        numeracoes.find(
          (item) =>
            item.serie ===
            serieInformada
        );
    } else if (
      numeracoes.length === 1
    ) {
      numeracao =
        numeracoes[0];
    }

    if (!numeracao) {
      return erro(
        numeracoes.length > 1
          ? "Há mais de uma série NFC-e ativa."
          : "Numeração NFC-e ativa não encontrada."
      );
    }

    const ie =
      texto(
        fiscal.inscricao_estadual
      );

    const uf =
      texto(
        fiscal.uf
      ).toUpperCase();

    const crt =
      Number(
        fiscal.codigo_regime_tributario
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

    if (!ie) {
      return erro(
        "Inscrição Estadual não configurada."
      );
    }

    if (
      !/^[A-Z]{2}$/.test(uf)
    ) {
      return erro(
        "UF do emitente inválida."
      );
    }

    if (
      ![1, 2, 3].includes(crt)
    ) {
      return erro(
        "CRT não suportado pelo motor Geranet atual."
      );
    }

    if (
      somenteDigitos(
        fiscal.cep
      ).length !== 8 ||
      !texto(fiscal.logradouro) ||
      !texto(fiscal.numero) ||
      !texto(fiscal.bairro) ||
      !texto(fiscal.municipio) ||
      !texto(
        fiscal.codigo_municipio_ibge
      ) ||
      !texto(
        fiscal.natureza_operacao_padrao
      )
    ) {
      return erro(
        "Endereço/natureza fiscal do emitente está incompleto."
      );
    }

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
    ] = await Promise.all([
      supabase
        .from("produtos")
        .select(`
          id,
          codigo_barras,
          tipo_item,
          grupo_fiscal_id,
          ativo
        `)
        .eq("empresa_id", empresaId)
        .in("id", produtoIds),

      supabase
        .from("produtos_fiscal")
        .select(`
          produto_id,
          ncm,
          cest,
          origem_produto
        `)
        .eq("empresa_id", empresaId)
        .in("produto_id", produtoIds),
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
        .from("grupos_fiscais")
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

    const produtosMap =
      new Map(
        (produtosResult.data ?? [])
          .map(
            (produto) => [
              produto.id,
              produto,
            ] as const
          )
      );

    const fiscalMap =
      new Map(
        (produtosFiscalResult.data ?? [])
          .map(
            (item) => [
              item.produto_id,
              item,
            ] as const
          )
      );

    const gruposMap =
      new Map(
        (grupos ?? [])
          .map(
            (grupo) => [
              grupo.id,
              grupo,
            ] as const
          )
      );

    const ambiente:
      AmbienteGeranet =
      Number(
        fiscal.ambiente
      ) === 1
        ? "1"
        : "2";

    const confirmacaoEsperada =
      ambiente === "1"
        ? "EMITIR_NFCE_VENDA_PRODUCAO"
        : "EMITIR_NFCE_VENDA_HOMOLOGACAO";

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
      crt as CodigoRegimeTributario;

    const operacao:
      OperacaoFiscal = "interna";

    const itensFiscais: ItemGeranet[] = [];

    const snapshots:
      Array<{
        id: string;
        persistirFallback: boolean;
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

    const vendaTributacaoCongelada =
      vendaTemTributacaoItensCongelada(
        venda.snapshot_fiscal
      );

    for (
      const [indice, itemVenda]
      of itensVenda.entries()
    ) {
      const produto =
        produtosMap.get(
          itemVenda.produto_id
        );

      const snapshotCompleto =
        snapshotTributarioItemCompleto(
          itemVenda.snapshot_fiscal
        );

      if (
        !snapshotCompleto &&
        (
          !produto ||
          !produto.ativo
        )
      ) {
        return erro(
          `Produto do item ${indice + 1} não encontrado ou inativo.`
        );
      }

      const fiscalAtual =
        fiscalMap.get(
          itemVenda.produto_id
        );

      const grupoId =
        itemVenda.grupo_fiscal_id ??
        produto?.grupo_fiscal_id;

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
          fiscalProduto: fiscalAtual,
          grupo,
          vendaTributacaoCongelada,
          tipoDestino: operacao,
          indiceItem: indice + 1,
        });

      if (!tributacao.ok) {
        return erro(tributacao.mensagem);
      }

      const ncm = tributacao.valor.ncm;
      const cest = tributacao.valor.cest;
      const origemProduto = tributacao.valor.origemProduto;
      const cfop = tributacao.valor.cfop;
      const icms = tributacao.valor.icms;
      const pis = tributacao.valor.pis;
      const cofins = tributacao.valor.cofins;

      const {
        item,
      } = montarItemGeranet({
        produto: {
          codigo:
            itemVenda.produto_codigo,
          codigoBarras:
            tributacao.valor.codigoBarras ??
            produto?.codigo_barras,
          nome:
            itemVenda.produto_nome,
          unidadeMedida:
            itemVenda.unidade_medida,
          tipoItem:
            tributacao.valor.tipoItem ??
            produto?.tipo_item,
          // Usa o preço congelado da venda.
          precoVenda:
            itemVenda.valor_unitario,
        },

        fiscal: {
          ncm,
          cest,
          origemProduto,
        },

        grupo: tributacao.valor.grupoGeranet,

        modelo: "65",
        perfilIpi: null,
        codigoRegimeTributario,
        ambiente,
        forcarIbscbsHomologacao:
          false,
        dataEmissao:
          new Date().toISOString(),
        operacao,
        quantidade:
          numero(
            itemVenda.quantidade
          ),
        desconto:
          descontosFiscais.get(itemVenda.id) ??
          numero(itemVenda.desconto),
      });

      const descontoFiscal =
        descontosFiscais.get(itemVenda.id) ??
        numero(itemVenda.desconto);
      const brutoEsperado = valorBrutoItemEmCentavos({
        quantidade: numero(itemVenda.quantidade),
        valorUnitario: numero(itemVenda.valor_unitario),
      });
      const liquidoEsperado = valorLiquidoFiscalEmCentavos({
        quantidade: numero(itemVenda.quantidade),
        valorUnitario: numero(itemVenda.valor_unitario),
        desconto: descontoFiscal,
      });

      if (
        paraCentavos(item.valorTotal) !== brutoEsperado ||
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
        valorTotalVenda: numero(venda.valor_total),
      });

    if (divergenciaTotais) {
      return erro(divergenciaTotais);
    }

    const emissaoPrevia = await carregarEmissaoPorChaveIdempotencia(
      admin,
      empresaId,
      vendaId
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
        mensagem: "Esta venda já possui NFC-e autorizada.",
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
      return erro(bloqueioRascunho.mensagem, 409, {
        emissao_id: bloqueioRascunho.emissao.id,
        status: bloqueioRascunho.emissao.status,
        podeConsultarNovamente: true,
        podeRetransmitir: false,
      });
    }

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
        `Não foi possível congelar os dados fiscais da NFC-e: ${erroSnapshot.message}`,
        500
      );
    }

    // A venda é a chave de idempotência e a origem fiscal.
    const {
      data: reservaData,
      error: reservaError,
    } = await admin.rpc(
      "rpc_reservar_emissao_fiscal",
      {
        p_empresa_id:
          empresaId,
        p_modelo: "65",
        p_serie:
          numeracao.serie,
        p_ambiente:
            Number(ambiente),
        p_chave_idempotencia:
          vendaId,
        p_origem_tipo:
          "venda",
        p_origem_id:
          vendaId,
      }
    );

    if (reservaError) {
      return erro(
        `Falha ao reservar numeração: ${reservaError.message}`,
        500
      );
    }

    const reserva =
      Array.isArray(reservaData)
        ? reservaData[0]
        : reservaData;

    if (!reserva?.emissao_id) {
      return erro(
        "A reserva fiscal não retornou uma emissão válida.",
        500
      );
    }

    const emissaoId =
      reserva.emissao_id;

    const {
      data: emissaoAtual,
      error: emissaoAtualError,
    } = await admin
      .from("fiscal_emissoes")
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
        geranet_situacao,
        erro_comunicacao,
        resposta_resumo
      `)
      .eq("id", emissaoId)
      .eq("empresa_id", empresaId)
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
      emissaoAtual.status ===
      "autorizada"
    ) {
      return json({
        ok: true,
        autorizada: true,
        reutilizada: true,
        emissao_id:
          emissaoAtual.id,
        serie:
          emissaoAtual.serie,
        numero:
          String(
            emissaoAtual.numero
          ),
        chave:
          emissaoAtual.chave_acesso,
        protocolo:
          emissaoAtual.protocolo,
        cstat:
          emissaoAtual.cstat,
        mensagem:
          "Esta venda já possui NFC-e autorizada.",
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

    // Só esta venda/emissão. NFC-e em conciliação de outra venda não entra aqui.
    if (
      nfce65DeveApenasReconciliar(emissaoAtual) ||
      emissaoBloqueiaRetransmissao(emissaoAtual)
    ) {
      return erro(
        MENSAGEM_BLOQUEIO_RETRANSMISSAO,
        409,
        {
          emissao_id: emissaoId,
          status: emissaoAtual.status,
          podeConsultarNovamente: true,
          podeRetransmitir: false,
        }
      );
    }

    if (
      emissaoPodeRetentarEnvio(emissaoAtual) &&
      !nfce65DeveApenasReconciliar(emissaoAtual) &&
      emissaoAtual.status !== "reservada" &&
      emissaoAtual.status !== "rejeitada" &&
      emissaoAtual.status !== "aguardando_reconciliacao"
    ) {
      const { error: resetError } = await admin
        .from("fiscal_emissoes")
        .update({
          status: "reservada",
          erro_comunicacao: null,
        })
        .eq("id", emissaoId)
        .eq("empresa_id", empresaId);

      if (resetError) {
        return erro(
          `Não foi possível reabrir a mesma reserva fiscal: ${resetError.message}`,
          500,
          { emissao_id: emissaoId }
        );
      }
    }

    // Monta com o builder atual e expande somente os arrays.
    const primeiroPagamento =
      pagamentosConfirmados[0];
    const itemNfce = itensFiscais[0];
    if (!itemNfce) {
      return erro("A venda não possui itens.");
    }

    const payload =
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
            empresa.razao_social,
          nomeFantasia:
            empresa.nome_fantasia,
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
            fiscal.codigo_municipio_ibge,
          uf,
          cep:
            fiscal.cep,
          codigoRegimeTributario,
          tipoAtividade:
            texto(
              fiscal.tipo_atividade
            ) || "3",
          informacaoComplementar:
            fiscal.informacao_complementar_padrao,
        },

        config: {
          ambiente,
          serie:
            emissaoAtual.serie,
          numeroNota:
            emissaoAtual.numero,
          idCsc,
          indicadorPresenca:
            String(
              fiscal.indicador_presenca_padrao
            ),
          indicativoIntermediador:
            String(
              fiscal.indicativo_intermediador_padrao
            ),
          naturezaOperacao:
            fiscal.natureza_operacao_padrao,
          informacaoComplementar:
            fiscal.informacao_complementar_padrao,
          dataEmissao:
            dataHoraFiscal,
          dataSaida:
            dataHoraFiscal,
          fusoHorario:
            fusoHorario,
        },

        segredos,
        item: itemNfce,
        pagamento: {
          tipo:
            texto(
              primeiroPagamento.codigo_fiscal
            ),
          valor:
            numero(
              primeiroPagamento.valor
            ),
          indicadorPagamento:
            texto(
              primeiroPagamento.indicador_pagamento
            ) as "0" | "1",
          troco:
            trocoVenda,
        },
        codigoNumerico:
          emissaoAtual.codigo_numerico,
        snapshotFiscal: venda.snapshot_fiscal,
      }) as PayloadNfceMutavel;


    // --------------------------------------------------------
    // CSC / QR-Code NFC-e
    // O OpenAPI atual da Geranet exige idCsc + csc no topo
    // para NFC-e e o exemplo oficial também replica o par
    // dentro de nfe.empresa.
    //
    // Forçamos os quatro campos a partir da MESMA origem para
    // impedir divergência entre o ID/token usado no QR-Code.
    // Nunca registrar o valor do CSC em log/resposta.
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
        "O builder NFC-e não retornou nfe.empresa. Nada foi transmitido; mantenha esta mesma venda para o retry.",
        500,
        {
          emissao_id:
            emissaoId,
          numero:
            String(
              emissaoAtual.numero
            ),
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

    if (
      !payload.nfe ||
      !Array.isArray(
        payload.nfe.itens
      ) ||
      !payload.nfe.pagamento ||
      !Array.isArray(
        payload.nfe.pagamento.detalhamento
      )
    ) {
      return erro(
        "O builder NFC-e mudou de estrutura. Nada foi transmitido; mantenha esta mesma venda para o retry.",
        500,
        {
          emissao_id:
            emissaoId,
          numero:
            String(
              emissaoAtual.numero
            ),
        }
      );
    }

    payload.nfe.itens =
      itensFiscais;

    payload.nfe.pagamento = {
      troco:
        trocoVenda,
      detalhamento:
        pagamentosConfirmados.map(
          (pagamento) => ({
            tipo:
              texto(
                pagamento.codigo_fiscal
              ),
            valor:
              numero(
                pagamento.valor
              ),
            indicadorPagamento:
              texto(
                pagamento.indicador_pagamento
              ) as "0" | "1",
          })
        ),
    };

    payload.nfe.numeroVenda =
      texto(venda.numero);

    const diagnosticoTotal = aplicarValorTotalNotaGeranet({
      modelo: "65",
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
          contexto: {
            modelo: "65",
            emissao_id: emissaoId,
          },
        });
    } catch (e) {
      const persistencia =
        persistenciaFalhaComunicacaoEmitir(e);

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

      return erro(
        persistencia.retransmitir
          ? `${persistencia.motivo} A mesma NFC-e pode ser enviada novamente sem novo número.`
          : mensagemResultadoRemotoNaoConclusivo("65"),
        persistencia.retransmitir ? 502 : 409,
        {
          emissao_id:
            emissaoId,
          status: persistencia.status,
          classificacao: persistencia.classificacaoResumo,
          podeConsultarNovamente: true,
          podeRetransmitir: persistencia.retransmitir,
        }
      );
    }

    const respostaHttpOk =
      resultadoGeranet.httpOk;

    const respostaHttpStatus =
      resultadoGeranet.httpStatus;

    const geranet =
      resultadoGeranet.dados;

    const resumo =
      resultadoGeranet.resumo;

    const chave =
      texto(geranet.chave);

    const protocolo =
      texto(
        geranet.protocolo
      );

    const situacao =
      texto(
        geranet.situacao
      ).toLowerCase();

    const autorizado =
      respostaHttpOk &&
      situacao === "sucesso" &&
      /^\d{44}$/.test(chave) &&
      protocolo.length > 0;

    if (autorizado) {
      const {
        error: updateError,
      } = await admin
        .from("fiscal_emissoes")
        .update({
          status:
            "autorizada",
          chave_acesso:
            chave,
          protocolo,
          cstat:
            texto(
              geranet.cstat
            ) || null,
          motivo:
            texto(
              geranet.mensagem
            ) || null,
          geranet_http_status:
            respostaHttpStatus,
          geranet_situacao:
            texto(
              geranet.situacao
            ) || null,
          resposta_resumo:
            resumo,
          xml_hex:
            texto(
              geranet.xml
            ) || null,
          pdf_hex:
            texto(
              geranet.pdf
            ) || null,
          erro_comunicacao:
            null,
          respondida_at:
            new Date()
              .toISOString(),
          autorizada_at:
            new Date()
              .toISOString(),
        })
        .eq("id", emissaoId)
        .eq("empresa_id", empresaId);

      if (updateError) {
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
        httpStatus: respostaHttpStatus,
        cstat: geranet.cstat,
        motivo: geranet.mensagem,
        geranetLogId: geranetLogIdDe(geranet),
        resposta: resumo,
        xmlHex: texto(geranet.xml) || null,
        pdfHex: texto(geranet.pdf) || null,
        classificacaoInicial: "autorizada",
      });

      await admin
        .from("vendas")
        .update({
          modelo_fiscal_intencao:
            "65",
        })
        .eq("empresa_id", empresaId)
        .eq("id", vendaId);

      return json({
        ok: true,
        autorizada: true,
        ambiente:
          ambiente === "1"
            ? "producao"
            : "homologacao",
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
            geranet.mensagem
          ) || "Autorizada",
        itens:
          itensFiscais.length,
        pagamentos:
          pagamentosConfirmados.length,
        diagnostico_total:
          diagnosticoTotal,
      });
    }

    const classificacaoEmissao = classificarRespostaEmitir({
      httpOk: respostaHttpOk,
      httpStatus: respostaHttpStatus,
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
      const motivoTecnico =
        texto(geranet.mensagem) || persistencia.mensagemPadrao;

      if (persistencia.status === "aguardando_reconciliacao") {
        console.info("[fiscal] geranet", {
          fase: "RESULTADO_AMBIGUO",
          endpoint: "/api/v1/nfe/emitir",
          modelo: "65",
          emissao_id: emissaoId,
          httpStatus: respostaHttpStatus,
        });
      }

      await admin
        .from("fiscal_emissoes")
        .update({
          status: persistencia.status,
          geranet_http_status:
            respostaHttpStatus,
          geranet_situacao:
            texto(
              geranet.situacao
            ) || null,
          cstat:
            texto(
              geranet.cstat
            ) || null,
          motivo: motivoTecnico,
          erro_comunicacao: motivoTecnico,
          resposta_resumo: {
            ...resumo,
            classificacao: persistencia.classificacaoResumo,
            historico: [historicoErroTecnico(motivoTecnico)],
          },
          xml_hex:
            texto(
              geranet.xml
            ) || null,
          pdf_hex:
            texto(
              geranet.pdf
            ) || null,
          respondida_at:
            new Date()
              .toISOString(),
        })
        .eq("id", emissaoId)
        .eq("empresa_id", empresaId);

      await registrarRespostaTentativaFiscal({
        admin,
        empresaId,
        tentativaId,
        httpStatus: respostaHttpStatus,
        cstat: geranet.cstat,
        motivo: motivoTecnico,
        geranetLogId: geranetLogIdDe(geranet),
        resposta: {
          ...resumo,
          classificacao: persistencia.classificacaoResumo,
        },
        xmlHex: texto(geranet.xml) || null,
        pdfHex: texto(geranet.pdf) || null,
        classificacaoInicial: persistencia.status,
      });

      return erro(
        persistencia.retransmitir
          ? `${motivoTecnico} A mesma NFC-e pode ser enviada novamente sem novo número.`
          : mensagemResultadoRemotoNaoConclusivo("65"),
        persistencia.retransmitir ? 502 : 409,
        {
          emissao_id:
            emissaoId,
          status: persistencia.status,
          podeConsultarNovamente: true,
          podeRetransmitir: persistencia.retransmitir,
          geranet:
            resumo,
        }
      );
    }

    await admin
      .from("fiscal_emissoes")
      .update({
        status:
          "rejeitada",
        geranet_http_status:
          respostaHttpStatus,
        geranet_situacao:
          texto(
            geranet.situacao
          ) || null,
        cstat:
          texto(
            geranet.cstat
          ) || null,
        motivo:
          texto(
            geranet.mensagem
          ) ||
          `Geranet HTTP ${respostaHttpStatus}`,
        resposta_resumo:
          resumo,
        xml_hex:
          texto(
            geranet.xml
          ) || null,
        pdf_hex:
          texto(
            geranet.pdf
          ) || null,
        respondida_at:
          new Date()
            .toISOString(),
      })
      .eq("id", emissaoId)
      .eq("empresa_id", empresaId);

    await registrarRespostaTentativaFiscal({
      admin,
      empresaId,
      tentativaId,
      httpStatus: respostaHttpStatus,
      cstat: geranet.cstat,
      motivo: geranet.mensagem,
      geranetLogId: geranetLogIdDe(geranet),
      resposta: resumo,
      xmlHex: texto(geranet.xml) || null,
      pdfHex: texto(geranet.pdf) || null,
      classificacaoInicial: "rejeitada",
    });

    return erro(
      texto(
        geranet.mensagem
      ) ||
      "NFC-e rejeitada.",
      respostaHttpStatus === 401
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
  } catch (e) {
    console.error(
      "[NFCE EMITIR VENDA]",
      e instanceof Error
        ? e.message
        : "Erro desconhecido"
    );

    return erro(
      e instanceof Error
        ? e.message
        : "Erro interno na emissão da venda.",
      500
    );
  }
}
