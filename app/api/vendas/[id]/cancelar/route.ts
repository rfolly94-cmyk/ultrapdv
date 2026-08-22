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
  exigirOperacaoVenda,
  respostaNegacaoVenda,
} from "@/lib/vendas/acesso-operacao";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type DestinoRecebido =
  | "DEVOLUCAO"
  | "CREDITO";

type Body = {
  motivo?: string;
  confirmar?: string;
  destino_valor_recebido?:
    | DestinoRecebido
    | null;
  confirmar_fiscal_comercial?: boolean;
};

function json(
  body: unknown,
  status = 200
) {
  return NextResponse.json(
    body,
    {
      status,
    }
  );
}

async function contexto() {
  const supabase =
    await createClient();

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
    return {
      erro: json(
        {
          ok: false,
          erro:
            "Não autenticado.",
        },
        401
      ),
    };
  }

  const {
    data: vinculo,
    error: vinculoError,
  } =
    await supabase
      .from(
        "usuarios_empresas"
      )
      .select(
        "empresa_id, usuario_id"
      )
      .eq(
        "usuario_id",
        String(
          claimsData
            .claims
            .sub
        )
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
    vinculoError ||
    !vinculo
  ) {
    return {
      erro: json(
        {
          ok: false,
          erro:
            "Empresa ativa não encontrada.",
        },
        403
      ),
    };
  }

  try {
    await exigirOperacaoVenda({
      empresaId: String(vinculo.empresa_id),
      acao: "cancelar",
      origem: "api/vendas/cancelar",
    });
  } catch (error) {
    const negacao = respostaNegacaoVenda(error);
    if (negacao) {
      return { erro: negacao };
    }
    throw error;
  }

  return {
    vinculo,
  };
}

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  const {
    id: vendaId,
  } =
    await context.params;

  const ctx =
    await contexto();

  if ("erro" in ctx) {
    return ctx.erro;
  }

  const admin =
    createAdminClient();

  const {
    data: venda,
    error: vendaError,
  } =
    await admin
      .from("vendas")
      .select(
        "id, numero, status, cliente_id, valor_total, troco"
      )
      .eq(
        "empresa_id",
        ctx.vinculo.empresa_id
      )
      .eq(
        "id",
        vendaId
      )
      .maybeSingle();

  if (
    vendaError ||
    !venda
  ) {
    return json(
      {
        ok: false,
        erro:
          "Venda não encontrada.",
      },
      404
    );
  }

  const {
    data: pagamentos,
    error: pagamentosError,
  } =
    await admin
      .from(
        "vendas_pagamentos"
      )
      .select(
        "id, forma_pagamento_id, valor, status"
      )
      .eq(
        "empresa_id",
        ctx.vinculo.empresa_id
      )
      .eq(
        "venda_id",
        vendaId
      )
      .eq(
        "status",
        "confirmado"
      );

  if (pagamentosError) {
    return json(
      {
        ok: false,
        erro:
          pagamentosError.message,
      },
      500
    );
  }

  const formaIds =
    Array.from(
      new Set(
        (pagamentos ?? [])
          .map(
            (pagamento) =>
              pagamento
                .forma_pagamento_id
          )
          .filter(
            (
              id
            ): id is string =>
              Boolean(id)
          )
      )
    );

  const formasPorId =
    new Map<
      string,
      {
        permite_fiado:
          boolean;
        movimenta_caixa:
          boolean;
        permite_troco:
          boolean;
      }
    >();

  if (formaIds.length) {
    const {
      data: formas,
      error: formasError,
    } =
      await admin
        .from(
          "formas_pagamento"
        )
        .select(
          "id, permite_fiado, movimenta_caixa, permite_troco"
        )
        .eq(
          "empresa_id",
          ctx.vinculo.empresa_id
        )
        .in(
          "id",
          formaIds
        );

    if (formasError) {
      return json(
        {
          ok: false,
          erro:
            formasError.message,
        },
        500
      );
    }

    for (
      const forma of
      formas ?? []
    ) {
      formasPorId.set(
        forma.id,
        {
          permite_fiado:
            Boolean(
              forma
                .permite_fiado
            ),
          movimenta_caixa:
            Boolean(
              forma
                .movimenta_caixa
            ),
          permite_troco:
            Boolean(
              forma
                .permite_troco
            ),
        }
      );
    }
  }

  const pagamentoImediatoBruto =
    (pagamentos ?? [])
      .reduce(
        (
          total,
          pagamento
        ) => {
          const forma =
            formasPorId.get(
              pagamento
                .forma_pagamento_id
            );

          if (
            !forma ||
            forma
              .permite_fiado ||
            !forma
              .movimenta_caixa
          ) {
            return total;
          }

          return (
            total +
            Number(
              pagamento.valor ??
              0
            )
          );
        },
        0
      );

  const pagamentoImediatoLiquido =
    venda.cliente_id
      ? Math.max(
          pagamentoImediatoBruto -
            Number(
              venda.troco ??
              0
            ),
          0
        )
      : 0;

  const {
    data: titulos,
    error: tituloError,
  } =
    await admin
      .from(
        "carteira_cliente_titulos"
      )
      .select(
        "id, cliente_id, valor_original, valor_aberto, status"
      )
      .eq(
        "empresa_id",
        ctx.vinculo.empresa_id
      )
      .eq(
        "venda_id",
        vendaId
      )
      .limit(2);

  if (tituloError) {
    return json(
      {
        ok: false,
        erro:
          tituloError.message,
      },
      500
    );
  }

  if (
    (titulos ?? [])
      .length >
    1
  ) {
    return json(
      {
        ok: false,
        erro:
          "Foram encontrados múltiplos títulos de carteira para esta venda.",
      },
      409
    );
  }

  const titulo =
    titulos?.[0] ??
    null;

  let valorRecebidoFiado =
    0;

  if (titulo) {
    const {
      data: itens,
      error: itensError,
    } =
      await admin
        .from(
          "carteira_cliente_itens"
        )
        .select("id")
        .eq(
          "empresa_id",
          ctx.vinculo.empresa_id
        )
        .eq(
          "titulo_id",
          titulo.id
        );

    if (itensError) {
      return json(
        {
          ok: false,
          erro:
            itensError.message,
        },
        500
      );
    }

    const itemIds =
      (itens ?? [])
        .map(
          (item) =>
            item.id
        );

    if (itemIds.length) {
      const {
        data: alocacoes,
        error:
          alocacoesError,
      } =
        await admin
          .from(
            "carteira_cliente_recebimento_alocacoes"
          )
          .select("valor")
          .eq(
            "empresa_id",
            ctx.vinculo.empresa_id
          )
          .in(
            "item_id",
            itemIds
          );

      if (
        alocacoesError
      ) {
        return json(
          {
            ok: false,
            erro:
              alocacoesError.message,
          },
          500
        );
      }

      valorRecebidoFiado =
        (alocacoes ?? [])
          .reduce(
            (
              total,
              alocacao
            ) =>
              total +
              Number(
                alocacao
                  .valor ??
                0
              ),
            0
          );
    }
  }

  const valorPagoCliente =
    venda.cliente_id
      ? Number(
          (
            pagamentoImediatoLiquido +
            valorRecebidoFiado
          ).toFixed(2)
        )
      : 0;

  const {
    data: fiscal,
  } =
    await admin
      .from("fiscal_emissoes")
      .select("modelo, numero, serie, status")
      .eq("empresa_id", ctx.vinculo.empresa_id)
      .eq("origem_tipo", "venda")
      .eq("origem_id", vendaId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

  return json({
    ok: true,
    preflight: {
      venda_id:
        venda.id,
      numero:
        venda.numero,
      status:
        venda.status,

      cliente_id:
        venda.cliente_id,
      cliente_identificado:
        Boolean(
          venda.cliente_id
        ),

      possui_titulo_fiado:
        Boolean(titulo),
      titulo_status:
        titulo?.status ??
        null,
      valor_fiado_original:
        Number(
          titulo
            ?.valor_original ??
          0
        ),
      valor_fiado_aberto:
        Number(
          titulo
            ?.valor_aberto ??
          0
        ),

      pagamento_imediato_liquido:
        Number(
          pagamentoImediatoLiquido
            .toFixed(2)
        ),
      fiado_recebido:
        Number(
          valorRecebidoFiado
            .toFixed(2)
        ),
      valor_pago_cliente:
        valorPagoCliente,

      exige_destino_recebido:
        valorPagoCliente >
        0,

      permite_credito:
        Boolean(
          venda.cliente_id
        ),

      possui_documento_fiscal:
        Boolean(fiscal?.status),
      fiscal_modelo:
        fiscal?.modelo ?? null,
      fiscal_numero:
        fiscal?.numero ?? null,
      fiscal_status:
        fiscal?.status ?? null,
    },
  });
}

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  const {
    id: vendaId,
  } =
    await context.params;

  const ctx =
    await contexto();

  if ("erro" in ctx) {
    return ctx.erro;
  }

  const admin =
    createAdminClient();

  let body: Body;

  try {
    body =
      await request.json();
  } catch {
    return json(
      {
        ok: false,
        erro:
          "JSON inválido.",
      },
      400
    );
  }

  if (
    body.confirmar !==
    "CANCELAR_VENDA_COMERCIAL"
  ) {
    return json(
      {
        ok: false,
        erro:
          "Confirmação explícita ausente.",
      },
      400
    );
  }

  const motivo =
    String(
      body.motivo ??
      ""
    ).trim();

  if (
    motivo.length < 5
  ) {
    return json(
      {
        ok: false,
        erro:
          "Informe o motivo com pelo menos 5 caracteres.",
      },
      400
    );
  }

  const destino =
    body
      .destino_valor_recebido ??
    null;

  if (
    destino !== null &&
    destino !==
      "DEVOLUCAO" &&
    destino !==
      "CREDITO"
  ) {
    return json(
      {
        ok: false,
        erro:
          "Destino do valor recebido inválido.",
      },
      400
    );
  }

  const {
    data: fiscalPost,
  } =
    await admin
      .from("fiscal_emissoes")
      .select("id, status")
      .eq("empresa_id", ctx.vinculo.empresa_id)
      .eq("origem_tipo", "venda")
      .eq("origem_id", vendaId)
      .limit(1)
      .maybeSingle();

  if (
    fiscalPost?.status &&
    body.confirmar_fiscal_comercial !== true
  ) {
    return json(
      {
        ok: false,
        erro:
          "Esta venda possui documento fiscal. Confirme que a operação alterará somente as movimentações comerciais.",
        exige_confirmacao_fiscal: true,
      },
      409
    );
  }

  const {
    data,
    error,
  } =
    await admin.rpc(
      "rpc_cancelar_venda_comercial",
      {
        p_empresa_id:
          ctx.vinculo.empresa_id,
        p_usuario_id:
          ctx.vinculo.usuario_id,
        p_venda_id:
          vendaId,
        p_motivo:
          motivo,
        p_destino_recebido:
          destino,
      }
    );

  if (error) {
    return json(
      {
        ok: false,
        erro:
          error.message,
      },
      422
    );
  }

  return json({
    ok: true,
    resultado:
      data,
  });
}
