import Link from "next/link";

import {
  notFound,
  redirect,
} from "next/navigation";

import {
  EmitirNfeVendaButton,
} from "@/components/vendas/emitir-nfe-venda-button";
import { ReconciliarEmissaoFiscal } from "@/components/vendas/reconciliar-emissao-fiscal";
import { NaturezaOperacaoVendaForm } from "@/components/vendas/natureza-operacao-venda-form";
import {
  TransporteVendaForm,
  type DadosTransporteVenda,
} from "@/components/vendas/transporte-venda-form";

import {
  createClient,
} from "@/lib/supabase/server";
import {
  camposIpiDoGrupo,
  parsePerfilIpi,
  pendenciasIpiDocumento,
} from "@/lib/fiscal/ipi";
import {
  classificacaoResumoDaEmissao,
  resolverApresentacaoEmissaoFiscal,
} from "@/lib/fiscal/apresentacao-emissao";
import { resolverEstadoOperacionalDeEmissaoPersistida } from "@/lib/fiscal/estado-operacional-fiscal";
import {
  MENSAGEM_NATUREZA_VENDA_AUSENTE,
  type NaturezaOperacaoFiscal,
} from "@/lib/fiscal/operacoes/catalogo";
import {
  escolherNaturezaParaVenda,
  naturezaEstaCompleta,
} from "@/lib/fiscal/operacoes/resolver-natureza";
import {
  ehTipoDestinoCfop,
  normalizarRegrasCfopDaEmpresaAtiva,
  resolverCfopEfetivo,
} from "@/lib/fiscal/operacoes/resolver-cfop";
import {
  filtrarRegistrosDaEmpresaAtiva,
} from "@/lib/empresa/assert-registro-empresa-ativa";
import {
  conferenciaFinanceiraVenda,
  filtrarPagamentosFinanceiros,
} from "@/lib/vendas/pagamentos-financeiros";
import { resolverDestinatarioFiscalDaOrigem } from "@/lib/fiscal/destinatario/resolver-destinatario-fiscal";

export const dynamic =
  "force-dynamic";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

type Check = {
  ok: boolean;
  titulo: string;
  detalhe: string;
};

const moeda =
  new Intl.NumberFormat(
    "pt-BR",
    {
      style:
        "currency",
      currency:
        "BRL",
    }
  );

function texto(
  valor: unknown
) {
  return String(
    valor ?? ""
  ).trim();
}

function digitos(
  valor: unknown
) {
  return texto(
    valor
  ).replace(
    /\D/g,
    ""
  );
}

function formatarData(
  valor:
    | string
    | null
    | undefined
) {
  if (!valor) {
    return "—";
  }

  const data =
    new Date(
      valor
    );

  if (
    Number.isNaN(
      data.getTime()
    )
  ) {
    return "—";
  }

  return new Intl.DateTimeFormat(
    "pt-BR",
    {
      dateStyle:
        "short",
      timeStyle:
        "short",
    }
  ).format(
    data
  );
}

function statusLabel(
  valor:
    | string
    | null
) {
  return texto(
    valor
  )
    .replace(
      /_/g,
      " "
    )
    .replace(
      /\b\w/g,
      (
        letra
      ) =>
        letra.toUpperCase()
    );
}

function checkClass(
  ok: boolean
) {
  return ok
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-red-200 bg-red-50 text-red-800";
}

