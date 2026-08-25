import { montarHistoricoCiclos } from "@/lib/caixa/reabertura";
import type { CaixaCicloFechamento, CaixaReabertura } from "@/lib/caixa/tipos";
import { formatarDataHora, formatarMoeda } from "@/lib/relatorios/formatacao";

export function CaixaHistoricoCiclos({
  ciclos,
  reaberturas,
}: {
  ciclos: CaixaCicloFechamento[];
  reaberturas: CaixaReabertura[];
}) {
  const historico = montarHistoricoCiclos({ ciclos, reaberturas });
  if (historico.length === 0) {
    return null;
  }

  return (
    <div data-caixa-historico-ciclos="true">
      <h3 className="mb-2 text-[13px] font-semibold text-zinc-950">
        Histórico de fechamentos e reaberturas
      </h3>
      <ul className="space-y-2 text-[13px] text-zinc-700">
        {historico.map((evento, indice) =>
          evento.tipo === "fechamento" ? (
            <li key={`f-${evento.versao}-${indice}`}>
              Fechado em {formatarDataHora(evento.em)} por {evento.porNome || "—"}
              . Diferença: {formatarMoeda(evento.diferenca)}
            </li>
          ) : (
            <li key={`r-${evento.em}-${indice}`}>
              Reaberto em {formatarDataHora(evento.em)} por {evento.porNome || "—"}
              . Motivo: {evento.motivo}
            </li>
          )
        )}
      </ul>
    </div>
  );
}
