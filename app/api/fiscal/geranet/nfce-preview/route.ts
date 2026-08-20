import {
  randomInt,
} from "node:crypto";

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

import {
  montarPayloadNfceGeranet,
  ocultarSegredosPayloadNfce,
  type SegredosFiscaisGeranet,
} from "@/lib/fiscal/geranet/montar-payload-nfce";

import type {
  AmbienteGeranet,
  CodigoRegimeTributario,
} from "@/lib/fiscal/geranet/resolver-politica-ibscbs";

import {
  createClient,
} from "@/lib/supabase/server";

import {
  createAdminClient,
} from "@/lib/supabase/admin";

function respostaErro(
  mensagem: string,
  status = 422,
  detalhes?: unknown
) {
  return NextResponse.json(
    {
      ok: false,
      erro: mensagem,
      ...(detalhes !== undefined
        ? { detalhes }
        : {}),
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

function somenteDigitos(
  valor: string | null | undefined
) {
  return String(valor ?? "")
    .replace(/\D/g, "");
}

function texto(
  valor: unknown
) {
  return String(
    valor ?? ""
  ).trim();
}

function gerarCodigoNumerico() {
  return randomInt(
    0,
    100_000_000
  )
    .toString()
    .padStart(8, "0");
}

export async function GET(
  request: NextRequest
) {
  try {
    const supabase =
      await createClient();

    const admin =
      createAdminClient();

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

    const empresaId =
      vinculo.empresa_id;

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
      operacaoParam !== "interna" &&
      operacaoParam !==
        "interestadual"
    ) {
      return respostaErro(
        'operacao deve ser "interna" ou "interestadual".'
      );
    }

    const operacao =
      operacaoParam as OperacaoFiscal;

    const quantidade = numeroQuery(
      params.get("quantidade"),
      1
    );

    const desconto = numeroQuery(
      params.get("desconto"),
      0
    );

    const tipoPagamento =
      params.get("tipo_pagamento") ??
      "01";

    const indicadorPagamento =
      params.get(
        "indicador_pagamento"
      ) ?? "0";

    const troco = numeroQuery(
      params.get("troco"),
      0
    );

    if (
      !Number.isFinite(
        quantidade
      ) ||
      quantidade <= 0
    ) {
      return respostaErro(
        "Quantidade inválida."
      );
    }

    if (
      !Number.isFinite(desconto) ||
      desconto < 0
    ) {
      return respostaErro(
        "Desconto inválido."
      );
    }

    if (
      !Number.isFinite(troco) ||
      troco < 0
    ) {
      return respostaErro(
        "Troco inválido."
      );
    }

    if (
      !/^\d{2}$/.test(
        tipoPagamento
      )
    ) {
      return respostaErro(
        "tipo_pagamento deve possuir 2 dígitos."
      );
    }

    if (
      indicadorPagamento !== "0" &&
      indicadorPagamento !== "1"
    ) {
      return respostaErro(
        'indicador_pagamento deve ser "0" (à vista) ou "1" (a prazo).'
      );
    }

    const serieParam =
      params.get("serie");

    const forcarIbscbsHomologacao =
      params.get("forcar_ibscbs") ===
        "1";

    const [
      empresaResult,
      fiscalEmpresaResult,
      nfceConfigsResult,
      numeracoesResult,
      segredosResult,
      produtoResult,
    ] = await Promise.all([
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
        .eq(
          "empresa_id",
          empresaId
        )
        .maybeSingle(),

      supabase
        .from("fiscal_nfce_config")
        .select(`
          id,
          empresa_id,
          id_csc,
          csc_configurado,
          ativo
        `)
        .eq(
          "empresa_id",
          empresaId
        )
        .eq("ativo", true)
        .limit(2),

      supabase
        .from("fiscal_numeracoes")
        .select(`
          id,
          empresa_id,
          modelo,
          serie,
          proximo_numero,
          ativo
        `)
        .eq(
          "empresa_id",
          empresaId
        )
        .eq("modelo", "65")
        .eq("ativo", true)
        .order("serie", {
          ascending: true,
        }),

      // SEGREDOS:
      // Esta RPC NÃO é executável por authenticated.
      // Após autenticar o usuário e resolver a empresa
      // pelo cliente normal, usamos service_role
      // exclusivamente no servidor para ler o Vault.
      //
      // Nunca retornar este resultado cru ao navegador.
      admin.rpc(
        "obter_segredos_fiscais",
        {
          p_empresa_id:
            empresaId,
        }
      ),

      supabase
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
        .eq(
          "empresa_id",
          empresaId
        )
        .eq("id", produtoId)
        .maybeSingle(),
    ]);

    if (empresaResult.error) {
      return respostaErro(
        empresaResult.error.message
      );
    }

    if (
      fiscalEmpresaResult.error
    ) {
      return respostaErro(
        fiscalEmpresaResult
          .error.message
      );
    }

    if (nfceConfigsResult.error) {
      return respostaErro(
        nfceConfigsResult
          .error.message
      );
    }

    if (numeracoesResult.error) {
      return respostaErro(
        numeracoesResult
          .error.message
      );
    }

    if (segredosResult.error) {
      return respostaErro(
        "Não foi possível ler os segredos fiscais no servidor.",
        500
      );
    }

    if (produtoResult.error) {
      return respostaErro(
        produtoResult.error.message
      );
    }

    const empresa =
      empresaResult.data;

    const fiscalEmpresa =
      fiscalEmpresaResult.data;

    const nfceConfigs =
      nfceConfigsResult.data ?? [];

    const numeracoes =
      numeracoesResult.data ?? [];

    const produto =
      produtoResult.data;

    const segredos =
      (segredosResult.data ??
        {}) as SegredosFiscaisGeranet;

    const pendencias: string[] =
      [];

    const alertas: string[] =
      [];

    if (!empresa) {
      pendencias.push(
        "Cadastro da empresa não encontrado."
      );
    } else if (!empresa.ativo) {
      pendencias.push(
        "Empresa está inativa."
      );
    }

    if (!fiscalEmpresa) {
      pendencias.push(
        "Configuração fiscal da empresa não encontrada."
      );
    } else if (
      !fiscalEmpresa.ativo
    ) {
      pendencias.push(
        "Configuração fiscal da empresa está inativa."
      );
    }

    if (
      nfceConfigs.length === 0
    ) {
      pendencias.push(
        "Configuração NFC-e ativa não encontrada."
      );
    }

    if (
      nfceConfigs.length > 1
    ) {
      pendencias.push(
        "Existe mais de uma configuração NFC-e ativa para a empresa."
      );
    }

    const nfceConfig =
      nfceConfigs[0] ?? null;

    if (
      !nfceConfig?.id_csc
    ) {
      pendencias.push(
        "ID do CSC não está configurado."
      );
    } else if (
      !/^\d{1,6}$/.test(
        String(
          nfceConfig.id_csc
        ).trim()
      ) ||
      Number(
        nfceConfig.id_csc
      ) <= 0
    ) {
      pendencias.push(
        "ID do CSC deve conter de 1 a 6 dígitos numéricos e ser maior que zero."
      );
    }

    if (
      nfceConfig &&
      !nfceConfig.csc_configurado
    ) {
      pendencias.push(
        "CSC está marcado como não configurado."
      );
    }

    if (
      !texto(
        segredos.geranet_api_key
      )
    ) {
      pendencias.push(
        "API Key da Geranet não está configurada no Vault."
      );
    }

    if (
      !texto(
        segredos.certificado_a1
      )
    ) {
      pendencias.push(
        "Certificado A1 não está configurado no Vault."
      );
    }

    if (
      !texto(
        segredos
          .senha_certificado
      )
    ) {
      pendencias.push(
        "Senha do certificado não está configurada no Vault."
      );
    }

    if (!texto(segredos.csc)) {
      pendencias.push(
        "CSC não está configurado no Vault."
      );
    }

    let numeracao:
      | (typeof numeracoes)[number]
      | null = null;

    if (serieParam) {
      const serie = Number(
        serieParam
      );

      if (
        !Number.isInteger(serie) ||
        serie <= 0
      ) {
        return respostaErro(
          "Série inválida."
        );
      }

      numeracao =
        numeracoes.find(
          (item) =>
            item.serie === serie
        ) ?? null;

      if (!numeracao) {
        pendencias.push(
          `Não existe numeração NFC-e ativa para a série ${serie}.`
        );
      }
    } else if (
      numeracoes.length === 1
    ) {
      numeracao =
        numeracoes[0];
    } else if (
      numeracoes.length === 0
    ) {
      pendencias.push(
        "Numeração NFC-e modelo 65 ativa não encontrada."
      );
    } else {
      pendencias.push(
        "Existe mais de uma série NFC-e ativa. Informe ?serie=NUMERO na URL do preview."
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

    if (
      !empresa ||
      !fiscalEmpresa
    ) {
      return NextResponse.json({
        ok: true,
        aviso:
          "PREVIEW: nenhuma nota foi enviada para a Geranet.",
        pronto_para_emitir:
          false,
        pendencias,
        alertas,
      });
    }

    const cnpj =
      somenteDigitos(
        empresa.cnpj
      );

    if (cnpj.length !== 14) {
      pendencias.push(
        "CNPJ do emitente deve possuir 14 dígitos."
      );
    }

    if (
      !texto(
        fiscalEmpresa
          .inscricao_estadual
      )
    ) {
      pendencias.push(
        "Inscrição Estadual do emitente não está configurada."
      );
    }

    if (
      !texto(
        fiscalEmpresa.logradouro
      )
    ) {
      pendencias.push(
        "Logradouro do emitente não está configurado."
      );
    }

    if (
      !texto(
        fiscalEmpresa.numero
      )
    ) {
      pendencias.push(
        "Número do endereço do emitente não está configurado."
      );
    }

    if (
      !texto(
        fiscalEmpresa.bairro
      )
    ) {
      pendencias.push(
        "Bairro do emitente não está configurado."
      );
    }

    if (
      somenteDigitos(
        fiscalEmpresa.cep
      ).length !== 8
    ) {
      pendencias.push(
        "CEP do emitente deve possuir 8 dígitos."
      );
    }

    if (
      !texto(
        fiscalEmpresa.municipio
      )
    ) {
      pendencias.push(
        "Município do emitente não está configurado."
      );
    }

    if (
      !texto(
        fiscalEmpresa
          .codigo_municipio_ibge
      )
    ) {
      pendencias.push(
        "Código IBGE do município do emitente não está configurado."
      );
    }

    const uf =
      texto(
        fiscalEmpresa.uf
      ).toUpperCase();

    if (!/^[A-Z]{2}$/.test(uf)) {
      pendencias.push(
        "UF do emitente é inválida."
      );
    }

    const crt = Number(
      fiscalEmpresa
        .codigo_regime_tributario
    );

    if (
      ![1, 2, 3, 4].includes(crt)
    ) {
      pendencias.push(
        "Código de regime tributário é inválido."
      );
    }

    // A OpenAPI atual da Geranet
    // resume os CRTs de NFe/NFCe como
    // 1, 2 e 3. Não bloqueia a arquitetura
    // geral do UltraPDV, mas evita emitir
    // CRT 4 sem validação específica.
    if (crt === 4) {
      pendencias.push(
        "CRT 4 exige validação específica com a versão atual da API Geranet antes da emissão."
      );
    }

    const ambienteNumero = Number(
      fiscalEmpresa.ambiente
    );

    if (
      ambienteNumero !== 1 &&
      ambienteNumero !== 2
    ) {
      pendencias.push(
        "Ambiente fiscal deve ser 1 (produção) ou 2 (homologação)."
      );
    }

    if (
      !texto(
        fiscalEmpresa
          .natureza_operacao_padrao
      )
    ) {
      pendencias.push(
        "Natureza da operação padrão não está configurada."
      );
    }

    if (
      !texto(
        fiscalEmpresa
          .tipo_atividade
      )
    ) {
      alertas.push(
        "Tipo de atividade do emitente está vazio; o preview omitirá esse campo."
      );
    }

    const {
      data: fiscalProduto,
      error: fiscalProdutoError,
    } = await supabase
      .from("produtos_fiscal")
      .select(`
        ncm,
        cest,
        origem_produto
      `)
      .eq(
        "empresa_id",
        empresaId
      )
      .eq(
        "produto_id",
        produto.id
      )
      .maybeSingle();

    if (fiscalProdutoError) {
      return respostaErro(
        fiscalProdutoError.message
      );
    }

    if (!fiscalProduto) {
      return respostaErro(
        "Configuração fiscal do produto não encontrada."
      );
    }

    const {
      data: grupo,
      error: grupoError,
    } = await supabase
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
      .eq(
        "id",
        produto.grupo_fiscal_id
      )
      .maybeSingle();

    if (grupoError) {
      return respostaErro(
        grupoError.message
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

    if (
      ambienteNumero !== 1 &&
      ambienteNumero !== 2
    ) {
      return NextResponse.json({
        ok: true,
        aviso:
          "PREVIEW: nenhuma nota foi enviada para a Geranet.",
        pronto_para_emitir:
          false,
        pendencias,
        alertas,
      });
    }

    const ambiente =
      String(
        ambienteNumero
      ) as AmbienteGeranet;

    const codigoRegimeTributario =
      crt as CodigoRegimeTributario;

    // No preview usamos o mesmo instante para
    // a política IBS/CBS e para dataEmissao/dataSaida.
    // A emissão real continua responsável por montar
    // a data fiscal definitiva com o fuso do emitente.
    const dataPolitica =
      new Date().toISOString();

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
          fiscalProduto.ncm,

        cest:
          fiscalProduto.cest,

        origemProduto:
          fiscalProduto
            .origem_produto,
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
      dataEmissao:
        dataPolitica,

      forcarIbscbsHomologacao:
        ambiente === "2" &&
        forcarIbscbsHomologacao,

      operacao,
      quantidade,
      desconto,
    });

    const totalItem =
      Number(item.valorTotal);

    if (
      !Number.isFinite(totalItem)
    ) {
      return respostaErro(
        "Total do item fiscal inválido."
      );
    }

    if (
      troco > totalItem
    ) {
      alertas.push(
        "Troco informado é maior que o total do item; confira antes de emitir."
      );
    }

    if (!numeracao) {
      return NextResponse.json({
        ok: true,
        aviso:
          "PREVIEW: nenhuma nota foi enviada para a Geranet.",
        pronto_para_emitir:
          false,
        pendencias,
        alertas,
        contexto: {
          empresa_id:
            empresaId,
          modelo: "65",
          ambiente,
          politica_ibscbs:
            politicaIbscbs,
        },
        item,
      });
    }

    if (!nfceConfig) {
      return NextResponse.json({
        ok: true,
        aviso:
          "PREVIEW: nenhuma nota foi enviada para a Geranet.",
        pronto_para_emitir:
          false,
        pendencias,
        alertas,
        contexto: {
          empresa_id:
            empresaId,
          modelo: "65",
          ambiente,
          politica_ibscbs:
            politicaIbscbs,
        },
        item,
      });
    }

    const payloadInterno =
      montarPayloadNfceGeranet({
        emitente: {
          cnpj:
            empresa.cnpj,

          inscricaoEstadual:
            texto(
              fiscalEmpresa
                .inscricao_estadual
            ),

          razaoSocial:
            empresa.razao_social,

          nomeFantasia:
            empresa.nome_fantasia,

          telefone:
            fiscalEmpresa.telefone,

          email:
            fiscalEmpresa.email,

          logradouro:
            texto(
              fiscalEmpresa
                .logradouro
            ),

          numero:
            texto(
              fiscalEmpresa.numero
            ),

          complemento:
            fiscalEmpresa
              .complemento,

          bairro:
            texto(
              fiscalEmpresa.bairro
            ),

          municipio:
            texto(
              fiscalEmpresa.municipio
            ),

          codigoMunicipio:
            texto(
              fiscalEmpresa
                .codigo_municipio_ibge
            ),

          uf,

          cep:
            texto(
              fiscalEmpresa.cep
            ),

          codigoRegimeTributario,

          tipoAtividade:
            fiscalEmpresa
              .tipo_atividade,

          informacaoComplementar:
            fiscalEmpresa
              .informacao_complementar_padrao,
        },

        config: {
          ambiente,
          serie:
            numeracao.serie,

          numeroNota:
            numeracao
              .proximo_numero,

          idCsc:
            texto(
              nfceConfig.id_csc
            ),

          indicadorPresenca:
            String(
              fiscalEmpresa
                .indicador_presenca_padrao
            ),

          indicativoIntermediador:
            String(
              fiscalEmpresa
                .indicativo_intermediador_padrao
            ),

          naturezaOperacao:
            fiscalEmpresa
              .natureza_operacao_padrao,

          informacaoComplementar:
            fiscalEmpresa
              .informacao_complementar_padrao,

          dataEmissao:
            dataPolitica,

          dataSaida:
            dataPolitica,

          fusoHorario:
            texto(
              fiscalEmpresa.fuso_horario
            ),
        },

        segredos,

        item,

        pagamento: {
          tipo:
            tipoPagamento,

          valor:
            totalItem,

          indicadorPagamento:
            indicadorPagamento as
              | "0"
              | "1",

          troco,
        },

        codigoNumerico:
          gerarCodigoNumerico(),
      });

    // Nunca retornar o payload cru,
    // nunca imprimir payloadInterno no log.
    const payloadPreview =
      ocultarSegredosPayloadNfce(
        payloadInterno
      );

    const prontoParaEmitir =
      pendencias.length === 0;

    return NextResponse.json({
      ok: true,

      aviso:
        "PREVIEW: nenhuma nota foi enviada para a Geranet e a numeração NÃO foi incrementada.",

      pronto_para_emitir:
        prontoParaEmitir,

      pendencias,
      alertas,

      contexto: {
        empresa_id:
          empresaId,

        modelo: "65",
        ambiente,

        serie:
          numeracao.serie,

        proximo_numero:
          String(
            numeracao
              .proximo_numero
          ),

        produto_id:
          produto.id,

        grupo_fiscal_id:
          produto
            .grupo_fiscal_id,

        consumidor:
          "não identificado",

        pagamento: {
          tipo:
            tipoPagamento,

          indicador:
            indicadorPagamento,
        },

        politica_ibscbs:
          politicaIbscbs,

        segredos: {
          geranet_api_key:
            texto(
              segredos
                .geranet_api_key
            )
              ? "CONFIGURADA"
              : "NÃO CONFIGURADA",

          certificado_a1:
            texto(
              segredos
                .certificado_a1
            )
              ? "CONFIGURADO"
              : "NÃO CONFIGURADO",

          senha_certificado:
            texto(
              segredos
                .senha_certificado
            )
              ? "CONFIGURADA"
              : "NÃO CONFIGURADA",

          csc:
            texto(segredos.csc)
              ? "CONFIGURADO"
              : "NÃO CONFIGURADO",
        },

        observacoes: [
          "A API Key é usada no header Authorization na emissão real e não faz parte do corpo.",
          "dataEmissao/dataSaida usam o mesmo instante ISO apenas neste preview; a emissão real monta a data fiscal definitiva com o fuso do emitente.",
          "O bloco cliente foi omitido porque este preview representa consumidor não identificado.",
        ],
      },

      payload:
        payloadPreview,
    });
  } catch (error) {
    console.error(
      "[GERANET NFCE PREVIEW]",
      error instanceof Error
        ? error.message
        : "Erro desconhecido"
    );

    return respostaErro(
      error instanceof Error
        ? error.message
        : "Erro ao montar preview da NFC-e."
    );
  }
}