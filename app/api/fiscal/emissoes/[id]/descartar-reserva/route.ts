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
  motivo?: string;
};

function resposta(
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

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  const {
    id: emissaoId,
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
      !claimsData?.claims?.sub
    ) {
      return resposta(
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
      error:
        vinculoError,
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
      vinculoError ||
      !vinculo
    ) {
      return resposta(
        {
          ok: false,
          erro:
            "Empresa ativa não encontrada.",
        },
        403
      );
    }

    let body: Body = {};

    try {
      body =
        await request.json();
    } catch {
      // Body é opcional.
    }

    const {
      data,
      error,
    } =
      await admin.rpc(
        "rpc_descartar_reserva_fiscal",
        {
          p_empresa_id:
            vinculo.empresa_id,
          p_emissao_id:
            emissaoId,
          p_motivo:
            String(
              body.motivo ??
                ""
            ).trim() ||
            null,
        }
      );

    if (error) {
      return resposta(
        {
          ok: false,
          erro:
            error.message,
        },
        409
      );
    }

    const resultado =
      Array.isArray(data)
        ? data[0]
        : data;

    if (
      !resultado?.emissao_id
    ) {
      return resposta(
        {
          ok: false,
          erro:
            "A operação não retornou uma emissão fiscal válida.",
        },
        500
      );
    }

    return resposta({
      ok: true,
      emissao:
        resultado,
      mensagem:
        resultado.reutilizada
          ? "A reserva já estava aguardando inutilização."
          : "Reserva descartada. O número fiscal foi mantido no histórico e ficou aguardando inutilização.",
    });
  } catch (error) {
    console.error(
      "[DESCARTAR RESERVA FISCAL]",
      error
    );

    return resposta(
      {
        ok: false,
        erro:
          error instanceof Error
            ? error.message
            : "Erro interno ao descartar reserva fiscal.",
      },
      500
    );
  }
}
