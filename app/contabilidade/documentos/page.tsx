import { ContabilidadeDocumentosLista } from "@/components/contabilidade/documentos-lista";
import { parseCompetencia } from "@/lib/contabilidade/competencia";
import { obterContextoContabilidade } from "@/lib/contabilidade/contexto";
import { carregarDocumentosCompetencia } from "@/lib/contabilidade/documentos";

export const metadata = {
  title: "Documentos fiscais",
};

type PageProps = {
  searchParams: Promise<{ competencia?: string }>;
};

export default async function ContabilidadeDocumentosPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const ctx = await obterContextoContabilidade();
  const competencia = parseCompetencia(params.competencia);
  const documentos = await carregarDocumentosCompetencia(
    ctx.supabase,
    ctx.empresaId,
    competencia,
    { porPagina: 200 },
    ctx.fusoHorario
  );

  return (
    <ContabilidadeDocumentosLista
      documentos={documentos.todos}
      somenteLeitura={ctx.ehContador}
    />
  );
}
