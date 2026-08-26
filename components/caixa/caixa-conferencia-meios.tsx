import { CampoValor } from "@/components/ui/campo-valor";
import { formatarMoeda } from "@/lib/relatorios/formatacao";
import {
  rotuloStatusDiferencaCaixa,
  statusDiferencaCaixa,
} from "@/lib/caixa/conferencia";
import { parseValorCaixa } from "@/lib/caixa/valor";
import type { CaixaFechamentoMeio, MeioConferenciaCaixa } from "@/lib/caixa/tipos";

function classeDiferenca(diferenca: number | undefined, cego: boolean) {
  if (cego || diferenca == null) {
    return "text-zinc-400";
  }
  if (diferenca === 0) {
    return "font-semibold text-zinc-950";
  }
  return diferenca > 0
    ? "font-semibold text-emerald-700"
    : "font-semibold text-rose-700";
}

export function CaixaConferenciaMeios({
  meios,
  valores,
  cego,
  somenteLeitura,
  onChange,
  onContarDinheiro,
}: {
  meios: Array<MeioConferenciaCaixa | CaixaFechamentoMeio>;
  valores?: Record<string, string>;
  cego?: boolean;
  somenteLeitura?: boolean;
  onChange?: (chave: string, valor: string) => void;
  onContarDinheiro?: (chave: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="updv-table" style={{ minWidth: 640 }}>
        <thead>
          <tr>
            <th>Forma</th>
            <th className="num">Esperado</th>
            <th className="num">Informado</th>
            <th className="num">Diferença</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {meios.map((meio) => {
            const chave = "chave" in meio ? meio.chave : "";
            const nome =
              "forma_nome" in meio ? meio.forma_nome : meio.forma_nome_snapshot;
            const afeta =
              "afeta_caixa_fisico" in meio
                ? meio.afeta_caixa_fisico
                : meio.afeta_caixa_fisico_snapshot;
            const esperado =
              "valor_esperado" in meio ? meio.valor_esperado : undefined;
            const informadoSnapshot =
              "valor_informado" in meio ? meio.valor_informado : undefined;
            const informadoTexto = valores?.[chave] ?? "";
            const informadoNumero =
              parseValorCaixa(informadoTexto) ??
              (informadoSnapshot == null ? null : informadoSnapshot);
            const diferenca =
              "diferenca" in meio && meio.diferenca != null
                ? meio.diferenca
                : undefined;
            const status =
              diferenca == null || cego
                ? null
                : statusDiferencaCaixa(diferenca);

            return (
              <tr key={chave || nome}>
                <td>
                  <div className="font-medium text-zinc-950">{nome}</div>
                  {afeta && onContarDinheiro && !somenteLeitura ? (
                    <button
                      type="button"
                      className="mt-1 text-[12px] font-medium text-zinc-700 underline"
                      onClick={() => onContarDinheiro(chave)}
                    >
                      Contar dinheiro
                    </button>
                  ) : null}
                </td>
                <td className="num">
                  {cego || esperado == null ? "—" : formatarMoeda(esperado)}
                </td>
                <td className="num">
                  {somenteLeitura ? (
                    informadoNumero == null ? "—" : formatarMoeda(informadoNumero)
                  ) : (
                    <CampoValor
                      value={informadoTexto}
                      onChange={(event) => onChange?.(chave, event.target.value)}
                      placeholder="0,00"
                      inputMode="decimal"
                      className="updv-input w-28 text-right"
                    />
                  )}
                </td>
                <td className={`num ${classeDiferenca(diferenca, Boolean(cego))}`}>
                  {cego || diferenca == null ? "—" : formatarMoeda(diferenca)}
                </td>
                <td>
                  {status && !cego ? rotuloStatusDiferencaCaixa(status) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
