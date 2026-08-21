"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { AppModal } from "@/components/ui/app-modal";
import {
  formatarPeriodoPersonalizadoExibicao,
  montarHrefListaVendas,
  type FiltrosListaVendas,
  type PeriodoListaVendas,
} from "@/lib/vendas/periodo-lista";

export function VendasPeriodoFiltro({
  filtros,
  dataHojeIso,
}: {
  filtros: FiltrosListaVendas;
  dataHojeIso: string;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [inicio, setInicio] = useState(
    filtros.inicio ?? dataHojeIso
  );
  const [fim, setFim] = useState(
    filtros.fim ?? dataHojeIso
  );

  const rotuloPersonalizado =
    formatarPeriodoPersonalizadoExibicao(
      filtros.inicio,
      filtros.fim
    );

  function ir(patch: Partial<FiltrosListaVendas>) {
    router.push(
      montarHrefListaVendas({
        ...filtros,
        ...patch,
      })
    );
  }

  function abrirPersonalizado() {
    setInicio(filtros.inicio ?? dataHojeIso);
    setFim(filtros.fim ?? dataHojeIso);
    setAberto(true);
  }

  function aplicarPersonalizado() {
    if (!inicio || !fim) {
      return;
    }

    const de = inicio <= fim ? inicio : fim;
    const ate = inicio <= fim ? fim : inicio;

    setAberto(false);
    ir({
      periodo: "personalizado",
      inicio: de,
      fim: ate,
    });
  }

  return (
    <>
      <select
        value={filtros.periodo}
        onChange={(event) => {
          const valor =
            event.target.value as PeriodoListaVendas;

          if (valor === "personalizado") {
            event.target.value = filtros.periodo;
            abrirPersonalizado();
            return;
          }

          ir({
            periodo: valor,
            inicio: null,
            fim: null,
          });
        }}
        className={
          filtros.periodo === "personalizado"
            ? "updv-select w-[210px]"
            : "updv-select w-[160px]"
        }
        aria-label="Período"
        title={
          filtros.periodo === "personalizado"
            ? rotuloPersonalizado
            : undefined
        }
      >
        <option value="hoje">Hoje</option>
        <option value="ontem">Ontem</option>
        <option value="7dias">Últimos 7 dias</option>
        <option value="30dias">Últimos 30 dias</option>
        <option value="personalizado">
          {filtros.periodo === "personalizado"
            ? rotuloPersonalizado
            : "Escolher período"}
        </option>
      </select>

      <AppModal
        open={aberto}
        title="Escolher período"
        onClose={() => setAberto(false)}
        footer={
          <>
            <button
              type="button"
              className="updv-btn updv-btn-ghost"
              onClick={() => setAberto(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="updv-btn updv-btn-primary"
              onClick={aplicarPersonalizado}
              disabled={!inicio || !fim}
            >
              Aplicar
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-zinc-500">
              Data inicial
            </span>
            <input
              type="date"
              value={inicio}
              onChange={(event) =>
                setInicio(event.target.value)
              }
              className="updv-input w-full"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-zinc-500">
              Data final
            </span>
            <input
              type="date"
              value={fim}
              onChange={(event) =>
                setFim(event.target.value)
              }
              className="updv-input w-full"
            />
          </label>
        </div>
      </AppModal>
    </>
  );
}
