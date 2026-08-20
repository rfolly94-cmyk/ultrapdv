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
  montarItemGeranet,
  type OperacaoFiscal,
} from "@/lib/fiscal/geranet/montar-item";
import {
  camposIpiDoGrupo,
  parsePerfilIpi,
  pendenciasIpiDocumento,
} from "@/lib/fiscal/ipi";

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
} from "@/lib/fiscal/geranet/cliente-geranet";
import {
  classificarRespostaEmitir,
  historicoErroTecnico,
  mensagemResultadoRemotoNaoConclusivo,
  MENSAGEM_BLOQUEIO_AGUARDANDO_RECONCILIACAO,
  MENSAGEM_BLOQUEIO_RETRANSMISSAO,
  persistirClassificacaoNaoAutorizada,
} from "@/lib/fiscal/geranet/classificar-emissao";
import {
  claimTentativaEmissaoFiscal,
  geranetLogIdDe,
  registrarRespostaTentativaFiscal,
} from "@/lib/fiscal/emissao-tentativas";

import {
  montarPayloadNfeGeranet,
} from "@/lib/fiscal/geranet/montar-payload-nfe";
import { resolverDestinatarioFiscalNfe } from "@/lib/fiscal/destinatario/resolver-destinatario-fiscal";
import { obterLogomarcaFiscalHex } from "@/lib/empresa/obter-logomarca-fiscal-hex";

type DestinatarioTeste = {
  cpf?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  municipio?: string;
  codigo_municipio?: string;
  uf?: string;
};

