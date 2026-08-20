import {
  NextRequest,
  NextResponse,
} from "next/server";

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

async function executar(
  request: NextRequest
) {
  const segredo =
    process.env
      .CRON_SECRET
      ?.trim();

  if (!segredo) {
    return json(
      {
        ok: false,
        erro:
          "CRON_SECRET não está configurado no servidor.",
      },
      503
    );
  }

  const authorization =
    request.headers
      .get(
        "authorization"
      )
      ?.trim();

  if (
    authorization !==
    `Bearer ${segredo}`
  ) {
    return json(
      {
        ok: false,
        erro:
          "Não autorizado.",
      },
      401
    );
  }

  const admin =
    createAdminClient();

  const {
    data: pendentes,
    error,
  } =
    await admin
      .from(
        "fiscal_emissoes"
      )
      .select(
        "id, empresa_id"
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
      .limit(20);

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
          item.empresa_id,
        emissaoId:
          item.id,
      });

    resultados.push(
      resultado
    );

    // Barreira global conservadora:
    // se uma transmissão fica ambígua, encerra o ciclo.
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
    resultados:
      resultados.map(
        (item) => ({
          emissao_id:
            item.emissao_id,
          status:
            item.status,
          ok:
            item.ok,
          mensagem:
            item.mensagem,
        })
      ),
  });
}

export async function GET(
  request: NextRequest
) {
  return executar(
    request
  );
}

export async function POST(
  request: NextRequest
) {
  return executar(
    request
  );
}
