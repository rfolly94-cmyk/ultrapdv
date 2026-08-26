"use client";

import type { InputHTMLAttributes } from "react";

import {
  consumirSelecaoValorPendente,
  marcarSelecaoValorSeCliqueInicial,
  selecionarValorAoFocar,
} from "@/lib/ui/selecionar-valor-ao-focar";

/**
 * Input de valor (moeda, quantidade, percentual) com seleção total ao focar.
 */
export function CampoValor({
  onFocus,
  onMouseDown,
  onMouseUp,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      onMouseDown={(event) => {
        marcarSelecaoValorSeCliqueInicial(event);
        onMouseDown?.(event);
      }}
      onFocus={(event) => {
        onFocus?.(event);
        selecionarValorAoFocar(event);
      }}
      onMouseUp={(event) => {
        consumirSelecaoValorPendente(event);
        onMouseUp?.(event);
      }}
    />
  );
}
