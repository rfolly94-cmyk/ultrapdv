import { liberarCompetenciaAction } from "@/app/contabilidade/actions";
import { DataTable, DataTableEmpty } from "@/components/ui/data-table";
import { PageAlert } from "@/components/ui/page-alert";
import { StatusBadge } from "@/components/ui/status-badge";
import { obterPermissoesSessao } from "@/lib/permissoes/sessao";
import { temPermissao } from "@/lib/permissoes/tem-permissao";
import { auditarCompetencia } from "@/lib/contabilidade/auditoria";
import {
  chaveCompetencia,
  competenciaAtual,
  parseCompetencia,
  rotuloCompetencia,
} from "@/lib/contabilidade/competencia";
import { obterContextoContabilidade } from "@/lib/contabilidade/contexto";
import { carregarVisaoGeral } from "@/lib/contabilidade/visao";

export const metadata = {
  title: "Competências",
};

type PageProps = {
  searchParams: Promise<{
    competencia?: string;
    erro?: string;
    sucesso?: string;
  }>;
};

export default async function ContabilidadeCompetenciasPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const ctx = await obterContextoContabilidade();
  const competencia = parseCompetencia(params.competencia);
  const sessaoPermissoes = await obterPermissoesSessao();
  const podeLiberar = Boolean(
    sessaoPermissoes &&
      temPermissao(sessaoPermissoes.permissoes, "contabilidade", "fechamento")
  );
  const atual = competenciaAtual();

  const [{ data: rows }, visao, auditoria] = await Promise.all([
    ctx.supabase
      .from("contabilidade_competencias")
      .select("ano, mes, status, liberado_em, liberado_por, observacao")
      .eq("empresa_id", ctx.empresaId)
      .order("ano", { ascending: false })
      .order("mes", { ascending: false })
      .limit(24),
    carregarVisaoGeral(ctx.supabase, ctx.empresaId, competencia, ctx.fusoHorario),
    auditarCompetencia(ctx.supabase, ctx.empresaId, competencia, ctx.fusoHorario),
  ]);

  const { data: inventario } = await ctx.supabase
    .from("inventarios_fiscais")
    .select("id, data_snapshot")
    .eq("empresa_id", ctx.empresaId)
    .order("data_snapshot", { ascending: false })
    .limit(1)
    .maybeSingle();

  const usuariosIds = [
    ...new Set(
      (rows ?? [])
        .map((item) => item.liberado_por)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const { data: usuarios } = usuariosIds.length
    ? await ctx.supabase.from("usuarios").select("id, nome").in("id", usuariosIds)
    : { data: [] };
  const nomePorId = new Map((usuarios ?? []).map((item) => [item.id, item.nome]));

  const lista = Array.from({ length: 12 }, (_, index) => {
    const mes = atual.mes - index;
    const ano = mes > 0 ? atual.ano : atual.ano - 1;
    const mesAjustado = mes > 0 ? mes : mes + 12;
    const registro = (rows ?? []).find(
      (item) => item.ano === ano && item.mes === mesAjustado
    );
    return {
      ano,
      mes: mesAjustado,
      status: registro?.status ?? "ABERTA",
      liberadoEm: registro?.liberado_em ?? null,
      liberadoPor: registro?.liberado_por
        ? nomePorId.get(registro.liberado_por) ?? "—"
        : "—",
    };
  });

  return (
    <>
      {params.erro && <PageAlert type="erro">{params.erro}</PageAlert>}
      {params.sucesso && <PageAlert type="sucesso">{params.sucesso}</PageAlert>}

      {podeLiberar && (
        <form
          action={liberarCompetenciaAction}
          className="mx-4 mt-3 rounded-md border border-zinc-200 p-3"
        >
          <input
            type="hidden"
            name="competencia"
            value={chaveCompetencia(competencia)}
          />
          <p className="text-[13px] font-semibold">
            Liberar {rotuloCompetencia(competencia)} para a contabilidade
          </p>
          <p className="mt-1 text-[12px] text-zinc-500">
            {visao.documentos} documentos · {visao.xmlsDisponiveis} XMLs
            disponíveis · {auditoria.erros} erros · {auditoria.alertas} alertas
            · inventário {inventario ? inventario.data_snapshot : "não gerado"}.
            Não fecha vendas, estoque nem gera SPED.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              name="observacao"
              placeholder="Observação opcional"
              className="updv-input h-8 min-w-[220px] text-[12px]"
            />
            {auditoria.erros > 0 && (
              <label className="flex items-center gap-1.5 text-[12px] text-zinc-600">
                <input type="checkbox" name="confirmar_erros" value="1" />
                Confirmar mesmo com erros
              </label>
            )}
            <button type="submit" className="updv-btn updv-btn-primary">
              Liberar competência para a contabilidade
            </button>
          </div>
        </form>
      )}

      <DataTable minWidth={900}>
        <thead>
          <tr>
            <th>Competência</th>
            <th>Status</th>
            <th>Data de liberação</th>
            <th>Liberado por</th>
            <th>Pendências</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {lista.length === 0 && (
            <DataTableEmpty colSpan={6}>Nenhuma competência.</DataTableEmpty>
          )}
          {lista.map((item) => {
            const chave = chaveCompetencia(item);
            const selecionada =
              item.ano === competencia.ano && item.mes === competencia.mes;
            return (
              <tr key={chave} data-selected={selecionada}>
                <td>{rotuloCompetencia(item)}</td>
                <td>
                  <StatusBadge
                    status={
                      item.status === "LIBERADA_CONTABILIDADE"
                        ? "sucesso"
                        : "pendente"
                    }
                  >
                    {item.status === "LIBERADA_CONTABILIDADE"
                      ? "Liberada"
                      : "Aberta"}
                  </StatusBadge>
                </td>
                <td>
                  {item.liberadoEm
                    ? new Date(item.liberadoEm).toLocaleString("pt-BR")
                    : "—"}
                </td>
                <td>{item.liberadoPor}</td>
                <td>
                  {selecionada
                    ? `${auditoria.erros} erros · ${auditoria.alertas} alertas`
                    : "—"}
                </td>
                <td>
                  <a
                    href={`/contabilidade/competencias?competencia=${chave}`}
                    className="updv-btn-row"
                  >
                    Abrir
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
    </>
  );
}
