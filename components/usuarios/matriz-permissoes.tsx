"use client";

import {
  ACAO_LABEL,
  ACOES_POR_MODULO,
  MODULO_LABEL,
  MODULOS_PERMISSAO,
  type ModuloPermissao,
  type PermissoesEfetivas,
} from "@/lib/permissoes/tipos";

export function MatrizPermissoes({
  valor,
  onChange,
  somenteLeitura = false,
}: {
  valor: PermissoesEfetivas;
  onChange?: (next: PermissoesEfetivas) => void;
  somenteLeitura?: boolean;
}) {
  function alternar(modulo: ModuloPermissao, acao: string, marcado: boolean) {
    if (somenteLeitura || !onChange) {
      return;
    }

    const next = JSON.parse(JSON.stringify(valor)) as PermissoesEfetivas;
    (next[modulo] as Record<string, boolean>)[acao] = marcado;

    if (acao !== "acessar" && marcado) {
      (next[modulo] as Record<string, boolean>).acessar = true;
    }

    if (acao === "acessar" && !marcado) {
      for (const outra of ACOES_POR_MODULO[modulo]) {
        (next[modulo] as Record<string, boolean>)[outra] = false;
      }
    }

    onChange(next);
  }

  return (
    <div className="grid gap-3">
      {MODULOS_PERMISSAO.map((modulo) => (
        <section
          key={modulo}
          className="rounded-xl border border-zinc-200 p-4"
        >
          <h3 className="text-sm font-semibold text-zinc-900">
            {MODULO_LABEL[modulo]}
          </h3>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
            {ACOES_POR_MODULO[modulo].map((acao) => (
              <label
                key={acao}
                className="flex items-center gap-2 text-sm text-zinc-700"
              >
                <input
                  type="checkbox"
                  checked={Boolean(
                    (valor[modulo] as Record<string, boolean>)[acao]
                  )}
                  disabled={somenteLeitura}
                  onChange={(event) =>
                    alternar(modulo, acao, event.target.checked)
                  }
                />
                {ACAO_LABEL[acao] ?? acao}
              </label>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
