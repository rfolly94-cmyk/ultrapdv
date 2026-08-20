import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { obterDocumentoFiscal } from "@/lib/fiscal/obter-documento-fiscal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: claimsData, error: authError } =
    await supabase.auth.getClaims();

  if (authError || !claimsData?.claims?.sub) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const { data: vinculo } = await supabase
    .from("usuarios_empresas")
    .select("empresa_id")
    .eq("usuario_id", String(claimsData.claims.sub))
    .eq("principal", true)
    .eq("ativo", true)
    .maybeSingle();

  if (!vinculo) {
    return NextResponse.json(
      { erro: "Empresa ativa não encontrada." },
      { status: 403 }
    );
  }

  const tipoParam = request.nextUrl.searchParams.get("tipo");
  const tipo =
    tipoParam === "pdf" ? "pdf" : tipoParam === "xml" ? "xml" : null;

  if (!tipo) {
    return NextResponse.json(
      { erro: "Informe tipo=xml ou tipo=pdf." },
      { status: 400 }
    );
  }

  const { data: emissao } = await admin
    .from("fiscal_emissoes")
    .select("modelo, serie, numero")
    .eq("empresa_id", vinculo.empresa_id)
    .eq("id", id)
    .maybeSingle();

  try {
    const documento = await obterDocumentoFiscal({
      admin,
      empresaId: vinculo.empresa_id,
      emissaoId: id,
      tipo,
    });

    const modeloNome =
      emissao?.modelo === "55"
        ? "nfe"
        : emissao?.modelo === "65"
          ? "nfce"
          : `modelo-${emissao?.modelo ?? "fiscal"}`;

    const nome = `${modeloNome}-${emissao?.serie ?? "s"}-${emissao?.numero ?? "n"}.${tipo}`;
    const download = request.nextUrl.searchParams.get("download") === "1";

    return new NextResponse(new Uint8Array(documento.buffer), {
      status: 200,
      headers: {
        "Content-Type":
          tipo === "pdf"
            ? "application/pdf"
            : "application/xml; charset=utf-8",
        "Content-Disposition": `${
          download ? "attachment" : "inline"
        }; filename="${nome}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Documento-Fonte": documento.fonte,
      },
    });
  } catch (error) {
    const mensagem =
      error instanceof Error
        ? error.message
        : "Não foi possível obter o documento fiscal.";

    const status = /não autenticado|não encontrada/i.test(mensagem)
      ? 404
      : /rejeitado|somente para documento|Não é possível gerar/i.test(mensagem)
        ? 409
        : 422;

    return NextResponse.json({ erro: mensagem }, { status });
  }
}
