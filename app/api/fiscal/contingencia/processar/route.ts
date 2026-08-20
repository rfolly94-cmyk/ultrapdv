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
  _request: NextRequest
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
    data: pendentes,
    error,
  } =
    await admin
      .from(
        "fiscal_emissoes"
      )
      .select(
        "id"
      )
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .eq(
        "modelo",
        "65"
      )
      .eq(
        "tipo_emissao",
        "contingencia_offline"
      )
      .eq(
        "status",
        "aguardando_transmissao_contingencia"
      )
      .order(
        "contingencia_gerada_at",
        {
          ascending:
            true,
        }
      )
      .limit(10);

  if (error) {
    return json(
      {
        ok: false,
        erro:
          error.message,
      },
      500
    );
  }

  const resultados = [];

  for (
    const item of
    pendentes ?? []
  ) {
    const resultado =
      await transmitirContingenciaNfce({
        admin,
        empresaId:
          vinculo.empresa_id,
        emissaoId:
          item.id,
      });

    resultados.push(
      resultado
    );

    // Situação ambígua é tratada como barreira:
    // não continuar disparando outras notas no mesmo clique.
    if (
      resultado.status ===
      "aguardando_reconciliacao"
    ) {
      break;
    }
  }

  return json({
    ok: true,
    processadas:
      resultados.length,
    autorizadas:
      resultados.filter(
        (item) =>
          item.status ===
          "autorizada"
      ).length,
    rejeitadas:
      resultados.filter(
        (item) =>
          item.status ===
          "rejeitada"
      ).length,
    ambiguas:
      resultados.filter(
        (item) =>
          item.status ===
          "aguardando_reconciliacao"
      ).length,
    resultados,
  });
}