type Body = {
  confirmar?: string;
  produto_id?: string;
  quantidade?: number | string;
  desconto?: number | string;
  tipo_pagamento?: string;
  indicador_pagamento?: "0" | "1";
  troco?: number | string;
  serie?: number | string;
  destinatario?: DestinatarioTeste;
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

  let v = texto(valor);

  if (
    v.includes(".") &&
    v.includes(",")
  ) {
    v = v
      .replace(/\./g, "")
      .replace(",", ".");
  } else if (
    v.includes(",")
  ) {
    v = v.replace(",", ".");
  }

  const n = Number(v);

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

export async function POST(
  request: NextRequest
) {
  const supabase =
    await createClient();

  const admin =
    createAdminClient();

  try {
    // ========================================================
    // 1. Autenticação UltraPDV
    // ========================================================

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

    const empresaId =
      vinculo.empresa_id;

    // ========================================================
    // 2. Confirmação + idempotência
    // ========================================================

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

    if (
      body.confirmar !==
      "EMITIR_NFE55_HOMOLOGACAO"
    ) {
      return erro(
        "Confirmação explícita de homologação ausente.",
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
      !uuidValido(
        idempotencyKey
      )
    ) {
      return erro(
        "Header Idempotency-Key deve conter um UUID válido.",
        400
      );
    }

    const produtoId =
      texto(body.produto_id);

    if (
      !uuidValido(produtoId)
    ) {
      return erro(
        "produto_id inválido."
      );
    }

    const quantidade =
      numero(
        body.quantidade,
        1
      );

    const desconto =
      numero(
        body.desconto,
        0
      );

    const troco =
      numero(
        body.troco,
        0
      );

    if (
      !Number.isFinite(
        quantidade
      ) ||
      quantidade <= 0
    ) {
      return erro(
        "Quantidade inválida."
      );
    }

    if (
      !Number.isFinite(
        desconto
      ) ||
      desconto < 0
    ) {
      return erro(
        "Desconto inválido."
      );
    }

    if (
      !Number.isFinite(troco) ||
      troco < 0
    ) {
      return erro(
        "Troco inválido."
      );
    }

    const tipoPagamento =
      texto(
        body.tipo_pagamento ??
          "01"
      );

    if (
      !/^\d{2}$/.test(
        tipoPagamento
      )
    ) {
      return erro(
        "tipo_pagamento deve possuir 2 dígitos."
      );
    }

    const indicadorPagamento =
      body.indicador_pagamento ??
      "0";

    if (
      indicadorPagamento !==
        "0" &&
      indicadorPagamento !== "1"
    ) {
      return erro(
        "indicador_pagamento inválido."
      );
    }

    const destinatario =
      body.destinatario;

    if (!destinatario) {
      return erro(
        "Destinatário de teste não informado.",
        400
      );
    }

    const destinatarioCpf =
      somenteDigitos(
        destinatario.cpf
      );

    const destinatarioCep =
      somenteDigitos(
        destinatario.cep
      );

    const destinatarioUf =
      texto(
        destinatario.uf
      ).toUpperCase();

    const destinatarioCodigoMunicipio =
      somenteDigitos(
        destinatario.codigo_municipio
      );

    const destinatarioLogradouro =
      texto(
        destinatario.logradouro
      );

    const destinatarioNumero =
      texto(
        destinatario.numero
      );

    const destinatarioBairro =
      texto(
        destinatario.bairro
      );

    const destinatarioMunicipio =
      texto(
        destinatario.municipio
      ).toUpperCase();

    if (
      destinatarioCpf.length !== 11
    ) {
      return erro(
        "CPF do destinatário deve possuir 11 dígitos.",
        400
      );
    }

    if (
      destinatarioCep.length !== 8
    ) {
      return erro(
        "CEP do destinatário deve possuir 8 dígitos.",
        400
      );
    }

    if (
      !/^[A-Z]{2}$/.test(
        destinatarioUf
      )
    ) {
      return erro(
        "UF do destinatário inválida.",
        400
      );
    }

    if (
      destinatarioCodigoMunicipio.length !== 7
    ) {
      return erro(
        "Código IBGE do destinatário deve possuir 7 dígitos.",
        400
      );
    }

    if (
      !destinatarioLogradouro ||
      !destinatarioNumero ||
      !destinatarioBairro ||
      !destinatarioMunicipio
    ) {
      return erro(
        "Endereço do destinatário está incompleto.",
        400
      );
    }

    // ========================================================
    // 3. Carrega configuração antes de reservar número
    // ========================================================

    const [
      empresaResult,
      fiscalResult,
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
          perfil_ipi,
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
          "fiscal_numeracoes"
        )
        .select(`
          id,
          modelo,
          serie,
          proximo_numero,
          ativo
        `)
        .eq(
          "empresa_id",
          empresaId
        )
        .eq("modelo", "55")
        .eq("ativo", true)
        .order(
          "serie",
          { ascending: true }
        ),

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

    const primeiroErro =
      empresaResult.error ??
      fiscalResult.error ??
      numeracoesResult.error ??
      produtoResult.error;

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

    const empresa =
      empresaResult.data;

    const fiscal =
      fiscalResult.data;

    const numeracoes =
      numeracoesResult.data ?? [];

    const produto =
      produtoResult.data;

    const segredos =
      (segredosResult.data ??
        {}) as SegredosFiscaisGeranet;

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

    // Valida o timezone antes de reservar/enviar.
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

    // TRAVA ABSOLUTA desta rota:
    // nunca produzir.
    if (
      Number(
        fiscal.ambiente
      ) !== 2
    ) {
      return erro(
        "Esta rota é exclusiva de HOMOLOGAÇÃO (ambiente 2). Produção foi bloqueada.",
        403
      );
    }

    const apiKey =
      texto(
        segredos
          .geranet_api_key
      );

    const certificado =
      texto(
        segredos.certificado_a1
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
        "API Key, certificado ou senha do certificado não estão completamente configurados."
      );
    }

    if (!produto) {
      return erro(
        "Produto não encontrado.",
        404
      );
    }

    if (!produto.ativo) {
      return erro(
        "Produto está inativo."
      );
    }

    if (
      !produto.grupo_fiscal_id
    ) {
      return erro(
        "Produto não possui Grupo Fiscal."
      );
    }

    const serieInformada =
      body.serie ===
        undefined
        ? null
        : Number(
            body.serie
          );

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
          (n) =>
            n.serie ===
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
          ? "Há mais de uma série NF-e ativa. Informe serie."
          : "Numeração NF-e ativa não encontrada."
      );
    }

    const cnpj =
      somenteDigitos(
        empresa.cnpj
      );

    if (cnpj.length !== 14) {
      return erro(
        "CNPJ do emitente é inválido."
      );
    }

    const ie =
      texto(
        fiscal
          .inscricao_estadual
      );

    if (!ie) {
      return erro(
        "Inscrição Estadual não configurada."
      );
    }

    const uf =
      texto(
        fiscal.uf
      ).toUpperCase();

    if (
      !/^[A-Z]{2}$/.test(uf)
    ) {
      return erro(
        "UF do emitente inválida."
      );
    }

    const crt = Number(
      fiscal
        .codigo_regime_tributario
    );

    if (
      ![1, 2, 3].includes(crt)
    ) {
      return erro(
        "CRT não suportado pela emissão Geranet atual."
      );
    }

    const camposObrigatorios:
      Array<
        [string, unknown]
      > = [
        [
          "logradouro",
          fiscal.logradouro,
        ],
        [
          "número",
          fiscal.numero,
        ],
        [
          "bairro",
          fiscal.bairro,
        ],
        [
          "município",
          fiscal.municipio,
        ],
        [
          "código IBGE",
          fiscal
            .codigo_municipio_ibge,
        ],
        [
          "natureza da operação",
          fiscal
            .natureza_operacao_padrao,
        ],
      ];

    for (
      const [
        nome,
        valor,
      ] of camposObrigatorios
    ) {
      if (!texto(valor)) {
        return erro(
          `${nome} do emitente não está configurado.`
        );
      }
    }

    if (
      somenteDigitos(
        fiscal.cep
      ).length !== 8
    ) {
      return erro(
        "CEP do emitente é inválido."
      );
    }

    const [
      fiscalProdutoResult,
      grupoResult,
    ] = await Promise.all([
      supabase
        .from(
          "produtos_fiscal"
        )
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
        .maybeSingle(),

      supabase
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
        .eq(
          "id",
          produto
            .grupo_fiscal_id
        )
        .maybeSingle(),
    ]);

    if (
      fiscalProdutoResult.error
    ) {
      return erro(
        fiscalProdutoResult
          .error.message,
        500
      );
    }

    if (grupoResult.error) {
      return erro(
        grupoResult
          .error.message,
        500
      );
    }

    const fiscalProduto =
      fiscalProdutoResult.data;

    const grupo =
      grupoResult.data;

    if (!fiscalProduto) {
      return erro(
        "Configuração fiscal do produto não encontrada."
      );
    }

    if (
      !grupo ||
      !grupo.ativo
    ) {
      return erro(
        "Grupo Fiscal não encontrado ou inativo."
      );
    }

    const pendenciasIpi =
      pendenciasIpiDocumento({
        modelo: "55",
        perfilIpi: parsePerfilIpi(
          fiscal.perfil_ipi
        ),
        grupos: [camposIpiDoGrupo(grupo)],
      });

    if (pendenciasIpi.length > 0) {
      return erro(pendenciasIpi[0]);
    }

    const ambiente:
      AmbienteGeranet = "2";

    const codigoRegimeTributario =
      crt as CodigoRegimeTributario;

    const operacao:
      OperacaoFiscal =
      "interna";

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
          produto
            .unidade_medida,
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

      modelo: "55",
      perfilIpi: parsePerfilIpi(
        fiscal.perfil_ipi
      ),
      codigoRegimeTributario,
      ambiente,

      // Emissão real não força IBS/CBS
      // fora da política normal.
      forcarIbscbsHomologacao:
        false,

      dataEmissao:
        new Date().toISOString(),

      operacao,
      quantidade,
      desconto,
    });

    const total =
      Number(item.valorTotal);

    if (
      !Number.isFinite(total) ||
      total <= 0
    ) {
      return erro(
        "Total fiscal inválido."
      );
    }

    // ========================================================
    // 4. Reserva atômica: agora sim consome o número
    // ========================================================

    const {
      data: reservaData,
      error: reservaError,
    } = await admin.rpc(
      "rpc_reservar_emissao_fiscal",
      {
        p_empresa_id:
          empresaId,
        p_modelo: "55",
        p_serie:
          numeracao.serie,
        p_ambiente: 2,
        p_chave_idempotencia:
          idempotencyKey,
        p_origem_tipo:
          "teste_nfe55_homologacao",
        p_origem_id: null,
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
      error:
        emissaoAtualError,
    } = await admin
      .from("fiscal_emissoes")
      .select(`
        id,
        status,
        tentativas,
        numero,
        serie,
        codigo_numerico,
        chave_acesso,
        protocolo,
        cstat,
        motivo,
        geranet_http_status,
        geranet_situacao,
        resposta_resumo
      `)
      .eq("id", emissaoId)
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
          emissaoAtual
            .chave_acesso,
        protocolo:
          emissaoAtual
            .protocolo,
        cstat:
          emissaoAtual.cstat,
        mensagem:
          "Esta chave de idempotência já havia sido autorizada. Nenhuma nova transmissão foi feita.",
      });
    }

    if (
      [
        "enviando",
        "erro_comunicacao",
        "aguardando_reconciliacao",
      ].includes(
        emissaoAtual.status
      )
    ) {
      return erro(
        emissaoAtual.status === "erro_comunicacao"
          ? "Esta emissão está em estado ambíguo ou já está sendo enviada. Não haverá retransmissão automática."
          : MENSAGEM_BLOQUEIO_AGUARDANDO_RECONCILIACAO,
        409,
        {
          emissao_id:
            emissaoAtual.id,
          status:
            emissaoAtual.status,
          serie:
            emissaoAtual.serie,
          numero:
            String(
              emissaoAtual.numero
            ),
          podeConsultarNovamente:
            emissaoAtual.status !== "erro_comunicacao",
          podeRetransmitir: false,
        }
      );
    }

    // ========================================================
    // 5. Monta payload com número/cNF RESERVADOS
    // ========================================================

    const payload =
      montarPayloadNfeGeranet({
        ambiente:
          "2",

        ufEmitente:
          uf,

        certificadoDigital:
          certificado,

        senhaCertificadoDigital:
          senhaCertificado,

        emitente: {
          logomarca:
            await obterLogomarcaFiscalHex(
              String(empresaId)
            ),
          cnpj,

          inscricaoEstadual:
            somenteDigitos(ie),

          razaoSocial:
            texto(
              empresa.razao_social
            ),

          nomeFantasia:
            texto(
              empresa.nome_fantasia
            ),

          telefone:
            fiscal.telefone,

          email:
            fiscal.email,

          logradouro:
            texto(
              fiscal.logradouro
            ),

          numero:
            texto(
              fiscal.numero
            ),

          complemento:
            fiscal.complemento,

          bairro:
            texto(
              fiscal.bairro
            ),

          municipio:
            `${texto(
              fiscal.municipio
            ).toUpperCase()} - ${uf}`,

          codigoMunicipio:
            texto(
              fiscal
                .codigo_municipio_ibge
            ),

          uf,

          cep:
            texto(
              fiscal.cep
            ),

          codigoRegimeTributario,

          tipoAtividade:
            "3",

          informacaoComplementar:
            fiscal
              .informacao_complementar_padrao,
        },

        destinatario: {
          cnpj:
            "",

          cpf:
            destinatarioCpf,

          inscricaoEstadual:
            "",

          // Em homologação o builder substitui
          // automaticamente pelo xNome exigido
          // para documento fiscal sem valor fiscal.
          razaoSocial:
            "",

          nomeFantasia:
            "",

          ...resolverDestinatarioFiscalNfe({
            modelo: "55",
            origemVenda: "pdv",
            contribuinteIcms: false,
          }),

          telefone:
            "",

          email:
            "",

          logradouro:
            destinatarioLogradouro,

          numero:
            destinatarioNumero,

          complemento:
            "",

          bairro:
            destinatarioBairro,

          municipio:
            `${destinatarioMunicipio} - ${destinatarioUf}`,

          codigoMunicipio:
            destinatarioCodigoMunicipio,

          codigoPais:
            "1058",

          nomePais:
            "Brasil",

          uf:
            destinatarioUf,

          cep:
            destinatarioCep,
        },

        config: {
          serie:
            emissaoAtual.serie,

          numeroNota:
            emissaoAtual.numero,

          codigoNumerico:
            texto(
              emissaoAtual
                .codigo_numerico
            ),

          dataSaida:
            dataHoraFiscal,

          dataEmissao:
            dataHoraFiscal,

          fusoHorario:
            fusoHorario,

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
            texto(
              fiscal
                .natureza_operacao_padrao
            ),

          informacaoComplementar:
            fiscal
              .informacao_complementar_padrao,

          tipo:
            "1",

          frete:
            "9",

          finalidade:
            "1",

          informacaoAdicionalFisco:
            "",

          notaFiscalReferencia:
            "",

          numeroVenda:
            "",
        },

        pagamento: {
          troco,

          detalhamento: [
            {
              tipo:
                tipoPagamento,

              valor:
                total,

              indicadorPagamento,
            },
          ],
        },

        itens: [
          item,
        ],
      });

    // ========================================================
    // 6. Claim atômico da transmissão
    // ========================================================

    const claim = await claimTentativaEmissaoFiscal({
      admin,
      empresaId,
      emissaoId,
      usuarioId: String(claimsData.claims.sub),
      payload,
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

    // ========================================================
    // 7. POST real à Geranet via cliente comum
    // ========================================================

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
    } catch (e) {
      const persistencia =
        persistenciaFalhaComunicacaoEmitir(e);

      await admin
        .from(
          "fiscal_emissoes"
        )
        .update({
          status:
            persistencia.status,
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

      return erro(
        persistencia.retransmitir
          ? `${persistencia.motivo} A mesma emissão pode ser enviada novamente sem novo número.`
          : mensagemResultadoRemotoNaoConclusivo("55"),
        persistencia.retransmitir ? 502 : 409,
        {
          emissao_id:
            emissaoId,
          serie:
            emissaoAtual.serie,
          numero:
            String(
              emissaoAtual.numero
            ),
          status:
            persistencia.status,
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
      situacao ===
        "sucesso" &&
      /^\d{44}$/.test(chave) &&
      protocolo.length > 0;

    // ========================================================
    // 8. Persistência da resposta
    // ========================================================

    if (autorizado) {
      const {
        error: updateError,
      } = await admin
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
            texto(geranet.xml) ||
            null,
          pdf_hex:
            texto(geranet.pdf) ||
            null,
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

      if (updateError) {
        // A nota já foi autorizada externamente.
        // Nunca sugerir retransmissão neste caso.
        return erro(
          "A Geranet informou autorização, mas houve falha ao persistir o resultado local. NÃO retransmita.",
          500,
          {
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
              ),
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

      return json({
        ok: true,
        autorizada: true,

        ambiente:
          "homologacao",

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

        xml_armazenado:
          Boolean(
            texto(
              geranet.xml
            )
          ),

        pdf_armazenado:
          Boolean(
            texto(
              geranet.pdf
            )
          ),

        politica_ibscbs:
          politicaIbscbs,
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

      await admin
        .from(
          "fiscal_emissoes"
        )
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
          motivo:
            motivoTecnico,
          erro_comunicacao:
            motivoTecnico,
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
          ? `${motivoTecnico} A mesma emissão pode ser enviada novamente sem novo número.`
          : mensagemResultadoRemotoNaoConclusivo("55"),
        persistencia.retransmitir ? 502 : 409,
        {
          emissao_id:
            emissaoId,
          status: persistencia.status,
          serie:
            emissaoAtual.serie,
          numero:
            String(
              emissaoAtual.numero
            ),
          geranet:
            resumo,
        }
      );
    }

    // Erro explícito / 4xx / 422.
    await admin
      .from(
        "fiscal_emissoes"
      )
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
      "NF-e rejeitada.",
      respostaHttpStatus === 401
        ? 401
        : 422,
      {
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
      }
    );
  } catch (e) {
    console.error(
      "[NFE55 EMITIR HOMOLOGACAO]",
      e instanceof Error
        ? e.message
        : "Erro desconhecido"
    );

    return erro(
      e instanceof Error
        ? e.message
        : "Erro interno na emissão.",
      500
    );
  }
}