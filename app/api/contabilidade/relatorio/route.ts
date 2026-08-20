import { NextRequest, NextResponse } from "next/server";

import { podeAcessarContabilidade } from "@/lib/contabilidade/acesso";
import { csvDocumento } from "@/lib/contabilidade/csv";
import {
  chaveCompetencia,
  parseCompetencia,
  slugArquivo,
} from "@/lib/contabilidade/competencia";
import { obterContextoContabilidade } from "@/lib/contabilidade/contexto";
import { carregarDocumentosCompetencia } from "@/lib/contabilidade/documentos";
import { modeloFiscalRotulo } from "@/lib/contabilidade/regras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const ctx = await obterContextoContabilidade();

  if (!podeAcessarContabilidade(ctx.perfil)) {
    return NextResponse.json({ erro: "Acesso negado." }, { status: 403 });
  }

  const competencia = parseCompetencia(
    request.nextUrl.searchParams.get("competencia")
  );
  const documentos = await carregarDocumentosCompetencia(
    ctx.supabase,
    ctx.empresaId,
    competencia,
    {},
    ctx.fusoHorario
  );

  const csv = csvDocumento([
    [
      "data",
      "modelo",
      "serie",
      "numero",
      "chave",
      "cliente",
      "cpf_cnpj",
      "valor",
      "situacao",
      "cfop",
      "cstat",
      "protocolo",
    ],
    ...documentos.todos.map((documento) => [
      documento.data,
      modeloFiscalRotulo(documento.modelo),
      String(documento.serie),
      documento.numero,
      documento.chave ?? "",
      documento.cliente,
      documento.documento ?? "",
      String(documento.valor),
      documento.status,
      documento.cfop ?? "",
      documento.cstat ?? "",
      documento.protocolo ?? "",
    ]),
  ]);

  const nome = `${slugArquivo(ctx.empresaNome)}-${chaveCompetencia(competencia)}-documentos-fiscais.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