export default async function VendaNfePage({
  params,
}: PageProps) {
  const {
    id,
  } =
    await params;

  const supabase =
    await createClient();

  const {
    data:
      claimsData,
    error:
      authError,
  } =
    await supabase.auth.getClaims();

  if (
    authError ||
    !claimsData
      ?.claims
      ?.sub
  ) {
    redirect(
      "/login"
    );
  }

  const {
    data:
      vinculo,
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

  if (
    !vinculo
  ) {
    redirect(
      "/onboarding"
    );
  }

  const empresaId =
    vinculo
      .empresa_id;

  const [
    vendaResult,
    itensResult,
    pagamentosResult,
    fiscalResult,
    numeracoesResult,
    emissoesResult,
    naturezaVendaResult,
    transportadorasResult,
  ] =
    await Promise.all([
      supabase
        .from("vendas")
        .select(`
          id,
          numero,
          cliente_id,
          status,
          valor_total,
          troco,
          acrescimo,
          frete,
          natureza_id,
          snapshot_fiscal,
          dados_transporte,
          finalizada_at,
          created_at
        `)
        .eq(
          "empresa_id",
          empresaId
        )
        .eq(
          "id",
          id
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
          id
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
          status
        `)
        .eq(
          "empresa_id",
          empresaId
        )
        .eq(
          "venda_id",
          id
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
          "empresas_fiscal"
        )
        .select(`
          empresa_id,
          inscricao_estadual,
          codigo_regime_tributario,
          perfil_ipi,
          ambiente,
          uf,
          natureza_operacao_padrao,
          fuso_horario,
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

      supabase
        .from(
          "fiscal_emissoes"
        )
        .select(`
          id,
          modelo,
          serie,
          numero,
          ambiente,
          status,
          chave_acesso,
          protocolo,
          cstat,
          motivo,
          geranet_http_status,
          geranet_situacao,
          erro_comunicacao,
          resposta_resumo,
          created_at
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
          "origem_tipo",
          "venda"
        )
        .eq(
          "origem_id",
          id
        )
        .order(
          "created_at",
          {
            ascending:
              false,
          }
        )
        .limit(
          5
        ),

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
        )
        .order("padrao", { ascending: false })
        .order("descricao"),

      supabase
        .from("transportadoras")
        .select(`
          id,
          nome_razao_social,
          nome_fantasia,
          cpf_cnpj,
          inscricao_estadual,
          rntrc,
          telefone,
          email,
          logradouro,
          numero,
          complemento,
          bairro,
          municipio,
          codigo_municipio_ibge,
          uf,
          cep
        `)
        .eq("empresa_id", empresaId)
        .eq("ativo", true)
        .order("nome_razao_social"),
    ]);

  if (
    vendaResult
      .error
  ) {
    throw new Error(
      `Erro ao carregar venda: ${vendaResult.error.message}`
    );
  }

  if (
    !vendaResult
      .data
  ) {
    notFound();
  }

  if (
    itensResult
      .error
  ) {
    throw new Error(
      `Erro ao carregar itens: ${itensResult.error.message}`
    );
  }

  if (
    pagamentosResult
      .error
  ) {
    throw new Error(
      `Erro ao carregar pagamentos: ${pagamentosResult.error.message}`
    );
  }

  if (
    naturezaVendaResult.error
  ) {
    throw new Error(
      `Erro ao carregar natureza de operação: ${naturezaVendaResult.error.message}`
    );
  }

  if (
    transportadorasResult.error
  ) {
    throw new Error(
      `Erro ao carregar transportadoras: ${transportadorasResult.error.message}`
    );
  }

  const naturezasVenda = filtrarRegistrosDaEmpresaAtiva(
    (naturezaVendaResult.data ?? []) as NaturezaOperacaoFiscal[],
    empresaId
  ).filter(
    (natureza) =>
      natureza.tipo_operacao_interno === "venda" &&
      natureza.ativo
  );

  const venda =
    vendaResult
      .data;

  const itens =
    itensResult
      .data ??
    [];

  const pagamentos =
    pagamentosResult
      .data ??
    [];

  const fiscal =
    fiscalResult
      .data;

  const ambienteAtual =
    Number(
      fiscal?.ambiente
    ) === 1
      ? 1
      : 2;

  const numeracoes =
    (
      numeracoesResult
        .data ??
      []
    ).filter(
      (item) =>
        Number(
          item.ambiente
        ) ===
        ambienteAtual
    );

  const emissoes =
    emissoesResult
      .data ??
    [];

  const naturezaResolvida = escolherNaturezaParaVenda({
    empresaIdAtiva: empresaId,
    naturezaIdVenda: venda.natureza_id,
    naturezas: naturezasVenda,
  });
  const naturezaVenda = naturezaResolvida.ok
    ? naturezaResolvida.natureza
    : null;

  const transportadorasCadastro = transportadorasResult.data ?? [];
  const transportadorasIds = transportadorasCadastro.map((item) => item.id);
  let veiculosCadastro: Array<{
    id: string;
    transportadora_id: string;
    placa: string;
    uf: string | null;
    rntrc: string | null;
    descricao: string | null;
  }> = [];

  if (transportadorasIds.length > 0) {
    const { data: veiculos, error: veiculosError } = await supabase
      .from("transportadoras_veiculos")
      .select("id, transportadora_id, placa, uf, rntrc, descricao")
      .eq("empresa_id", empresaId)
      .eq("ativo", true)
      .in("transportadora_id", transportadorasIds)
      .order("placa");

    if (veiculosError) {
      throw new Error(
        `Erro ao carregar veículos das transportadoras: ${veiculosError.message}`
      );
    }

    veiculosCadastro = veiculos ?? [];
  }

  const transportadorasParaVenda = transportadorasCadastro.map(
    (transportadora) => ({
      id: transportadora.id,
      nome_razao_social: transportadora.nome_razao_social,
      nome_fantasia: transportadora.nome_fantasia ?? "",
      cpf_cnpj: transportadora.cpf_cnpj,
      inscricao_estadual: transportadora.inscricao_estadual ?? "",
      rntrc: transportadora.rntrc ?? "",
      telefone: transportadora.telefone ?? "",
      email: transportadora.email ?? "",
      logradouro: transportadora.logradouro ?? "",
      numero: transportadora.numero ?? "",
      complemento: transportadora.complemento ?? "",
      bairro: transportadora.bairro ?? "",
      municipio: transportadora.municipio ?? "",
      codigo_municipio_ibge: transportadora.codigo_municipio_ibge ?? "",
      uf: transportadora.uf ?? "",
      cep: transportadora.cep ?? "",
      veiculos: veiculosCadastro
        .filter((veiculo) => veiculo.transportadora_id === transportadora.id)
        .map((veiculo) => ({
          id: veiculo.id,
          placa: veiculo.placa,
          uf: veiculo.uf ?? "",
          rntrc: veiculo.rntrc ?? "",
          descricao: veiculo.descricao ?? "",
        })),
    })
  );

  const possuiFiscalTransporteBloqueante = emissoes.some(
    (emissao) =>
      !resolverEstadoOperacionalDeEmissaoPersistida(emissao).podeEditarFiscal
  );

  let cliente:
    | {
        id: string;
        nome: string;
        nome_fantasia:
          | string
          | null;
        tipo_pessoa:
          string;
        cpf_cnpj:
          | string
          | null;
        inscricao_estadual:
          | string
          | null;
        contribuinte_icms:
          boolean;
        indicador_ie_destinatario?:
          string
          | null;
        consumidor_final:
          boolean;
        telefone:
          | string
          | null;
        email:
          | string
          | null;
        cep:
          | string
          | null;
        logradouro:
          | string
          | null;
        numero:
          | string
          | null;
        complemento:
          | string
          | null;
        bairro:
          | string
          | null;
        municipio:
          | string
          | null;
        codigo_municipio_ibge:
          | string
          | null;
        uf:
          | string
          | null;
        ativo:
          boolean;
      }
    | null =
      null;

  if (
    venda.cliente_id
  ) {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          "clientes"
        )
        .select(`
          id,
          nome,
          nome_fantasia,
          tipo_pessoa,
          cpf_cnpj,
          inscricao_estadual,
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
          venda
            .cliente_id
        )
        .maybeSingle();

    if (
      error
    ) {
      throw new Error(
        `Erro ao carregar destinatário: ${error.message}`
      );
    }

    cliente =
      data;
  }

  const { data: operacaoVenda } =
    await supabase
      .from("fiscal_operacoes")
      .select("id, empresa_id, snapshot_fiscal")
      .eq("empresa_id", empresaId)
      .eq("venda_id", venda.id)
      .maybeSingle();

  const destinatarioFiscal =
    resolverDestinatarioFiscalDaOrigem({
      modelo: "55",
      tipoOperacaoInterno: "venda",
      origemVenda: "pdv",
      snapshotOperacao:
        operacaoVenda &&
        String(operacaoVenda.empresa_id) ===
          String(empresaId)
          ? operacaoVenda.snapshot_fiscal
          : null,
      snapshotVenda: venda.snapshot_fiscal,
      contribuinteIcms:
        cliente?.contribuinte_icms,
      indicadorIeCadastro:
        cliente?.indicador_ie_destinatario,
      consumidorFinalCadastro:
        cliente?.consumidor_final,
    });

  const produtoIds =
    Array.from(
      new Set(
        itens
          .map(
            (
              item
            ) =>
              item
                .produto_id
          )
          .filter(
            (
              produtoId
            ): produtoId is string =>
              Boolean(
                produtoId
              )
          )
      )
    );

  const [
    produtosResult,
    produtosFiscalResult,
  ] =
    produtoIds.length >
    0
      ? await Promise.all([
          supabase
            .from(
              "produtos"
            )
            .select(`
              id,
              grupo_fiscal_id
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
        ])
      : [
          {
            data:
              [],
            error:
              null,
          },
          {
            data:
              [],
            error:
              null,
          },
        ];

  if (
    produtosResult
      .error
  ) {
    throw new Error(
      produtosResult
        .error
        .message
    );
  }

  if (
    produtosFiscalResult
      .error
  ) {
    throw new Error(
      produtosFiscalResult
        .error
        .message
    );
  }

  const produtosMap =
    new Map(
      (
        produtosResult
          .data ??
        []
      ).map(
        (
          produto
        ) => [
          produto.id,
          produto,
        ] as const
      )
    );

  const fiscalProdutoMap =
    new Map(
      (
        produtosFiscalResult
          .data ??
        []
      ).map(
        (
          produtoFiscal
        ) => [
          produtoFiscal
            .produto_id,
          produtoFiscal,
        ] as const
      )
    );

  const grupoIds =
    Array.from(
      new Set(
        [
          ...itens.map(
            (
              item
            ) =>
              item
                .grupo_fiscal_id
          ),
          ...Array.from(
            produtosMap
              .values()
          ).map(
            (
              produto
            ) =>
              produto
                .grupo_fiscal_id
          ),
        ].filter(
          (
            grupoId
          ): grupoId is string =>
            Boolean(
              grupoId
            )
        )
      )
    );

  const gruposResult =
    grupoIds.length >
    0
      ? await supabase
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
            cofins_cst,
            ipi_aplicavel,
            ipi_cst,
            ipi_aliquota,
            ipi_enquadramento
          `)
          .eq(
            "empresa_id",
            empresaId
          )
          .in(
            "id",
            grupoIds
          )
      : {
          data:
            [],
          error:
            null,
        };

  if (
    gruposResult
      .error
  ) {
    throw new Error(
      gruposResult
        .error
        .message
    );
  }

  const regrasCfopResult =
    naturezaVenda?.id
      ? await supabase
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
            naturezaVenda.id
          )
          .eq(
            "ativo",
            true
          )
      : {
          data:
            [],
          error:
            null,
        };

  if (
    regrasCfopResult
      .error
  ) {
    throw new Error(
      regrasCfopResult
        .error
        .message
    );
  }

  const regrasCfop =
    normalizarRegrasCfopDaEmpresaAtiva(
      regrasCfopResult.data,
      empresaId
    );

  const gruposMap =
    new Map(
      (
        gruposResult
          .data ??
        []
      ).map(
        (
          grupo
        ) => [
          grupo.id,
          grupo,
        ] as const
      )
    );

  const ufEmitente =
    texto(
      fiscal?.uf
    ).toUpperCase();

  const ufCliente =
    texto(
      cliente?.uf
    ).toUpperCase();

  const operacao =
    ufEmitente &&
    ufCliente &&
    ufEmitente !==
      ufCliente
      ? "interestadual"
      : "interna";

  const itensResolvidos =
    itens.map(
      (
        item
      ) => {
        const produto =
          produtosMap.get(
            item
              .produto_id
          );

        const produtoFiscal =
          fiscalProdutoMap.get(
            item
              .produto_id
          );

        const grupoId =
          item
            .grupo_fiscal_id ??
          produto
            ?.grupo_fiscal_id ??
          null;

        const grupo =
          grupoId
            ? gruposMap.get(
                grupoId
              )
            : undefined;

        return {
          ...item,
          grupo_fiscal_resolvido:
            grupoId,
          ncm_resolvido:
            texto(
              item.ncm ??
              produtoFiscal
                ?.ncm
            ),
          origem_resolvida:
            texto(
              item
                .origem_produto ??
              produtoFiscal
                ?.origem_produto
            ),
          ...(() => {
            const destino = ehTipoDestinoCfop(operacao)
              ? operacao
              : "interna";
            const resolvido = resolverCfopEfetivo({
              tipoOperacaoInterno: "venda",
              tipoDestino: destino,
              grupoFiscal: {
                nome: grupo?.nome,
                cfopInterno: grupo?.cfop_interno,
                cfopInterestadual: grupo?.cfop_interestadual,
              },
              naturezaId: naturezaVenda?.id,
              grupoFiscalId: grupoId,
              regras: regrasCfop,
              empresaIdAtiva: empresaId,
              naturezaPadrao: Boolean(naturezaVenda?.padrao),
              naturezaDescricao: naturezaVenda?.descricao,
            });

            return {
              cfop_resolvido: resolvido.ok ? resolvido.cfop : "",
              cfop_mensagem: resolvido.ok ? null : resolvido.mensagem,
            };
          })(),
          icms_resolvido:
            texto(
              item
                .icms_cst_csosn ??
              grupo
                ?.icms_cst_csosn
            ),
          pis_resolvido:
            texto(
              item
                .pis_cst ??
              grupo
                ?.pis_cst
            ),
          cofins_resolvido:
            texto(
              item
                .cofins_cst ??
              grupo
                ?.cofins_cst
            ),
        };
      }
    );

  const checks:
    Check[] = [];

  checks.push({
    ok:
      venda.status ===
      "finalizada",
    titulo:
      "Venda finalizada",
    detalhe:
      venda.status ===
      "finalizada"
        ? "A venda comercial está finalizada."
        : `Status atual: ${statusLabel(
            venda.status
          )}.`,
  });

  checks.push({
    ok:
      Boolean(
        cliente &&
        cliente.ativo
      ),
    titulo:
      "Destinatário",
    detalhe:
      cliente
        ? `${cliente.nome} · ${cliente.tipo_pessoa === "J" ? "Pessoa jurídica" : "Pessoa física"}`
        : "NF-e exige cliente identificado na venda.",
  });

  const documento =
    digitos(
      cliente
        ?.cpf_cnpj
    );

  checks.push({
    ok:
      Boolean(
        cliente
      ) &&
      (
        (
          cliente
            ?.tipo_pessoa ===
            "F" &&
          documento.length ===
            11
        ) ||
        (
          cliente
            ?.tipo_pessoa ===
            "J" &&
          documento.length ===
            14
        )
      ),
    titulo:
      "CPF/CNPJ",
    detalhe:
      documento
        ? documento
        : "Documento não informado.",
  });

  const enderecoOk =
    Boolean(
      cliente &&
      digitos(
        cliente.cep
      ).length === 8 &&
      texto(
        cliente.logradouro
      ) &&
      texto(
        cliente.numero
      ) &&
      texto(
        cliente.bairro
      ) &&
      texto(
        cliente.municipio
      ) &&
      digitos(
        cliente
          .codigo_municipio_ibge
      ).length === 7 &&
      /^[A-Z]{2}$/.test(
        texto(
          cliente.uf
        ).toUpperCase()
      )
    );

  checks.push({
    ok:
      enderecoOk,
    titulo:
      "Endereço fiscal do destinatário",
    detalhe:
      enderecoOk
        ? `${cliente?.logradouro}, ${cliente?.numero} · ${cliente?.bairro} · ${cliente?.municipio}/${texto(cliente?.uf).toUpperCase()} · CEP ${cliente?.cep}`
        : "CEP, logradouro, número, bairro, município, código IBGE e UF são obrigatórios.",
  });

  checks.push({
    ok:
      !cliente
        ?.contribuinte_icms ||
      Boolean(
        texto(
          cliente
            ?.inscricao_estadual
        )
      ),
    titulo:
      "Inscrição Estadual do destinatário",
    detalhe:
      cliente
        ?.contribuinte_icms
        ? texto(
            cliente
              .inscricao_estadual
          )
          ? `Contribuinte ICMS · IE ${cliente.inscricao_estadual}`
          : "Cliente contribuinte ICMS sem IE."
        : "Não contribuinte · indIEDest = 9.",
  });

  checks.push({
    ok:
      itens.length >
      0,
    titulo:
      "Itens da venda",
    detalhe:
      `${itens.length} item(ns). Operação ${operacao}.`,
  });

  const perfilIpi = parsePerfilIpi(
    fiscal?.perfil_ipi
  );

  const pendenciasIpi = pendenciasIpiDocumento({
    modelo: "55",
    perfilIpi,
    grupos: (gruposResult.data ?? []).map(
      (grupo) => ({
        nome: null,
        ...camposIpiDoGrupo(grupo),
      })
    ),
  });

  checks.push({
    ok: pendenciasIpi.length === 0,
    titulo: "Perfil e IPI para NF-e",
    detalhe:
      pendenciasIpi.length === 0
        ? perfilIpi === "NAO_CONTRIBUINTE"
          ? "Não contribuinte de IPI · grupo IPI omitido."
          : perfilIpi
            ? `Perfil IPI ${perfilIpi.replaceAll("_", " ").toLowerCase()}.`
            : "Perfil IPI configurado."
        : pendenciasIpi[0],
  });

  for (
    const [
      indice,
      item,
    ] of
      itensResolvidos.entries()
  ) {
    const erros:
      string[] =
        [];

    if (
      digitos(
        item
          .ncm_resolvido
      ).length !== 8
    ) {
      erros.push(
        "NCM"
      );
    }

    if (
      !/^\d{4}$/.test(
        item
          .cfop_resolvido
      )
    ) {
      erros.push(
        operacao ===
        "interna"
          ? "CFOP interno"
          : "CFOP interestadual"
      );
    }

    if (
      !/^\d$/.test(
        item
          .origem_resolvida
      )
    ) {
      erros.push(
        "origem"
      );
    }

    if (
      !item
        .icms_resolvido
    ) {
      erros.push(
        "ICMS/CSOSN"
      );
    }

    if (
      !/^\d{2}$/.test(
        item
          .pis_resolvido
      )
    ) {
      erros.push(
        "PIS CST"
      );
    }

    if (
      !/^\d{2}$/.test(
        item
          .cofins_resolvido
      )
    ) {
      erros.push(
        "COFINS CST"
      );
    }

    checks.push({
      ok:
        erros.length ===
        0,
      titulo:
        `Item ${indice + 1}: ${item.produto_nome}`,
      detalhe:
        erros.length ===
        0
          ? `NCM ${item.ncm_resolvido} · CFOP ${item.cfop_resolvido} · ICMS ${item.icms_resolvido} · PIS ${item.pis_resolvido} · COFINS ${item.cofins_resolvido}`
          : item.cfop_mensagem
            ? `${item.cfop_mensagem}${
                erros.filter((erro) => erro !== "CFOP interno" && erro !== "CFOP interestadual").length > 0
                  ? ` Também falta/está inválido: ${erros.filter((erro) => erro !== "CFOP interno" && erro !== "CFOP interestadual").join(", ")}.`
                  : ""
              }`
            : `Falta/está inválido: ${erros.join(", ")}.`,
    });
  }

  const pagamentosAtuais =
    filtrarPagamentosFinanceiros(
      pagamentos
    );

  const pagamentosValidos =
    pagamentosAtuais.length >
      0 &&
    pagamentosAtuais.every(
      (
        pagamento
      ) =>
        /^\d{2}$/.test(
          texto(
            pagamento
              .codigo_fiscal
          )
        )
    );

  checks.push({
    ok:
      pagamentosValidos,
    titulo:
      "Pagamentos",
    detalhe:
      pagamentosValidos
        ? `${pagamentosAtuais.length} pagamento(s) vigente(s) com tPag válido.`
        : "Os pagamentos vigentes precisam ter código fiscal tPag.",
  });

  const conferencia =
    conferenciaFinanceiraVenda({
      valorTotal:
        venda.valor_total,
      pagamentos,
      troco:
        venda.troco,
    });

  const totalLiquido =
    conferencia.pagamentosLiquidos;

  checks.push({
    ok:
      conferencia.ok,
    titulo:
      "Conferência financeira",
    detalhe:
      `Venda ${moeda.format(conferencia.valorVenda)} · pagamentos líquidos ${moeda.format(totalLiquido)}.`,
  });

  checks.push({
    ok:
      Number(
        venda.acrescimo ??
        0
      ) === 0 &&
      Number(
        venda.frete ??
        0
      ) === 0 &&
      !itens.some(
        (
          item
        ) =>
          Number(
            item.acrescimo ??
            0
          ) > 0
      ),
    titulo:
      "Totais suportados nesta primeira NF-e",
    detalhe:
      "Nesta etapa: sem acréscimo e sem valor de frete; modFrete 9.",
  });

  checks.push({
    ok:
      Boolean(
        fiscal?.ativo
      ) &&
      Boolean(
        texto(
          fiscal
            ?.inscricao_estadual
        )
      ) &&
      /^[A-Z]{2}$/.test(
        ufEmitente
      ),
    titulo:
      "Configuração fiscal do emitente",
    detalhe:
      fiscal?.ativo
        ? `${ambienteAtual === 1 ? "Produção" : "Homologação"} · UF ${ufEmitente || "—"}.`
        : "Configuração fiscal ausente ou inativa.",
  });

  checks.push({
    ok:
      naturezaEstaCompleta(
        naturezaVenda,
        empresaId
      ),
    titulo:
      "Natureza de operação (Venda)",
    detalhe:
      naturezaEstaCompleta(
        naturezaVenda,
        empresaId
      )
        ? `${texto(naturezaVenda?.descricao)} · tpNF ${texto(naturezaVenda?.tp_nf)} · finNFe ${texto(naturezaVenda?.fin_nfe)}${naturezaResolvida.ok && naturezaResolvida.origem === "venda" ? " · selecionada nesta venda" : " · padrão da empresa"}.`
        : naturezaResolvida.ok
          ? MENSAGEM_NATUREZA_VENDA_AUSENTE
          : naturezaResolvida.mensagem,
  });

  checks.push({
    ok:
      numeracoes.length ===
      1,
    titulo:
      "Numeração NF-e modelo 55",
    detalhe:
      numeracoes.length ===
      1
        ? `Série ${numeracoes[0].serie} · próximo número ${numeracoes[0].proximo_numero}.`
        : numeracoes.length ===
          0
        ? "Nenhuma série NF-e 55 ativa."
        : "Existe mais de uma série NF-e 55 ativa.",
  });

  const autorizada =
    emissoes.find(
      (
        emissao
      ) =>
        emissao
          .status ===
        "autorizada"
    );

  const apresentacoes = emissoes.map((emissao) => ({
    emissao,
    ui: resolverApresentacaoEmissaoFiscal({
      modelo: emissao.modelo,
      status: emissao.status,
      classificacao: classificacaoResumoDaEmissao(emissao.resposta_resumo),
      cstat: emissao.cstat,
      motivo: emissao.motivo,
      protocolo: emissao.protocolo,
      chaveAcesso: emissao.chave_acesso,
      geranetHttpStatus: emissao.geranet_http_status,
      geranetSituacao: emissao.geranet_situacao,
      erroComunicacao: emissao.erro_comunicacao,
    }),
  }));

  const emissaoPendenteConsulta = apresentacoes.find(
    (item) => item.ui.caso === "aguardando_reconciliacao"
  )?.emissao;

  const emissaoNaoTransmitida = apresentacoes.find(
    (item) => item.ui.caso === "nao_transmitida"
  )?.emissao;

  const emissaoNaoClassificada = apresentacoes.find(
    (item) => item.ui.caso === "nao_classificada"
  )?.emissao;

  const ambigua =
    emissoes.find((emissao) => {
      const estado = resolverEstadoOperacionalDeEmissaoPersistida(emissao);
      return (
        estado.documentoFiscalAmbiguo ||
        estado.estado === "inutilizacao" ||
        estado.estado === "nao_classificada"
      );
    });

  checks.push({
    ok:
      !ambigua,
    titulo:
      "Segurança contra retransmissão",
    detalhe:
      autorizada
        ? `NF-e já autorizada: série ${autorizada.serie}, número ${autorizada.numero}.`
        : ambigua
        ? ambigua.status ===
          "aguardando_inutilizacao"
          ? `Existe NF-e série ${ambigua.serie} nº ${ambigua.numero} aguardando inutilização. Conclua a inutilização antes de emitir novamente.`
          : `Existe emissão ${statusLabel(ambigua.status)}; não retransmitir. Reconcilie primeiro essa transmissão.`
        : "Nenhuma emissão NF-e ambígua vinculada à venda.",
  });

  const bloqueios =
    checks.filter(
      (
        check
      ) =>
        !check.ok
    );

  const pronta =
    bloqueios.length ===
      0 &&
    !autorizada;

  return (
    <main className="min-h-full p-4 md:p-6">
      <section className="mx-auto max-w-[1200px] space-y-4">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <Link
            href={`/vendas/${venda.id}`}
            className="text-sm font-medium text-zinc-500 transition hover:text-zinc-950"
          >
            ← Voltar para venda
          </Link>

          <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-500">
                Conferência fiscal
              </p>

              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
                NF-e modelo 55 · Venda #{venda.numero ?? "—"}
              </h1>

              <p className="mt-1 text-sm text-zinc-500">
                {formatarData(venda.finalizada_at ?? venda.created_at)}
                {" · "}
                {moeda.format(Number(venda.valor_total ?? 0))}
                {" · "}
                {operacao === "interestadual" ? "Interestadual" : "Interna"}
                {naturezaEstaCompleta(naturezaVenda, empresaId)
                  ? ` · ${texto(naturezaVenda?.descricao)} · tpNF ${texto(naturezaVenda?.tp_nf)} · finNFe ${texto(naturezaVenda?.fin_nfe)}`
                  : ""}
              </p>
            </div>

            <div
              className={[
                "rounded-xl border px-4 py-3 text-sm font-semibold",
                autorizada || pronta
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-red-200 bg-red-50 text-red-800",
              ].join(" ")}
            >
              {
                autorizada
                  ? "NF-e já autorizada"
                  : pronta
                  ? "Pronta para emissão"
                  : `${bloqueios.length} bloqueio(s)`
              }
            </div>
          </div>
        </div>

        {
          cliente && (
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <h2 className="font-semibold text-zinc-950">
                Destinatário
              </h2>

              <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                <p>
                  <span className="text-zinc-500">Nome:</span>{" "}
                  <strong>{cliente.nome}</strong>
                </p>

                <p>
                  <span className="text-zinc-500">CPF/CNPJ:</span>{" "}
                  <strong>{cliente.cpf_cnpj ?? "—"}</strong>
                </p>

                <p>
                  <span className="text-zinc-500">IE:</span>{" "}
                  <strong>{cliente.inscricao_estadual ?? "Não contribuinte"}</strong>
                </p>

                <p>
                  <span className="text-zinc-500">Indicador IE:</span>{" "}
                  <strong>
                    {destinatarioFiscal.indicadorIEdestinatario === "1"
                      ? "Contribuinte"
                      : destinatarioFiscal.indicadorIEdestinatario === "2"
                        ? "Isento"
                        : "Não contribuinte"}
                  </strong>
                </p>

                <p>
                  <span className="text-zinc-500">Consumidor final desta operação:</span>{" "}
                  <strong>{destinatarioFiscal.consumidorFinal === "1" ? "Sim" : "Não"}</strong>
                </p>

                <p className="md:col-span-2">
                  <span className="text-zinc-500">Endereço:</span>{" "}
                  <strong>
                    {cliente.logradouro ?? "—"}, {cliente.numero ?? "—"} · {cliente.bairro ?? "—"} · {cliente.municipio ?? "—"}/{texto(cliente.uf).toUpperCase()} · CEP {cliente.cep ?? "—"}
                  </strong>
                </p>
              </div>
            </div>
          )
        }

        {
          venda.status === "finalizada" && (
            <>
              <NaturezaOperacaoVendaForm
                vendaId={venda.id}
                naturezas={naturezasVenda}
                naturezaIdAtual={
                  venda.natureza_id ?? naturezaVenda?.id ?? null
                }
                bloqueado={possuiFiscalTransporteBloqueante}
                motivoBloqueio={
                  possuiFiscalTransporteBloqueante
                    ? "Existe documento fiscal em estado sensível. Resolva a NF-e/NFC-e antes de alterar a natureza."
                    : undefined
                }
              />

              <TransporteVendaForm
                vendaId={venda.id}
                numero={venda.numero}
                dadosTransporte={
                  (venda.dados_transporte ?? null) as DadosTransporteVenda | null
                }
                transportadoras={transportadorasParaVenda}
                bloqueado={possuiFiscalTransporteBloqueante}
                motivoBloqueio={
                  possuiFiscalTransporteBloqueante
                    ? "Existe documento fiscal em estado sensível. Resolva a NF-e/NFC-e antes de alterar o transporte."
                    : undefined
                }
              />
            </>
          )
        }

        {
          autorizada && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
              <h2 className="font-semibold text-emerald-900">
                NF-e autorizada
              </h2>

              <div className="mt-3 grid gap-3 text-sm text-emerald-900 md:grid-cols-2">
                <p>
                  Série: <strong>{autorizada.serie}</strong>
                </p>
                <p>
                  Número: <strong>{autorizada.numero}</strong>
                </p>
                <p>
                  cStat: <strong>{autorizada.cstat ?? "—"}</strong>
                </p>
                <p>
                  Protocolo: <strong>{autorizada.protocolo ?? "—"}</strong>
                </p>
                <p className="break-all md:col-span-2">
                  Chave: <strong>{autorizada.chave_acesso ?? "—"}</strong>
                </p>
              </div>
            </div>
          )
        }

        <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-200 p-5">
            <h2 className="font-semibold text-zinc-950">
              Validações NF-e
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              A conferência não reserva número e não transmite.
            </p>
          </div>

          <div className="divide-y divide-zinc-100">
            {
              checks.map(
                (
                  check,
                  index
                ) => (
                  <div
                    key={`${check.titulo}-${index}`}
                    className="flex gap-3 p-4"
                  >
                    <div
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${checkClass(check.ok)}`}
                    >
                      {check.ok ? "✓" : "!"}
                    </div>

                    <div>
                      <p className="font-medium text-zinc-950">
                        {check.titulo}
                      </p>
                      <p className="mt-1 text-sm text-zinc-500">
                        {check.detalhe}
                      </p>
                    </div>
                  </div>
                )
              )
            }
          </div>
        </div>

        {
          emissaoPendenteConsulta && (
            <ReconciliarEmissaoFiscal
              emissaoId={emissaoPendenteConsulta.id}
              modelo={emissaoPendenteConsulta.modelo}
              serie={emissaoPendenteConsulta.serie}
              numero={emissaoPendenteConsulta.numero}
              status={emissaoPendenteConsulta.status}
              motivo={emissaoPendenteConsulta.motivo}
              cstat={emissaoPendenteConsulta.cstat}
              geranetHttpStatus={emissaoPendenteConsulta.geranet_http_status}
              geranetSituacao={emissaoPendenteConsulta.geranet_situacao}
              erroComunicacao={emissaoPendenteConsulta.erro_comunicacao}
              protocolo={emissaoPendenteConsulta.protocolo}
              chaveAcesso={emissaoPendenteConsulta.chave_acesso}
              classificacao={classificacaoResumoDaEmissao(
                emissaoPendenteConsulta.resposta_resumo
              )}
              destaque
            />
          )
        }

        {
          emissaoNaoTransmitida && (
            <ReconciliarEmissaoFiscal
              emissaoId={emissaoNaoTransmitida.id}
              modelo={emissaoNaoTransmitida.modelo}
              serie={emissaoNaoTransmitida.serie}
              numero={emissaoNaoTransmitida.numero}
              status={emissaoNaoTransmitida.status}
              motivo={emissaoNaoTransmitida.motivo}
              cstat={emissaoNaoTransmitida.cstat}
              geranetHttpStatus={emissaoNaoTransmitida.geranet_http_status}
              geranetSituacao={emissaoNaoTransmitida.geranet_situacao}
              erroComunicacao={emissaoNaoTransmitida.erro_comunicacao}
              protocolo={emissaoNaoTransmitida.protocolo}
              chaveAcesso={emissaoNaoTransmitida.chave_acesso}
              classificacao={classificacaoResumoDaEmissao(
                emissaoNaoTransmitida.resposta_resumo
              )}
              destaque
              retryVenda={{
                vendaId: venda.id,
                ambiente: ambienteAtual,
                serie: Number(emissaoNaoTransmitida.serie) || undefined,
              }}
            />
          )
        }

        {
          emissaoNaoClassificada && (
            <ReconciliarEmissaoFiscal
              emissaoId={emissaoNaoClassificada.id}
              modelo={emissaoNaoClassificada.modelo}
              serie={emissaoNaoClassificada.serie}
              numero={emissaoNaoClassificada.numero}
              status={emissaoNaoClassificada.status}
              motivo={emissaoNaoClassificada.motivo}
              cstat={emissaoNaoClassificada.cstat}
              geranetHttpStatus={emissaoNaoClassificada.geranet_http_status}
              geranetSituacao={emissaoNaoClassificada.geranet_situacao}
              erroComunicacao={emissaoNaoClassificada.erro_comunicacao}
              protocolo={emissaoNaoClassificada.protocolo}
              chaveAcesso={emissaoNaoClassificada.chave_acesso}
              classificacao={classificacaoResumoDaEmissao(
                emissaoNaoClassificada.resposta_resumo
              )}
              destaque
            />
          )
        }

        {
          !autorizada && !emissaoPendenteConsulta && !emissaoNaoTransmitida && !emissaoNaoClassificada && (
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="font-semibold text-zinc-950">
                    Emitir NF-e modelo 55
                  </h2>

                  <p className="mt-1 text-sm text-zinc-500">
                    {
                      pronta
                        ? `A venda passou pela conferência e pode ser transmitida em ${ambienteAtual === 1 ? "PRODUÇÃO" : "homologação"}.`
                        : "Corrija os bloqueios acima antes de transmitir."
                    }
                  </p>
                </div>

                {
                  pronta ? (
                    <EmitirNfeVendaButton
                      vendaId={venda.id}
                      ambiente={
                        ambienteAtual
                      }
                      serie={
                        numeracoes.length === 1
                          ? numeracoes[0].serie
                          : undefined
                      }
                    />
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-200 px-4 text-sm font-semibold text-zinc-500"
                    >
                      Emitir NF-e
                    </button>
                  )
                }
              </div>
            </div>
          )
        }

        {
          emissoes.length > 0 && (
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <h2 className="font-semibold text-zinc-950">
                Histórico NF-e da venda
              </h2>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                      <th className="py-2 pr-4">Data</th>
                      <th className="py-2 pr-4">Série</th>
                      <th className="py-2 pr-4">Número</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2">Motivo</th>
                    </tr>
                  </thead>

                  <tbody>
                    {
                      emissoes.map(
                        (
                          emissao
                        ) => (
                          <tr
                            key={emissao.id}
                            className="border-b border-zinc-100"
                          >
                            <td className="py-3 pr-4 text-zinc-600">
                              {formatarData(emissao.created_at)}
                            </td>
                            <td className="py-3 pr-4">{emissao.serie}</td>
                            <td className="py-3 pr-4">{emissao.numero}</td>
                            <td className="py-3 pr-4 font-medium">
                              {statusLabel(emissao.status)}
                            </td>
                            <td className="py-3 text-zinc-600">
                              {emissao.motivo ?? "—"}
                            </td>
                          </tr>
                        )
                      )
                    }
                  </tbody>
                </table>
              </div>
            </div>
          )
        }
      </section>
    </main>
  );
}
