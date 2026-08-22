import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { auditarCompetencia } from "@/lib/contabilidade/auditoria";
import {
  chaveCompetencia,
  parseCompetencia,
} from "@/lib/contabilidade/competencia";
import { obterContextoContabilidade, planoContabilidadePermitidoNaSessao } from "@/lib/contabilidade/contexto";

export const metadata = {
  title: "Auditoria fiscal",
};

type PageProps = {
  searchParams: Promise<{ competencia?: string }>;
};

export default async function ContabilidadeAuditoriaPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const plano = await planoContabilidadePermitidoNaSessao();
  if (!plano.permitido) {
    return null;
  }
  const ctx = await obterContextoContabilidade();
  const competencia = parseCompetencia(params.competencia);
  const resultado = await auditarCompetencia(
    ctx.supabase,
    ctx.empresaId,
    competencia,
    ctx.fusoHorario
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 md:grid-cols-4">
          <Resumo label="Documentos analisados" valor={resultado.documentosAnalisados} />
          <Resumo label="Erros" valor={resultado.erros} />
          <Resumo label="Alertas" valor={resultado.alertas} />
          <Resumo label="Informações" valor={resultado.informacoes} />
        </div>
        <a
          href={`/contabilidade/auditoria?competencia=${chaveCompetencia(competencia)}`}
          className="updv-btn updv-btn-primary"
        >
          Validar competência
        </a>
      </div>

      <DataTable minWidth={900}>
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Gravidade</th>
            <th>Descrição</th>
            <th>Relacionado</th>
            <th>Ação sugerida</th>
          </tr>
        </thead>
        <tbody>
          {resultado.itens.length === 0 && (
            <DataTableEmpty colSpan={5}>
              Nenhuma inconsistência encontrada nesta competência.
            </DataTableEmpty>
          )}
          {resultado.itens.map((item, index) => (
            <tr key={`${item.tipo}-${index}`}>
              <td>{item.tipo}</td>
              <td>
                <StatusBadge
                  status={
                    item.gravidade === "erro"
                      ? "rejeitada"
                      : item.gravidade === "atencao"
                        ? "pendente"
                        : "ativo"
                  }
                >
                  {item.gravidade === "erro"
                    ? "Erro"
                    : item.gravidade === "atencao"
                      ? "Atenção"
                      : "Informação"}
                </StatusBadge>
              </td>
              <td className="max-w-[420px]">{item.descricao}</td>
              <td>{item.relacionado ?? "—"}</td>
              <td>
                {item.href && !ctx.ehContador ? (
                  <a href={item.href} className="updv-btn-row">
                    Abrir correção
                  </a>
                ) : (
                  "Revisar cadastro ou documento"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </>
  );
}

function Resumo({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="rounded-md border border-zinc-200 px-3 py-2">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className="text-[18px] font-semibold leading-tight">{valor}</p>
    </div>
  );
}
