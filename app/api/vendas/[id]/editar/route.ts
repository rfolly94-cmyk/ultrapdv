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

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

type Body = {
  cliente_id?:
    | string
    | null;
  tipo_venda?: string;
  modelo_fiscal_intencao?:
    | string
    | null;
  observacao?:
    | string
    | null;
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

function texto(
  valor: unknown
) {
  return String(
    valor ?? ""
  ).trim();
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  const {
    id: vendaId,
  } =
    await context.params;

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
      return json(
        {
          ok: false,
          erro:
            "Não autenticado.",
        },
        401
      );
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
      return json(
        {
          ok: false,
          erro:
            "Empresa ativa não encontrada.",
        },
        403
      );
    }

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

    const {
      data: venda,
      error: vendaError,
    } =
      await admin
        .from("vendas")
        .select(
          "id, status, cliente_id"
        )
        .eq(
          "empresa_id",
          vinculo.empresa_id
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
            vendaError
              ?.message ??
            "Venda não encontrada.",
        },
        404
      );
    }

    if (
      venda.status !==
      "finalizada"
    ) {
      return json(
        {
          ok: false,
          erro:
            "Somente venda finalizada pode ser editada.",
        },
        409
      );
    }

    const {
      data:
        fiscaisBloqueantes,
      error:
        fiscalError,
    } =
      await admin
        .from(
          "fiscal_emissoes"
        )
        .select(
          "id, status"
        )
        .eq(
          "empresa_id",
          vinculo.empresa_id
        )
        .eq(
          "origem_tipo",
          "venda"
        )
        .eq(
          "origem_id",
          vendaId
        )
        .in(
          "status",
          [
            "autorizada",
            "enviando",
            "erro_comunicacao",
            "aguardando_reconciliacao",
          ]
        )
        .limit(1);

    if (
      fiscalError
    ) {
      return json(
        {
          ok: false,
          erro:
            fiscalError.message,
        },
        500
      );
    }

    if (
      (
        fiscaisBloqueantes ??
        []
      ).length > 0
    ) {
      return json(
        {
          ok: false,
          erro:
            "Esta venda possui documento fiscal autorizado ou em estado sensível. Cancele/reconcilie o documento fiscal antes de editar a venda.",
        },
        409
      );
    }

    const tipoVenda =
      texto(
        body.tipo_venda
      );

    if (
      ![
        "balcao",
        "entrega",
        "completa",
      ].includes(
        tipoVenda
      )
    ) {
      return json(
        {
          ok: false,
          erro:
            "Tipo da venda inválido.",
        },
        400
      );
    }

    const modelo =
      body
        .modelo_fiscal_intencao ===
      null
        ? null
        : texto(
            body
              .modelo_fiscal_intencao
          ) || null;

    if (
      modelo !== null &&
      modelo !== "55" &&
      modelo !== "65"
    ) {
      return json(
        {
          ok: false,
          erro:
            "Intenção fiscal inválida.",
        },
        400
      );
    }

    const observacao =
      texto(
        body.observacao
      );

    if (
      observacao.length >
      2000
    ) {
      return json(
        {
          ok: false,
          erro:
            "Observação deve possuir no máximo 2000 caracteres.",
        },
        400
      );
    }

    const novoClienteId =
      body.cliente_id
        ? texto(
            body.cliente_id
          )
        : null;

    if (
      novoClienteId
    ) {
      const {
        data: cliente,
        error:
          clienteError,
      } =
        await admin
          .from(
            "clientes"
          )
          .select("id")
          .eq(
            "empresa_id",
            vinculo.empresa_id
          )
          .eq(
            "id",
            novoClienteId
          )
          .eq(
            "ativo",
            true
          )
          .maybeSingle();

      if (
        clienteError ||
        !cliente
      ) {
        return json(
          {
            ok: false,
            erro:
              "Cliente inválido ou inativo.",
          },
          400
        );
      }
    }

    if (
      novoClienteId !==
      venda.cliente_id
    ) {
      const {
        data: titulos,
        error:
          tituloError,
      } =
        await admin
          .from(
            "carteira_cliente_titulos"
          )
          .select("id")
          .eq(
            "empresa_id",
            vinculo.empresa_id
          )
          .eq(
            "venda_id",
            vendaId
          )
          .limit(1);

      if (
        tituloError
      ) {
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
        (
          titulos ??
          []
        ).length > 0
      ) {
        return json(
          {
            ok: false,
            erro:
              "O cliente não pode ser alterado porque esta venda possui débito/título na Carteira.",
          },
          409
        );
      }
    }

    const {
      error: updateError,
    } =
      await admin
        .from("vendas")
        .update({
          cliente_id:
            novoClienteId,
          tipo_venda:
            tipoVenda,
          modelo_fiscal_intencao:
            modelo,
          observacao:
            observacao ||
            null,
        })
        .eq(
          "empresa_id",
          vinculo.empresa_id
        )
        .eq(
          "id",
          vendaId
        );

    if (
      updateError
    ) {
      return json(
        {
          ok: false,
          erro:
            updateError.message,
        },
        422
      );
    }

    return json({
      ok: true,
      venda_id:
        vendaId,
      mensagem:
        "Alteração realizada com sucesso.",
    });
  } catch (
    error
  ) {
    console.error(
      "[EDITAR VENDA]",
      error
    );

    return json(
      {
        ok: false,
        erro:
          error instanceof Error
            ? error.message
            : "Erro interno ao editar a venda.",
      },
      500
    );
  }
}
