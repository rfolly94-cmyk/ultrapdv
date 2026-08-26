"use client";

import {
  PALETAS_PDV_OPCOES,
  amostrasDaPaleta,
  tokensDaPaleta,
  type PreferenciasPdv,
} from "@/lib/pdv/preferencias";

export function PdvPreferenciasModal({
  inicial,
  permitirVendaSemEstoque,
  salvando,
  onCancelar,
  onPreview,
  onPermitirVendaSemEstoque,
  onSalvar,
}: {
  inicial: PreferenciasPdv;
  permitirVendaSemEstoque: boolean;
  salvando: boolean;
  onCancelar: () => void;
  onPreview: (preferencias: PreferenciasPdv) => void;
  onPermitirVendaSemEstoque: (valor: boolean) => void;
  onSalvar: (
    preferencias: PreferenciasPdv,
    permitirVendaSemEstoque: boolean
  ) => void;
}) {
  function atualizar(parcial: Partial<PreferenciasPdv>) {
    onPreview({ ...inicial, ...parcial });
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Fechar"
        className="absolute inset-0 bg-black/40"
        onClick={onCancelar}
      />
      <div className="pdv-modal-box relative z-10 w-full max-w-xl rounded-2xl p-5 shadow-2xl">
        <h2 className="text-xl font-bold">Preferências do PDV</h2>
        <p className="pdv-muted mt-1 text-sm">
          Vale para este usuário nesta empresa.
        </p>

        <p className="mt-5 text-xs font-semibold uppercase tracking-wide">
          Aparência
        </p>
        <p className="mt-3 text-sm font-semibold">Paleta do PDV</p>
        <div className="mt-3 grid max-h-[46vh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
          {PALETAS_PDV_OPCOES.map((paleta) => {
            const tokens = tokensDaPaleta(paleta.id);
            const amostras = amostrasDaPaleta(paleta.id);
            const ativa = inicial.paleta === paleta.id;
            return (
              <button
                key={paleta.id}
                type="button"
                onClick={() => atualizar({ paleta: paleta.id })}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm ${
                  ativa ? "ring-2 ring-[var(--pdv-primary)]" : ""
                }`}
                style={{
                  borderColor: ativa ? tokens.primary : tokens.border,
                  background: tokens.surface,
                  color: tokens.text,
                }}
              >
                <span className="flex gap-1" aria-hidden>
                  {amostras.map((cor, index) => (
                    <span
                      key={`${paleta.id}-${index}`}
                      className="h-3.5 w-3.5 rounded-full"
                      style={{
                        background: cor,
                        border: `1px solid ${tokens.border}`,
                      }}
                    />
                  ))}
                </span>
                {paleta.label}
              </button>
            );
          })}
        </div>

        <p className="mt-5 text-xs font-semibold uppercase tracking-wide">
          Exibição
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={inicial.mostrarLogoCentro}
            onChange={(event) =>
              atualizar({ mostrarLogoCentro: event.target.checked })
            }
          />
          Mostrar logo no centro do PDV
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={inicial.mostrarFotosProdutos}
            onChange={(event) =>
              atualizar({ mostrarFotosProdutos: event.target.checked })
            }
          />
          Mostrar fotos dos produtos
        </label>

        <p className="mt-5 text-xs font-semibold uppercase tracking-wide">
          Estoque
        </p>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={permitirVendaSemEstoque}
            onChange={(event) =>
              onPermitirVendaSemEstoque(event.target.checked)
            }
          />
          <span>
            <span className="font-medium">Permitir venda sem estoque</span>
            <span className="pdv-muted mt-0.5 block text-xs">
              Permite concluir vendas mesmo quando o estoque disponível for insuficiente.
            </span>
          </span>
        </label>
        <p className="pdv-muted mt-2 text-xs">
          Vale para toda a empresa, não só para este usuário.
        </p>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            className="rounded-md px-3 py-2 text-sm font-medium hover:bg-[var(--pdv-hover)]"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={salvando}
            onClick={() => onSalvar(inicial, permitirVendaSemEstoque)}
            className="pdv-btn-primary rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-60"
          >
            {salvando ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}
