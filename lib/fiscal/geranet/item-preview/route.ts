import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  montarItemGeranet,
  type OperacaoFiscal,
} from "@/lib/fiscal/geranet/montar-item";
import {
  camposIpiDoGrupo,
} from "@/lib/fiscal/ipi";

import type {
  AmbienteGeranet,
  CodigoRegimeTributario,
} from "@/lib/fiscal/geranet/resolver-politica-ibscbs";

import {
  createClient,
} from "@/lib/supabase/server";

function respostaErro(
  mensagem: string,
  status = 422
) {
  return NextResponse.json(
    {
      ok: false,
      erro: mensagem,
    },
    { status }
  );
}

function numeroQuery(
  valor: string | null,
  padrao: number
) {
  if (!valor) return padrao;

  const numero = Number(
    valor.replace(",", ".")
  );

  return Number.isFinite(numero)
    ? numero
    : NaN;
}

export async function GET(
  request: NextRequest
) {
  try {
    const supabase =
      await createClient();

    const {
      data: claimsData,
      error: authError,
    } =
      await supabase.auth.getClaims();

    if (
      authError ||
      !claimsData?.claims?.sub
    ) {
      return respostaErro(
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
      return respostaErro(
        "Empresa ativa não encontrada.",
        403
      );
    }

    const params =
      request.nextUrl.searchParams;

    const produtoId =
      params
        .get("produto_id")
        ?.trim();

    if (!produtoId) {
      return respostaErro(
        "Informe produto_id."
      );
    }

    const operacaoParam =
      params.get("operacao") ??
      "interna";

    if (
      operacaoParam !==
        "interna" &&
      operacaoParam !==
        "interestadual"
    ) {
      return respostaErro(
        'operacao deve ser "interna" ou "interestadual".'
      );
    }

    const operacao =
      operacaoParam as OperacaoFiscal;

    const modelo =
      params.get("modelo") ??
      "65";

    if (
      modelo !== "55" &&
      modelo !== "65"
    ) {
      return respostaErro(
        'modelo deve ser "55" ou "65".'
      );
    }

    const ambienteParam =
      params.get("ambiente") ??
      "2";

    if (
      ambienteParam !== "1" &&
      ambienteParam !== "2"
    ) {
      return respostaErro(
        'ambiente deve ser "1" (produção) ou "2" (homologação).'
      );
    }

    const ambiente =
      ambienteParam as AmbienteGeranet;

    const forcarIbscbsHomologacao =
      ambiente === "2" &&
      params.get("forcar_ibscbs") ===
        "1";

    const quantidade = numeroQuery(
      params.get("quantidade"),
      1
    );

    const desconto = numeroQuery(
      params.get("desconto"),
      0
    );

    if (
      !Number.isFinite(
        quantidade
      ) ||
      !Number.isFinite(
        desconto
      )
    ) {
      return respostaErro(
        "Quantidade ou desconto inválido."
      );
    }

    const {
      data: fiscalEmpresa,
      error: fiscalEmpresaError,
    } = await supabase
      .from("empresas_fiscal")
      .select(
        "codigo_regime_tributario"
      )
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .maybeSingle();

    if (fiscalEmpresaError) {
      return respostaErro(
        fiscalEmpresaError.message
      );
    }

    const crt = Number(
      fiscalEmpresa
        ?.codigo_regime_tributario
    );

    if (
      ![1, 2, 3, 4].includes(crt)
    ) {
      return respostaErro(
        "Código de regime tributário da empresa não está configurado corretamente."
      );
    }

    const codigoRegimeTributario =
      crt as CodigoRegimeTributario;

    const {
      data: produto,
      error: produtoError,
    } = await supabase
      .from("produtos")
      .select(`
        id,
        empresa_id,
        codigo,
        codigo_barras,
        nome,
        unidade_medida,
        tipo_item,
        preco_venda,
        grupo_fiscal_id,
        ativo
      `)
      .eq("id", produtoId)
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .maybeSingle();

    if (produtoError) {
      return respostaErro(
        produtoError.message
      );
    }

    if (!produto) {
      return respostaErro(
        "Produto não encontrado.",
        404
      );
    }

    if (!produto.ativo) {
      return respostaErro(
        "Produto está inativo."
      );
    }

    if (
      !produto.grupo_fiscal_id
    ) {
      return respostaErro(
        "Produto não possui Grupo Fiscal."
      );
    }

    const [
      {
        data: fiscal,
        error: fiscalError,
      },
      {
        data: grupo,
        error: grupoError,
      },
    ] = await Promise.all([
      supabase
        .from("produtos_fiscal")
        .select(`
          ncm,
          cest,
          origem_produto
        `)
        .eq(
          "empresa_id",
          vinculo.empresa_id
        )
        .eq(
          "produto_id",
          produto.id
        )
        .maybeSingle(),

      supabase
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
          vinculo.empresa_id
        )
        .eq(
          "id",
          produto.grupo_fiscal_id
        )
        .maybeSingle(),
    ]);

    if (fiscalError) {
      return respostaErro(
        fiscalError.message
      );
    }

    if (grupoError) {
      return respostaErro(
        grupoError.message
      );
    }

    if (!fiscal) {
      return respostaErro(
        "Configuração fiscal do produto não encontrada."
      );
    }

    if (
      !grupo ||
      !grupo.ativo
    ) {
      return respostaErro(
        "Grupo Fiscal não encontrado ou inativo."
      );
    }

    /**
     * Só validamos a relação CST/cClassTrib
     * quando IBS/CBS estiver efetivamente
     * sendo usado. O montador ainda faz
     * validação dos próprios campos.
     */
    if (
      ambiente === "2" &&
      forcarIbscbsHomologacao
    ) {
      if (
        !grupo.cst_ibscbs ||
        !grupo
          .classificacao_ibscbs
      ) {
        return respostaErro(
          "Para forçar IBS/CBS em homologação, configure CST IBS/CBS e cClassTrib no Grupo Fiscal."
        );
      }

      const {
        data: classTrib,
        error: classTribError,
      } = await supabase
        .from(
          "fiscal_cclasstrib_catalogo"
        )
        .select(`
          codigo,
          cst_codigo,
          permite_nfe,
          permite_nfce,
          ativo
        `)
        .eq(
          "codigo",
          grupo
            .classificacao_ibscbs
        )
        .eq(
          "cst_codigo",
          grupo.cst_ibscbs
        )
        .maybeSingle();

      if (classTribError) {
        return respostaErro(
          classTribError.message
        );
      }

      if (!classTrib?.ativo) {
        return respostaErro(
          "cClassTrib do Grupo Fiscal não está ativo no catálogo."
        );
      }

      if (
        modelo === "65" &&
        !classTrib.permite_nfce
      ) {
        return respostaErro(
          "O cClassTrib deste grupo não é aplicável a NFC-e."
        );
      }

      if (
        modelo === "55" &&
        !classTrib.permite_nfe
      ) {
        return respostaErro(
          "O cClassTrib deste grupo não é aplicável a NF-e."
        );
      }
    }

    const agora = new Date();

    const {
      item,
      politicaIbscbs,
    } = montarItemGeranet({
      produto: {
        codigo:
          produto.codigo,

        codigoBarras:
          produto.codigo_barras,

        nome:
          produto.nome,

        unidadeMedida:
          produto.unidade_medida,

        tipoItem:
          produto.tipo_item,

        precoVenda:
          produto.preco_venda,
      },

      fiscal: {
        ncm:
          fiscal.ncm,

        cest:
          fiscal.cest,

        origemProduto:
          fiscal.origem_produto,
      },

      grupo: {
        cfopInterno:
          grupo.cfop_interno,

        cfopInterestadual:
          grupo
            .cfop_interestadual,

        icmsCstCsosn:
          grupo
            .icms_cst_csosn,

        pisCst:
          grupo.pis_cst,

        pisAliquota:
          grupo.pis_aliquota,

        cofinsCst:
          grupo.cofins_cst,

        cofinsAliquota:
          grupo
            .cofins_aliquota,

        cstIbscbs:
          grupo.cst_ibscbs,

        classificacaoIbscbs:
          grupo
            .classificacao_ibscbs,

        aliquotaIbsUf:
          grupo
            .aliquota_ibs_uf,

        aliquotaIbsMunicipio:
          grupo
            .aliquota_ibs_municipio,

        aliquotaCbs:
          grupo.aliquota_cbs,

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
          grupo.ibscbs_manual,
        ...camposIpiDoGrupo(grupo),
      },

      modelo: "65",
      perfilIpi: null,
      codigoRegimeTributario,
      ambiente,
      dataEmissao: agora,

      forcarIbscbsHomologacao,

      operacao,
      quantidade,
      desconto,
    });

    return NextResponse.json({
      ok: true,

      aviso:
        "PREVIEW: nenhuma nota foi enviada para a Geranet.",

      contexto: {
        modelo,
        ambiente,
        operacao,

        codigo_regime_tributario:
          codigoRegimeTributario,

        produto_id:
          produto.id,

        grupo_fiscal_id:
          produto.grupo_fiscal_id,

        politica_ibscbs:
          politicaIbscbs,
      },

      item,
    });
  } catch (error) {
    console.error(
      "[GERANET ITEM PREVIEW]",
      error
    );

    return respostaErro(
      error instanceof Error
        ? error.message
        : "Erro ao montar item fiscal."
    );
  }
}
