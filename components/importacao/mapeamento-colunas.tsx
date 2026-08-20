"use client";

export function MapeamentoColunas({
  destinos,
  rotulos,
  colunas,
  mapeamento,
  onChange,
}: {
  destinos: string[];
  rotulos: Record<string, string>;
  colunas: string[];
  mapeamento: Record<string, string | null>;
  onChange: (campo: string, coluna: string | null) => void;
}) {
  const usados = Object.values(mapeamento).filter(Boolean) as string[];

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <table className="updv-table">
        <thead>
          <tr>
            <th>Campo UltraPDV</th>
            <th>Coluna da planilha</th>
          </tr>
        </thead>
        <tbody>
          {destinos.map((campo) => {
            const atual = mapeamento[campo] ?? "";
            const conflito =
              atual && usados.filter((item) => item === atual).length > 1;
            return (
              <tr key={campo}>
                <td className="font-medium">{rotulos[campo] ?? campo}</td>
                <td>
                  <select
                    className="updv-input"
                    value={atual}
                    onChange={(event) =>
                      onChange(campo, event.target.value || null)
                    }
                  >
                    <option value="">Não vinculado</option>
                    {colunas.map((coluna) => (
                      <option key={coluna} value={coluna}>
                        {coluna}
                      </option>
                    ))}
                  </select>
                  {conflito ? (
                    <p className="mt-1 text-[12px] text-amber-800">
                      Esta coluna já está vinculada a outro campo.
                    </p>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
