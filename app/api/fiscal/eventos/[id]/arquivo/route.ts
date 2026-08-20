import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  createClient,
} from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function texto(
  valor: unknown
) {
  return String(
    valor ?? ""
  ).trim();
}

function pareceHex(
  valor: string
) {
  const limpo =
    valor.startsWith("0x")
      ? valor.slice(2)
      : valor;

  return (
    limpo.length > 0 &&
    limpo.length % 2 === 0 &&
    /^[0-9a-f]+$/i.test(
      limpo
    )
  );
}

function pareceBase64(
  valor: string
) {
  return (
    valor.length >= 8 &&
    valor.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(
      valor
    )
  );
}

function decodificar(
  valor: string,
  tipo:
    | "xml"
    | "pdf"
) {
  const bruto =
    texto(valor);

  if (!bruto) {
    return null;
  }

  if (
    tipo === "xml" &&
    bruto.includes("<")
  ) {
    return Buffer.from(
      bruto,
      "utf8"
    );
  }

  if (
    pareceHex(
      bruto
    )
  ) {
    const limpo =
      bruto.startsWith("0x")
        ? bruto.slice(2)
        : bruto;

    const buffer =
      Buffer.from(
        limpo,
        "hex"
      );

    if (
      tipo === "pdf"
    ) {
      return buffer
        .subarray(
          0,
          5
        )
        .toString(
          "ascii"
        ) === "%PDF-"
        ? buffer
        : null;
    }

    return buffer
      .subarray(
        0,
        512
      )
      .toString(
        "utf8"
      )
      .includes("<")
      ? buffer
      : null;
  }

  if (
    pareceBase64(
      bruto
    )
  ) {
    const buffer =
      Buffer.from(
        bruto,
        "base64"
      );

    if (
      tipo === "pdf"
    ) {
      return buffer
        .subarray(
          0,
          5
        )
        .toString(
          "ascii"
        ) === "%PDF-"
        ? buffer
        : null;
    }

    return buffer
      .subarray(
        0,
        512
      )
      .toString(
        "utf8"
      )
      .includes("<")
      ? buffer
      : null;
  }

  return null;
}

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  const {
    id,
  } =
    await context.params;

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
    return NextResponse.json(
      {
        erro:
          "Não autenticado.",
      },
      {
        status:
          401,
      }
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
    return NextResponse.json(
      {
        erro:
          "Empresa ativa não encontrada.",
      },
      {
        status:
          403,
      }
    );
  }

  const tipoParam =
    request
      .nextUrl
      .searchParams
      .get(
        "tipo"
      );

  const tipo =
    tipoParam ===
    "pdf"
      ? "pdf"
      : tipoParam ===
        "xml"
      ? "xml"
      : null;

  if (!tipo) {
    return NextResponse.json(
      {
        erro:
          "Informe tipo=xml ou tipo=pdf.",
      },
      {
        status:
          400,
      }
    );
  }

  const {
    data: evento,
    error,
  } =
    await supabase
      .from(
        "fiscal_emissao_eventos"
      )
      .select(`
        id,
        tipo,
        status,
        protocolo,
        xml_hex,
        pdf_hex
      `)
      .eq(
        "empresa_id",
        vinculo
          .empresa_id
      )
      .eq(
        "id",
        id
      )
      .maybeSingle();

  if (
    error ||
    !evento
  ) {
    return NextResponse.json(
      {
        erro:
          error?.message ??
          "Evento fiscal não encontrado.",
      },
      {
        status:
          404,
      }
    );
  }

  if (
    evento.status !==
    "sucesso"
  ) {
    return NextResponse.json(
      {
        erro:
          "Arquivo disponível apenas para evento fiscal concluído com sucesso.",
      },
      {
        status:
          409,
      }
    );
  }

  const armazenado =
    tipo === "xml"
      ? evento.xml_hex
      : evento.pdf_hex;

  if (
    !texto(
      armazenado
    )
  ) {
    return NextResponse.json(
      {
        erro:
          `${tipo.toUpperCase()} não armazenado neste evento.`,
      },
      {
        status:
          404,
      }
    );
  }

  const buffer =
    decodificar(
      armazenado,
      tipo
    );

  if (!buffer) {
    return NextResponse.json(
      {
        erro:
          `Não foi possível decodificar o ${tipo.toUpperCase()} do evento.`,
      },
      {
        status:
          422,
      }
    );
  }

  const nome =
    `${evento.tipo}-${evento.protocolo ?? evento.id}.${tipo}`;

  return new NextResponse(
    new Uint8Array(
      buffer
    ),
    {
      status:
        200,
      headers: {
        "Content-Type":
          tipo === "pdf"
            ? "application/pdf"
            : "application/xml; charset=utf-8",
        "Content-Disposition":
          `attachment; filename="${nome}"`,
        "Cache-Control":
          "private, no-store",
        "X-Content-Type-Options":
          "nosniff",
      },
    }
  );
}
