import { ContabilidadeXmlsLista } from "@/components/contabilidade/xmls-lista";
import {
  chaveCompetencia,
  parseCompetencia,
} from "@/lib/contabilidade/competencia";
import { obterContextoContabilidade, planoContabilidadePermitidoNaSessao } from "@/lib/contabilidade/contexto";
import { carregarDocumentosCompetencia } from "@/lib/contabilidade/documentos";
import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import { temPermissao } from "@/lib/permissoes/tem-permissao";

export const metadata = {
  title: "XMLs",
};

type PageProps = {
  searchParams: Promise<{ competencia?: string }>;
};

export default async function ContabilidadeXmlsPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const plano = await planoContabilidadePermitidoNaSessao();
  if (!plano.permitido) {
    return null;
  }
  const ctx = await obterContextoContabilidade();
  const sessaoPermissoes = await obterPermissoesSessao();
  const podeRelatorio = Boolean(
    sessaoPermissoes &&
      temPermissao(sessaoPermissoes.permissoes, "contabilidade", "relatorios")
  );
  const competencia = parseCompetencia(params.competencia);
  const documentos = await carregarDocumentosCompetencia(
    ctx.supabase,
    ctx.empresaId,
    competencia,
    { porPagina: 400 },
    ctx.fusoHorario
  );

  const ids = documentos.todos.map((item) => item.id);
  const { data: eventos } = ids.length
    ? await ctx.supabase
        .from("fiscal_emissao_eventos")
        .select("id, emissao_id, tipo, xml_hex")
        .eq("empresa_id", ctx.empresaId)
        .in("emissao_id", ids)
    : { data: [] };

  return (
    <>
      <div className="flex justify-end px-4 py-2">
        {podeRelatorio ? (
          <a
            href={`/api/contabilidade/relatorio?competencia=${chaveCompetencia(competencia)}`}
            className="updv-btn updv-btn-ghost"
          >
            Relatório CSV
          </a>
        ) : null}
      </div>
      <ContabilidadeXmlsLista
        documentos={documentos.todos}
        eventos={(eventos ?? []).map((evento) => ({
          id: evento.id,
          tipo: String(evento.tipo),
          emissaoId: evento.emissao_id,
          temXml: Boolean(evento.xml_hex),
        }))}
        competencia={chaveCompetencia(competencia)}
      />
    </>
  );
}
