import { formatarDataHora } from "@/lib/relatorios/formatacao";
import type { CaixaAvisoReaberto } from "@/lib/caixa/tipos";

export function CaixaAvisoReabertoFaixa({
  aviso,
}: {
  aviso: CaixaAvisoReaberto;
}) {
  return (
    <div
      className="sticky top-0 z-30 border-b border-amber-300 bg-amber-100 px-4 py-2 text-amber-950"
      data-caixa-aviso-reaberto="true"
      role="status"
    >
      <p className="text-sm font-semibold">⚠ Caixa reaberto</p>
      <p className="text-[13px]">
        Esta sessão foi reaberta em {formatarDataHora(aviso.reaberto_em)}
        {aviso.reaberto_por_nome ? ` por ${aviso.reaberto_por_nome}` : ""}.
      </p>
      {aviso.motivo ? (
        <p className="text-[13px]">Motivo: {aviso.motivo}</p>
      ) : null}
    </div>
  );
}
