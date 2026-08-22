import { PageAlert } from "@/components/ui/page-alert";
import { StatusBadge } from "@/components/ui/status-badge";
import { parseCompetencia } from "@/lib/contabilidade/competencia";
import { obterContextoContabilidade, planoContabilidadePermitidoNaSessao } from "@/lib/contabilidade/contexto";
import { carregarVisaoGeral } from "@/lib/contabilidade/visao";

export const metadata = {
  title: "Contabilidade",
};

const moeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function valorOuTraco(valor: number | null) {
  return valor == null ? "—" : moeda.format(valor);
}

type PageProps = {
  searchParams: Promise<{
    competencia?: string;
    erro?: string;
    sucesso?: string;
  }>;
};

export default async function ContabilidadeVisaoPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const plano = await planoContabilidadePermitidoNaSessao();
  if (!plano.permitido) {
    return null;
  }
  const ctx = await obterContextoContabilidade();
  const competencia = parseCompetencia(params.competencia);
  const visao = await carregarVisaoGeral(
    ctx.supabase,
    ctx.empresaId,
    competencia,
    ctx.fusoHorario
  );

  const cards = [
    ["NF-e autorizadas", visao.cards.nfeAutorizadas],
    ["NFC-e autorizadas", visao.cards.nfceAutorizadas],
    ["Canceladas", visao.cards.canceladas],
    ["Inutilizadas", visao.cards.inutilizadas],
    ["Rejeitadas", visao.cards.rejeitadas],
    ["Aguardando reconciliação", visao.cards.aguardandoReconciliacao],
    ["Aguardando inutilização", visao.cards.aguardandoInutilizacao],
  ] as const;

  const tributos = [
    ["Total fiscal das vendas", visao.totais.totalVendas],
    ["Base ICMS", visao.totais.baseIcms],
    ["ICMS", visao.totais.icms],
    ["PIS", visao.totais.pis],
    ["COFINS", visao.totais.cofins],
    ["IPI", visao.totais.ipi],
    ["IBS", visao.totais.ibs],
    ["CBS", visao.totais.cbs],
  ] as const;

  return (
    <>
      {params.erro && <PageAlert type="erro">{params.erro}</PageAlert>}
      {params.sucesso && <PageAlert type="sucesso">{params.sucesso}</PageAlert>}

      <div className="flex items-center justify-end px-4 pt-3">
        <StatusBadge
          status={visao.status === "LIBERADA_CONTABILIDADE" ? "sucesso" : "pendente"}
        >
          {visao.status === "LIBERADA_CONTABILIDADE"
            ? "Liberada pela empresa"
            : "Em preparação"}
        </StatusBadge>
      </div>

      <div className="grid grid-cols-2 gap-2 px-4 py-3 md:grid-cols-4 xl:grid-cols-7">
        {cards.map(([label, valor]) => (
          <div
            key={label}
            className="rounded-md border border-zinc-200 px-3 py-2"
          >
            <p className="text-[11px] text-zinc-500">{label}</p>
            <p className="text-[18px] font-semibold leading-tight">{valor}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 px-4 pb-3 md:grid-cols-4">
        {tributos.map(([label, valor]) => (
          <div
            key={label}
            className="rounded-md border border-zinc-200 px-3 py-2"
          >
            <p className="text-[11px] text-zinc-500">{label}</p>
            <p className="text-[15px] font-medium leading-tight">
              {valorOuTraco(valor)}
            </p>
          </div>
        ))}
      </div>

      <section className="px-4 pb-6">
        <h2 className="mb-2 text-[13px] font-semibold">
          Pendências da competência
        </h2>
        {visao.auditoria.itens.length === 0 ? (
          <p className="text-[13px] text-zinc-500">
            Nenhuma pendência identificada em {visao.rotulo}.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200">
            {visao.auditoria.itens.slice(0, 12).map((item, index) => (
              <li
                key={`${item.tipo}-${index}`}
                className="flex items-start justify-between gap-3 px-3 py-2 text-[13px]"
              >
                <div>
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
                  <p className="mt-1 text-zinc-800">{item.descricao}</p>
                </div>
                {item.href && !ctx.ehContador && (
                  <a href={item.href} className="updv-btn-row shrink-0">
                    Corrigir
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
