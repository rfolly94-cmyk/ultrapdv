"use client";

export function SeletorCampos<T extends string>({
  campos,
  rotulos,
  selecionados,
  onChange,
}: {
  campos: readonly T[];
  rotulos: Record<T, string>;
  selecionados: T[];
  onChange: (campos: T[]) => void;
}) {
  function alternar(campo: T) {
    onChange(
      selecionados.includes(campo)
        ? selecionados.filter((item) => item !== campo)
        : [...selecionados, campo]
    );
  }

  return (
    <div>
      <div className="mb-3 flex gap-2">
        <button
          type="button"
          className="updv-btn updv-btn-ghost"
          onClick={() => onChange([...campos])}
        >
          Marcar todos
        </button>
        <button
          type="button"
          className="updv-btn updv-btn-ghost"
          onClick={() => onChange([])}
        >
          Desmarcar todos
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {campos.map((campo) => (
          <label
            key={campo}
            className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[13px]"
          >
            <input
              type="checkbox"
              checked={selecionados.includes(campo)}
              onChange={() => alternar(campo)}
            />
            {rotulos[campo]}
          </label>
        ))}
      </div>
    </div>
  );
}
