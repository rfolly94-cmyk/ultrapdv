import Link from "next/link";
import {
  notFound,
  redirect,
} from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { EmitirNfceVendaButton } from "@/components/vendas/emitir-nfce-venda-button";
import { ReconciliarEmissaoFiscal } from "@/components/vendas/reconciliar-emissao-fiscal";
import {
  classificacaoResumoDaEmissao,
  resolverApresentacaoEmissaoFiscal,
} from "@/lib/fiscal/apresentacao-emissao";
import { resolverEstadoOperacionalDeEmissaoPersistida } from "@/lib/fiscal/estado-operacional-fiscal";
import {
  conferenciaFinanceiraVenda,
  filtrarPagamentosFinanceiros,
  filtrarPagamentosHistorico,
} from "@/lib/vendas/pagamentos-financeiros";

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
      style: "currency",
      currency: "BRL",
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
    new Date(valor);

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
      dateStyle: "short",
      timeStyle: "short",
    }
  ).format(data);
}

function statusLabel(
  valor:
    | string
    | null
) {
  return texto(valor)
    .replace(
      /_/g,
      " "
    )
    .replace(
      /\b\w/g,
      (letra) =>
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

export default async function VendaNfcePage({
  params,
}: PageProps) {
  const { id } =
    await params;

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
    redirect("/login");
  }

  const { data: vinculo } =
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
    redirect(
      "/onboarding"
    );
  }

  const empresaId =
    vinculo.empresa_id;

  const [
    vendaResult,
    itensResult,
    pagamentosResult,
    fiscalResult,
    nfceConfigResult,
    numeracoesResult,
    emissoesResult,
  ] = await Promise.all([
    supabase
      .from("vendas")
      .select(`
        id,
        numero,
        status,
        tipo_venda,
        modelo_fiscal_intencao,
        cliente_id,
        valor_produtos,
        desconto,
        acrescimo,
        frete,
        valor_total,
        troco,
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
          ascending: true,
        }
      ),

    supabase
      .from(
        "vendas_pagamentos"
      )
      .select(`
        id,
        forma_pagamento_id,
        forma_pagamento_codigo,
        forma_pagamento_nome,
        codigo_fiscal,
        indicador_pagamento,
        valor,
        quantidade_parcelas,
        bandeira,
        autorizacao,
        troco,
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
          ascending: true,
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
          ascending: true,
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
        reservada_at,
        enviada_at,
        respondida_at,
        autorizada_at,
        created_at
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
        id
      )
      .order(
        "created_at",
        {
          ascending: false,
        }
      )
      .limit(5),
  ]);

  if (
    vendaResult.error
  ) {
    throw new Error(
      `Erro ao carregar venda: ${vendaResult.error.message}`
    );
  }

  if (!vendaResult.data) {
    notFound();
  }

  if (
    itensResult.error
  ) {
    throw new Error(
      `Erro ao carregar itens: ${itensResult.error.message}`
    );
  }

  if (
    pagamentosResult.error
  ) {
    throw new Error(
      `Erro ao carregar pagamentos: ${pagamentosResult.error.message}`
    );
  }

  const venda =
    vendaResult.data;

  const itens =
    itensResult.data ?? [];

  const pagamentos =
    pagamentosResult.data ??
    [];

  const fiscal =
    fiscalResult.data;

  const nfceConfigs =
    nfceConfigResult.data ??
    [];

  const ambienteAtual =
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
        ambienteAtual
    );

  const emissoes =
    emissoesResult.data ??
    [];

  const produtoIds =
    Array.from(
      new Set(
        itens
          .map(
            (item) =>
              item.produto_id
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
            data: [],
            error: null,
          },
          {
            data: [],
            error: null,
          },
        ];

  if (
    produtosResult.error
  ) {
    throw new Error(
      produtosResult
        .error
        .message
    );
  }

  if (
    produtosFiscalResult.error
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
            (item) =>
              item.grupo_fiscal_id
          ),
          ...Array.from(
            produtosMap.values()
          ).map(
            (produto) =>
              produto.grupo_fiscal_id
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
            ativo,
            cfop_interno,
            icms_cst_csosn,
            pis_cst,
            cofins_cst
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
          data: [],
          error: null,
        };

  if (
    gruposResult.error
  ) {
    throw new Error(
      gruposResult
        .error
        .message
    );
  }

  const gruposMap =
    new Map(
      (
        gruposResult.data ??
        []
      ).map(
        (grupo) => [
          grupo.id,
          grupo,
        ] as const
      )
    );

  const itensResolvidos =
    itens.map(
      (item) => {
        const produto =
          produtosMap.get(
            item.produto_id
          );

        const produtoFiscal =
          fiscalProdutoMap.get(
            item.produto_id
          );

        const grupoId =
          item.grupo_fiscal_id ??
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
          grupo_fiscal_ativo:
            Boolean(
              grupo?.ativo
            ),
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
          cfop_resolvido:
            texto(
              item.cfop ??
              grupo
                ?.cfop_interno
            ),
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
        : `A venda está com status ${statusLabel(
            venda.status
          )}.`,
  });

  checks.push({
    ok:
      venda.modelo_fiscal_intencao !==
      "55",
    titulo:
      "Modelo compatível",
    detalhe:
      venda.modelo_fiscal_intencao ===
      "55"
        ? "Esta venda está marcada para NF-e modelo 55."
        : "A venda pode seguir para NFC-e modelo 65.",
  });

  checks.push({
    ok:
      itens.length > 0,
    titulo:
      "Itens da venda",
    detalhe:
      itens.length > 0
        ? `${itens.length} item(ns) encontrado(s).`
        : "A venda não possui itens.",
  });

  const possuiAcrescimoFrete =
    Number(
      venda.acrescimo ?? 0
    ) > 0 ||
    Number(
      venda.frete ?? 0
    ) > 0 ||
    itens.some(
      (item) =>
        Number(
          item.acrescimo ?? 0
        ) > 0
    );

  checks.push({
    ok:
      !possuiAcrescimoFrete,
    titulo:
      "Totais suportados pelo builder",
    detalhe:
      possuiAcrescimoFrete
        ? "Há acréscimo/frete que ainda não é representado pela rota NFC-e por venda."
        : "Venda sem acréscimo/frete incompatível com esta etapa.",
  });

  for (
    const [
      indice,
      item,
    ] of
      itensResolvidos.entries()
  ) {
    const erros:
      string[] = [];

    if (
      digitos(
        item.ncm_resolvido
      ).length !== 8
    ) {
      erros.push(
        "NCM"
      );
    }

    if (
      !/^\d{4}$/.test(
        item.cfop_resolvido
      )
    ) {
      erros.push(
        "CFOP"
      );
    }

    if (
      !/^\d$/.test(
        item.origem_resolvida
      )
    ) {
      erros.push(
        "origem"
      );
    }

    if (
      !item.icms_resolvido
    ) {
      erros.push(
        "ICMS/CSOSN"
      );
    }

    if (
      !/^\d{2}$/.test(
        item.pis_resolvido
      )
    ) {
      erros.push(
        "PIS CST"
      );
    }

    if (
      !/^\d{2}$/.test(
        item.cofins_resolvido
      )
    ) {
      erros.push(
        "COFINS CST"
      );
    }

    if (
      !item
        .grupo_fiscal_resolvido ||
      !item
        .grupo_fiscal_ativo
    ) {
      erros.push(
        "grupo fiscal"
      );
    }

    checks.push({
      ok:
        erros.length === 0,
      titulo:
        `Item ${indice + 1}: ${item.produto_nome}`,
      detalhe:
        erros.length === 0
          ? `NCM ${item.ncm_resolvido} · CFOP ${item.cfop_resolvido} · ICMS ${item.icms_resolvido} · PIS ${item.pis_resolvido} · COFINS ${item.cofins_resolvido}`
          : `Falta/está inválido: ${erros.join(
              ", "
            )}.`,
    });
  }

  const pagamentosAtuais =
    filtrarPagamentosFinanceiros(
      pagamentos
    );
  const pagamentosHistorico =
    filtrarPagamentosHistorico(
      pagamentos
    );

  checks.push({
    ok:
      pagamentosAtuais.length >
      0,
    titulo:
      "Pagamentos",
    detalhe:
      pagamentosAtuais.length >
      0
        ? `${pagamentosAtuais.length} pagamento(s) vigente(s).`
        : "Nenhum pagamento vigente encontrado.",
  });

  for (
    const pagamento
    of pagamentosAtuais
  ) {
    const codigo =
      texto(
        pagamento.codigo_fiscal
      );

    checks.push({
      ok:
        /^\d{2}$/.test(
          codigo
        ) &&
        Number(
          pagamento.valor
        ) >= 0,
      titulo:
        pagamento.forma_pagamento_nome ??
        pagamento.forma_pagamento_codigo ??
        "Forma de pagamento",
      detalhe:
        !/^\d{2}$/.test(
          codigo
        )
          ? "Código fiscal tPag não configurado."
          : `tPag ${codigo} · ${moeda.format(
              Number(
                pagamento.valor
              )
            )}.`,
    });
  }

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
      conferencia.ok
        ? `Pagamentos líquidos conferem com o total da venda (${moeda.format(
            conferencia.valorVenda
          )}).`
        : `Venda ${moeda.format(
            conferencia.valorVenda
          )}; pagamentos líquidos ${moeda.format(
            totalLiquido
          )}.`,
  });

  checks.push({
    ok:
      Boolean(
        fiscal?.ativo
      ) &&
      Boolean(
        texto(
          fiscal?.inscricao_estadual
        )
      ) &&
      Boolean(
        texto(
          fiscal?.uf
        )
      ) &&
      Boolean(
        texto(
          fiscal
            ?.natureza_operacao_padrao
        )
      ),
    titulo:
      "Configuração fiscal da empresa",
    detalhe:
      fiscal?.ativo
        ? "Extensão fiscal ativa; IE, UF e natureza padrão serão usadas na emissão."
        : "Configuração fiscal da empresa ausente ou inativa.",
  });

  const nfceConfig =
    nfceConfigs.length ===
    1
      ? nfceConfigs[0]
      : null;

  checks.push({
    ok:
      Boolean(
        nfceConfig
      ) &&
      Boolean(
        nfceConfig
          ?.csc_configurado
      ) &&
      /^\d{1,6}$/.test(
        texto(
          nfceConfig?.id_csc
        )
      ),
    titulo:
      "CSC da NFC-e",
    detalhe:
      nfceConfigs.length >
      1
        ? "Existe mais de uma configuração NFC-e ativa."
        : nfceConfig
            ?.csc_configurado
        ? `CSC marcado como configurado; ID ${texto(
            nfceConfig.id_csc
          )}.`
        : "CSC/ID CSC ainda não está pronto.",
  });

  checks.push({
    ok:
      numeracoes.length ===
      1,
    titulo:
      "Numeração NFC-e",
    detalhe:
      numeracoes.length ===
      1
        ? `Série ${numeracoes[0].serie}; próximo número ${numeracoes[0].proximo_numero}.`
        : numeracoes.length ===
          0
        ? "Nenhuma numeração NFC-e ativa encontrada."
        : "Existe mais de uma série NFC-e ativa; será necessário escolher a série.",
  });

  const emissaoAutorizada =
    emissoes.find(
      (emissao) =>
        emissao.status ===
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

  const emissaoAmbigua =
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
      !emissaoAmbigua,
    titulo:
      "Segurança contra retransmissão",
    detalhe:
      emissaoAutorizada
        ? `Já existe NFC-e autorizada: série ${emissaoAutorizada.serie}, número ${emissaoAutorizada.numero}.`
        : emissaoAmbigua
        ? emissaoAmbigua.status ===
          "aguardando_inutilizacao"
          ? `Existe NFC-e série ${emissaoAmbigua.serie} nº ${emissaoAmbigua.numero} aguardando inutilização. Conclua a inutilização antes de emitir novamente.`
          : `Existe emissão ${statusLabel(
              emissaoAmbigua.status
            )}; não deve haver nova transmissão até reconciliar.`
        : "Nenhuma emissão ambígua vinculada a esta venda.",
  });

  const bloqueios =
    checks.filter(
      (item) =>
        !item.ok
    );

  const pronta =
    bloqueios.length ===
      0 &&
    !emissaoAutorizada;

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
                NFC-e da venda #
                {
                  venda.numero ??
                  "—"
                }
              </h1>

              <p className="mt-1 text-sm text-zinc-500">
                {
                  formatarData(
                    venda.finalizada_at ??
                      venda.created_at
                  )
                }
                {" · "}
                {
                  moeda.format(
                    Number(
                      venda.valor_total ??
                        0
                    )
                  )
                }
              </p>
            </div>

            <div
              className={[
                "rounded-xl border px-4 py-3 text-sm font-semibold",
                emissaoAutorizada
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : pronta
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-red-200 bg-red-50 text-red-800",
              ].join(" ")}
            >
              {emissaoAutorizada
                ? "NFC-e já autorizada"
                : pronta
                ? "Pronta para emissão"
                : `${bloqueios.length} bloqueio(s)`}
            </div>
          </div>
        </div>

        {emissaoAutorizada && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <h2 className="font-semibold text-emerald-900">
              Documento autorizado
            </h2>

            <div className="mt-3 grid gap-3 text-sm text-emerald-900 md:grid-cols-2">
              <p>
                Série:{" "}
                <strong>
                  {
                    emissaoAutorizada.serie
                  }
                </strong>
              </p>

              <p>
                Número:{" "}
                <strong>
                  {
                    emissaoAutorizada.numero
                  }
                </strong>
              </p>

              <p>
                cStat:{" "}
                <strong>
                  {
                    emissaoAutorizada.cstat ??
                    "—"
                  }
                </strong>
              </p>

              <p>
                Protocolo:{" "}
                <strong>
                  {
                    emissaoAutorizada.protocolo ??
                    "—"
                  }
                </strong>
              </p>

              <p className="md:col-span-2 break-all">
                Chave:{" "}
                <strong>
                  {
                    emissaoAutorizada.chave_acesso ??
                    "—"
                  }
                </strong>
              </p>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-200 p-5">
            <h2 className="font-semibold text-zinc-950">
              Validações
            </h2>

            <p className="mt-1 text-sm text-zinc-500">
              Nenhuma transmissão é feita nesta tela.
            </p>
          </div>

          <div className="divide-y divide-zinc-100">
            {checks.map(
              (
                check,
                index
              ) => (
                <div
                  key={`${check.titulo}-${index}`}
                  className="flex gap-3 p-4"
                >
                  <div
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${checkClass(
                      check.ok
                    )}`}
                  >
                    {
                      check.ok
                        ? "✓"
                        : "!"
                    }
                  </div>

                  <div>
                    <p className="font-medium text-zinc-950">
                      {
                        check.titulo
                      }
                    </p>

                    <p className="mt-1 text-sm text-zinc-500">
                      {
                        check.detalhe
                      }
                    </p>
                  </div>
                </div>
              )
            )}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-zinc-950">
              Itens
            </h2>

            <div className="mt-4 space-y-3">
              {itens.map(
                (
                  item,
                  index
                ) => (
                  <div
                    key={
                      item.id
                    }
                    className="rounded-xl border border-zinc-200 p-4"
                  >
                    <p className="font-medium text-zinc-950">
                      {index + 1}.{" "}
                      {
                        item.produto_nome
                      }
                    </p>

                    <p className="mt-1 text-xs text-zinc-500">
                      NCM{" "}
                      {
                        item.ncm ??
                        "—"
                      }
                      {" · "}
                      CFOP{" "}
                      {
                        item.cfop ??
                        "—"
                      }
                      {" · "}
                      ICMS{" "}
                      {
                        item.icms_cst_csosn ??
                        "—"
                      }
                    </p>

                    <p className="mt-2 text-sm text-zinc-700">
                      {
                        Number(
                          item.quantidade
                        )
                      }{" "}
                      ×{" "}
                      {
                        moeda.format(
                          Number(
                            item.valor_unitario
                          )
                        )
                      }
                      {" = "}
                      <strong>
                        {
                          moeda.format(
                            Number(
                              item.valor_total
                            )
                          )
                        }
                      </strong>
                    </p>
                  </div>
                )
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-zinc-950">
              Pagamentos
            </h2>

            <div className="mt-4 space-y-3">
              {pagamentosAtuais.map(
                (
                  pagamento
                ) => (
                  <div
                    key={
                      pagamento.id
                    }
                    className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 p-4"
                  >
                    <div>
                      <p className="font-medium text-zinc-950">
                        {
                          pagamento.forma_pagamento_nome ??
                          pagamento.forma_pagamento_codigo ??
                          "Pagamento"
                        }
                      </p>

                      <p className="mt-1 text-xs text-zinc-500">
                        tPag{" "}
                        {
                          pagamento.codigo_fiscal ??
                          "não configurado"
                        }
                        {" · "}
                        {
                          moeda.format(
                            Number(
                              pagamento.valor
                            )
                          )
                        }
                      </p>
                    </div>

                    <strong className="text-zinc-950">
                      {
                        moeda.format(
                          Number(
                            pagamento.valor
                          )
                        )
                      }
                    </strong>
                  </div>
                )
              )}

              {pagamentosHistorico.length >
                0 && (
                <div className="space-y-2 border-t border-zinc-100 pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                    Histórico / pagamentos cancelados
                  </p>
                  {pagamentosHistorico.map(
                    (
                      pagamento
                    ) => (
                      <div
                        key={
                          pagamento.id
                        }
                        className="flex items-center justify-between gap-4 rounded-xl border border-zinc-100 bg-zinc-50 p-3 text-zinc-500"
                      >
                        <p className="text-sm">
                          {
                            pagamento.forma_pagamento_nome ??
                            pagamento.forma_pagamento_codigo ??
                            "Pagamento"
                          }
                          {" — "}
                          {
                            statusLabel(
                              pagamento.status
                            )
                          }
                        </p>
                        <span className="text-sm">
                          {
                            moeda.format(
                              Number(
                                pagamento.valor
                              )
                            )
                          }
                        </span>
                      </div>
                    )
                  )}
                </div>
              )}

              <div className="flex items-center justify-between border-t border-zinc-200 pt-4 text-sm">
                <span className="text-zinc-500">
                  Total líquido
                </span>

                <strong className="text-zinc-950">
                  {
                    moeda.format(
                      totalLiquido
                    )
                  }
                </strong>
              </div>
            </div>
          </div>
        </div>

        {emissaoPendenteConsulta && (
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
        )}

        {emissaoNaoTransmitida && (
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
        )}

        {emissaoNaoClassificada && (
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
        )}

        {!emissaoAutorizada && !emissaoPendenteConsulta && !emissaoNaoTransmitida && !emissaoNaoClassificada && (
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="font-semibold text-zinc-950">
                  Próxima ação
                </h2>

                <p className="mt-1 text-sm text-zinc-500">
                  {pronta
                    ? `A venda passou pela conferência e pode ser transmitida à Geranet em ${ambienteAtual === 1 ? "PRODUÇÃO" : "homologação"}.`
                    : "Corrija os bloqueios acima antes de transmitir a NFC-e."}
                </p>
              </div>

              {pronta ? (
                <EmitirNfceVendaButton
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
                  Emitir NFC-e
                </button>
              )}
            </div>
          </div>
        )}

        {emissoes.length > 0 && (
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-zinc-950">
              Histórico fiscal da venda
            </h2>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                    <th className="py-2 pr-4">
                      Data
                    </th>
                    <th className="py-2 pr-4">
                      Série
                    </th>
                    <th className="py-2 pr-4">
                      Número
                    </th>
                    <th className="py-2 pr-4">
                      Status
                    </th>
                    <th className="py-2">
                      Motivo
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {emissoes.map(
                    (
                      emissao
                    ) => (
                      <tr
                        key={
                          emissao.id
                        }
                        className="border-b border-zinc-100"
                      >
                        <td className="py-3 pr-4 text-zinc-600">
                          {
                            formatarData(
                              emissao.created_at
                            )
                          }
                        </td>

                        <td className="py-3 pr-4">
                          {
                            emissao.serie
                          }
                        </td>

                        <td className="py-3 pr-4">
                          {
                            emissao.numero
                          }
                        </td>

                        <td className="py-3 pr-4 font-medium">
                          {
                            statusLabel(
                              emissao.status
                            )
                          }
                        </td>

                        <td className="py-3 text-zinc-600">
                          {
                            emissao.motivo ??
                            "—"
                          }
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
