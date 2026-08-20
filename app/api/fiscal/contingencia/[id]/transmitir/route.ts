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
  transmitirContingenciaNfce,
} from "@/lib/fiscal/contingencia/transmitir-contingencia";

type Context = {
  params: Promise<{
    id: string;
  }>;
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

export async function POST(
  _request: NextRequest,
  context: Context
) {
  const supabase =
    await createClient();

  const admin =
    createAdminClient();

  const {
    data: claims,
    error: authError,
  } =
    await supabase.auth.getClaims();

  if (
    authError ||
    !claims?.claims?.sub
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
    return json(
      {
        ok: false,
        erro:
          "Empresa ativa não encontrada.",
      },
      403
    );
  }

  const {
    id,
  } =
    await context.params;

  const resultado =
    await transmitirContingenciaNfce({
      admin,
      empresaId:
        vinculo.empresa_id,
      emissaoId:
        id,
    });

  return json(
    resultado.ok
      ? {
          ...resultado,
          ok: true,
        }
      : {
          ...resultado,
          ok: false,
          erro:
            resultado.mensagem,
        },
    resultado.ok
      ? 200
      : resultado.status ===
          "rejeitada"
        ? 422
        : resultado.status ===
            "aguardando_reconciliacao"
          ? 409
          : 400
  );
}
