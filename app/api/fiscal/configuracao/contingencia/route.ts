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

function json(
  body: unknown,
  status = 200
) {
  return NextResponse.json(
    body,
    { status }
  );
}

function texto(
  valor: unknown
) {
  return String(
    valor ?? ""
  ).trim();
}

export async function POST(
  request: NextRequest
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
        "empresa_id, perfil"
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

  const perfil =
    texto(
      vinculo.perfil
    )
      .toLowerCase();

  if (
    ![
      "administrador",
      "admin",
      "gerente",
    ].includes(
      perfil
    )
  ) {
    return json(
      {
        ok: false,
        erro:
          "Seu perfil não pode alterar a configuração de contingência.",
      },
      403
    );
  }

  const body =
    await request
      .json()
      .catch(
        () => ({})
      ) as {
        habilitada?: unknown;
        justificativa_padrao?: unknown;
      };

  const justificativa =
    texto(
      body
        .justificativa_padrao
    );

  if (
    justificativa.length <
      15 ||
    justificativa.length >
      256
  ) {
    return json(
      {
        ok: false,
        erro:
          "A justificativa padrão deve possuir entre 15 e 256 caracteres.",
      },
      400
    );
  }

  const {
    error,
  } =
    await admin
      .from(
        "fiscal_contingencia_config"
      )
      .upsert(
        {
          empresa_id:
            vinculo.empresa_id,
          nfce_offline_habilitada:
            body.habilitada ===
            true,
          justificativa_padrao:
            justificativa,
          updated_at:
            new Date()
              .toISOString(),
        },
        {
          onConflict:
            "empresa_id",
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
    mensagem:
      "Configuração de contingência salva com sucesso.",
  });
}
