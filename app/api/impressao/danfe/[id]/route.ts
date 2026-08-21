import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { buscarVinculoEmpresaAtiva } from "@/lib/empresa/empresa-ativa";
import { obterDocumentoFiscal } from "@/lib/fiscal/obter-documento-fiscal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();
  const { data: claimsData, error } = await supabase.auth.getClaims();
  const usuarioId = claimsData?.claims?.sub;

  if (error || !usuarioId) {
    return NextResponse.json({ erro: "Não autenticado." }, { status: 401 });
  }

  const { data: vinculo } = await buscarVinculoEmpresaAtiva<{
    empresa_id: string;
  }>(supabase, usuarioId, "empresa_id");

  if (!vinculo) {
    return NextResponse.json(
      { erro: "Empresa ativa não encontrada." },
      { status: 403 }
    );
  }

  const admin = createAdminClient();
  const { data: emissao } = await admin
    .from("fiscal_emissoes")
    .select("id, empresa_id, modelo, status")
    .eq("empresa_id", vinculo.empresa_id)
    .eq("id", id)
    .maybeSingle();

  if (!emissao || emissao.empresa_id !== vinculo.empresa_id) {
    return NextResponse.json({ erro: "Emissão não encontrada." }, { status: 404 });
  }

  if (emissao.status !== "autorizada") {
    return NextResponse.json(
      { erro: "DANFE automático somente para documento autorizado." },
      { status: 409 }
    );
  }

  try {
    const documento = await obterDocumentoFiscal({
      admin,
      empresaId: vinculo.empresa_id,
      emissaoId: id,
      tipo: "pdf",
    });

    const modeloNome = emissao.modelo === "55" ? "nfe" : "nfce";
    return new NextResponse(new Uint8Array(documento.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="danfe-${modeloNome}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (caught) {
    const mensagem =
      caught instanceof Error
        ? caught.message
        : "Não foi possível obter o DANFE.";
    return NextResponse.json({ erro: mensagem }, { status: 422 });
  }
}
