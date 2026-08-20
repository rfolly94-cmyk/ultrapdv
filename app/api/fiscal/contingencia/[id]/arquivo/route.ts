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

type Context = {
  params: Promise<{
    id: string;
  }>;
};

function hexParaBytes(
  hex: string
) {
  const limpo =
    hex.trim();

  if (
    !limpo ||
    limpo.length % 2 !==
      0 ||
    !/^[0-9a-f]+$/i.test(
      limpo
    )
  ) {
    return null;
  }

  return Buffer.from(
    limpo,
    "hex"
  );
}

export async function GET(
  request: NextRequest,
  context: Context
) {
  const supabase =
    await createClient();

  const admin =
    createAdminClient();

  const {
    data: claims,
  } =
    await supabase.auth.getClaims();

  if (
    !claims?.claims?.sub
  ) {
    return NextResponse.json(
      {
        erro:
          "Não autenticado.",
      },
      {
        status: 401,
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
    return NextResponse.json(
      {
        erro:
          "Empresa ativa não encontrada.",
      },
      {
        status: 403,
      }
    );
  }

  const {
    id,
  } =
    await context.params;

  const tipo =
    request.nextUrl
      .searchParams
      .get("tipo") ===
      "xml"
      ? "xml"
      : "pdf";

  const download =
    request.nextUrl
      .searchParams
      .get("download") ===
    "1";

  const {
    data: emissao,
    error,
  } =
    await admin
      .from(
        "fiscal_emissoes"
      )
      .select(`
        id,
        modelo,
        serie,
        numero,
        tipo_emissao,
        xml_contingencia_hex,
        pdf_contingencia_hex,
        xml_hex,
        pdf_hex
      `)
      .eq(
        "id",
        id
      )
      .eq(
        "empresa_id",
        vinculo.empresa_id
      )
      .maybeSingle();

  if (
    error ||
    !emissao
  ) {
    return NextResponse.json(
      {
        erro:
          "Emissão não encontrada.",
      },
      {
        status: 404,
      }
    );
  }

  const hex =
    tipo === "xml"
      ? (
          emissao
            .xml_contingencia_hex ||
          emissao.xml_hex ||
          ""
        )
      : (
          emissao
            .pdf_contingencia_hex ||
          emissao.pdf_hex ||
          ""
        );

  const bytes =
    hexParaBytes(
      String(hex)
    );

  if (!bytes) {
    return NextResponse.json(
      {
        erro:
          `${tipo.toUpperCase()} de contingência não está disponível.`,
      },
      {
        status: 404,
      }
    );
  }

  const extensao =
    tipo === "xml"
      ? "xml"
      : "pdf";

  const filename =
    `nfce-contingencia-${emissao.serie}-${emissao.numero}.${extensao}`;

  return new NextResponse(
    bytes,
    {
      headers: {
        "Content-Type":
          tipo === "xml"
            ? "application/xml; charset=utf-8"
            : "application/pdf",
        "Content-Disposition":
          `${
            download
              ? "attachment"
              : "inline"
          }; filename="${filename}"`,
        "Cache-Control":
          "private, no-store",
      },
    }
  );
}
