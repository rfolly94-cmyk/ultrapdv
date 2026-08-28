import { formatarDataHora } from "@/lib/relatorios/formatacao";
import type { CaixaEventoGaveta } from "@/lib/caixa/tipos";

const ROTULO_ORIGEM: Record<CaixaEventoGaveta["origem"], string> = {
  caixa: "Caixa",
  pdv: "PDV",
  venda: "Venda",
};

export function CaixaEventosGaveta({
  eventos,
}: {
  eventos: CaixaEventoGaveta[];
}) {
  if (eventos.length === 0) {
    return null;
  }

  return (
    <div>
      <h3 className="mb-2 text-[13px] font-semibold text-zinc-950">
        Aberturas de gaveta
      </h3>
      <div className="overflow-x-auto">
        <table className="updv-table" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th>Hora</th>
              <th>Origem</th>
              <th>Operador</th>
            </tr>
          </thead>
          <tbody>
            {eventos.map((evento) => (
              <tr key={evento.id}>
                <td>{formatarDataHora(evento.created_at)}</td>
                <td>{ROTULO_ORIGEM[evento.origem]}</td>
                <td>{evento.usuario_nome || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
